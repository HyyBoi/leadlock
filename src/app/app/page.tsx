import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, AVAIL_LABEL } from "@/lib/page";
import { dashboard } from "@/server/metrics";
import { money } from "@/server/crm";
import { fmt } from "@/lib/time";
import { DashboardToggles } from "@/components/ui";

const ITEMS = [
  { key: "newToday", label: "New leads today" },
  { key: "pipeline", label: "Open pipeline value" },
  { key: "response", label: "Avg time to first response" },
  { key: "recovery", label: "Recovery queue" },
  { key: "escalations", label: "Escalations (24h)" },
  { key: "team", label: "Employee availability" },
  { key: "appointments", label: "Upcoming appointments" },
  { key: "payments", label: "Payments this month" },
];

const dur = (s: number | null) => (s == null ? "—" : s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${(s / 3600).toFixed(1)}h`);

function Stat({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: string; href?: string }) {
  const inner = (
    <>
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--muted)]">{sub}</p>}
    </>
  );
  return href ? <Link href={href} className="card block hover:border-[var(--primary)]" aria-label={`${label}: open the list`}>{inner}<span className="mt-2 block text-xs link">View records →</span></Link> : <div className="card">{inner}</div>;
}

export default async function Dashboard() {
  const ctx = await requirePage();
  const d = await dashboard(ctx);
  const me = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, ctx.membershipId) }))!;
  const hidden = new Set(me.dashboardHidden);
  const show = (k: string) => !hidden.has(k);
  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <span className="badge badge-info">{d.personal ? "Your personal figures" : "Company-wide figures"}</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {show("newToday") && <Stat label="New leads today" value={d.newToday} href="/app/leads?scope=today" />}
        {show("response") && <Stat label="Avg time to first response" value={dur(d.avgResponseSec)} sub={`assignment → first acknowledgement, ${d.respondedCount} leads`} />}
        {show("recovery") && <Stat label="Recovery queue" value={d.recovery} sub="overdue, escalated 2+ or idle" href="/app/recovery" />}
        {show("escalations") && <Stat label="Escalations (last 24h)" value={d.escalations24h} href="/app/audit?action=lead.escalated" />}
        {show("payments") && <Stat label="Collected this month" value={money(d.collectedMonth)} sub={`${d.collectedCount} webhook-confirmed payments, net of refunds · ${money(d.pendingPayments)} awaiting payment`} href="/app/payments?status=PAID" />}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {show("pipeline") && (
          <section className="card">
            <h2 className="font-semibold">Open pipeline value by stage</h2>
            {d.pipeline ? (
              <table className="table mt-2">
                <thead><tr><th>Stage</th><th>Opportunities</th><th>Value</th></tr></thead>
                <tbody>
                  {d.pipeline.map((s) => (
                    <tr key={s.stageId}><td><Link className="link" href={`/app/pipeline?p=${s.pipelineId}`}>{s.stage}</Link></td><td>{s.n}</td><td>{money(s.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-[var(--muted)]">Hidden: your role doesn&apos;t include permission to see opportunity values.</p>
            )}
          </section>
        )}
        {show("team") && (
          <section className="card">
            <h2 className="font-semibold">Employee availability</h2>
            <ul className="mt-2 grid gap-1 text-sm">
              {d.team.map((t) => <li key={t.availability}>{AVAIL_LABEL[t.availability]}: <strong>{t.n}</strong></li>)}
            </ul>
            <Link className="link mt-2 inline-block text-sm" href="/app/team">See who →</Link>
          </section>
        )}
        {show("appointments") && (
          <section className="card">
            <h2 className="font-semibold">Upcoming appointments (7 days)</h2>
            {d.upcoming.length ? (
              <ul className="mt-2 grid gap-1 text-sm">
                {d.upcoming.map((a) => <li key={a.id}><Link className="link" href={`/app/contacts/${a.contactId}`}>{a.title}</Link> — {fmt(a.startAt, ctx.timezone)}</li>)}
              </ul>
            ) : <p className="mt-2 text-sm text-[var(--muted)]">Nothing booked.</p>}
            <Link className="link mt-2 inline-block text-sm" href="/app/appointments">All appointments →</Link>
          </section>
        )}
      </div>
      <DashboardToggles items={ITEMS} hidden={me.dashboardHidden} />
    </div>
  );
}
