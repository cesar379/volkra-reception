import "server-only";
import type { BookingDeps } from "./booking/service";
import { googleCalendar } from "./calendar/google";
import { getDb } from "./db";
import { features } from "./env";
import { emailNotifier, issueEmailAlert } from "./notify";

/** Dependencias reales del motor de reservas para la app (calendario y email solo si están configurados). */
export async function bookingDeps(): Promise<BookingDeps> {
  const db = await getDb();
  return {
    db,
    now: () => new Date(),
    calendar: features.google ? googleCalendar(db) : null,
    notify: emailNotifier(db),
    alert: issueEmailAlert(),
  };
}
