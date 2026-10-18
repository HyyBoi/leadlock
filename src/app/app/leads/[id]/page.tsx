import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf, SOURCE_LABEL, AVAIL_LABEL } from "@/lib/page";
import { ActionButton, ApiForm, Card, Countdown } from "@/components/ui";
import { statusBadge } from "@/components/LeadRow";
import { fmt } from "@/lib/time";
import { ACKED_LEAD_POLICY } from "@/server/leads";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage();
  const { id } = await params;
  const lead = await db.query.leads.findFirst({ where: and(eq(schema.leads.id, id), eq(schema.leads.workspaceId, ctx.workspaceId)) });
  if (!lead || (!ctx.perms.has("leads.view_all") && lead.ownerId !== ctx.membershipId)) notFound();
  const contact = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, lead.contactId) }))!;
  const members = await membersOf(ctx.workspaceId);
  const owner = members.find((m) => m.id === lead.ownerId);
  const history = await db.query.activities.findMany({ where: eq(schema.activities.leadId, lead.id), orderBy: desc(schema.activities.createdAt) });
  return (
    <div className="grid max-w-4xl gap-4">
      <header className="grid gap-2">
        <p className="text-sm"><Link className="link" href="/app/leads">← Leads</Link></p>
        <h1 className="text-2xl font-bold">Lead: {contact.name}</h1>
        <div className="flex flex-wrap gap-2">{statusBadge(lead)}<span className="badge">{SOURCE_LABEL[lead.source]}</span>{lead.status === "OPEN" && <Countdown deadline={lead.deadlineAt?.toISOString() ?? null} />}{lead.escalationCount > 0 && <span className="badge">escalated {lead.escalationCount}×</span>}</div>
      </header>
      <Card title="Accountable owner">
        <p className="text-lg font-semibold">{owner?.name ?? "—"} {owner && <span className="text-sm font-normal">{AVAIL_LABEL[owner.availability]}</span>}</p>
        <p className="text-sm text-[var(--muted)]">{lead.assignReason} · assigned {fmt(lead.assignedAt, ctx.timezone)}</p>
        {lead.message && <blockquote className="mt-3 border-l-4 border-[var(--border)] pl-3 text-sm">“{lead.message}”</blockquote>}
        <div className="mt-3 flex flex-wrap gap-2">
          {lead.status === "OPEN" && lead.ownerId === ctx.membershipId && <ActionButton url={`/api/leads/${lead.id}/ack`} label="Acknowledge now" variant="primary" success="Acknowledged — the timer is stopped." />}
          <Link className="btn btn-ghost" href={`/app/contacts/${contact.id}`}>Open customer record</Link>
          {lead.status !== "CLOSED" && <ActionButton url={`/api/leads/${lead.id}/close`} label="Close lead" confirm="Close this lead?" />}
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">Acknowledging = clicking Acknowledge, or any recorded action on the customer (note, message, call log, stage change, appointment). {ACKED_LEAD_POLICY}</p>
      </Card>
      {ctx.perms.has("leads.reassign") && lead.status !== "CLOSED" && (
        <Card title="Reassign manually">
          <ApiForm action={`/api/leads/${lead.id}/reassign`} inline submitLabel="Reassign" success="Reassigned." fields={[{ name: "membershipId", label: "New owner", type: "select", required: true, options: members.filter((m) => m.active && m.id !== lead.ownerId).map((m) => ({ value: m.id, label: `${m.name} — ${AVAIL_LABEL[m.availability]}` })) }]} />
        </Card>
      )}
      <Card title="Ownership history">
        <ol className="grid gap-2 text-sm">
          {history.map((h) => <li key={h.id}><span className="text-[var(--muted)]">{fmt(h.createdAt, ctx.timezone)}</span> — {h.summary} <span className="text-[var(--muted)]">({h.actorLabel})</span></li>)}
        </ol>
      </Card>
    </div>
  );
}
