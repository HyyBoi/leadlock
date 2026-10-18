import Link from "next/link";
import { and, desc, eq, or, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { ago } from "@/lib/time";

/** I1.6: conversations scoped to the assigned employee unless the user can see all. */
export default async function Inbox() {
  const ctx = await requirePage();
  const all = ctx.perms.has("leads.view_all");
  const rows = await db
    .select({ conv: schema.conversations, contact: schema.contacts })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(and(eq(schema.conversations.workspaceId, ctx.workspaceId), all ? undefined : or(eq(schema.contacts.ownerId, ctx.membershipId), isNull(schema.contacts.ownerId))))
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(100);
  const members = await membersOf(ctx.workspaceId);
  const lastMsgs = await Promise.all(rows.map((r) => db.query.messages.findFirst({ where: eq(schema.messages.conversationId, r.conv.id), orderBy: desc(schema.messages.createdAt) })));
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Inbox</h1>
      <p className="text-sm text-[var(--muted)]">{all ? "All WhatsApp conversations" : "Conversations with customers assigned to you"} · new messages appear automatically.</p>
      <ul className="grid gap-2">
        {rows.map((r, i) => (
          <li key={r.conv.id} className="card flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Link className="link font-semibold" href={`/app/contacts/${r.contact.id}#conversation`}>{r.contact.name}</Link>
              <p className="truncate text-sm">{lastMsgs[i]?.direction === "IN" ? "" : ""}{lastMsgs[i]?.body}</p>
            </div>
            <div className="text-right text-xs text-[var(--muted)]">{ago(r.conv.lastMessageAt)}<br />Assigned: {members.find((m) => m.id === r.contact.ownerId)?.name ?? "—"}</div>
          </li>
        ))}
        {!rows.length && <li className="card text-sm">No conversations yet. Messages sent to the WhatsApp sandbox number appear here.</li>}
      </ul>
    </div>
  );
}
