import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { env, features } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { purgeChatContent } from "@/server/webchat/session";
import { purgeWhatsAppInbound } from "@/server/whatsapp/handler";
import { sendReminders } from "@/server/reminders";
import { dailyDigest, platformAlert } from "@/server/platform-alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tarea diaria (Vercel Cron, 16:00 UTC: tarde en España):
 *  - recordatorios por email de las citas de mañana;
 *  - RGPD: borra el texto de las conversaciones terminadas y los ids de mensajes de WhatsApp viejos;
 *  - resumen de fallos de las últimas 24 h para Volkra (ALERT_EMAIL), solo si hay alguno.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!env.CRON_SECRET || !safeEqual(auth, `Bearer ${env.CRON_SECRET}`)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await getDb();
  const now = new Date();
  const reminders = features.email ? await sendReminders(db, now) : { sent: 0, failed: 0, skipped: "email no configurado" };
  const conversations = await purgeChatContent(db, now);
  const whatsappIds = await purgeWhatsAppInbound(db, now);
  const digest = await dailyDigest(db, now, { remindersFailed: reminders.failed });
  const alert = digest ? await platformAlert(db, digest) : "nada que contar";
  return NextResponse.json({ reminders, conversations, whatsappIds, alert });
}
