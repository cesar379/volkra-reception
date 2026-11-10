import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/app/ui";
import { PRODUCTS } from "@/lib/products";

export const metadata = { title: "Productos" };

export default function ProductsPage() {
  return (
    <>
      <PageHeader title="Productos" description="Las herramientas de Volkra Hub para tu negocio." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PRODUCTS.map(({ key, name, tagline, description, href, icon: Icon, status }) => (
          <Link key={key} href={href} className="group flex flex-col rounded-xl border bg-card p-5 transition hover:border-ring">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-secondary"><Icon className="size-5" /></span>
              <span>
                <span className="block font-medium">{name}</span>
                <span className="block text-sm text-muted-foreground">{tagline}</span>
              </span>
              {status === "active" ? <span className="ml-auto rounded-full bg-success/10 px-2 py-0.5 text-xs text-success">Activo</span> : null}
            </div>
            <p className="mt-4 flex-1 text-sm text-muted-foreground">{description}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium">Abrir <ArrowRight className="size-4 transition group-hover:translate-x-0.5" /></span>
          </Link>
        ))}
        <div className="flex flex-col rounded-xl border border-dashed p-5 text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-lg bg-muted"><Sparkles className="size-5" /></span>
            <span className="font-medium text-foreground">Más productos en camino</span>
          </div>
          <p className="mt-4 text-sm">Estamos preparando nuevas herramientas con IA para tu negocio. Aparecerán aquí.</p>
        </div>
      </div>
    </>
  );
}
