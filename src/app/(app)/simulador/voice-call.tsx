"use client";

import { useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { Mic, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { voiceSession } from "./actions";

type Line = { who: "agent" | "caller" | "system"; text: string };

export function VoiceCall({ businessName }: { businessName: string }) {
  return (
    <ConversationProvider>
      <VoiceInner businessName={businessName} />
    </ConversationProvider>
  );
}

function VoiceInner({ businessName }: { businessName: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const add = (l: Line) => {
    setLines((x) => [...x, l]);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 50);
  };

  const conversation = useConversation({
    onMessage: (m) => add({ who: m.source === "user" ? "caller" : "agent", text: m.message }),
    onDisconnect: () => add({ who: "system", text: "Llamada terminada" }),
    onError: (msg) => setError(typeof msg === "string" ? msg : "Error de conexión"),
  });
  const live = conversation.status === "connected" || conversation.status === "connecting";

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const s = await voiceSession();
      if (!s.ok) {
        setError(s.message);
        return;
      }
      setLines([{ who: "system", text: `Llamada a ${businessName}` }]);
      const common = {
        dynamicVariables: s.dynamicVariables,
        overrides: { agent: { prompt: { prompt: s.prompt }, language: "es" as const } },
      };
      if (s.conversationToken) conversation.startSession({ conversationToken: s.conversationToken, connectionType: "webrtc", ...common });
      else conversation.startSession({ agentId: s.agentId!, ...common });
    } catch {
      setError("Permite el micrófono para llamar.");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-[640px] max-h-[75vh] flex-col overflow-hidden rounded-[28px] border-[6px] border-primary bg-card shadow-sm">
      <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
        <span className={cn("grid size-9 place-items-center rounded-full bg-primary-foreground/15", conversation.isSpeaking && "animate-pulse")}>
          <Mic className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{businessName}</div>
          <div className="text-[11px] opacity-75">
            {conversation.status === "connected" ? (conversation.isSpeaking ? "Hablando…" : "Escuchando…") : conversation.status === "connecting" ? "Conectando…" : "Voz · ElevenLabs"}
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto bg-muted/40 p-4" aria-live="polite">
        {lines.map((l, i) =>
          l.who === "system" ? (
            <div key={i} className="py-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground">{l.text}</div>
          ) : (
            <div key={i} className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed", l.who === "agent" ? "rounded-tl-sm bg-card ring-1 ring-border" : "ml-auto rounded-tr-sm bg-primary text-primary-foreground")}>
              {l.text}
            </div>
          ),
        )}
        {error ? <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        <div ref={endRef} />
      </div>
      <div className="border-t bg-card p-3">
        {live ? (
          <Button className="w-full" size="lg" variant="destructive" onClick={() => conversation.endSession()}><PhoneOff /> Colgar</Button>
        ) : (
          <Button className="w-full" size="lg" onClick={start} disabled={starting}><Mic /> {starting ? "Conectando…" : "Llamar por voz"}</Button>
        )}
      </div>
    </div>
  );
}
