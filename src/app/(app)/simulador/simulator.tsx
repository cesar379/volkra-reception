"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bot, CircleCheck, CircleX, Mic, PhoneCall, PhoneOff, SendHorizontal, Volume2, VolumeX, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { simEnd, simSend, simStart } from "./actions";
import type { SimEvent } from "@/server/simulator/session";

type Line = { who: "agent" | "caller" | "system"; text: string };

const TOOL_LABEL: Record<string, string> = {
  buscar_huecos: "Consulta la agenda", reservar_cita: "Guarda la cita", buscar_mis_citas: "Busca sus citas", cambiar_cita: "Cambia la cita",
  cancelar_cita: "Cancela la cita", consultar_informacion: "Busca en la información del negocio", dejar_recado: "Guarda un recado", transferCall: "Transferencia",
};

type SpeechRec = { lang: string; interimResults: boolean; start: () => void; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onerror: () => void; onend: () => void };

export function Simulator({ mode, model, businessName, suggestions }: { mode: "claude" | "script"; model: string; businessName: string; suggestions: string[] }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [ended, setEnded] = useState(false);
  const [text, setText] = useState("");
  const [speak, setSpeak] = useState(false);
  const [listening, setListening] = useState(false);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [lines]);

  const say = (t: string) => {
    if (!speak || typeof window === "undefined" || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "es-ES";
    const v = window.speechSynthesis.getVoices().find((x) => x.lang === "es-ES");
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  };

  const begin = () =>
    start(async () => {
      const r = await simStart();
      if (!r.ok) { toast.error(r.message); return; }
      setSessionId(r.sessionId);
      setEnded(false);
      setEvents([]);
      setLines([{ who: "system", text: `Llamada simulada a ${businessName}` }, ...r.replies.map((t) => ({ who: "agent" as const, text: t }))]);
      r.replies.forEach(say);
    });

  const send = (message: string) => {
    if (!sessionId || !message.trim() || ended) return;
    setLines((l) => [...l, { who: "caller", text: message }]);
    setText("");
    start(async () => {
      const r = await simSend(sessionId, message);
      if (!r.ok) { toast.error(r.message); setLines((l) => [...l, { who: "system", text: r.message }]); return; }
      setLines((l) => [...l, ...r.replies.map((t) => ({ who: "agent" as const, text: t })), ...(r.ended ? [{ who: "system" as const, text: r.endReason === "transferred" ? "Llamada transferida al equipo" : "Llamada finalizada" }] : [])]);
      setEvents((e) => [...e, ...r.events]);
      r.replies.forEach(say);
      if (r.ended) setEnded(true);
    });
  };

  const hangUp = () =>
    start(async () => {
      if (sessionId && !ended) await simEnd(sessionId);
      setEnded(true);
      setLines((l) => [...l, { who: "system", text: "Has colgado. La llamada ya aparece en el historial." }]);
    });

  const listen = () => {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { toast.info("Tu navegador no permite dictar por voz. Prueba con Chrome."); return; }
    const rec = new Ctor();
    rec.lang = "es-ES";
    rec.interimResults = false;
    rec.onresult = (e) => send(e.results[0][0].transcript);
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="flex h-[640px] max-h-[75vh] flex-col overflow-hidden rounded-[28px] border-[6px] border-primary bg-card shadow-sm">
        <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
          <span className="grid size-9 place-items-center rounded-full bg-primary-foreground/15"><Bot className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{businessName}</div>
            <div className="text-[11px] opacity-75">{mode === "claude" ? `Asistente con Claude (${model})` : "Guion local de demostración (sin IA)"}</div>
          </div>
          <button type="button" onClick={() => setSpeak((v) => !v)} className="rounded-md p-1.5 hover:bg-primary-foreground/10" aria-label={speak ? "Silenciar voz" : "Leer respuestas en voz alta"} title={speak ? "Silenciar voz" : "Leer respuestas en voz alta"}>
            {speak ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4" aria-live="polite">
          {lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <PhoneCall className="size-8" />
              
            </div>
          ) : lines.map((l, i) =>
            l.who === "system" ? (
              <div key={i} className="py-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground">{l.text}</div>
            ) : (
              <div key={i} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed", l.who === "agent" ? "rounded-tl-sm bg-card ring-1 ring-border" : "ml-auto rounded-tr-sm bg-primary text-primary-foreground")}>
                {l.text}
              </div>
            ),
          )}
          {pending && sessionId ? <div className="w-16 rounded-2xl bg-card px-3 py-2 text-center text-sm ring-1 ring-border"><span className="animate-pulse">···</span></div> : null}
          <div ref={endRef} />
        </div>

        {sessionId && !ended ? (
          <div className="border-t bg-card p-3">
            <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
              {suggestions.map((s) => (
                <button key={s} type="button" disabled={pending} onClick={() => send(s)} className="shrink-0 rounded-full border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">{s}</button>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); send(text); }} className="flex items-center gap-2">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escribe lo que diría el cliente…"
                className="h-9 min-w-0 flex-1 rounded-full border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                aria-label="Mensaje del cliente"
              />
              <Button type="button" size="icon" variant="outline" onClick={listen} disabled={pending || listening} aria-label="Dictar por voz"><Mic className={cn(listening && "animate-pulse text-destructive")} /></Button>
              <Button type="submit" size="icon" disabled={pending || !text.trim()} aria-label="Enviar"><SendHorizontal /></Button>
              <Button type="button" size="icon" variant="destructive" onClick={hangUp} disabled={pending} aria-label="Colgar"><PhoneOff /></Button>
            </form>
          </div>
        ) : (
          <div className="border-t bg-card p-3">
            <Button className="w-full" size="lg" onClick={begin} disabled={pending}><PhoneCall /> {sessionId ? "Nueva llamada" : "Llamar"}</Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="flex items-center gap-2 text-base font-medium"><Wrench className="size-4" /> Acciones</h2>
          {events.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">—</p> : (
            <ol className="mt-4 grid gap-2">
              {events.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {e.ok === false || e.kind === "error" ? <CircleX className="mt-0.5 size-4 shrink-0 text-warning" /> : <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />}
                  <span><span className="font-medium">{TOOL_LABEL[e.name] ?? e.name}</span>{e.summary ? <span className="text-muted-foreground"> · {e.summary}</span> : null}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
