/** Destino tras un enlace de email: solo rutas de esta app, nunca otra web ("//otra.web" o "https://…"). */
export function safeNext(next: string | null | undefined, fallback = "/panel"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
