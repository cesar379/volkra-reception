"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CalendarDays, ChevronsUpDown, LayoutDashboard, LayoutGrid, LogOut, Menu, MessageSquareText, PhoneCall, Plus, Settings, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { switchBusiness } from "@/app/(app)/actions";
import { logout } from "@/app/login/actions";

/** Menú del producto Reception. Los productos nuevos tendrán su propio grupo (ver src/lib/products.ts). */
const NAV = [
  { href: "/panel", label: "Panel", icon: LayoutDashboard },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/llamadas", label: "Llamadas", icon: PhoneCall },
  { href: "/incidencias", label: "Para revisar", icon: TriangleAlert, badgeKey: "issues" as const },
  { href: "/simulador", label: "Probar el asistente", icon: MessageSquareText },
  { href: "/configuracion", label: "Configuración", icon: Settings },
];

type Props = {
  business: { id: string; name: string; is_demo: boolean };
  businesses: { id: string; name: string }[];
  email: string | null;
  openIssues: number;
};

export function Sidebar(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <HubMark width={112} />
        <button type="button" onClick={() => setOpen(true)} className="rounded-md p-2 hover:bg-muted" aria-label="Abrir menú">
          <Menu className="size-5" />
        </button>
      </header>
      {open ? <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-sidebar transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-5 pb-4 pt-5">
          <HubMark width={124} priority />
          <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 hover:bg-muted lg:hidden" aria-label="Cerrar menú">
            <X className="size-4" />
          </button>
        </div>
        <BusinessSwitcher {...props} />
        <Nav openIssues={props.openIssues} onNavigate={() => setOpen(false)} />
        <div className="mt-auto border-t p-3">
          <div className="truncate px-2 pb-2 text-xs text-muted-foreground" title={props.email ?? ""}>{props.email ?? "Sesión de demostración"}</div>
          <form action={logout}>
            <button type="submit" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
              <LogOut className="size-4" /> Salir
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

function HubMark({ width, priority }: { width: number; priority?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <Image src="/brand/volkra-logo.png" alt="Volkra" width={width} height={Math.round(width * 0.21)} priority={priority} />
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">HUB</span>
    </span>
  );
}

function Nav({ openIssues, onNavigate }: { openIssues: number; onNavigate: () => void }) {
  const pathname = usePathname();
  const productsActive = pathname === "/productos";
  return (
    <nav className="grid gap-0.5 px-3 py-2" aria-label="Secciones">
      <Link
        href="/productos"
        onClick={onNavigate}
        aria-current={productsActive ? "page" : undefined}
        className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition", productsActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground")}
      >
        <LayoutGrid className="size-4" />
        <span className="flex-1">Productos</span>
      </Link>
      <div className="px-3 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Reception</div>
      {NAV.map(({ href, label, icon: Icon, badgeKey }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
              active ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            <span className="flex-1">{label}</span>
            {badgeKey === "issues" && openIssues > 0 ? (
              <span className={cn("rounded-full px-1.5 text-[11px] font-medium tabular", active ? "bg-white/20" : "bg-warning/15 text-warning")}>{openIssues}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function BusinessSwitcher({ business, businesses }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative px-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-left hover:border-ring"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{business.name}</span>
          <span className="block text-[11px] text-muted-foreground">{business.is_demo ? "Negocio de demostración" : "Tu negocio"}</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute inset-x-3 top-full z-10 mt-1 rounded-lg border bg-popover p-1 shadow-lg">
          {businesses.map((b) => (
            <form key={b.id} action={switchBusiness}>
              <input type="hidden" name="businessId" value={b.id} />
              <button type="submit" className={cn("w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", b.id === business.id && "font-medium")}>
                {b.name}
              </button>
            </form>
          ))}
          <Link href="/nueva-empresa" className="mt-1 flex items-center gap-2 rounded-md border-t px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted">
            <Plus className="size-3.5" /> Añadir negocio
          </Link>
        </div>
      ) : null}
    </div>
  );
}
