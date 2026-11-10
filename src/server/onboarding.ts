import type { Queryable } from "./db/client";
import type { Business } from "./booking/repo";

/**
 * Puesta en marcha de un negocio: qué falta para que el asistente atienda bien. Se calcula a partir de
 * la configuración real (no hay que marcar nada a mano) y se muestra en el panel hasta completarla.
 */
export type OnboardingStep = { key: string; title: string; hint: string; href: string; done: boolean; optional?: boolean };

export async function getOnboarding(q: Queryable, b: Business): Promise<OnboardingStep[]> {
  const count = async (sql: string) => (await q.query<{ n: number }>(sql, [b.id]))[0]?.n ?? 0;
  const [hours, services, staff, faqs, simulated] = await Promise.all([
    count(`select count(*)::int n from business_hours where business_id = $1`),
    count(`select count(*)::int n from services where business_id = $1 and active`),
    count(`select count(*)::int n from staff where business_id = $1 and active`),
    count(`select count(*)::int n from faqs where business_id = $1`),
    count(`select count(*)::int n from calls where business_id = $1 and is_simulated`),
  ]);
  const channel = Boolean(b.agent_phone_number || b.vapi_phone_number_id || b.elevenlabs_agent_id || b.whatsapp_enabled || b.web_chat_enabled);
  return [
    { key: "datos", title: "Datos del negocio", hint: "Dirección y teléfono público: el asistente los da a quien pregunta.", href: "/configuracion?tab=negocio", done: Boolean(b.address.trim() && b.public_phone.trim()) },
    { key: "horario", title: "Horario", hint: "Horario de apertura y festivos. Sin horario no hay huecos para reservar.", href: "/configuracion?tab=horario", done: hours > 0 },
    { key: "servicios", title: "Servicios", hint: "Nombre, duración y precio de cada servicio.", href: "/configuracion?tab=servicios", done: services > 0 },
    { key: "equipo", title: "Equipo", hint: "Profesionales y qué servicios hace cada uno.", href: "/configuracion?tab=equipo", done: staff > 0 },
    { key: "preguntas", title: "Preguntas frecuentes", hint: "Al menos 3: aparcamiento, formas de pago, seguros… Evitan recados innecesarios.", href: "/configuracion?tab=preguntas", done: faqs >= 3 },
    { key: "avisos", title: "Email para avisos", hint: "Donde llegan las citas nuevas, los recados y los fallos.", href: "/configuracion?tab=negocio", done: Boolean(b.notify_email) },
    { key: "prueba", title: "Probar el asistente", hint: "Una conversación de prueba antes de abrirlo a los clientes.", href: "/simulador", done: simulated > 0 },
    { key: "canal", title: "Conectar un canal", hint: "Teléfono, WhatsApp o chat de la web: por donde le escribirán los clientes.", href: "/configuracion?tab=agente", done: channel },
    { key: "calendario", title: "Google Calendar", hint: "Opcional: copia las citas al calendario del negocio.", href: "/configuracion?tab=integraciones", done: b.google_connected, optional: true },
  ];
}
