import { and, eq, gte, isNotNull, ne, sql, inArray, lte, asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { Ctx } from "@/lib/auth";
import { recoveryQueue } from "./leads";
import { zonedToUtc } from "@/lib/time";

const { leads, opportunities, stages, payments, appointments, memberships, auditLogs } = schema;

/** Section 7 definitions, one implementation used by every screen (Q12). Personal scope for plain Users (F5.4). */
export async function dashboard(ctx: Ctx) {
  const personal = ctx.level === "USER" && !ctx.perms.has("leads.view_all");
  const ws = ctx.workspaceId;
  const me = ctx.membershipId;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: ctx.timezone });
  const dayStart = zonedToUtc(today, "00:00", ctx.timezone);
  const monthStart = zonedToUtc(today.slice(0, 8) + "01", "00:00", ctx.timezone);
  const leadScope = and(eq(leads.workspaceId, ws), personal ? eq(leads.ownerId, me) : undefined);

  const [newToday] = await db.select({ n: sql<number>`count(*)::int` }).from(leads).where(and(leadScope, gte(leads.createdAt, dayStart)));
  const [resp] = await db
    .select({ avg: sql<number | null>`avg(extract(epoch from (${leads.firstAcknowledgedAt} - ${leads.firstAssignedAt})))::float`, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(leadScope, isNotNull(leads.firstAcknowledgedAt)));
  const recovery = await recoveryQueue(ws, personal ? me : undefined);
  const esc = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(and(eq(auditLogs.workspaceId, ws), eq(auditLogs.action, "lead.escalated"), gte(auditLogs.createdAt, new Date(Date.now() - 864e5)), personal ? sql`(${auditLogs.after}->>'ownerId' = ${me} or ${auditLogs.before}->>'ownerId' = ${me})` : undefined));
  const pipeline = ctx.perms.has("crm.view_value")
    ? await db
        .select({ stageId: stages.id, stage: stages.name, pipelineId: stages.pipelineId, total: sql<number>`coalesce(sum(${opportunities.value}),0)::int`, n: sql<number>`count(${opportunities.id})::int` })
        .from(stages)
        .leftJoin(opportunities, and(eq(opportunities.stageId, stages.id), personal ? eq(opportunities.ownerId, me) : undefined))
        .where(and(eq(stages.workspaceId, ws), eq(stages.kind, "OPEN")))
        .groupBy(stages.id, stages.name, stages.pipelineId, stages.position)
        .orderBy(asc(stages.pipelineId), asc(stages.position))
    : null;
  const team = await db
    .select({ availability: memberships.availability, n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, ws), eq(memberships.active, true)))
    .groupBy(memberships.availability);
  const upcoming = await db.query.appointments.findMany({
    where: and(eq(appointments.workspaceId, ws), eq(appointments.status, "SCHEDULED"), gte(appointments.startAt, new Date()), lte(appointments.startAt, new Date(Date.now() + 7 * 864e5)), personal ? eq(appointments.membershipId, me) : undefined),
    orderBy: asc(appointments.startAt),
    limit: 5,
  });
  const payScope = and(eq(payments.workspaceId, ws), personal ? eq(payments.requestedById, me) : undefined);
  const [collected] = await db
    .select({ total: sql<number>`coalesce(sum(${payments.amount} - ${payments.refundedAmount}),0)::int`, n: sql<number>`count(*)::int` })
    .from(payments)
    .where(and(payScope, isNotNull(payments.paidAt), gte(payments.paidAt, monthStart)));
  const [pending] = await db.select({ total: sql<number>`coalesce(sum(${payments.amount}),0)::int` }).from(payments).where(and(payScope, eq(payments.status, "PENDING")));
  return {
    personal,
    newToday: newToday.n,
    avgResponseSec: resp.avg,
    respondedCount: resp.n,
    recovery: recovery.length,
    escalations24h: esc[0].n,
    pipeline,
    team,
    upcoming,
    collectedMonth: collected.total,
    collectedCount: collected.n,
    pendingPayments: pending.total,
  };
}
void ne; void inArray;
