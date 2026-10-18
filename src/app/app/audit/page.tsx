import { and, desc, eq, gte, lte, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { fmt } from "@/lib/time";

/** F4.2 / F4.3: read-only, permission-gated, filterable. No edit/delete exists anywhere (and the DB trigger forbids it). */
export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string; actor?: string; from?: string; to?: string }> }) {
  const ctx = await requirePage("audit.view");
  const sp = await searchParams;
  const a = schema.auditLogs;
  const rows = await db.query.auditLogs.findMany({
    where: and(eq(a.workspaceId, ctx.workspaceId), sp.action ? like(a.action, `${sp.action}%`) : undefined, sp.actor === "system" ? sql`${a.actorId} is null` : sp.actor ? eq(a.actorId, sp.actor) : undefined, sp.from ? gte(a.createdAt, new Date(sp.from)) : undefined, sp.to ? lte(a.createdAt, new Date(sp.to + "T23:59:59Z")) : undefined),
    orderBy: desc(a.createdAt), limit: 300,
  });
  const actions = await db.selectDistinct({ action: a.action }).from(a).where(eq(a.workspaceId, ctx.workspaceId));
  const members = await membersOf(ctx.workspaceId);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <p className="text-sm text-[var(--muted)]">Append-only. Entries cannot be edited or deleted by any screen, endpoint or even a direct database UPDATE/DELETE.</p>
      <form className="card grid gap-3 sm:grid-cols-5" method="get">
        <label className="grid gap-1 text-sm">Event type<select name="action" defaultValue={sp.action ?? ""} className="input"><option value="">All</option>{actions.map((x) => <option key={x.action}>{x.action}</option>)}</select></label>
        <label className="grid gap-1 text-sm">User<select name="actor" defaultValue={sp.actor ?? ""} className="input"><option value="">Anyone</option><option value="system">System</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">From<input type="date" name="from" defaultValue={sp.from} className="input" /></label>
        <label className="grid gap-1 text-sm">To<input type="date" name="to" defaultValue={sp.to} className="input" /></label>
        <div className="flex items-end"><button className="btn btn-primary">Filter</button></div>
      </form>
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Before → After</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-sm">{fmt(r.createdAt, ctx.timezone)}</td>
              <td>{r.actorLabel}</td>
              <td><code className="text-xs">{r.action}</code></td>
              <td className="text-xs">{r.targetType} <code>{r.targetId?.slice(0, 8)}</code></td>
              <td className="text-xs break-all">{r.before ? <code className="text-[var(--danger)]">{JSON.stringify(r.before)}</code> : "—"} → {r.after ? <code className="text-[var(--ok)]">{JSON.stringify(r.after)}</code> : "—"}</td>
            </tr>))}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-[var(--muted)]">No entries match.</p>}
      </div>
    </div>
  );
}
