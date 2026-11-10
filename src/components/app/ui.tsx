import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL, STATUS_LABEL } from "@/lib/format";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-medium sm:text-[28px]">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warning" }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-heading text-3xl font-medium tabular", tone === "warning" && "text-warning")}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  booked: "bg-success/12 text-success",
  rescheduled: "bg-success/12 text-success",
  cancelled: "bg-muted text-muted-foreground",
  info: "bg-secondary text-secondary-foreground",
  transferred: "bg-accent text-accent-foreground",
  message: "bg-warning/12 text-warning",
  no_action: "bg-muted text-muted-foreground",
  error: "bg-destructive/10 text-destructive",
};

export function OutcomeBadge({ outcome, status }: { outcome: string | null; status?: string }) {
  const key = outcome ?? (status === "in_progress" ? "in_progress" : "no_action");
  const label = OUTCOME_LABEL[key] ?? STATUS_LABEL[key] ?? key;
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", OUTCOME_TONE[key] ?? "bg-muted")}>{label}</span>;
}

export function SimTag() {
  return <span className="rounded border border-dashed border-warning/50 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-warning">simulado</span>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-muted-foreground">{icon}</div> : null}
      <div className="font-medium">{title}</div>
      {children ? <div className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Section({ title, description, children, actions }: { title: string; description?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="text-base font-medium">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
