import Link from "next/link";
import { and, eq, gte } from "drizzle-orm";
import { schema } from "@/db";
import { requirePage } from "@/lib/page";
import { leadViews } from "@/server/leadviews";
import { LeadRow } from "@/components/LeadRow";
import { ApiForm, Card } from "@/components/ui";
import { zonedToUtc } from "@/lib/time";

const PAGE = 25;

export default async function Leads({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string; page?: string }> }) {
  const ctx = await requirePage();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const conds = [];
  if (sp.scope === "mine") conds.push(eq(schema.leads.ownerId, ctx.membershipId));
  if (sp.scope === "today") conds.push(gte(schema.leads.createdAt, zonedToUtc(new Date().toLocaleDateString("en-CA", { timeZone: ctx.timezone }), "00:00", ctx.timezone)));
  if (sp.status === "OPEN" || sp.status === "ACKNOWLEDGED" || sp.status === "CLOSED") conds.push(eq(schema.leads.status, sp.status));
  const { rows, total } = await leadViews(ctx, conds.length ? and(...conds) : undefined, { limit: PAGE, offset: (page - 1) * PAGE });
  const q = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Leads</h1>
        <p className="text-sm text-[var(--muted)]">{ctx.perms.has("leads.view_all") ? "All leads in the workspace" : "Leads assigned to you"} · updates live</p>
      </header>
      <nav aria-label="Lead filters" className="flex flex-wrap gap-2 text-sm">
        {[["All", undefined], ["Mine", "mine"], ["Today", "today"]].map(([l, v]) => <Link key={l} className={`btn ${sp.scope === v ? "btn-primary" : "btn-ghost"}`} href={q({ scope: v, page: undefined })}>{l}</Link>)}
        {[["Any status", undefined], ["Waiting", "OPEN"], ["Acknowledged", "ACKNOWLEDGED"], ["Closed", "CLOSED"]].map(([l, v]) => <Link key={l} className={`btn ${sp.status === v ? "btn-primary" : "btn-ghost"}`} href={q({ status: v, page: undefined })}>{l}</Link>)}
      </nav>
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>Lead</th><th>Owner</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((l) => <LeadRow key={l.id} l={l} me={ctx.membershipId} />)}</tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-[var(--muted)]">No leads match.</p>}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>{total} leads · page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="btn btn-ghost" href={q({ page: String(page - 1) })}>← Previous</Link>}
            {page * PAGE < total && <Link className="btn btn-ghost" href={q({ page: String(page + 1) })}>Next →</Link>}
          </span>
        </div>
      </div>
      {ctx.perms.has("crm.create") && (
        <Card title="Add a lead manually">
          <ApiForm action="/api/leads" submitLabel="Create lead" success="Lead created and assigned." reset className="grid gap-3 sm:grid-cols-2" fields={[
            { name: "name", label: "Name", required: true },
            { name: "phone", label: "Phone", type: "tel", placeholder: "+923001234567" },
            { name: "email", label: "Email", type: "email" },
            { name: "message", label: "Notes / request", type: "textarea" },
          ]} />
        </Card>
      )}
      <p className="text-sm">Public web form for customers: <Link className="link" href={`/f/${ctx.workspaceSlug}`} target="_blank">/f/{ctx.workspaceSlug}</Link></p>
    </div>
  );
}
