import { Sidebar } from "@/components/app/sidebar";
import { requireApp } from "@/server/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireApp();
  const issues = await ctx.asUser((q) =>
    q.query<{ n: number }>(`select count(*)::int as n from issues where business_id = $1 and resolved_at is null`, [ctx.business.id]),
  );
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      <Sidebar business={ctx.business} businesses={ctx.businesses} email={ctx.session.email} openIssues={issues[0]?.n ?? 0} />
      <main className="min-w-0 px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-8">
        {ctx.business.is_demo ? (
          <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-foreground">
            <strong className="font-medium">Demo.</strong> Datos simulados.
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
