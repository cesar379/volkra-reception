import type { Db } from "../db/client";
import { decrypt } from "../crypto";
import { env } from "../env";
import { CalendarError, type CalendarPort } from "./types";
import { localToDate } from "../booking/time";

const API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"];

const tokenCache = new Map<string, { token: string; exp: number }>();

async function accessToken(db: Db, businessId: string): Promise<string> {
  const cached = tokenCache.get(businessId);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const row = (await db.query<{ refresh_token_enc: string }>(`select refresh_token_enc from google_credentials where business_id = $1`, [businessId]))[0];
  if (!row) throw new CalendarError("Google Calendar no está conectado", false);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new CalendarError("Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", false);
  const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: decrypt(row.refresh_token_enc),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new CalendarError(`No se pudo renovar el acceso a Google (${res.status})`, res.status >= 500);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(businessId, { token: json.access_token, exp: Date.now() + json.expires_in * 1000 });
  return json.access_token;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 4000) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  } catch (err) {
    throw new CalendarError(`Google Calendar no responde (${(err as Error).name})`);
  }
}

async function gfetch(db: Db, businessId: string, path: string, init: RequestInit = {}) {
  const token = await accessToken(db, businessId);
  return fetchWithTimeout(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

type GEvent = {
  id: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

export function googleCalendar(db: Db): CalendarPort {
  return {
    async busy({ businessId, staff, from, to }) {
      const out: { staffId: string; start: Date; end: Date }[] = [];
      for (const s of staff) {
        const qs = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true", maxResults: "250" });
        const res = await gfetch(db, businessId, `/calendars/${encodeURIComponent(s.calendarId)}/events?${qs}`);
        if (!res.ok) throw new CalendarError(`Error ${res.status} al leer el calendario`, res.status >= 500 || res.status === 429);
        const json = (await res.json()) as { items?: GEvent[] };
        for (const e of json.items ?? []) {
          if (e.status === "cancelled" || e.transparency === "transparent") continue;
          if (e.extendedProperties?.private?.volkraAppointmentId) continue; // nuestras propias citas ya están en la agenda
          // Eventos de día completo: bloquean el día entero en la zona del negocio.
          const start = e.start?.dateTime ? new Date(e.start.dateTime) : e.start?.date ? localToDate(e.start.date, "00:00", s.timezone) : null;
          const end = e.end?.dateTime ? new Date(e.end.dateTime) : e.end?.date ? localToDate(e.end.date, "00:00", s.timezone) : null;
          if (start && end) out.push({ staffId: s.id, start, end });
        }
      }
      return out;
    },

    async upsertEvent(p) {
      const body = {
        summary: p.summary,
        description: p.description,
        start: { dateTime: p.start.toISOString(), timeZone: p.timezone },
        end: { dateTime: p.end.toISOString(), timeZone: p.timezone },
        extendedProperties: { private: { volkraAppointmentId: p.appointmentId } },
      };
      const cal = encodeURIComponent(p.calendarId);
      if (p.eventId) {
        const res = await gfetch(db, p.businessId, `/calendars/${cal}/events/${encodeURIComponent(p.eventId)}`, { method: "PATCH", body: JSON.stringify(body) });
        if (res.ok) return { eventId: p.eventId };
        if (res.status !== 404 && res.status !== 410) throw new CalendarError(`Error ${res.status} al actualizar el evento`);
      }
      const res = await gfetch(db, p.businessId, `/calendars/${cal}/events`, { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) throw new CalendarError(`Error ${res.status} al crear el evento`);
      const json = (await res.json()) as { id: string };
      return { eventId: json.id };
    },

    async deleteEvent(p) {
      const res = await gfetch(db, p.businessId, `/calendars/${encodeURIComponent(p.calendarId)}/events/${encodeURIComponent(p.eventId)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new CalendarError(`Error ${res.status} al borrar el evento`);
    },
  };
}
