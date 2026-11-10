"use client";

import { useEffect, useRef, useState } from "react";
import { SendHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Line = { who: "agent" | "user" | "system"; text: string };

export function ChatWindow({ chatKey, businessName, greeting, embed }: { chatKey: string; businessName: string; greeting: string; embed: boolean }) {
  const [lines, setLines] = useState<Line[]>([{ who: "agent", text: greeting }]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [ended, setEnded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines, pending]);

  const send = async () => {
    const message = text.trim();
    if (!message || pending || ended) return;
    setLines((l) => [...l, { who: "user", text: message }]);
    setText("");
    setPending(true);
    try {
      const res = await fetch(`/api/chat/${encodeURIComponent(chatKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, text: message }),
      });
      const r = (await res.json().catch(() => null)) as { ok: boolean; sessionId?: string; replies?: string[]; code?: string; message?: string } | null;
      if (!r?.ok) {
        if (r?.code === "ended") setEnded(true);
        setLines((l) => [...l, { who: "system", text: r?.message ?? "No he podido responder. Inténtalo de nuevo." }]);
        return;
      }
      if (r.sessionId) setSessionId(r.sessionId);
      setLines((l) => [...l, ...(r.replies ?? []).map((t) => ({ who: "agent" as const, text: t }))]);
    } catch {
      setLines((l) => [...l, { who: "system", text: "Sin conexión. Inténtalo de nuevo." }]);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  };

  const restart = () => {
    setSessionId(null);
    setEnded(false);
    setLines([{ who: "agent", text: greeting }]);
  };

  return (
    <div className={cn("flex h-dvh flex-col bg-background", !embed && "mx-auto max-w-lg sm:border-x")}>
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{businessName}</div>
          <div className="text-[11px] text-muted-foreground">Asistente con IA</div>
        </div>
        {embed ? (
          <button type="button" onClick={() => window.parent.postMessage({ type: "volkra-chat-close" }, "*")} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Cerrar chat">
            <X className="size-4" />
          </button>
        ) : null}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-4" aria-live="polite">
        {lines.map((l, i) =>
          l.who === "system" ? (
            <div key={i} className="py-1 text-center text-xs text-muted-foreground">{l.text}</div>
          ) : (
            <div key={i} className={cn("max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm leading-relaxed", l.who === "agent" ? "rounded-tl-sm bg-muted" : "ml-auto rounded-tr-sm bg-primary text-primary-foreground")}>
              {l.text}
            </div>
          ),
        )}
        {pending ? <div className="w-14 rounded-2xl bg-muted px-3 py-2 text-center text-sm"><span className="animate-pulse">···</span></div> : null}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3">
        {ended ? (
          <button type="button" onClick={restart} className="h-10 w-full rounded-full bg-primary text-sm text-primary-foreground">Nueva conversación</button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              rows={1}
              maxLength={600}
              placeholder="Escribe tu mensaje"
              aria-label="Mensaje"
              className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border bg-background px-3.5 py-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            />
            <button type="submit" disabled={pending || !text.trim()} aria-label="Enviar" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
              <SendHorizontal className="size-4" />
            </button>
          </form>
        )}
        <p className="mt-2 text-center text-[10px] text-muted-foreground">Asistente virtual con IA · <a href="https://volkra.es" target="_blank" rel="noopener" className="hover:underline">Volkra</a></p>
      </div>
    </div>
  );
}
