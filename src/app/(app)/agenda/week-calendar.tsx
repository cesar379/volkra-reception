"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/app/native-select";
import { SimTag } from "@/components/app/ui";
import { cn } from "@/lib/utils";
import { cancelAppointmentAction, createAppointment, getSlots, moveAppointment, type SlotOption } from "./actions";

export type CalAppointment = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  booking_code: string;
  is_simulated: boolean;
  gcal_sync_status: string;
  notes: string;
  service_id: string;
  service_name: string;
  duration_min: number;
  staff_id: string;
  staff_name: string;
  staff_color: string;
  customer_name: string;
  customer_phone: string | null;
};

type Props = {
  timezone: string;
  weekStart: string;
  today: string;
  appointments: CalAppointment[];
  staff: { id: string; name: string; color: string; active: boolean }[];
  services: { id: string; name: string; duration_min: number }[];
  hours: Record<number, { opens: string; closes: string }[]>;
  specials: Record<string, { closed: boolean; hours: { opens: string; closes: string }[]; reason: string }>;
};

const HOUR_PX = 56;
const SOURCE_LABEL: Record<string, string> = { ai_call: "Asistente telefónico", manual: "Añadida a mano", simulator: "Simulador" };
const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function WeekCalendar(props: Props) {
  const { timezone: tz } = props;
  const [staffFilter, setStaffFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<CalAppointment | null>(null);
  const [creating, setCreating] = useState(false);
  const start = DateTime.fromISO(props.weekStart, { zone: tz });
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));

  const appts = props.appointments.filter((a) => !staffFilter || a.staff_id === staffFilter);

  // Rango horario a mostrar: del primer al último tramo de apertura de la semana
  const [minH, maxH] = useMemo(() => {
    let lo = 24 * 60, hi = 0;
    for (const ranges of Object.values(props.hours)) for (const r of ranges) { lo = Math.min(lo, toMin(r.opens)); hi = Math.max(hi, toMin(r.closes)); }
    for (const a of props.appointments) {
      const s = DateTime.fromISO(a.starts_at, { zone: tz }); const e = DateTime.fromISO(a.ends_at, { zone: tz });
      lo = Math.min(lo, s.hour * 60); hi = Math.max(hi, e.hour * 60 + e.minute);
    }
    if (hi <= lo) { lo = 9 * 60; hi = 20 * 60; }
    return [Math.floor(lo / 60), Math.ceil(hi / 60)];
  }, [props.hours, props.appointments, tz]);

  const dayInfo = (d: DateTime) => {
    const iso = d.toISODate()!;
    const sp = props.specials[iso];
    if (sp) return sp.closed ? { closed: true, label: sp.reason || "Cerrado", ranges: [] } : { closed: false, label: sp.reason, ranges: sp.hours };
    const ranges = props.hours[d.weekday] ?? [];
    return { closed: ranges.length === 0, label: ranges.length === 0 ? "Cerrado" : "", ranges };
  };
  const showDays = days.filter((d) => !(d.weekday === 7 && dayInfo(d).closed && !appts.some((a) => DateTime.fromISO(a.starts_at, { zone: tz }).hasSame(d, "day"))));
  const nav = (weeks: number) => `/agenda?semana=${start.plus({ weeks }).toISODate()}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={nav(-1)} className="grid size-8 place-items-center rounded-lg border bg-card hover:bg-muted" aria-label="Semana anterior"><ChevronLeft className="size-4" /></Link>
          <Link href="/agenda" className="rounded-lg border bg-card px-3 py-1.5 text-sm hover:bg-muted">Hoy</Link>
          <Link href={nav(1)} className="grid size-8 place-items-center rounded-lg border bg-card hover:bg-muted" aria-label="Semana siguiente"><ChevronRight className="size-4" /></Link>
          <div className="ml-2 text-sm font-medium capitalize">
            {start.setLocale("es").toFormat("d LLL")} – {start.plus({ days: 6 }).setLocale("es").toFormat("d LLL yyyy")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => setStaffFilter(null)} className={cn("rounded-full border px-3 py-1 text-xs", !staffFilter ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>Todo el equipo</button>
            {props.staff.filter((s) => s.active).map((s) => (
              <button key={s.id} type="button" onClick={() => setStaffFilter(s.id)} className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", staffFilter === s.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
                <span className="size-2 rounded-full" style={{ background: s.color }} />{s.name}
              </button>
            ))}
          </div>
          <Button onClick={() => setCreating(true)}><Plus /> Nueva cita</Button>
        </div>
      </div>

      {/* Escritorio: rejilla semanal */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <div className="grid min-w-[720px]" style={{ gridTemplateColumns: `56px repeat(${showDays.length}, minmax(0, 1fr))` }}>
          <div className="border-b" />
          {showDays.map((d) => {
            const info = dayInfo(d);
            const isToday = d.toISODate() === props.today;
            return (
              <div key={d.toISODate()} className={cn("border-b border-l px-2 py-2 text-center", isToday && "bg-accent/50")}>
                <div className="text-xs capitalize text-muted-foreground">{d.setLocale("es").toFormat("ccc")}</div>
                <div className={cn("text-lg font-medium tabular", isToday && "text-primary")}>{d.day}</div>
                {info.label ? <div className="truncate text-[10px] text-warning" title={info.label}>{info.label}</div> : null}
              </div>
            );
          })}

          <div className="relative" style={{ height: (maxH - minH) * HOUR_PX }}>
            {Array.from({ length: maxH - minH }, (_, i) => (
              <div key={i} className="absolute right-2 text-[11px] text-muted-foreground tabular" style={{ top: i * HOUR_PX - 7 }}>{String(minH + i).padStart(2, "0")}:00</div>
            ))}
          </div>
          {showDays.map((d) => {
            const info = dayInfo(d);
            const dayAppts = appts.filter((a) => DateTime.fromISO(a.starts_at, { zone: tz }).hasSame(d, "day"));
            const layout = packLanes(dayAppts);
            return (
              <div key={d.toISODate()} className={cn("relative border-l", info.closed && "bg-muted/60")} style={{ height: (maxH - minH) * HOUR_PX }}>
                {Array.from({ length: maxH - minH }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-border/60" style={{ top: i * HOUR_PX }} />)}
                {/* Franjas cerradas dentro del día (p. ej. la hora de comer) */}
                {!info.closed ? closedBands(info.ranges, minH, maxH).map(([a, b]) => (
                  <div key={a} className="absolute inset-x-0 bg-muted/60" style={{ top: ((a - minH * 60) / 60) * HOUR_PX, height: ((b - a) / 60) * HOUR_PX }} />
                )) : null}
                {dayAppts.map((a) => {
                  const s = DateTime.fromISO(a.starts_at, { zone: tz });
                  const minutes = s.hour * 60 + s.minute - minH * 60;
                  const { lane, lanes } = layout.get(a.id) ?? { lane: 0, lanes: 1 };
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelected(a)}
                      className={cn("absolute overflow-hidden rounded-md border-l-[3px] bg-card px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm ring-1 ring-border transition hover:z-10 hover:ring-ring", a.status !== "confirmed" && "opacity-55")}
                      style={{
                        top: (minutes / 60) * HOUR_PX + 1,
                        height: Math.max(22, (a.duration_min / 60) * HOUR_PX - 2),
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        borderLeftColor: a.staff_color,
                      }}
                      title={`${s.toFormat("HH:mm")} ${a.service_name} · ${a.customer_name}`}
                    >
                      <div className="font-medium tabular">{s.toFormat("HH:mm")} {a.customer_name}</div>
                      <div className="truncate text-muted-foreground">{a.service_name}</div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Móvil: lista por día */}
      <div className="grid gap-3 md:hidden">
        {showDays.map((d) => {
          const info = dayInfo(d);
          const dayAppts = appts.filter((a) => DateTime.fromISO(a.starts_at, { zone: tz }).hasSame(d, "day"));
          return (
            <div key={d.toISODate()} className="rounded-xl border bg-card">
              <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
                <span className="font-medium capitalize">{d.setLocale("es").toFormat("cccc d 'de' LLLL")}</span>
                {info.label ? <span className="text-xs text-warning">{info.label}</span> : null}
              </div>
              {dayAppts.length === 0 ? <div className="px-4 py-3 text-sm text-muted-foreground">{info.closed ? "Cerrado" : "Sin citas"}</div> : (
                <ul className="divide-y">
                  {dayAppts.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setSelected(a)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
                        <span className="h-8 w-1 rounded-full" style={{ background: a.staff_color }} />
                        <span className="w-12 text-sm font-medium tabular">{DateTime.fromISO(a.starts_at, { zone: tz }).toFormat("HH:mm")}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm">{a.customer_name}</span><span className="block truncate text-xs text-muted-foreground">{a.service_name} · {a.staff_name}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {selected ? <AppointmentDialog appt={selected} tz={tz} staff={props.staff} onClose={() => setSelected(null)} /> : null}
      {creating ? <NewAppointmentDialog {...props} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** Reparte en columnas solo las citas que se solapan entre sí (como un calendario normal). */
function packLanes(list: CalAppointment[]) {
  const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const out = new Map<string, { lane: number; lanes: number }>();
  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: string[] = [];
  let clusterEnd = "";
  const flush = () => { for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length }); cluster = []; laneEnds = []; };
  for (const a of sorted) {
    if (cluster.length && a.starts_at >= clusterEnd) { flush(); clusterEnd = ""; }
    let lane = laneEnds.findIndex((end) => end <= a.starts_at);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(a.ends_at); } else laneEnds[lane] = a.ends_at;
    cluster.push({ id: a.id, lane });
    if (a.ends_at > clusterEnd) clusterEnd = a.ends_at; // fechas ISO en UTC: se comparan como texto
  }
  flush();
  return out;
}

function closedBands(ranges: { opens: string; closes: string }[], minH: number, maxH: number): [number, number][] {
  const sorted = [...ranges].sort((a, b) => toMin(a.opens) - toMin(b.opens));
  const out: [number, number][] = [];
  let cursor = minH * 60;
  for (const r of sorted) {
    if (toMin(r.opens) > cursor) out.push([cursor, toMin(r.opens)]);
    cursor = Math.max(cursor, toMin(r.closes));
  }
  if (cursor < maxH * 60) out.push([cursor, maxH * 60]);
  return out;
}

function SlotPicker({ tz, serviceId, staffId, excludeAppointmentId, value, onChange }: {
  tz: string; serviceId: string; staffId: string | null; excludeAppointmentId?: string;
  value: SlotOption | null; onChange: (s: SlotOption | null) => void;
}) {
  const [day, setDay] = useState(DateTime.now().setZone(tz).toISODate()!);
  const [options, setOptions] = useState<SlotOption[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = (d = day) =>
    start(async () => {
      onChange(null);
      const r = await getSlots({ serviceId, day: d, staffId, excludeAppointmentId });
      if (r.ok) { setOptions(r.options); setMessage(r.note ?? null); if (r.day !== d) setDay(r.day); }
      else { setOptions([]); setMessage(r.message); }
    });
  return (
    <div className="grid gap-2">
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="slot-day">Día</Label>
          <Input id="slot-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <Button type="button" variant="outline" onClick={() => load()} disabled={pending || !serviceId}>
          {pending ? <RefreshCw className="animate-spin" /> : <CalendarClock />} Ver horas libres
        </Button>
      </div>
      {message ? <p className="text-xs text-warning">{message}</p> : null}
      {options && options.length > 0 ? (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {options.map((o) => (
            <button key={o.start} type="button" onClick={() => onChange(o)}
              className={cn("rounded-md border px-2.5 py-1 text-sm tabular", value?.start === o.start ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}
              title={o.staff.map((s) => s.name).join(", ")}>
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
      {options && options.length === 0 && !message ? <p className="text-xs text-muted-foreground">No hay horas libres.</p> : null}
    </div>
  );
}

function NewAppointmentDialog(props: Props & { onClose: () => void }) {
  const [serviceId, setServiceId] = useState(props.services[0]?.id ?? "");
  const [staffId, setStaffId] = useState<string>("");
  const [slot, setSlot] = useState<SlotOption | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva cita</DialogTitle>
          <DialogDescription>Solo se muestran horas realmente libres según el horario, el equipo y las citas existentes.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          action={(fd) =>
            start(async () => {
              if (!slot) { toast.error("Elige una hora libre"); return; }
              const chosenStaff = staffId || (slot.staff.length === 1 ? slot.staff[0].id : null);
              const r = await createAppointment({
                serviceId, start: slot.start, staffId: chosenStaff,
                name: String(fd.get("name") ?? ""), phone: String(fd.get("phone") ?? ""),
                email: String(fd.get("email") ?? ""), emailConsent: fd.get("consent") === "on", notes: String(fd.get("notes") ?? ""),
              });
              if (r.ok) { toast.success(r.message); props.onClose(); } else toast.error(r.message);
            })
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="svc">Servicio</Label>
              <NativeSelect id="svc" value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSlot(null); }}>
                {props.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.duration_min} min)</option>)}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="stf">Profesional</Label>
              <NativeSelect id="stf" value={staffId} onChange={(e) => { setStaffId(e.target.value); setSlot(null); }}>
                <option value="">Cualquiera</option>
                {props.staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </NativeSelect>
            </div>
          </div>
          <SlotPicker key={`${serviceId}-${staffId}`} tz={props.timezone} serviceId={serviceId} staffId={staffId || null} value={slot} onChange={setSlot} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="name">Nombre y apellido</Label><Input id="name" name="name" required minLength={2} autoComplete="off" /></div>
            <div className="grid gap-1.5"><Label htmlFor="phone">Teléfono</Label><Input id="phone" name="phone" type="tel" required placeholder="600 000 000" autoComplete="off" /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="email">Email (opcional)</Label><Input id="email" name="email" type="email" autoComplete="off" /></div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="consent" className="mt-0.5" /> La persona acepta recibir la confirmación por email.
          </label>
          <div className="grid gap-1.5"><Label htmlFor="notes">Nota interna (opcional)</Label><Input id="notes" name="notes" maxLength={200} placeholder="Sin datos de salud innecesarios" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>Cancelar</Button>
            <Button type="submit" disabled={pending || !slot}>{pending ? "Guardando…" : "Crear cita"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDialog({ appt, tz, staff, onClose }: { appt: CalAppointment; tz: string; staff: Props["staff"]; onClose: () => void }) {
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [slot, setSlot] = useState<SlotOption | null>(null);
  const [staffId, setStaffId] = useState<string>(appt.staff_id);
  const [pending, start] = useTransition();
  const s = DateTime.fromISO(appt.starts_at, { zone: tz }).setLocale("es");
  const past = DateTime.fromISO(appt.starts_at) < DateTime.now();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{appt.service_name} {appt.is_simulated ? <SimTag /> : null}</DialogTitle>
          <DialogDescription className="capitalize">{s.toFormat("cccc d 'de' LLLL 'a las' HH:mm")}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Persona</dt><dd>{appt.customer_name}</dd>
          <dt className="text-muted-foreground">Teléfono</dt><dd className="tabular">{appt.customer_phone ?? "—"}</dd>
          <dt className="text-muted-foreground">Profesional</dt><dd>{appt.staff_name}</dd>
          <dt className="text-muted-foreground">Código</dt><dd className="font-mono">{appt.booking_code}</dd>
          <dt className="text-muted-foreground">Origen</dt><dd>{SOURCE_LABEL[appt.source] ?? appt.source}</dd>
          <dt className="text-muted-foreground">Estado</dt><dd>{appt.status === "confirmed" ? "Confirmada" : appt.status === "completed" ? "Realizada" : appt.status}</dd>
          <dt className="text-muted-foreground">Google Calendar</dt>
          <dd>{{ synced: "Sincronizada", pending: "Pendiente", failed: "Error (se reintentará)", not_configured: "No conectado" }[appt.gcal_sync_status] ?? appt.gcal_sync_status}</dd>
          {appt.notes ? <><dt className="text-muted-foreground">Nota</dt><dd>{appt.notes}</dd></> : null}
        </dl>

        {mode === "move" ? (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
            <div className="grid gap-1.5">
              <Label htmlFor="mv-staff">Profesional</Label>
              <NativeSelect id="mv-staff" value={staffId} onChange={(e) => { setStaffId(e.target.value); setSlot(null); }}>
                <option value="">Cualquiera</option>
                {staff.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </NativeSelect>
            </div>
            <SlotPicker key={staffId} tz={tz} serviceId={appt.service_id} staffId={staffId || null} excludeAppointmentId={appt.id} value={slot} onChange={setSlot} />
          </div>
        ) : null}
        {mode === "cancel" ? <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">¿Seguro que quieres cancelar esta cita? El hueco quedará libre.</p> : null}

        <DialogFooter>
          {mode === "view" && appt.status === "confirmed" && !past ? (
            <>
              <Button variant="outline" onClick={() => setMode("cancel")}>Cancelar cita</Button>
              <Button onClick={() => setMode("move")}>Cambiar hora</Button>
            </>
          ) : null}
          {mode === "move" ? (
            <>
              <Button variant="outline" onClick={() => setMode("view")}>Volver</Button>
              <Button disabled={!slot || pending} onClick={() => start(async () => {
                if (!slot) return;
                const r = await moveAppointment({ appointmentId: appt.id, start: slot.start, staffId: staffId || (slot.staff.length === 1 ? slot.staff[0].id : null) });
                if (r.ok) { toast.success(r.message); onClose(); } else toast.error(r.message);
              })}>{pending ? "Guardando…" : "Guardar cambio"}</Button>
            </>
          ) : null}
          {mode === "cancel" ? (
            <>
              <Button variant="outline" onClick={() => setMode("view")}>No, volver</Button>
              <Button variant="destructive" disabled={pending} onClick={() => start(async () => {
                const r = await cancelAppointmentAction({ appointmentId: appt.id });
                if (r.ok) { toast.success(r.message); onClose(); } else toast.error(r.message);
              })}>Sí, cancelar</Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
