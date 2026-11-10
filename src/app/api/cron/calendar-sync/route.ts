import { NextResponse } from "next/server";
import { bookingDeps } from "@/server/deps";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { retryPendingCalendarSyncs } from "@/server/booking/service";

export const dynamic = "force-dynamic";

/** Reintenta sincronizaciones con Google Calendar pendientes o fallidas. Vercel Cron la llama cada 15 min. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await retryPendingCalendarSyncs(await bookingDeps());
  return NextResponse.json(r);
}
