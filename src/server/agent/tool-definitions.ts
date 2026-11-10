/**
 * Definición única de las herramientas del agente. La usan:
 *  - el asistente de Vapi (llamadas reales), como herramientas "function";
 *  - el simulador con Claude, como herramientas de la API de Anthropic.
 * Así lo que se prueba en el simulador es exactamente lo que se ejecuta en una llamada.
 */
export type ToolName =
  | "buscar_huecos"
  | "reservar_cita"
  | "buscar_mis_citas"
  | "cambiar_cita"
  | "cancelar_cita"
  | "consultar_informacion"
  | "dejar_recado";

export type ToolDefinition = {
  name: ToolName;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
    additionalProperties: false;
  };
  /** Frase breve que dice el asistente mientras la herramienta trabaja (voz). */
  waitMessage: string;
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "buscar_huecos",
    description:
      "Busca horas libres reales en la agenda para un servicio. Úsala SIEMPRE antes de proponer una hora: nunca propongas horas que no vengan de esta herramienta. " +
      "Pasa el día tal como lo dijo la persona (por ejemplo 'mañana', 'el jueves que viene', '15 de noviembre'); el sistema lo interpreta en horario de Madrid.",
    parameters: {
      type: "object",
      properties: {
        servicio: { type: "string", description: "Nombre del servicio tal como aparece en la lista de servicios" },
        dia: { type: "string", description: "Día pedido, en las palabras de la persona o en formato AAAA-MM-DD" },
        franja: { type: "string", description: "Preferencia horaria si la dijo: 'por la mañana', 'por la tarde', 'a última hora', 'a primera hora'…" },
        profesional: { type: "string", description: "Nombre del profesional si la persona tiene preferencia. Omítelo si le da igual." },
      },
      required: ["servicio", "dia"],
      additionalProperties: false,
    },
    waitMessage: "Un momento, que miro la agenda.",
  },
  {
    name: "reservar_cita",
    description:
      "Reserva una cita en una de las horas devueltas por buscar_huecos. Necesitas el nombre de la persona. " +
      "No confirmes la cita a la persona hasta que esta herramienta responda ok=true.",
    parameters: {
      type: "object",
      properties: {
        servicio: { type: "string", description: "Nombre del servicio" },
        inicio: { type: "string", description: "Valor 'inicio' exacto de la opción elegida en buscar_huecos (AAAA-MM-DDTHH:MM)" },
        profesional: { type: "string", description: "Valor 'profesional_id' de la opción elegida, o 'cualquiera'" },
        nombre: { type: "string", description: "Nombre y apellido de la persona" },
        telefono: { type: "string", description: "Solo si la persona da un teléfono distinto del que llama, o si no hay número de llamada" },
        email: { type: "string", description: "Solo si la persona quiere recibir la confirmación por correo. Si ya ha dicho que no quiere correo, reserva sin él y sin volver a preguntar" },
        acepta_email: { type: "boolean", description: "true solo si la persona ha dicho expresamente que quiere la confirmación por correo" },
      },
      required: ["servicio", "inicio", "nombre"],
      additionalProperties: false,
    },
    waitMessage: "Perfecto, te lo reservo ahora mismo.",
  },
  {
    name: "buscar_mis_citas",
    description:
      "Busca las próximas citas de la persona que llama. Si llama desde el teléfono con el que reservó, no hace falta más. " +
      "Si no, pide el código de la cita y el nombre con el que se reservó.",
    parameters: {
      type: "object",
      properties: {
        codigo: { type: "string", description: "Código de la cita (6 letras y números) si la persona lo tiene" },
        nombre: { type: "string", description: "Nombre con el que se hizo la reserva" },
      },
      required: [],
      additionalProperties: false,
    },
    waitMessage: "Dame un segundo, que busco tu cita.",
  },
  {
    name: "cambiar_cita",
    description:
      "Cambia una cita existente a una nueva hora que antes hayas obtenido con buscar_huecos. Requiere identificar la cita con buscar_mis_citas.",
    parameters: {
      type: "object",
      properties: {
        cita: { type: "string", description: "Código de la cita" },
        nuevo_inicio: { type: "string", description: "Valor 'inicio' exacto de la nueva opción (AAAA-MM-DDTHH:MM)" },
        profesional: { type: "string", description: "Valor 'profesional_id' de la nueva opción, o 'cualquiera'" },
        nombre: { type: "string", description: "Nombre con el que se hizo la reserva (necesario si llama desde otro teléfono)" },
      },
      required: ["cita", "nuevo_inicio"],
      additionalProperties: false,
    },
    waitMessage: "Vale, te la cambio.",
  },
  {
    name: "cancelar_cita",
    description: "Cancela una cita existente. Antes confirma con la persona qué cita quiere cancelar.",
    parameters: {
      type: "object",
      properties: {
        cita: { type: "string", description: "Código de la cita" },
        nombre: { type: "string", description: "Nombre con el que se hizo la reserva (necesario si llama desde otro teléfono)" },
        motivo: { type: "string", description: "Motivo, si lo dijo. Sin datos de salud." },
      },
      required: ["cita"],
      additionalProperties: false,
    },
    waitMessage: "De acuerdo, la cancelo.",
  },
  {
    name: "consultar_informacion",
    description:
      "Consulta información del negocio que no tengas clara en tus instrucciones (políticas, seguros, aparcamiento, pagos…). " +
      "Si responde encontrado=false, di que no tienes ese dato y ofrece dejar un recado o pasar con una persona. Nunca inventes.",
    parameters: {
      type: "object",
      properties: { pregunta: { type: "string", description: "La pregunta de la persona, resumida" } },
      required: ["pregunta"],
      additionalProperties: false,
    },
    waitMessage: "Déjame comprobarlo.",
  },
  {
    name: "dejar_recado",
    description:
      "Deja un recado para que alguien del equipo contacte con la persona (le llega al negocio por email). Úsala cuando no puedas resolver algo y no sea posible transferir la llamada (por ejemplo fuera de horario).",
    parameters: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre de la persona" },
        motivo: { type: "string", description: "Qué necesita, en una frase. Sin datos de salud innecesarios." },
        telefono: { type: "string", description: "Solo si quiere que la llamen a un número distinto del que llama" },
        email: { type: "string", description: "Solo si prefiere que le contesten por correo" },
      },
      required: ["nombre", "motivo"],
      additionalProperties: false,
    },
    waitMessage: "Apuntado, un segundo.",
  },
];
