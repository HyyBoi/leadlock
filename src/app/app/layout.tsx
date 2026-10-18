import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, AVAIL_LABEL } from "@/lib/page";
import { LiveRefresh, ActionButton } from "@/components/ui";
import { NavLinks } from "@/components/NavLinks";
import { Permission } from "@/lib/permissions";

const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/leads", label: "Leads" },
  { href: "/app/recovery", label: "Recovery queue" },
  { href: "/app/contacts", label: "Contacts", perm: "crm.view" },
  { href: "/app/pipeline", label: "Pipeline", perm: "crm.view" },
  { href: "/app/inbox", label: "Inbox" },
  { href: "/app/payments", label: "Payments", perm: "crm.view" },
  { href: "/app/appointments", label: "Appointments", perm: "crm.view" },
  { href: "/app/team", label: "Team & roles" },
  { href: "/app/settings", label: "Pipelines & rules" },
  { href: "/app/integrations", label: "Integrations", perm: "integrations.manage" },
  { href: "/app/audit", label: "Audit log", perm: "audit.view" },
  { href: "/app/profile", label: "My profile" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePage();
  const me = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, ctx.membershipId) }))!;
  const nav = NAV.filter((n) => !n.perm || ctx.perms.has(n.perm));
  const items = nav.map((n) => ({ href: n.href, label: n.label }));
  return (
    <div className="min-h-screen p-2 md:grid md:grid-cols-[220px_1fr] md:gap-2 md:p-3">
      <a href="#main" className="sr-only focus:not-sr-only">Skip to content</a>
      <aside className="px-2 py-3 md:sticky md:top-3 md:h-[calc(100vh-24px)] md:overflow-y-auto">
        <div className="flex items-center gap-3 px-2 pb-4">
          <span className="mark" aria-hidden />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-none">LeadLock</p>
            <p className="truncate text-xs text-[var(--muted)]">{ctx.workspaceName}</p>
          </div>
        </div>
        <details className="md:hidden pb-2">
          <summary className="btn btn-ghost w-full">Menu</summary>
          <nav aria-label="Main" className="mt-2"><NavLinks items={items} /></nav>
        </details>
        <nav aria-label="Main" className="hidden md:block"><NavLinks items={items} /></nav>
        <div className="mt-6 hidden gap-2 px-2 text-sm md:grid">
          <p className="truncate font-semibold">{ctx.name}</p>
          <p className="text-xs text-[var(--muted)]">{ctx.level.charAt(0) + ctx.level.slice(1).toLowerCase()} · {AVAIL_LABEL[me.availability]}</p>
          <ActionButton url="/api/auth/logout" label="Log out" redirect="/login" />
        </div>
      </aside>
      <main id="main" className="panel min-w-0 p-5 md:p-8">
        <LiveRefresh />
        {children}
        <div className="mt-8 md:hidden"><ActionButton url="/api/auth/logout" label="Log out" redirect="/login" /></div>
      </main>
    </div>
  );
}
