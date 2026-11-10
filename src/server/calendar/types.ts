/** Lo que el motor de reservas necesita de un calendario externo (Google Calendar u otro). */
export interface CalendarPort {
  /** Bloques ocupados en los calendarios de los profesionales que no son citas de Volkra. */
  busy(params: { businessId: string; staff: { id: string; calendarId: string; timezone: string }[]; from: Date; to: Date }): Promise<
    { staffId: string; start: Date; end: Date }[]
  >;
  upsertEvent(params: {
    businessId: string;
    calendarId: string;
    eventId: string | null;
    appointmentId: string;
    summary: string;
    description: string;
    start: Date;
    end: Date;
    timezone: string;
  }): Promise<{ eventId: string }>;
  deleteEvent(params: { businessId: string; calendarId: string; eventId: string }): Promise<void>;
}

export class CalendarError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
    this.name = "CalendarError";
  }
}
