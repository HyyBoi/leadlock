import Link from "next/link";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { money } from "@/server/crm";
import { fmt } from "@/lib/time";

const BADGE: Record<string, string> = { PENDING: "badge badge-warn", PAID: "badge badge-ok", FAILED: "badge badge-danger", EXPIRED: "badge", REFUNDED: "badge badge-info", PARTIALLY_REFUNDED: "badge badge-info" };

/** I2.6 / I2.7: collected vs projected, with full traceability per payment. */
export default async function Payments({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requirePage("crm.view");
  const { status } = await searchParams;
  const ws = eq(schema.payments.workspaceId, ctx.workspaceId);
  const rows = await db
    .select({ p: schema.payments, contact: schema.contacts.name, opp: schema.opportunities.title })
    .from(schema.payments)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.payments.contactId))
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.payments.opportunityId))
    .where(and(ws, status === "PAID" ? isNotNull(schema.payments.paidAt) : status ? sql`${schema.payments.status} = ${status}` : undefined))
    .orderBy(desc(schema.payments.createdAt))
    .limit(200);
  const [tot] = await db.select({
    collected: sql<number>`coalesce(sum(case when ${schema.payments.paidAt} is not null then ${schema.payments.amount} - ${schema.payments.refundedAmount} end),0)::int`,
    pending: sql<number>`coalesce(sum(case when ${schema.payments.status} = 'PENDING' then ${schema.payments.amount} end),0)::int`,
  }).from(schema.payments).where(ws);
  const [openOpps] = ctx.perms.has("crm.view_value") ? await db.select({ v: sql<number>`coalesce(sum(${schema.opportunities.value}),0)::int` }).from(schema.opportunities).innerJoin(schema.stages, eq(schema.stages.id, schema.opportunities.stageId)).where(and(eq(schema.opportunities.workspaceId, ctx.workspaceId), eq(schema.stages.kind, "OPEN"))) : [{ v: null }];
  const members = await membersOf(ctx.workspaceId);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Payments</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card"><p className="text-sm text-[var(--muted)]">Collected (webhook-confirmed, net of refunds)</p><p className="text-2xl font-bold">{money(tot.collected)}</p></div>
        <div className="card"><p className="text-sm text-[var(--muted)]">Requested, not yet paid</p><p className="text-2xl font-bold">{money(tot.pending)}</p></div>
        <div className="card"><p className="text-sm text-[var(--muted)]">Projected (open opportunities + unpaid requests)</p><p className="text-2xl font-bold">{openOpps.v === null ? "hidden" : money(openOpps.v + tot.pending)}</p></div>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Payment status filter">{[undefined, "PAID", "PENDING", "FAILED", "EXPIRED", "REFUNDED"].map((s) => <Link key={s ?? "all"} href={s ? `/app/payments?status=${s}` : "/app/payments"} className={`btn ${status === s ? "btn-primary" : "btn-ghost"}`}>{s ?? "All"}</Link>)}</nav>
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>Status</th><th>Amount</th><th>Customer / opportunity</th><th>Requested by</th><th>Provider reference</th><th>Created</th></tr></thead>
          <tbody>
            {rows.map(({ p, contact, opp }) => (
              <tr key={p.id}>
                <td><span className={BADGE[p.status]}>{p.status.replace("_", " ")}</span>{p.lastError && <div className="text-xs text-[var(--danger)]">{p.lastError}</div>}</td>
                <td>{money(p.amount, p.currency)}{p.refundedAmount > 0 && <div className="text-xs">refunded {money(p.refundedAmount, p.currency)}</div>}</td>
                <td><Link className="link" href={`/app/contacts/${p.contactId}#opportunities`}>{contact}</Link><div className="text-xs">{opp}</div></td>
                <td>{members.find((m) => m.id === p.requestedById)?.name ?? "—"}</td>
                <td className="text-xs break-all"><code>{p.providerRef ?? "—"}</code>{p.providerPayment && <div><code>{p.providerPayment}</code></div>}</td>
                <td className="text-sm">{fmt(p.createdAt, ctx.timezone)}{p.paidAt && <div className="text-xs">paid {fmt(p.paidAt, ctx.timezone)}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-[var(--muted)]">No payments.</p>}
      </div>
      <p className="text-xs text-[var(--muted)]">Card details are entered only on Stripe&apos;s hosted page. LeadLock never sees or stores card numbers.</p>
    </div>
  );
}
