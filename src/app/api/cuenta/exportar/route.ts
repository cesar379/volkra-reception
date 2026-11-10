import { requireApp } from "@/server/auth";
import { exportBusiness } from "@/server/team";

export const dynamic = "force-dynamic";

/** Descarga todos los datos del negocio activo en JSON. Solo administradores. */
export async function GET() {
  const ctx = await requireApp();
  if (ctx.business.role !== "owner") return new Response("Solo un administrador del negocio puede exportar los datos.", { status: 403 });
  const data = await ctx.asUser((q) => exportBusiness(q, ctx.business.id));
  const slug = ctx.business.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="volkra-${slug || "negocio"}-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
