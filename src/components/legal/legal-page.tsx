import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import { Marked } from "marked";

/**
 * Textos legales públicos (privacidad, condiciones, encargo). El contenido vive en docs/legal/*.md
 * y los datos del titular en LEGAL_TITULAR, LEGAL_NIF y LEGAL_DOMICILIO (o en docs/legal/titular.json).
 * Se generan al compilar: son páginas estáticas.
 */
export type LegalDoc = "privacidad" | "condiciones" | "encargo-tratamiento";

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const marked = new Marked({
  renderer: {
    heading({ tokens, depth, text }) {
      return `<h${depth} id="${slug(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    },
  },
});

export function legalHtml(doc: LegalDoc): { title: string; html: string } {
  const dir = path.join(process.cwd(), "docs", "legal");
  const holder = JSON.parse(fs.readFileSync(path.join(dir, "titular.json"), "utf8")) as Record<string, string>;
  // Las variables de entorno tienen prioridad: así el NIF y el domicilio no tienen que estar en el repositorio.
  const env = { TITULAR: process.env.LEGAL_TITULAR, NIF: process.env.LEGAL_NIF, DOMICILIO: process.env.LEGAL_DOMICILIO };
  for (const [k, v] of Object.entries(env)) if (v?.trim()) holder[k] = v;
  const md = fs
    .readFileSync(path.join(dir, `${doc}.md`), "utf8")
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => holder[k]?.trim() || `[${k}]`);
  const title = md.match(/^# (.+)$/m)?.[1] ?? "Volkra";
  return { title, html: marked.parse(md, { async: false }) };
}

const LINKS: [LegalDoc, string][] = [
  ["privacidad", "Privacidad"],
  ["condiciones", "Condiciones"],
  ["encargo-tratamiento", "Encargo de tratamiento"],
];

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const { html } = legalHtml(doc);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <Link href="https://volkra.es"><Image src="/brand/volkra-logo.png" alt="Volkra" width={130} height={28} priority /></Link>
        <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {LINKS.map(([d, label]) => (
            <Link key={d} href={`/${d}`} className={d === doc ? "font-medium text-foreground" : "hover:text-foreground"}>{label}</Link>
          ))}
        </nav>
      </header>
      <article
        className="space-y-4 text-[15px] leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[13px] [&_h1]:text-3xl [&_h1]:font-medium [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-medium [&_li]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_table]:w-full [&_table]:text-sm [&_td]:border-t [&_td]:py-2 [&_td]:pr-3 [&_td]:align-top [&_th]:py-2 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium [&_ul]:list-disc [&_ul]:space-y-1 [&_div.table]:overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: html.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>") }}
      />
    </main>
  );
}
