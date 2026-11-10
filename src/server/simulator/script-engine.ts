import { normalize, parseDay } from "../booking/spanish-dates";
import type { Service } from "../booking/repo";
import type { ToolOutput } from "../agent/tools";
import { resolveService } from "../agent/tools";
import type { TransferDecision } from "../agent/transfer";

/**
 * Motor de conversación por guion para el modo demostración SIN credenciales (sin IA).
 * No improvisa: entiende un conjunto acotado de peticiones y SIEMPRE usa las herramientas reales
 * (las mismas que usa Claude en una llamada) para consultar la agenda, reservar, cambiar o cancelar.
 * Cuando hay ANTHROPIC_API_KEY, el simulador usa Claude en lugar de este motor.
 */

type Option = { inicio: string; decir: string; profesional_id: string };

export type ScriptState = {
  step: "idle" | "need_service" | "need_day" | "choose_slot" | "need_name" | "confirm_cancel" | "need_new_day" | "choose_new_slot" | "recado_motivo" | "recado_nombre" | "ended";
  service?: string;
  dayText?: string;
  part?: string;
  options?: Option[];
  chosen?: Option;
  name?: string;
  code?: string;
  motivo?: string;
};

export type ScriptIO = {
  exec: (name: string, args: Record<string, unknown>) => Promise<ToolOutput>;
  transfer: () => Promise<TransferDecision>;
  services: Service[];
  now: Date;
  tz: string;
};

export type ScriptTurn = { state: ScriptState; replies: string[]; end?: "goodbye" | "transferred" };

const YES = /\b(si|vale|venga|perfecto|correcto|exacto|eso es|de acuerdo|ok|claro|adelante|hazlo)\b/;
const NO = /\b(no|mejor no|nada|dejalo|deja)\b/;
const BYE = /\b(adios|hasta luego|eso es todo|nada mas|ya esta|chao|un saludo)\b/;
const HUMAN = /\b(persona|humano|alguien|recepcion|recepcionista|hablar con|doctora?|encargad[oa])\b/;
const CANCEL = /\b(cancelar|cancela|anular|anula|no podre ir|no puedo ir)\b/;
const CHANGE = /\b(cambiar|cambia|mover|mueve|aplazar|retrasar|adelantar|otro dia)\b/;
const BOOK = /\b(cita|reservar|reserva|hueco|pedir|quiero|quisiera|queria|me gustaria|necesito|vengo|ir)\b/;
const INFO = /\b(horario|abris|abren|cerrais|donde|direccion|precio|cuesta|cuanto|parking|aparcamiento|aparcar|seguro|seguros|sanitas|adeslas|dkv|financia\w*|pagar|pago|bizum|tarjeta|ninos|llego tarde|hac[ei]is|teneis|trabajais|atendeis)\b/;

function timeOf(o: Option) {
  const m = o.inicio.match(/T(\d{2}):(\d{2})/);
  return m ? { h: Number(m[1]), m: Number(m[2]) } : { h: -1, m: -1 };
}
function timePart(decir: string) {
  const i = decir.search(/ a las? /);
  return i >= 0 ? decir.slice(i + 1) : decir;
}
function dayPart(decir: string) {
  const i = decir.search(/ a las? /);
  return i >= 0 ? decir.slice(0, i) : decir;
}
function listTimes(opts: Option[]) {
  let times = opts.map((o) => timePart(o.decir));
  // "a las cuatro, a las siete o a las ocho de la tarde" en vez de repetir "de la tarde"
  const suffix = times[0]?.match(/ de la (mañana|tarde|noche)$/)?.[0];
  if (suffix && times.every((t) => t.endsWith(suffix))) times = times.map((t, i) => (i < times.length - 1 ? t.slice(0, -suffix.length) : t));
  return times.length <= 1 ? times.join("") : `${times.slice(0, -1).join(", ")} o ${times[times.length - 1]}`;
}
function presentOptions(opts: Option[]) {
  const days = [...new Set(opts.map((o) => dayPart(o.decir)))];
  if (days.length === 1) return `El ${days[0]} tengo ${listTimes(opts)}.`;
  return `Tengo ${opts.map((o) => `el ${o.decir}`).join(" o ")}.`;
}

const NUM_WORDS: Record<string, number> = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };

/** "a las cinco y media", "17:30", "la segunda", "esa" → opción */
export function pickOption(text: string, opts: Option[]): Option | null {
  const t = normalize(text);
  const ord = [/\b(primera|1a)\b/, /\b(segunda|2a)\b/, /\b(tercera|3a)\b/];
  for (let i = 0; i < ord.length; i++) if (ord[i].test(t) && opts[i]) return opts[i];
  if (/\bultima\b/.test(t) && !/ultima hora/.test(t)) return opts[opts.length - 1];

  let h: number | null = null;
  let m: number | null = null;
  const dig = t.match(/\b(\d{1,2})(?:[:.h ](\d{2}))?\b/);
  if (dig) { h = Number(dig[1]); m = dig[2] ? Number(dig[2]) : null; }
  else {
    const w = t.match(/\b(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/);
    if (w) h = NUM_WORDS[w[1]];
  }
  if (h !== null) {
    if (/y media/.test(t)) m = 30;
    else if (/y cuarto/.test(t)) m = 15;
    else if (/menos cuarto/.test(t)) { m = 45; h = h - 1; }
    const hours = h < 12 ? [h, h + 12] : [h];
    const exact = opts.find((o) => { const x = timeOf(o); return hours.includes(x.h) && x.m === (m ?? 0); });
    if (exact) return exact;
    if (m === null) {
      const sameHour = opts.filter((o) => hours.includes(timeOf(o).h));
      if (sameHour.length === 1) return sameHour[0];
    }
    return null;
  }
  if (opts.length === 1 && YES.test(t)) return opts[0];
  if (/\b(esa|ese|la que dices)\b/.test(t) && opts.length === 1) return opts[0];
  return null;
}

function extractName(text: string): string | null {
  const cleaned = text
    .replace(/^(hola[, ]*)?/i, "")
    .replace(/\b(me llamo|mi nombre es|soy|a nombre de|pon(lo|la)? a nombre de)\b/gi, "")
    .replace(/[.,!¡¿?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.split(" ").length > 5 || /\d/.test(cleaned)) return null;
  return cleaned.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const spell = (code: string) => code.split("").join(" ");

export async function scriptTurn(state: ScriptState, text: string, io: ScriptIO): Promise<ScriptTurn> {
  const t = normalize(text);
  const s: ScriptState = { ...state };
  const say = (...replies: string[]): ScriptTurn => ({ state: s, replies });

  if (BYE.test(t) && !["need_name", "recado_nombre", "recado_motivo"].includes(s.step)) {
    s.step = "ended";
    return { state: s, replies: ["Gracias por llamar. ¡Hasta luego!"], end: "goodbye" };
  }
  if (HUMAN.test(t) && !["recado_motivo", "recado_nombre"].includes(s.step)) {
    const d = await io.transfer();
    if (d.transfer) {
      s.step = "ended";
      return { state: s, replies: [d.message, "(En una llamada real, aquí se transfiere la llamada al número del negocio.)"], end: "transferred" };
    }
    s.step = "recado_motivo";
    return say(`${d.message} ¿Qué quieres que les diga?`);
  }

  switch (s.step) {
    case "need_service": {
      const { service } = resolveService(io.services, text);
      if (!service) return say(`Perdona, ¿qué servicio necesitas? Por ejemplo: ${io.services.slice(0, 4).map((x) => x.name.toLowerCase()).join(", ")}.`);
      s.service = service.name;
      if (!s.dayText) { s.step = "need_day"; return say(`${service.name}, perfecto. ¿Para qué día te vendría bien?`); }
      return search(s, io);
    }
    case "need_day": {
      if (!parseDay(text, io.now, io.tz).ok) return say("¿Qué día te iría bien? Puedes decirme, por ejemplo, mañana, el jueves o el 15 de noviembre.");
      s.dayText = text;
      if (/\b(manana|tarde|noche|primera|ultima)\b/.test(t)) s.part = text;
      return search(s, io);
    }
    case "choose_slot":
    case "choose_new_slot": {
      const opt = pickOption(text, s.options ?? []);
      if (!opt) {
        if (parseDay(text, io.now, io.tz).ok) { s.dayText = text; s.part = text; return search(s, io, s.step === "choose_new_slot"); }
        return say(`¿Cuál te viene mejor? ${presentOptions(s.options ?? [])}`);
      }
      s.chosen = opt;
      if (s.step === "choose_new_slot") {
        const r = await io.exec("cambiar_cita", { cita: s.code, nuevo_inicio: opt.inicio, profesional: opt.profesional_id });
        s.step = "idle";
        if (r.ok) return say(`Hecho. Tu cita queda cambiada al ${String(r.cuando)}. ¿Algo más?`);
        s.options = (r.alternativas as Option[]) ?? [];
        s.step = s.options.length ? "choose_new_slot" : "idle";
        return say(`Vaya, esa hora ya no está libre. ${s.options.length ? presentOptions(s.options) + " ¿Te viene bien alguna?" : "¿Quieres probar otro día?"}`);
      }
      if (s.name) return book(s, io);
      s.step = "need_name";
      return say(`Perfecto, ${timePart(opt.decir)}. ¿Me dices tu nombre y apellido para la reserva?`);
    }
    case "need_name": {
      const name = extractName(text);
      if (!name) return say("Perdona, no lo he entendido bien. ¿Me repites tu nombre y apellido?");
      s.name = name;
      return book(s, io);
    }
    case "confirm_cancel": {
      if (YES.test(t)) {
        const r = await io.exec("cancelar_cita", { cita: s.code });
        s.step = "idle";
        return say(r.ok ? "Listo, tu cita queda cancelada. ¿Quieres pedir otra?" : "No he podido cancelarla. Te recomiendo que hables con el equipo.");
      }
      if (NO.test(t)) { s.step = "idle"; return say("De acuerdo, la mantengo. ¿Te ayudo con algo más?"); }
      return say("¿Te la cancelo, sí o no?");
    }
    case "need_new_day": {
      if (!parseDay(text, io.now, io.tz).ok) return say("¿A qué día te la cambio?");
      s.dayText = text;
      s.part = text;
      return search(s, io, true);
    }
    case "recado_motivo": {
      s.motivo = text.slice(0, 300);
      s.step = "recado_nombre";
      return say("Apuntado. ¿A nombre de quién dejo el recado?");
    }
    case "recado_nombre": {
      const name = extractName(text) ?? text.slice(0, 60);
      await io.exec("dejar_recado", { nombre: name, motivo: s.motivo ?? "" });
      s.step = "idle";
      return say("Hecho. El equipo te llamará lo antes posible en horario de apertura. ¿Algo más?");
    }
    case "ended":
      return say("La llamada ha terminado. Pulsa «Nueva llamada» para empezar otra.");
    default:
      break;
  }

  // --- idle: detectar intención ---
  if (CANCEL.test(t) || CHANGE.test(t)) {
    const r = await io.exec("buscar_mis_citas", {});
    const citas = (r.citas as { codigo: string; servicio: string; cuando: string }[] | undefined) ?? [];
    if (!r.ok || citas.length === 0) return say("No encuentro ninguna cita próxima con este número. ¿Has llamado desde otro teléfono o tienes el código de la cita?");
    const c = citas[0];
    s.code = c.codigo;
    s.service = c.servicio;
    if (CANCEL.test(t)) { s.step = "confirm_cancel"; return say(`Tienes una cita de ${c.servicio.toLowerCase()} el ${c.cuando}. ¿Quieres que la cancele?`); }
    s.step = "need_new_day";
    return say(`Tienes ${c.servicio.toLowerCase()} el ${c.cuando}. ¿A qué día te la cambio?`);
  }

  const { service } = resolveService(io.services, text);
  const day = parseDay(text, io.now, io.tz);
  const priceQuestion = /\b(cuanto|precio|cuesta)\b/.test(t);
  const bookingish = Boolean(service && BOOK.test(t)) || day.ok || /\b(hueco|cita)\b/.test(t);
  const looksInfo = INFO.test(t) && (priceQuestion || !bookingish);
  if (looksInfo) {
    const r = await io.exec("consultar_informacion", { pregunta: text });
    if (r.encontrado) return say(`${String(r.respuesta)} ¿Te ayudo con algo más?`);
    return say("Eso no lo tengo en mi información y no quiero decirte algo incorrecto. ¿Quieres que te deje un recado para que te llame alguien del equipo?");
  }
  if (service || BOOK.test(t) || day.ok) {
    if (service) s.service = service.name;
    if (day.ok) { s.dayText = text; s.part = text; }
    if (!s.service) { s.step = "need_service"; return say(`Claro. ¿Qué servicio necesitas? Tenemos ${io.services.slice(0, 4).map((x) => x.name.toLowerCase()).join(", ")}…`); }
    if (!s.dayText) { s.step = "need_day"; return say(`${s.service}, perfecto. ¿Para qué día te vendría bien?`); }
    return search(s, io);
  }
  if (NO.test(t) && t.length < 20) return say("Muy bien. Si necesitas algo más, aquí estoy. ¡Hasta luego!");
  return say("Perdona, no te he entendido. Puedo ayudarte a pedir, cambiar o cancelar una cita, o con dudas de horario, precios o ubicación.");
}

async function search(s: ScriptState, io: ScriptIO, forChange = false): Promise<ScriptTurn> {
  const r = await io.exec("buscar_huecos", { servicio: s.service, dia: s.dayText, franja: s.part });
  const next = forChange ? "choose_new_slot" : "choose_slot";
  if (r.ok) {
    s.options = r.opciones as Option[];
    s.step = next;
    return { state: s, replies: [`${presentOptions(s.options)} ¿Qué hora te viene mejor?`] };
  }
  if (r.error === "servicio_desconocido" || r.error === "servicio_ambiguo") {
    s.step = "need_service";
    return { state: s, replies: [`¿Qué servicio exactamente? ${(r.opciones as string[]).slice(0, 5).join(", ")}.`] };
  }
  if (r.error === "dia_no_entendido") { s.step = forChange ? "need_new_day" : "need_day"; return { state: s, replies: ["No he entendido el día. ¿Me lo dices de otra forma?"] }; }
  const alts = (r.alternativas as Option[] | undefined) ?? [];
  const why = r.error === "cerrado" ? `Ese día estamos cerrados (${String(r.motivo)}).` : r.error === "too_far" || r.error === "past_day" ? String(r.instruccion) : "Ese día ya no me quedan huecos.";
  if (alts.length) {
    s.options = alts;
    s.step = next;
    return { state: s, replies: [`${why} Lo más cercano que tengo: ${presentOptions(alts)} ¿Te viene bien alguna?`] };
  }
  s.step = forChange ? "need_new_day" : "need_day";
  return { state: s, replies: [`${why} ¿Probamos otro día?`] };
}

async function book(s: ScriptState, io: ScriptIO): Promise<ScriptTurn> {
  const r = await io.exec("reservar_cita", { servicio: s.service, inicio: s.chosen!.inicio, profesional: s.chosen!.profesional_id, nombre: s.name });
  if (r.ok) {
    s.step = "idle";
    const first = s.name!.split(" ")[0];
    return { state: s, replies: [`Genial, ${first}. Tu cita de ${String(r.servicio).toLowerCase()} queda confirmada el ${String(r.cuando)} con ${String(r.profesional)}. Tu código es ${spell(String(r.codigo))}. ¡Te esperamos!`] };
  }
  const alts = (r.alternativas as Option[] | undefined) ?? [];
  if (alts.length) {
    s.options = alts;
    s.step = "choose_slot";
    return { state: s, replies: [`Vaya, esa hora se acaba de ocupar. ${presentOptions(alts)} ¿Te viene bien alguna?`] };
  }
  s.step = "need_day";
  return { state: s, replies: ["Vaya, no he podido guardar la cita y no quiero confirmarte algo que no está reservado. ¿Probamos otro día?"] };
}
