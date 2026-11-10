import type { BookingDeps } from "../booking/service";
import type { Business } from "../booking/repo";

/** Aviso interno al negocio: alguien dejó un recado o una llamada falló. */
export type IssueAlert = {
  business: Business;
  kind: "callback_request" | "call_failed";
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  reason: string;
  at: Date;
};

/** Envía el aviso sin romper nunca la llamada: si el envío falla, se registra y se sigue. */
export async function safeAlert(deps: BookingDeps, alert: IssueAlert): Promise<void> {
  if (!deps.alert) return;
  try {
    await deps.alert(alert);
  } catch (err) {
    console.error(`[aviso ${alert.kind}] no se pudo enviar el email al negocio:`, (err as Error).message);
  }
}
