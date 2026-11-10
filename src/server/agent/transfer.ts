import type { BookingDeps } from "../booking/service";
import type { Business } from "../booking/repo";
import { isOpenNow } from "./open-now";
import { logEvent, setOutcome } from "./calls";

export type TransferDecision =
  | { transfer: true; number: string; message: string }
  | { transfer: false; message: string; reason: "fuera_de_horario" | "sin_numero" };

/**
 * ¿Se puede pasar la llamada a una persona? Solo en horario de apertura y con número configurado.
 * Si no, el asistente ofrece dejar un recado. La misma regla vale para el teléfono y el simulador.
 */
export async function decideTransfer(deps: BookingDeps, business: Business, callId: string | null): Promise<TransferDecision> {
  const open = await isOpenNow(deps.db, business, deps.now());
  if (business.transfer_number && open) {
    if (callId) {
      await logEvent(deps.db, { businessId: business.id, callId, kind: "transfer", name: "transferCall", detail: { destino: "equipo", ok: true } });
      await setOutcome(deps.db, callId, "transferred");
      await deps.db.query(`update calls set status = 'transferred' where id = $1`, [callId]);
    }
    return { transfer: true, number: business.transfer_number, message: "Te paso con el equipo, un momento." };
  }
  const reason = business.transfer_number ? "fuera_de_horario" : "sin_numero";
  if (callId) {
    await logEvent(deps.db, { businessId: business.id, callId, kind: "transfer", name: "transferCall", detail: { ok: false, motivo: reason } });
  }
  return { transfer: false, reason, message: "Ahora mismo no hay nadie del equipo disponible. Puedo tomar nota de un recado para que te llamen." };
}
