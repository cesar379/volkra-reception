/**
 * Errores no controlados en producción → alerta por email a Volkra (ALERT_EMAIL), como mucho una por
 * ruta y error cada hora. Ver src/server/platform-alerts.ts.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  const { isControlFlowError, platformAlert, requestErrorAlert } = await import("./server/platform-alerts");
  if (isControlFlowError(err)) return;
  const { getDb } = await import("./server/db");
  await platformAlert(await getDb(), requestErrorAlert(err, `${request.method} ${request.path}`, context.routePath, context.routeType));
}
