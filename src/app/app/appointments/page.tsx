import Link from "next/link";
import { and, asc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { fmt } from "@/lib/time";

export default async function Appointments() {
  const ctx = await requirePage("crm.view");
  const rows = await db.select({ a: schema.appointments, contact: schema.contacts.name }).from(schema.appointments).innerJoin(schema.contacts, eq(schema.contacts.id, schema.appointments.contactId))
    .where(and(eq(schema.appointments.workspaceId, ctx.workspaceId), gte(schema.appointments.endAt, new Date(Date.now() - 864e5)))).orderBy(asc(schema.appointments.startAt)).limit(200);
  const members = await membersOf(ctx.workspaceId);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Appointments</h1>
      <p className="text-sm text-[var(--muted)]">Times shown in your time zone ({ctx.timezone}); the booking time zone is in brackets. Book from a contact page.</p>
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>When</th><th>Title</th><th>Customer</th><th>Employee</th><th>Status</th></tr></thead>
          <tbody>{rows.map(({ a, contact }) => (
            <tr key={a.id}>
              <td>{fmt(a.startAt, ctx.timezone)}<div className="text-xs text-[var(--muted)]">({fmt(a.startAt, a.timezone)} {a.timezone})</div></td>
              <td>{a.title}</td>
              <td><Link className="link" href={`/app/contacts/${a.contactId}#appointments`}>{contact}</Link></td>
              <td>{members.find((m) => m.id === a.membershipId)?.name}</td>
              <td><span className={a.status === "SCHEDULED" ? "badge badge-ok" : "badge"}>{a.status.toLowerCase()}</span></td>
            </tr>))}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-[var(--muted)]">No upcoming appointments.</p>}
      </div>
    </div>
  );
}
