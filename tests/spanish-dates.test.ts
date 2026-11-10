import { describe, expect, it } from "vitest";
import { parseDay, parsePartOfDay } from "@/server/booking/spanish-dates";
import { NOW } from "./helpers";

const TZ = "Europe/Madrid";
// NOW = jueves 22 de octubre de 2026, 10:00
const day = (t: string) => {
  const r = parseDay(t, NOW, TZ);
  return r.ok ? r.day : `ERROR: ${r.reason}`;
};

describe("fechas en español (Europe/Madrid)", () => {
  it("relativas básicas", () => {
    expect(day("hoy")).toBe("2026-10-22");
    expect(day("mañana")).toBe("2026-10-23");
    expect(day("Mañana por la tarde")).toBe("2026-10-23");
    expect(day("pasado mañana")).toBe("2026-10-24");
  });
  it("días de la semana", () => {
    expect(day("el lunes")).toBe("2026-10-26");
    expect(day("el jueves")).toBe("2026-10-29"); // dicho un jueves: el de la semana siguiente
    expect(day("este jueves")).toBe("2026-10-22");
    expect(day("el jueves que viene")).toBe("2026-10-29");
    expect(day("el próximo viernes")).toBe("2026-10-23");
    expect(day("el martes de la semana que viene")).toBe("2026-10-27");
    expect(day("el miércoles por la mañana")).toBe("2026-10-28");
  });
  it("fechas concretas", () => {
    expect(day("el 15 de noviembre")).toBe("2026-11-15");
    expect(day("3 de enero")).toBe("2027-01-03");
    expect(day("5/11")).toBe("2026-11-05");
    expect(day("2026-12-24")).toBe("2026-12-24");
    expect(day("el día 30")).toBe("2026-10-30");
  });
  it("búsquedas flexibles", () => {
    const r = parseDay("la semana que viene", NOW, TZ);
    expect(r.ok && r.day).toBe("2026-10-26");
    expect(r.ok && r.flexibleDays).toBe(6);
    const asap = parseDay("lo antes posible", NOW, TZ);
    expect(asap.ok && asap.flexibleDays).toBeGreaterThan(0);
  });
  it("no inventa cuando no entiende", () => {
    expect(parseDay("cuando a ti te venga bien jaja", NOW, TZ).ok).toBe(true); // "cuando ..." = lo antes posible
    expect(parseDay("blablabla", NOW, TZ).ok).toBe(false);
    expect(parseDay("31 de febrero", NOW, TZ).ok).toBe(false);
  });
  it("franjas del día", () => {
    expect(parsePartOfDay("por la tarde")).toBe("tarde");
    expect(parsePartOfDay("por la mañana")).toBe("manana");
    expect(parsePartOfDay("a última hora")).toBe("ultima_hora");
    expect(parsePartOfDay("a primera hora")).toBe("primera_hora");
    expect(parsePartOfDay("me da igual")).toBe("cualquiera");
  });
});
