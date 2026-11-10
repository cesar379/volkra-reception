/**
 * Configuración desde variables de entorno. Ninguna credencial está escrita en el código.
 * Sin variables, la app arranca en modo local: Postgres embebido + datos de demostración + acceso de demo.
 */
function str(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export const env = {
  get DATABASE_URL() { return str("DATABASE_URL"); },
  get LOCAL_DB_DIR() { return str("LOCAL_DB_DIR") ?? ".data/pglite"; },
  get SEED_DEMO() { return (str("SEED_DEMO") ?? "true") !== "false"; },
  get APP_URL() { return str("APP_URL") ?? str("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000"; },
  /** Firma de la sesión de demostración y derivación de claves locales. Obligatoria en producción. */
  get APP_SECRET() { return str("APP_SECRET") ?? "dev-only-insecure-secret-change-me"; },
  /** 32 bytes en base64 para cifrar tokens de Google. Si falta, se deriva de APP_SECRET (solo desarrollo). */
  get ENCRYPTION_KEY() { return str("ENCRYPTION_KEY"); },

  get SUPABASE_URL() { return str("NEXT_PUBLIC_SUPABASE_URL"); },
  get SUPABASE_ANON_KEY() { return str("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? str("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"); },

  get VAPI_API_KEY() { return str("VAPI_API_KEY"); },
  get VAPI_WEBHOOK_SECRET() { return str("VAPI_WEBHOOK_SECRET"); },

  get ELEVENLABS_TOOLS_SECRET() { return str("ELEVENLABS_TOOLS_SECRET"); },
  get ELEVENLABS_WEBHOOK_SECRET() { return str("ELEVENLABS_WEBHOOK_SECRET"); },
  /** Clave de la API de ElevenLabs: solo para abrir llamadas de voz de prueba desde el panel. */
  get ELEVENLABS_API_KEY() { return str("ELEVENLABS_API_KEY"); },

  get ANTHROPIC_API_KEY() { return str("ANTHROPIC_API_KEY"); },
  get AGENT_MODEL() { return str("AGENT_MODEL") ?? "claude-sonnet-5"; },

  get GOOGLE_CLIENT_ID() { return str("GOOGLE_CLIENT_ID"); },
  get GOOGLE_CLIENT_SECRET() { return str("GOOGLE_CLIENT_SECRET"); },

  /** WhatsApp Business (Cloud API de Meta). Secreto de la app: firma de los webhooks. */
  get WHATSAPP_APP_SECRET() { return str("WHATSAPP_APP_SECRET"); },
  /** Texto libre que se pone en Meta al suscribir el webhook. */
  get WHATSAPP_VERIFY_TOKEN() { return str("WHATSAPP_VERIFY_TOKEN"); },
  /** Token por defecto (usuario del sistema de la plataforma). Cada negocio puede guardar el suyo. */
  get WHATSAPP_ACCESS_TOKEN() { return str("WHATSAPP_ACCESS_TOKEN"); },
  get WHATSAPP_GRAPH_VERSION() { return str("WHATSAPP_GRAPH_VERSION") ?? "v23.0"; },
  /** Solo para pruebas en local contra una Graph API simulada (scripts/whatsapp-local.ts). */
  get WHATSAPP_GRAPH_URL() { return (str("WHATSAPP_GRAPH_URL") ?? "https://graph.facebook.com").replace(/\/$/, ""); },

  /** Stripe: cobro de la suscripción a los negocios. */
  get STRIPE_SECRET_KEY() { return str("STRIPE_SECRET_KEY"); },
  get STRIPE_WEBHOOK_SECRET() { return str("STRIPE_WEBHOOK_SECRET"); },
  get STRIPE_PRICE_ID() { return str("STRIPE_PRICE_ID"); },

  get RESEND_API_KEY() { return str("RESEND_API_KEY"); },
  get EMAIL_FROM() { return str("EMAIL_FROM"); },

  /** Email de Volkra que recibe las alertas de producción (fallos, saldo de la IA) y el resumen diario. */
  get ALERT_EMAIL() { return str("ALERT_EMAIL"); },

  get CRON_SECRET() { return str("CRON_SECRET"); },
  get NODE_ENV() { return process.env.NODE_ENV ?? "development"; },
};

export const features = {
  get supabaseAuth() { return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY); },
  get realDatabase() { return Boolean(env.DATABASE_URL); },
  get vapi() { return Boolean(env.VAPI_WEBHOOK_SECRET); },
  get elevenlabs() { return Boolean(env.ELEVENLABS_TOOLS_SECRET); },
  get claude() { return Boolean(env.ANTHROPIC_API_KEY); },
  get google() { return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET); },
  get whatsapp() { return Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN); },
  get email() { return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM); },
  get billing() { return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID); },
};
