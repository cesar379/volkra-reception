import { createDb, type Db } from "@/server/db/client";
import { DEMO_BUSINESS_IDS } from "@/server/db/seed";
import { localToDate } from "@/server/booking/time";
import type { BookingDeps } from "@/server/booking/service";
import type { CalendarPort } from "@/server/calendar/types";

/** "Ahora" fijo en los tests: jueves 22 de octubre de 2026, 10:00 en Madrid. */
export const NOW = localToDate("2026-10-22", "10:00", "Europe/Madrid");
export const CLINIC = DEMO_BUSINESS_IDS.clinic;
export const GARAGE = DEMO_BUSINESS_IDS.garage;
export const SVC = {
  revision: "cccccccc-0000-4000-8000-000000000001",
  limpieza: "cccccccc-0000-4000-8000-000000000002",
  empaste: "cccccccc-0000-4000-8000-000000000003",
  endodoncia: "cccccccc-0000-4000-8000-000000000004",
  blanqueamiento: "cccccccc-0000-4000-8000-000000000005",
  urgencia: "cccccccc-0000-4000-8000-000000000006",
  aceite: "cccccccc-0000-4000-8000-000000000011",
};
export const STAFF = {
  ortega: "bbbbbbbb-0000-4000-8000-000000000001",
  salas: "bbbbbbbb-0000-4000-8000-000000000002",
  gil: "bbbbbbbb-0000-4000-8000-000000000003",
};

export async function freshDb(): Promise<Db> {
  return createDb({ dataDir: "memory://", seedDemo: true, now: () => NOW });
}

export function deps(db: Db, extra: Partial<BookingDeps> = {}): BookingDeps {
  return { db, now: () => NOW, ...extra };
}

export const madrid = (day: string, hhmm: string) => localToDate(day, hhmm, "Europe/Madrid");

/** Calendario falso en memoria; puede simular caídas. */
export function fakeCalendar(opts: { failBusy?: boolean; failWrite?: boolean } = {}): CalendarPort & { events: Map<string, unknown> } {
  const events = new Map<string, unknown>();
  let n = 0;
  return {
    events,
    async busy() {
      if (opts.failBusy) throw new Error("ECONNRESET googleapis.com");
      return [];
    },
    async upsertEvent(p) {
      if (opts.failWrite) throw new Error("503 Service Unavailable");
      const id = p.eventId ?? `evt_${++n}`;
      events.set(id, p);
      return { eventId: id };
    },
    async deleteEvent(p) {
      if (opts.failWrite) throw new Error("503 Service Unavailable");
      events.delete(p.eventId);
    },
  };
}
