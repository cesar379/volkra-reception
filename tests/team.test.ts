import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/server/db/client";
import { DEMO_USERS } from "@/server/db/seed";
import { claimInvites, deleteBusiness, exportBusiness, inviteMember, listTeam, removeMember, revokeInvite } from "@/server/team";
import { CLINIC, GARAGE, freshDb } from "./helpers";

const OWNER = DEMO_USERS.clinic.id;
const NEW_USER = "dddddddd-0000-4000-8000-000000000001";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => db.close());

const memberIds = async (businessId: string) => (await listTeam(db, businessId)).members.map((m) => m.user_id);

describe("Personas con acceso", () => {
  it("invitación por email: al entrar con ese email recibe acceso, solo a ese negocio", async () => {
    expect(await inviteMember(db, { businessId: CLINIC, email: " Laura@Clinica.TEST ", role: "staff", invitedBy: OWNER })).toEqual({ ok: true, added: "invite" });
    expect((await listTeam(db, CLINIC)).invites.map((i) => i.email)).toEqual(["laura@clinica.test"]);

    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [NEW_USER, "laura@clinica.test"]);
    expect(await claimInvites(db, NEW_USER, "LAURA@clinica.test")).toBe(1);
    expect(await memberIds(CLINIC)).toContain(NEW_USER);
    expect(await memberIds(GARAGE)).not.toContain(NEW_USER);
    expect((await listTeam(db, CLINIC)).invites).toHaveLength(0);
    // Volver a entrar no duplica nada
    expect(await claimInvites(db, NEW_USER, "laura@clinica.test")).toBe(0);

    // Con acceso, ve los datos de la clínica por RLS, pero no los del taller
    const own = await db.asUser(NEW_USER, (q) => q.query<{ id: string }>(`select id from businesses`));
    expect(own.map((r) => r.id)).toEqual([CLINIC]);
  });

  it("si ya tiene cuenta, el acceso es inmediato; no se duplica", async () => {
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [NEW_USER, "ya@existe.test"]);
    expect(await inviteMember(db, { businessId: CLINIC, email: "ya@existe.test", role: "owner", invitedBy: OWNER })).toEqual({ ok: true, added: "member" });
    expect(await inviteMember(db, { businessId: CLINIC, email: "ya@existe.test", role: "staff", invitedBy: OWNER })).toMatchObject({ ok: false });
    expect(await inviteMember(db, { businessId: CLINIC, email: "no-es-email", role: "staff", invitedBy: OWNER })).toMatchObject({ ok: false });
  });

  it("anular invitación y quitar acceso; nunca queda el negocio sin administrador", async () => {
    await inviteMember(db, { businessId: CLINIC, email: "otra@clinica.test", role: "staff", invitedBy: OWNER });
    const inv = (await listTeam(db, CLINIC)).invites[0];
    await revokeInvite(db, GARAGE, inv.id); // de otro negocio: no hace nada
    expect((await listTeam(db, CLINIC)).invites).toHaveLength(1);
    await revokeInvite(db, CLINIC, inv.id);
    expect((await listTeam(db, CLINIC)).invites).toHaveLength(0);

    expect(await removeMember(db, CLINIC, OWNER)).toMatchObject({ ok: false });
    await db.query(`insert into auth.users (id, email) values ($1, $2)`, [NEW_USER, "socio@clinica.test"]);
    await inviteMember(db, { businessId: CLINIC, email: "socio@clinica.test", role: "owner", invitedBy: OWNER });
    expect(await removeMember(db, CLINIC, OWNER)).toEqual({ ok: true });
    expect(await memberIds(CLINIC)).toEqual([NEW_USER]);
  });
});

describe("Exportación y baja", () => {
  it("exporta los datos del negocio y solo los suyos", async () => {
    const data = await db.asUser(OWNER, (q) => exportBusiness(q, CLINIC));
    expect(data.business).toMatchObject({ id: CLINIC });
    expect(data.services.length).toBeGreaterThan(0);
    expect(data.staff.length).toBeGreaterThan(0);
    const garage = await db.asUser(OWNER, (q) => exportBusiness(q, GARAGE));
    expect(garage.business).toBeNull();
    expect(garage.customers).toHaveLength(0);
  });

  it("la baja borra el negocio y todos sus datos, sin tocar los de otros", async () => {
    const before = await db.query<{ n: number }>(`select count(*)::int n from appointments where business_id = $1`, [GARAGE]);
    await deleteBusiness(db, CLINIC);
    for (const t of ["businesses", "appointments", "customers", "calls", "services", "staff", "memberships"]) {
      const col = t === "businesses" ? "id" : "business_id";
      const r = await db.query<{ n: number }>(`select count(*)::int n from ${t} where ${col} = $1`, [CLINIC]);
      expect(r[0].n, t).toBe(0);
    }
    const after = await db.query<{ n: number }>(`select count(*)::int n from appointments where business_id = $1`, [GARAGE]);
    expect(after[0].n).toBe(before[0].n);
  });
});
