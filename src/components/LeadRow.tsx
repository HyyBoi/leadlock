import Link from "next/link";
import { Countdown, ActionButton } from "./ui";
import { SOURCE_LABEL } from "@/lib/page";
import { ago } from "@/lib/time";

export type LeadView = {
  id: string; contactId: string; contactName: string; source: string; status: string; ownerName: string | null; ownerId: string | null;
  deadlineAt: Date | null; escalationCount: number; windowExpired: boolean; createdAt: Date; assignReason: string | null;
};

export function statusBadge(l: { status: string; windowExpired: boolean }) {
  if (l.status === "CLOSED") return <span className="badge">Closed</span>;
  if (l.status === "ACKNOWLEDGED") return <span className="badge badge-ok">✓ Acknowledged</span>;
  if (l.windowExpired) return <span className="badge badge-danger">⚠ Unacknowledged</span>;
  return <span className="badge badge-warn">Waiting for acknowledgement</span>;
}

export function LeadRow({ l, me }: { l: LeadView; me: string }) {
  return (
    <tr>
      <td><Link className="link font-medium" href={`/app/leads/${l.id}`}>{l.contactName}</Link><div className="text-xs text-[var(--muted)]">{SOURCE_LABEL[l.source]} · {ago(l.createdAt)}</div></td>
      <td>{l.ownerName ?? "—"}{l.ownerId === me && <span className="badge badge-info ml-1">you</span>}<div className="text-xs text-[var(--muted)]">{l.assignReason}</div></td>
      <td className="grid gap-1">{statusBadge(l)}{l.status === "OPEN" && <Countdown deadline={l.deadlineAt ? new Date(l.deadlineAt).toISOString() : null} />}{l.escalationCount > 0 && <span className="badge">↑ escalated {l.escalationCount}×</span>}</td>
      <td>{l.status === "OPEN" && l.ownerId === me && <ActionButton url={`/api/leads/${l.id}/ack`} label="Acknowledge" variant="primary" success="Acknowledged." />}</td>
    </tr>
  );
}
