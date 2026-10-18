import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, AVAIL_LABEL } from "@/lib/page";
import { LiveRefresh, ActionButton } from "@/components/ui";
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
  const links = nav.map((n) => (
    <li key={n.href}>
      <Link className="block rounded-md px-3 py-2 text-sm hover:bg-[var(--bg)]" href={n.href}>
        {n.label}
      </Link>
    </li>
  ));
  return (
    <div className="min-h-screen md:grid md:grid-cols-[230px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only">Skip to content</a>
      <aside className="border-b border-[var(--border)] bg-[var(--surface)] md:min-h-screen md:border-b-0 md:border-r">
        <div className="flex items-center justify-between p-4">
          <div className="min-w-0">
            <p className="font-bold">LeadLock</p>
            <p className="truncate text-xs text-[var(--muted)]">{ctx.workspaceName}</p>
          </div>
        </div>
        <details className="md:hidden px-2 pb-2">
          <summary className="btn btn-ghost w-full">Menu</summary>
          <ul className="mt-2 grid">{links}</ul>
        </details>
        <nav aria-label="Main" className="hidden md:block px-2">
          <ul className="grid gap-0.5">{links}</ul>
        </nav>
        <div className="hidden md:grid gap-2 p-4 text-sm">
          <p className="truncate">{ctx.name} · <span className="text-[var(--muted)]">{ctx.level.toLowerCase()}</span></p>
          <p className="text-xs">{AVAIL_LABEL[me.availability]}</p>
          <ActionButton url="/api/auth/logout" label="Log out" redirect="/login" />
        </div>
      </aside>
      <main id="main" className="min-w-0 p-4 md:p-6">
        <LiveRefresh />
        {children}
        <div className="mt-8 md:hidden"><ActionButton url="/api/auth/logout" label="Log out" redirect="/login" /></div>
      </main>
    </div>
  );
}
