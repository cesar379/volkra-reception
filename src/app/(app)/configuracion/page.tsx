import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleDashed, Trash2 } from "lucide-react";
import { requireApp } from "@/server/auth";
import { env, features } from "@/server/env";
import { getDb } from "@/server/db";
import { getBusiness, getBusinessHours, getFaqs, getStaffHours, listServices, listStaff } from "@/server/booking/repo";
import { PageHeader } from "@/components/app/ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/app/native-select";
import { CopyButton } from "@/components/app/copy-button";
import { SubmitButton } from "@/components/app/submit-button";
import { fmtDate, fmtEuros, VERTICALS } from "@/lib/format";
import { cn } from "@/lib/utils";
import * as A from "./actions";
import { listTeam } from "@/server/team";
import { BILLING_LABEL, getBilling } from "@/server/billing";

export const metadata = { title: "Configuración" };

const TABS = [
  ["negocio", "Negocio"], ["horario", "Horario y festivos"], ["servicios", "Servicios"], ["equipo", "Equipo"],
  ["preguntas", "Preguntas frecuentes"], ["agente", "Asistente de voz"], ["chat", "Chat web"], ["whatsapp", "WhatsApp"], ["integraciones", "Integraciones"], ["cuenta", "Usuarios y cuenta"],
] as const;
const DAYS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const rangesText = (r?: { opens: string; closes: string }[]) => (r ?? []).map((x) => `${x.opens}-${x.closes}`).join(", ");

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? "negocio") as (typeof TABS)[number][0];
  const ctx = await requireApp();
  const d = await ctx.asUser(async (q) => {
    const id = ctx.business.id;
    const [business, hours, staff, services, faqs, staffHours] = await Promise.all([
      getBusiness(q, id), getBusinessHours(q, id), listStaff(q, id, false), listServices(q, id, false), getFaqs(q, id), getStaffHours(q, id),
    ]);
    const specials = await q.query<{ id: string; day: string; closed: boolean; hours: { opens: string; closes: string }[]; reason: string }>(
      `select id, to_char(day,'YYYY-MM-DD') as day, closed, hours, reason from special_days where business_id=$1 and day >= current_date - 1 order by day`, [id]);
    const links = await q.query<{ staff_id: string; service_id: string }>(`select staff_id, service_id from staff_services where business_id=$1`, [id]);
    const timeOff = await q.query<{ id: string; staff_id: string; starts_at: Date; ends_at: Date; reason: string }>(
      `select id, staff_id, starts_at, ends_at, reason from staff_time_off where business_id=$1 and ends_at > now() order by starts_at`, [id]);
    return { business: business!, hours, staff, services, faqs, staffHours, specials, links, timeOff };
  });
  const b = d.business;
  const appUrl = env.APP_URL.replace(/\/$/, "");
  // El token es solo del servidor (RLS): aquí solo se mira si hay uno guardado.
  const waToken = tab === "whatsapp" && (await (await getDb()).query(`select 1 from whatsapp_credentials where business_id = $1`, [b.id])).length > 0;
  const isOwner = ctx.business.role === "owner";
  const team = tab === "cuenta" ? await listTeam(await getDb(), b.id) : null;
  const billing = tab === "cuenta" && isOwner ? await getBilling(await getDb(), b.id) : null;
  const chatSnippet = b.web_chat_key ? `<script src="${appUrl}/widget.js" data-key="${b.web_chat_key}" async></script>` : "";

  return (
    <>
      <PageHeader title="Configuración" />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b" aria-label="Apartados">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/configuracion?tab=${k}`} aria-current={tab === k ? "page" : undefined}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        ))}
      </nav>
      {sp.guardado ? <p className="mb-4 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"><CheckCircle2 className="size-4" /> Cambios guardados.</p> : null}
      {sp.error ? <p className="mb-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert"><CircleAlert className="size-4" /> {sp.error}</p> : null}

      {tab === "negocio" ? (
        <Card title="Datos del negocio">
          <form action={A.saveBusiness} className="grid max-w-2xl gap-4">
            <Field label="Nombre" id="name"><Input id="name" name="name" defaultValue={b.name} required /></Field>
            <Field label="Tipo de negocio" id="vertical">
              <NativeSelect id="vertical" name="vertical" defaultValue={b.vertical}>{Object.entries(VERTICALS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
            </Field>
            <Field label="Descripción breve" id="description" hint="Una o dos frases. El asistente puede usarla para presentar el negocio."><Textarea id="description" name="description" defaultValue={b.description} rows={3} /></Field>
            <Field label="Dirección" id="address"><Input id="address" name="address" defaultValue={b.address} /></Field>
            <Field label="Teléfono público" id="public_phone"><Input id="public_phone" name="public_phone" defaultValue={b.public_phone} /></Field>
            <Field label="Email para avisos" id="notify_email" hint={`Recibe un email con cada cita que el asistente reserva, cambia o cancela (con invitación para tu calendario), cada recado y cada llamada fallida. ${features.email ? "Déjalo vacío para no recibir avisos." : "Requiere configurar Resend (RESEND_API_KEY y EMAIL_FROM) en el servidor."}`}>
              <Input id="notify_email" name="notify_email" type="email" defaultValue={b.notify_email ?? ""} placeholder="recepcion@tuclinica.es" />
            </Field>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="reminder_email" defaultChecked={b.reminder_email} className="mt-1" /><span><span className="font-medium">Recordatorio por email el día antes de la cita</span><span className="block text-muted-foreground">Solo a quien dio su email y aceptó recibir la confirmación. Sale por la tarde, con la opción de cambiar o cancelar.</span></span></label>
            <div><SubmitButton>Guardar</SubmitButton></div>
          </form>
        </Card>
      ) : null}

      {tab === "horario" ? (
        <div className="grid gap-6">
          <Card title="Horario semanal" description="Formato: 09:30-14:00, 16:00-20:30. Vacío = cerrado.">
            <form action={A.saveHours} className="grid max-w-2xl gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                <div key={w} className="grid grid-cols-[110px_1fr] items-center gap-3">
                  <Label htmlFor={`d${w}`}>{DAYS[w]}</Label>
                  <Input id={`d${w}`} name={`d${w}`} defaultValue={rangesText(d.hours[w])} placeholder="Cerrado" />
                </div>
              ))}
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <Field label="Intervalo entre citas" id="slot_interval_min">
                  <NativeSelect id="slot_interval_min" name="slot_interval_min" defaultValue={String(b.slot_interval_min)}>{[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>cada {n} min</option>)}</NativeSelect>
                </Field>
                <Field label="Antelación mínima (min)" id="min_notice_min"><Input id="min_notice_min" name="min_notice_min" type="number" min={0} defaultValue={b.min_notice_min} /></Field>
                <Field label="Reservas hasta (días)" id="max_days_ahead"><Input id="max_days_ahead" name="max_days_ahead" type="number" min={1} max={365} defaultValue={b.max_days_ahead} /></Field>
              </div>
              <div><SubmitButton>Guardar horario</SubmitButton></div>
            </form>
          </Card>
          <Card title="Festivos y días especiales">
            <ul className="mb-5 grid gap-2">
              {d.specials.length === 0 ? <li className="text-sm text-muted-foreground">No hay días especiales.</li> : d.specials.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                  <span className="w-36 font-medium capitalize tabular">{fmtDate(`${s.day}T12:00:00Z`, "UTC", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs", s.closed ? "bg-destructive/10 text-destructive" : "bg-warning/12 text-warning")}>{s.closed ? "Cerrado" : rangesText(s.hours)}</span>
                  <span className="flex-1 text-muted-foreground">{s.reason}</span>
                  <form action={A.deleteSpecialDay}><input type="hidden" name="id" value={s.id} /><button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Eliminar"><Trash2 className="size-4" /></button></form>
                </li>
              ))}
            </ul>
            <form action={A.addSpecialDay} className="grid max-w-2xl gap-3 sm:grid-cols-[150px_150px_1fr]">
              <Field label="Día" id="sd-day"><Input id="sd-day" name="day" type="date" required /></Field>
              <Field label="Tipo" id="sd-kind"><NativeSelect id="sd-kind" name="kind"><option value="closed">Cerrado</option><option value="custom">Horario especial</option></NativeSelect></Field>
              <Field label="Horario (si es especial)" id="sd-hours"><Input id="sd-hours" name="hours" placeholder="10:00-13:00" /></Field>
              <div className="sm:col-span-3"><Field label="Motivo" id="sd-reason"><Input id="sd-reason" name="reason" placeholder="Festivo local, vacaciones…" /></Field></div>
              <div><SubmitButton variant="outline">Añadir día</SubmitButton></div>
            </form>
          </Card>
        </div>
      ) : null}

      {tab === "servicios" ? (
        <Card title="Servicios" description="Margen: tiempo bloqueado tras la cita.">
          <div className="grid gap-3">
            {d.services.map((s) => (
              <details key={s.id} className="group rounded-lg border">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <span className="flex-1 font-medium">{s.name}{!s.active ? <span className="ml-2 text-xs font-normal text-muted-foreground">(inactivo)</span> : null}</span>
                  <span className="text-muted-foreground tabular">{s.duration_min} min{s.buffer_min ? ` + ${s.buffer_min}` : ""}</span>
                  <span className="w-24 text-right tabular">{fmtEuros(s.price_cents, s.price_from)}</span>
                  <span className="text-xs text-muted-foreground group-open:hidden">Editar</span>
                </summary>
                <ServiceForm service={s} staff={d.staff} linked={d.links.filter((l) => l.service_id === s.id).map((l) => l.staff_id)} />
              </details>
            ))}
            <details className="rounded-lg border border-dashed">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">+ Añadir servicio</summary>
              <ServiceForm staff={d.staff} linked={d.staff.map((s) => s.id)} />
            </details>
          </div>
        </Card>
      ) : null}

      {tab === "equipo" ? (
        <div className="grid gap-6">
          <Card title="Equipo">
            <div className="grid gap-3">
              {d.staff.map((s) => (
                <details key={s.id} className="group rounded-lg border">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm">
                    <span className="size-3 rounded-full" style={{ background: s.color }} />
                    <span className="flex-1 font-medium">{s.name} <span className="font-normal text-muted-foreground">{s.role_title}</span>{!s.active ? <span className="ml-2 text-xs text-muted-foreground">(inactivo)</span> : null}</span>
                    <span className="text-xs text-muted-foreground">{d.staffHours[s.id] ? "Horario propio" : "Horario del negocio"}</span>
                  </summary>
                  <StaffForm staff={s} hours={d.staffHours[s.id]} />
                </details>
              ))}
              <details className="rounded-lg border border-dashed">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium">+ Añadir persona o recurso</summary>
                <StaffForm />
              </details>
            </div>
          </Card>
          <Card title="Ausencias y vacaciones">
            <ul className="mb-5 grid gap-2">
              {d.timeOff.length === 0 ? <li className="text-sm text-muted-foreground">No hay ausencias próximas.</li> : d.timeOff.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                  <span className="font-medium">{d.staff.find((s) => s.id === t.staff_id)?.name}</span>
                  <span className="tabular text-muted-foreground">{fmtDate(t.starts_at)} – {fmtDate(new Date(new Date(t.ends_at).getTime() - 1))}</span>
                  <span className="flex-1 text-muted-foreground">{t.reason}</span>
                  <form action={A.deleteTimeOff}><input type="hidden" name="id" value={t.id} /><button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Eliminar"><Trash2 className="size-4" /></button></form>
                </li>
              ))}
            </ul>
            <form action={A.addTimeOff} className="grid max-w-2xl gap-3 sm:grid-cols-4">
              <Field label="Persona" id="to-staff"><NativeSelect id="to-staff" name="staff_id">{d.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></Field>
              <Field label="Desde" id="to-from"><Input id="to-from" name="from" type="date" required /></Field>
              <Field label="Hasta" id="to-to"><Input id="to-to" name="to" type="date" required /></Field>
              <Field label="Motivo" id="to-reason"><Input id="to-reason" name="reason" placeholder="Vacaciones" /></Field>
              <div><SubmitButton variant="outline">Añadir ausencia</SubmitButton></div>
            </form>
          </Card>
        </div>
      ) : null}

      {tab === "preguntas" ? (
        <Card title="Preguntas frecuentes" description="Lo que no esté aquí, el asistente no lo sabe.">
          <div className="grid gap-3">
            {d.faqs.map((f) => (
              <details key={f.id} className="group rounded-lg border">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm"><span className="font-medium">{f.question}</span><span className="mt-0.5 block truncate text-muted-foreground group-open:hidden">{f.answer}</span></summary>
                <div className="border-t p-4">
                  <form action={A.saveFaq} className="grid gap-3">
                    <input type="hidden" name="id" value={f.id} />
                    <Field label="Pregunta" id={`q-${f.id}`}><Input id={`q-${f.id}`} name="question" defaultValue={f.question} /></Field>
                    <Field label="Respuesta" id={`a-${f.id}`}><Textarea id={`a-${f.id}`} name="answer" defaultValue={f.answer} rows={3} /></Field>
                    <div className="flex gap-2"><SubmitButton>Guardar</SubmitButton></div>
                  </form>
                  <form action={A.deleteFaq} className="mt-2"><input type="hidden" name="id" value={f.id} /><SubmitButton variant="ghost" size="sm">Eliminar pregunta</SubmitButton></form>
                </div>
              </details>
            ))}
            <form action={A.saveFaq} className="grid gap-3 rounded-lg border border-dashed p-4">
              <div className="text-sm font-medium">Añadir pregunta</div>
              <Field label="Pregunta" id="new-q"><Input id="new-q" name="question" placeholder="¿Hay aparcamiento?" /></Field>
              <Field label="Respuesta" id="new-a"><Textarea id="new-a" name="answer" rows={2} /></Field>
              <div><SubmitButton variant="outline">Añadir</SubmitButton></div>
            </form>
          </div>
        </Card>
      ) : null}

      {tab === "agente" ? (
        <form action={A.saveAgent} className="grid gap-6">
          <Card title="Cómo se presenta" description="El saludo debe decir que es un asistente de IA.">
            <div className="grid max-w-2xl gap-4">
              <Field label="Nombre del asistente" id="agent_name"><Input id="agent_name" name="agent_name" defaultValue={b.agent_name} /></Field>
              <Field label="Mensaje de bienvenida" id="welcome_message"><Textarea id="welcome_message" name="welcome_message" defaultValue={b.welcome_message} rows={3} /></Field>
              <Field label="Instrucciones particulares" id="ai_instructions" hint="Normas propias del negocio: cómo tratar urgencias, qué no decir, a quién derivar…">
                <Textarea id="ai_instructions" name="ai_instructions" defaultValue={b.ai_instructions} rows={5} />
              </Field>
            </div>
          </Card>
          <Card title="Voz y modelo">
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <Field label="Modelo de Claude" id="voice_model">
                <NativeSelect id="voice_model" name="voice_model" defaultValue={b.voice_model}>
                  <option value="claude-sonnet-5">Claude Sonnet 5 · más capaz (recomendado)</option>
                  <option value="claude-haiku-5-5">Claude Haiku 5.5 · más rápido</option>
                </NativeSelect>
              </Field>
              <Field label="Voz" id="voice_id">
                <NativeSelect id="voice_id" name="voice_id" defaultValue={b.voice_id}>
                  <option value="es-ES-ElviraNeural">Elvira · femenina</option>
                  <option value="es-ES-XimenaNeural">Ximena · femenina</option>
                  <option value="es-ES-AlvaroNeural">Álvaro · masculina</option>
                  <option value="es-ES-ArnauNeural">Arnau · masculina</option>
                </NativeSelect>
              </Field>
            </div>
          </Card>
          <Card title="Teléfonos">
            <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <Field label="Número del asistente" id="agent_phone_number"><Input id="agent_phone_number" name="agent_phone_number" defaultValue={b.agent_phone_number ?? ""} placeholder="+34 9xx xxx xxx" /></Field>
              <Field label="ID del número en Vapi" id="vapi_phone_number_id" hint="Lo ves en el panel de Vapi, en Phone Numbers."><Input id="vapi_phone_number_id" name="vapi_phone_number_id" defaultValue={b.vapi_phone_number_id ?? ""} /></Field>
              <Field label="ID del agente en ElevenLabs (opcional)" id="elevenlabs_agent_id" hint="Solo si este negocio usa ElevenLabs como voz en lugar de Vapi."><Input id="elevenlabs_agent_id" name="elevenlabs_agent_id" defaultValue={b.elevenlabs_agent_id ?? ""} /></Field>
              <Field label="Transferir llamadas a" id="transfer_number"><Input id="transfer_number" name="transfer_number" defaultValue={b.transfer_number ?? ""} placeholder="+34 6xx xxx xxx" /></Field>
            </div>
          </Card>
          <Card title="Privacidad y métricas" description="Sin grabación ni transcripciones por defecto.">
            <div className="grid max-w-2xl gap-4">
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="store_call_summaries" defaultChecked={b.store_call_summaries} className="mt-1" /><span><span className="font-medium">Guardar un resumen de cada llamada</span><span className="block text-muted-foreground">Breve, sin transcripción. Útil para revisar qué pasó.</span></span></label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="recording_enabled" defaultChecked={b.recording_enabled} className="mt-1" /><span><span className="font-medium">Grabar las llamadas</span><span className="block text-muted-foreground">Desactivado por defecto. Si lo activas, informa de ello en el mensaje de bienvenida y revisa la base legal (RGPD).</span></span></label>
              <Field label="Minutos de recepción ahorrados por llamada (estimación)" id="minutes_saved_per_call" hint="Se usa solo para el cálculo estimado de horas ahorradas del panel.">
                <Input id="minutes_saved_per_call" name="minutes_saved_per_call" type="number" step="0.5" min={0} max={60} defaultValue={b.minutes_saved_per_call} className="max-w-32" />
              </Field>
            </div>
          </Card>
          <div><SubmitButton>Guardar asistente</SubmitButton></div>
        </form>
      ) : null}

      {tab === "chat" ? (
        <Card title="Chat web" description="El mismo asistente, por escrito, en tu web.">
          {!features.claude ? <p className="mb-4 text-sm text-warning">Falta ANTHROPIC_API_KEY en el servidor.</p> : null}
          {b.web_chat_enabled && b.web_chat_key ? (
            <div className="grid max-w-3xl gap-4">
              <div className="grid gap-2">
                <Label>Código para la web (antes de &lt;/body&gt;)</Label>
                <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{chatSnippet}</pre>
                <div className="flex flex-wrap gap-2">
                  <CopyButton text={chatSnippet} />
                  <a href={`/chat/${b.web_chat_key}`} target="_blank" rel="noopener" className="inline-flex h-7 items-center rounded-md border px-2.5 text-sm hover:bg-muted">Abrir chat</a>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Enlace directo: <code className="break-all">{appUrl}/chat/{b.web_chat_key}</code></p>
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <form action={A.disableWebChat}><SubmitButton variant="outline" size="sm">Desactivar</SubmitButton></form>
                <form action={A.rotateWebChatKey}><SubmitButton variant="ghost" size="sm">Regenerar código</SubmitButton></form>
              </div>
            </div>
          ) : (
            <form action={A.enableWebChat}><SubmitButton>Activar chat web</SubmitButton></form>
          )}
        </Card>
      ) : null}

      {tab === "whatsapp" ? (
        <Card title="WhatsApp Business" description="El mismo asistente responde por WhatsApp: informa, reserva, cambia y cancela citas. Usa el número de WhatsApp para identificar a la persona.">
          {!features.whatsapp ? <p className="mb-4 text-sm text-warning">Faltan WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN en el servidor.</p> : null}
          {!features.claude ? <p className="mb-4 text-sm text-warning">Falta ANTHROPIC_API_KEY en el servidor.</p> : null}
          <div className="grid max-w-3xl gap-4">
            {b.whatsapp_phone_number_id ? (
              <p className="text-sm">
                {b.whatsapp_enabled ? "Activo" : "Desactivado"} en el número <strong>{b.whatsapp_display_phone ?? b.whatsapp_phone_number_id}</strong>.
              </p>
            ) : null}
            <form action={A.saveWhatsApp} className="grid gap-4">
              <Field label="Identificador del número (Phone number ID)" id="wa-id" hint="En Meta: WhatsApp → Configuración de la API. Son solo cifras; no es el número de teléfono.">
                <Input id="wa-id" name="whatsapp_phone_number_id" inputMode="numeric" defaultValue={b.whatsapp_phone_number_id ?? ""} required />
              </Field>
              <Field label="Token de acceso" id="wa-token" hint={waToken ? "Hay un token guardado. Déjalo vacío para mantenerlo." : env.WHATSAPP_ACCESS_TOKEN ? "Opcional: si lo dejas vacío se usa el token de la plataforma." : "Token permanente de un usuario del sistema de Meta, con permiso whatsapp_business_messaging."}>
                <Input id="wa-token" name="whatsapp_token" type="password" autoComplete="off" />
              </Field>
              <div><SubmitButton>{b.whatsapp_enabled ? "Guardar" : "Comprobar y activar"}</SubmitButton></div>
            </form>
            {features.whatsapp ? (
              <p className="text-xs text-muted-foreground">
                En Meta → WhatsApp → Configuración → Webhook: URL <code className="break-all rounded bg-muted px-1">{appUrl}/api/whatsapp/webhook</code>, el token de verificación de WHATSAPP_VERIFY_TOKEN y suscripción al campo <code className="rounded bg-muted px-1">messages</code>.
              </p>
            ) : null}
            {b.whatsapp_phone_number_id ? (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {b.whatsapp_enabled ? <form action={A.disableWhatsApp}><SubmitButton variant="outline" size="sm">Desactivar</SubmitButton></form> : null}
                <form action={A.disconnectWhatsApp}><SubmitButton variant="ghost" size="sm">Desconectar número</SubmitButton></form>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {tab === "integraciones" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Integration name="Claude (Anthropic)" ok={features.claude} detail={features.claude ? `Simulador con Claude activo. Las llamadas usan ${b.voice_model} a través de Vapi.` : "Sin ANTHROPIC_API_KEY el simulador usa un guion local. En llamadas reales, Claude lo gestiona Vapi."} />
          <Integration name="Vapi (llamadas)" ok={features.vapi && Boolean(b.vapi_phone_number_id || b.agent_phone_number)} partial={features.vapi}
            detail={!features.vapi ? "Falta VAPI_WEBHOOK_SECRET en el servidor." : b.vapi_phone_number_id || b.agent_phone_number ? "Número asignado. Las llamadas a ese número las atiende este negocio." : "Servidor listo. Asigna el número en «Asistente de voz»."}>
            {features.vapi ? <p className="mt-2 text-xs text-muted-foreground">URL del servidor para Vapi: <code className="break-all rounded bg-muted px-1">{env.APP_URL.replace(/\/$/, "")}/api/vapi/webhook</code></p> : null}
          </Integration>
          <Integration name="ElevenLabs (voz alternativa)" ok={features.elevenlabs && Boolean(b.elevenlabs_agent_id)} partial={features.elevenlabs}
            detail={!features.elevenlabs ? "Opcional. Requiere ELEVENLABS_TOOLS_SECRET y ELEVENLABS_WEBHOOK_SECRET en el servidor." : b.elevenlabs_agent_id ? "Agente de ElevenLabs asignado a este negocio." : "Servidor listo. Asigna el ID del agente en «Asistente de voz»."}>
            {features.elevenlabs ? <p className="mt-2 text-xs text-muted-foreground">Inicio de llamada: <code className="break-all rounded bg-muted px-1">{env.APP_URL.replace(/\/$/, "")}/api/elevenlabs/init</code> · Herramientas: <code className="break-all rounded bg-muted px-1">/api/elevenlabs/tools/&lt;nombre&gt;</code> · Fin de llamada: <code className="break-all rounded bg-muted px-1">/api/elevenlabs/post-call</code></p> : null}
          </Integration>
          <Integration name="Google Calendar" ok={b.google_connected} partial={features.google}
            detail={!features.google ? "Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el servidor." : b.google_connected ? `Conectado. Las citas se copian al calendario «${b.google_calendar_id ?? "primary"}».` : "Conecta la cuenta de Google del negocio para copiar las citas a su calendario."}>
            {features.google ? (
              b.google_connected ? (
                <div className="mt-3 grid gap-2">
                  <form action={A.saveCalendarId} className="flex gap-2"><Input name="google_calendar_id" defaultValue={b.google_calendar_id ?? "primary"} aria-label="ID del calendario" /><SubmitButton variant="outline" size="sm">Guardar</SubmitButton></form>
                  <form action={A.disconnectGoogle}><SubmitButton variant="ghost" size="sm">Desconectar</SubmitButton></form>
                </div>
              ) : <a href="/api/google/connect" className="mt-3 inline-flex rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">Conectar Google Calendar</a>
            ) : null}
          </Integration>
          <Integration name="WhatsApp Business" ok={features.whatsapp && b.whatsapp_enabled} partial={features.whatsapp}
            detail={!features.whatsapp ? "Faltan WHATSAPP_APP_SECRET y WHATSAPP_VERIFY_TOKEN en el servidor." : b.whatsapp_enabled ? `Activo en ${b.whatsapp_display_phone ?? "el número configurado"}.` : "Servidor listo. Conecta el número en la pestaña «WhatsApp»."} />
          <Integration name="Email (Resend)" ok={features.email} detail={features.email ? "Se envían confirmaciones solo a quien da su email y acepta recibirlas." : "Sin RESEND_API_KEY y EMAIL_FROM no se envían emails (todo lo demás funciona)."} />
        </div>
      ) : null}
      {tab === "cuenta" && team ? (
        <div className="grid gap-6">
          <Card title="Personas con acceso" description="Los administradores pueden cambiar la configuración, invitar a otras personas y dar de baja el negocio. El equipo usa el panel, la agenda y las llamadas.">
            <ul className="grid max-w-3xl gap-2">
              {team.members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                  <span>{m.email ?? "Usuario"}{m.user_id === ctx.session.userId ? " (tú)" : ""} <span className="text-muted-foreground">· {m.role === "owner" ? "Administrador" : "Equipo"}</span></span>
                  {isOwner && m.user_id !== ctx.session.userId ? (
                    <form action={A.removeUser}><input type="hidden" name="user_id" value={m.user_id} /><SubmitButton variant="ghost" size="sm">Quitar acceso</SubmitButton></form>
                  ) : null}
                </li>
              ))}
              {team.invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-sm">
                  <span>{i.email} <span className="text-muted-foreground">· {i.role === "owner" ? "Administrador" : "Equipo"} · invitación pendiente desde {fmtDate(i.created_at)}</span></span>
                  {isOwner ? <form action={A.revokeUserInvite}><input type="hidden" name="id" value={i.id} /><SubmitButton variant="ghost" size="sm">Anular</SubmitButton></form> : null}
                </li>
              ))}
            </ul>
            {isOwner ? (
              <form action={A.inviteUser} className="mt-5 grid max-w-3xl gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                <Field label="Invitar por email" id="invite-email" hint={features.email ? "Le llega un email. Al entrar o crear su cuenta con ese email, tendrá acceso." : "Al entrar o crear su cuenta con ese email, tendrá acceso. Avísale tú: el email no está configurado."}>
                  <Input id="invite-email" name="email" type="email" required placeholder="persona@tuclinica.es" />
                </Field>
                <Field label="Rol" id="invite-role">
                  <NativeSelect id="invite-role" name="role" defaultValue="staff"><option value="staff">Equipo</option><option value="owner">Administrador</option></NativeSelect>
                </Field>
                <div><SubmitButton>Invitar</SubmitButton></div>
              </form>
            ) : null}
          </Card>

          {isOwner ? (
            <>
              {billing ? (
                <Card title="Suscripción" description="Volkra Hub · Reception: teléfono, WhatsApp y chat web. El pago se hace con tarjeta a través de Stripe; desde allí puedes cambiar la tarjeta, descargar las facturas o cancelar.">
                  {sp.pago === "ok" ? <p className="mb-3 text-sm text-success">Pago recibido. La suscripción se activa en unos segundos.</p> : null}
                  <p className="text-sm">Estado: <strong>{BILLING_LABEL[billing.status]}</strong>{billing.current_period_end && ["active", "trialing"].includes(billing.status) ? <span className="text-muted-foreground"> · se renueva el {fmtDate(billing.current_period_end)}</span> : null}</p>
                  {!features.billing ? <p className="mt-2 text-sm text-muted-foreground">El cobro con Stripe aún no está configurado en el servidor.</p> : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["none", "canceled", "incomplete"].includes(billing.status) ? <form action={A.startSubscription}><SubmitButton>Suscribirse</SubmitButton></form> : null}
                      {billing.stripe_customer_id ? <form action={A.openBillingPortal}><SubmitButton variant="outline">Gestionar suscripción y facturas</SubmitButton></form> : null}
                    </div>
                  )}
                </Card>
              ) : null}
              <Card title="Exportar los datos" description="Descarga en un archivo JSON la configuración, los clientes, las citas, el historial de llamadas y las incidencias. Útil para tener una copia o para llevártelos al darte de baja.">
                <a href="/api/cuenta/exportar" className="inline-flex rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Descargar datos (JSON)</a>
              </Card>
              <Card title="Dar de baja el negocio" description="Borra de forma definitiva el negocio y todos sus datos: citas, clientes, llamadas, conversaciones y conexiones con Google y WhatsApp. No se puede deshacer. Exporta antes los datos si quieres conservarlos.">
                <form action={A.deleteMyBusiness} className="grid max-w-xl gap-3">
                  <Field label={`Escribe «${b.name}» para confirmar`} id="confirm-delete"><Input id="confirm-delete" name="confirm" autoComplete="off" required /></Field>
                  <div><SubmitButton variant="destructive">Borrar el negocio y sus datos</SubmitButton></div>
                </form>
              </Card>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="text-base font-medium">{title}</h2>
      {description ? <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Integration({ name, ok, partial, detail, children }: { name: string; ok: boolean; partial?: boolean; detail: string; children?: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : partial ? CircleDashed : CircleAlert;
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", ok ? "text-success" : partial ? "text-warning" : "text-muted-foreground")} />
        <h3 className="font-medium">{name}</h3>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs", ok ? "bg-success/12 text-success" : "bg-muted text-muted-foreground")}>{ok ? "Activo" : partial ? "Pendiente" : "No configurado"}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
      {children}
    </div>
  );
}

type Svc = { id: string; name: string; description: string; duration_min: number; buffer_min: number; price_cents: number | null; price_from: boolean; active: boolean };
function ServiceForm({ service, staff, linked }: { service?: Svc; staff: { id: string; name: string }[]; linked: string[] }) {
  const p = service?.price_cents;
  return (
    <form action={A.saveService} className="grid gap-3 border-t p-4">
      {service ? <input type="hidden" name="id" value={service.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <Field label="Nombre" id={`sn-${service?.id ?? "new"}`}><Input id={`sn-${service?.id ?? "new"}`} name="name" defaultValue={service?.name} required /></Field>
        <Field label="Duración (min)" id={`sd-${service?.id ?? "new"}`}><Input id={`sd-${service?.id ?? "new"}`} name="duration_min" type="number" min={5} max={480} defaultValue={service?.duration_min ?? 30} required /></Field>
        <Field label="Margen (min)" id={`sb-${service?.id ?? "new"}`}><Input id={`sb-${service?.id ?? "new"}`} name="buffer_min" type="number" min={0} max={120} defaultValue={service?.buffer_min ?? 0} /></Field>
        <Field label="Precio (€)" id={`sp-${service?.id ?? "new"}`}><Input id={`sp-${service?.id ?? "new"}`} name="price" inputMode="decimal" defaultValue={p === null || p === undefined ? "" : String(p / 100).replace(".", ",")} placeholder="Vacío = a consultar" /></Field>
      </div>
      <Field label="Descripción" id={`sx-${service?.id ?? "new"}`}><Input id={`sx-${service?.id ?? "new"}`} name="description" defaultValue={service?.description} /></Field>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="price_from" defaultChecked={service?.price_from} /> El precio es «desde»</label>
        {service ? <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={service.active} /> Activo</label> : null}
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-medium">Quién lo hace</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {staff.map((s) => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="staff" value={s.id} defaultChecked={linked.includes(s.id)} /> {s.name}</label>)}
        </div>
      </fieldset>
      <div><SubmitButton>{service ? "Guardar servicio" : "Añadir servicio"}</SubmitButton></div>
    </form>
  );
}

type St = { id: string; name: string; role_title: string; color: string; active: boolean; google_calendar_id: string | null };
function StaffForm({ staff, hours }: { staff?: St; hours?: Record<number, { opens: string; closes: string }[]> }) {
  const key = staff?.id ?? "new";
  return (
    <form action={A.saveStaff} className="grid gap-3 border-t p-4">
      {staff ? <input type="hidden" name="id" value={staff.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-[2fr_2fr_90px]">
        <Field label="Nombre" id={`tn-${key}`}><Input id={`tn-${key}`} name="name" defaultValue={staff?.name} required /></Field>
        <Field label="Puesto" id={`tr-${key}`}><Input id={`tr-${key}`} name="role_title" defaultValue={staff?.role_title} /></Field>
        <Field label="Color" id={`tc-${key}`}><Input id={`tc-${key}`} name="color" type="color" defaultValue={staff?.color ?? "#4A5D5E"} className="h-8 p-1" /></Field>
      </div>
      <Field label="Calendario de Google (opcional)" id={`tg-${key}`} hint="Si esta persona tiene su propio calendario, sus eventos bloquearán huecos y sus citas irán ahí.">
        <Input id={`tg-${key}`} name="google_calendar_id" defaultValue={staff?.google_calendar_id ?? ""} placeholder="nombre@empresa.com" />
      </Field>
      {staff ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={staff.active} /> Activo</label> : null}
      <details className="rounded-lg bg-muted/40 p-3" open={Boolean(hours)}>
        <summary className="cursor-pointer text-sm font-medium">Horario propio</summary>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="own_hours" defaultChecked={Boolean(hours)} /> No sigue el horario del negocio</label>
        <div className="mt-3 grid gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <div key={w} className="grid grid-cols-[100px_1fr] items-center gap-3">
              <Label htmlFor={`th-${key}-${w}`}>{DAYS[w]}</Label>
              <Input id={`th-${key}-${w}`} name={`d${w}`} defaultValue={rangesText(hours?.[w])} placeholder="No trabaja" />
            </div>
          ))}
        </div>
      </details>
      <div><SubmitButton>{staff ? "Guardar" : "Añadir"}</SubmitButton></div>
    </form>
  );
}
