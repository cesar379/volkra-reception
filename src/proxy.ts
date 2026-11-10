import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refresca la sesión de Supabase en cada petición (si Supabase está configurado).
 * La autorización real se hace en el servidor (requireApp) y en la base de datos (RLS).
 */
/**
 * Direcciones antiguas: las páginas se redirigen a la dirección actual (APP_URL), pero las APIs
 * (webhooks de Meta, ElevenLabs, Vapi, Stripe…), el chat y el widget siguen funcionando en ellas,
 * para no romper integraciones ni webs de clientes ya configuradas.
 */
const LEGACY_HOSTS = new Set(["entrada.volkra.es"]);

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const appUrl = process.env.APP_URL;
  if (appUrl && LEGACY_HOSTS.has(host) && !request.nextUrl.pathname.startsWith("/api/")) {
    const target = new URL(appUrl);
    if (target.host !== host) return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, target), 308);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const c of list) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of list) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/vapi|api/elevenlabs|api/cron|api/chat|chat/|widget.js|brand|icon.png|favicon.ico).*)"],
};
