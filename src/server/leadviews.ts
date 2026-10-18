import { and, desc, eq, gte, inArray, SQL, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Ctx } from "@/lib/auth";
import { LeadView } from "@/components/LeadRow";

const { leads, contacts, memberships, users } = schema;

export async function leadViews(ctx: Ctx, extra?: SQL, opts: { limit?: number; offset?: number; ids?: string[] } = {}) {
  const own = ctx.perms.has("leads.view_all") ? undefined : eq(leads.ownerId, ctx.membershipId);
  const where = and(eq(leads.workspaceId, ctx.workspaceId), own, extra, opts.ids ? inArray(leads.id, opts.ids.length ? opts.ids : ["-"]) : undefined);
  const rows = await db
    .select({
      id: leads.id, contactId: leads.contactId, contactName: contacts.name, source: leads.source, status: leads.status, ownerName: users.name, ownerId: leads.ownerId,
      deadlineAt: leads.deadlineAt, escalationCount: leads.escalationCount, windowExpired: leads.windowExpired, createdAt: leads.createdAt, assignReason: leads.assignReason,
    })
    .from(leads)
    .innerJoin(contacts, eq(contacts.id, leads.contactId))
    .leftJoin(memberships, eq(memberships.id, leads.ownerId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(where)
    .orderBy(sql`case ${leads.status} when 'OPEN' then 0 when 'ACKNOWLEDGED' then 1 else 2 end`, desc(leads.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(where);
  return { rows: rows as LeadView[], total: n };
}
export { gte };
