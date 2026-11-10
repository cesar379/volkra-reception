import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { env, features } from "@/server/env";

export const dynamic = "force-dynamic";

/** Estado del servicio (sin datos sensibles). */
export async function GET() {
  try {
    const db = await getDb();
    await db.query("select 1");
    return NextResponse.json({
      ok: true,
      database: db.kind,
      integrations: {
        supabaseAuth: features.supabaseAuth, vapi: features.vapi, claude: features.claude, google: features.google, email: features.email, whatsapp: features.whatsapp, billing: features.billing,
        elevenlabsTools: features.elevenlabs, elevenlabsPostCall: Boolean(env.ELEVENLABS_WEBHOOK_SECRET), elevenlabsVoice: Boolean(env.ELEVENLABS_API_KEY),
      },
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
