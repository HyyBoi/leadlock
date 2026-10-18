import Link from "next/link";
import { requirePage, membersOf } from "@/lib/page";
import { recoveryQueue, getRule } from "@/server/leads";
import { leadViews } from "@/server/leadviews";
import { db } from "@/db";
import { ApiForm, Countdown } from "@/components/ui";
import { statusBadge } from "@/components/LeadRow";
import { AVAIL_LABEL, SOURCE_LABEL } from "@/lib/page";

export default async function Recovery() {
  const ctx = await requirePage();
  const all = ctx.perms.has("leads.view_all");
  const items = await recoveryQueue(ctx.workspaceId, all ? undefined : ctx.membershipId);
  const reasons = new Map(items.map((i) => [i.lead.id, i.reasons]));
  const { rows } = await leadViews(ctx, undefined, { ids: items.map((i) => i.lead.id), limit: 200 });
  const members = ctx.perms.has("leads.reassign") ? await membersOf(ctx.workspaceId) : [];
  const rule = await getRule(db, ctx.workspaceId);
  return (
    <div className="grid gap-4">
      <header>
        <h1 className="text-2xl font-bold">Recovery queue</h1>
        <p className="text-sm text-[var(--muted)]">Leads unacknowledged beyond their window, escalated 2+ times, idle for over {Math.round(rule.idleSeconds / 60)} min, or whose owner is unavailable.</p>
      </header>
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>Lead</th><th>Owner</th><th>Why it&apos;s here</th><th>Status</th>{members.length > 0 && <th>Reassign</th>}</tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td><Link className="link font-medium" href={`/app/leads/${l.id}`}>{l.contactName}</Link><div className="text-xs">{SOURCE_LABEL[l.source]}</div></td>
                <td>{l.ownerName}</td>
                <td><ul className="grid gap-1">{reasons.get(l.id)!.map((r) => <li key={r}><span className="badge badge-danger">{r}</span></li>)}</ul></td>
                <td className="grid justify-items-start gap-1">{statusBadge(l)}{l.status === "OPEN" && <Countdown deadline={l.deadlineAt ? new Date(l.deadlineAt).toISOString() : null} />}</td>
                {members.length > 0 && <td className="min-w-48"><ApiForm action={`/api/leads/${l.id}/reassign`} submitLabel="Move" success="Reassigned." fields={[{ name: "membershipId", label: "To", type: "select", required: true, options: members.filter((m) => m.active && m.id !== l.ownerId && m.availability !== "ON_LEAVE" && m.availability !== "OFFLINE").map((m) => ({ value: m.id, label: `${m.name} ${AVAIL_LABEL[m.availability]}` })) }]} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm">Nothing to recover — every lead is being handled.</p>}
      </div>
    </div>
  );
}
