import { and, asc, count, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { db, schema, Tx } from "@/db";
import type { ChainStep } from "@/db/schema";
import { activity, audit, SYSTEM } from "./audit";
import { enqueueAlert } from "./notify";

type Actor = { id?: string | null; label: string };
const { leads, memberships, users, assignmentRules } = schema;

export const ACKED_LEAD_POLICY =
  "When an employee goes On leave or Offline, their UNACKNOWLEDGED leads are reassigned immediately. " +
  "ACKNOWLEDGED leads stay with them (the customer keeps one contact person) but are flagged " +
  "'Owner unavailable' in the Recovery queue so a manager can reassign them.";

export async function lockWorkspace(tx: Tx, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"assign:" + workspaceId}))`);
}

export async function getRule(tx: Tx | typeof db, workspaceId: string) {
  const r = await tx.query.assignmentRules.findFirst({ where: eq(assignmentRules.workspaceId, workspaceId) });
  if (r) return r;
  const [created] = await tx.insert(assignmentRules).values({ workspaceId }).onConflictDoNothing().returning();
  return created ?? (await tx.query.assignmentRules.findFirst({ where: eq(assignmentRules.workspaceId, workspaceId) }))!;
}

async function memberLabel(tx: Tx, membershipId: string | null | undefined) {
  if (!membershipId) return "nobody";
  const r = await tx
    .select({ name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.id, membershipId));
  return r[0]?.name ?? "unknown";
}

/** Employees eligible for new leads: active, opted in, status Available, under the open-lead limit. */
export async function eligibleMembers(tx: Tx | typeof db, workspaceId: string, maxOpen: number) {
  const open = tx
    .select({ ownerId: leads.ownerId, n: count().as("n") })
    .from(leads)
    .where(and(eq(leads.workspaceId, workspaceId), ne(leads.status, "CLOSED")))
    .groupBy(leads.ownerId)
    .as("open");
  const rows = await tx
    .select({ id: memberships.id, n: open.n })
    .from(memberships)
    .leftJoin(open, eq(open.ownerId, memberships.id))
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        eq(memberships.active, true),
        eq(memberships.receivesLeads, true),
        eq(memberships.availability, "AVAILABLE"),
      ),
    )
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
  return rows.filter((r) => Number(r.n ?? 0) < maxOpen).map((r) => r.id);
}

/** Round-robin among eligible members, continuing after the stored cursor. Caller must hold the workspace lock. */
async function pickRoundRobin(tx: Tx, workspaceId: string, exclude: string[]) {
  const rule = await getRule(tx, workspaceId);
  const all = await tx
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(asc(memberships.createdAt), asc(memberships.id));
  const order = all.map((r) => r.id);
  const eligible = new Set((await eligibleMembers(tx, workspaceId, rule.maxOpenLeads)).filter((id) => !exclude.includes(id)));
  if (!eligible.size) return null;
  const start = rule.rrCursor ? order.indexOf(rule.rrCursor) + 1 : 0;
  for (let i = 0; i < order.length; i++) {
    const cand = order[(start + i) % order.length];
    if (eligible.has(cand)) {
      await tx.update(assignmentRules).set({ rrCursor: cand }).where(eq(assignmentRules.id, rule.id));
      return cand;
    }
  }
  return null;
}

async function usable(tx: Tx, membershipId: string | null | undefined, exclude: string[]) {
  if (!membershipId || exclude.includes(membershipId)) return false;
  const m = await tx.query.memberships.findFirst({ where: eq(memberships.id, membershipId) });
  return !!m && m.active && m.availability !== "ON_LEAVE" && m.availability !== "OFFLINE";
}

async function workspaceOwner(tx: Tx, workspaceId: string) {
  const o = await tx.query.memberships.findFirst({
    where: and(eq(memberships.workspaceId, workspaceId), eq(memberships.level, "OWNER")),
  });
  return o?.id ?? null;
}

/** Fallback when nobody is Available: backup -> manager -> owner. A lead is never left ownerless. */
async function fallbackOwner(tx: Tx, workspaceId: string, exclude: string[]) {
  const rule = await getRule(tx, workspaceId);
  if (await usable(tx, rule.backupId, exclude)) return { id: rule.backupId!, why: "no Available employee; designated backup" };
  if (await usable(tx, rule.managerId, exclude)) return { id: rule.managerId!, why: "no Available employee; manager" };
  return { id: (await workspaceOwner(tx, workspaceId))!, why: "no Available employee; workspace owner" };
}

async function chooseInitialOwner(tx: Tx, workspaceId: string, exclude: string[]) {
  const rr = await pickRoundRobin(tx, workspaceId, exclude);
  if (rr) return { id: rr, why: "round-robin among Available employees" };
  return fallbackOwner(tx, workspaceId, exclude);
}

const secs = (n: number) => new Date(Date.now() + n * 1000);

export async function createLead(input: {
  workspaceId: string;
  contactId: string;
  opportunityId?: string | null;
  source: "WEB_FORM" | "WHATSAPP" | "MANUAL";
  message?: string | null;
  actor: Actor;
  tx?: Tx;
}) {
  const run = async (tx: Tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const rule = await getRule(tx, input.workspaceId);
    const owner = await chooseInitialOwner(tx, input.workspaceId, []);
    const now = new Date();
    const [lead] = await tx
      .insert(leads)
      .values({
        workspaceId: input.workspaceId,
        contactId: input.contactId,
        opportunityId: input.opportunityId ?? null,
        source: input.source,
        message: input.message ?? null,
        ownerId: owner.id,
        assignedAt: now,
        firstAssignedAt: now,
        deadlineAt: secs(rule.ackWindowSeconds),
        assignReason: owner.why,
        lastActionAt: now,
      })
      .returning();
    const ownerName = await memberLabel(tx, owner.id);
    await activity(tx, {
      workspaceId: input.workspaceId,
      type: "lead.assigned",
      summary: `New ${input.source.replace("_", " ").toLowerCase()} lead assigned to ${ownerName} (${owner.why})`,
      actor: input.actor,
      contactId: input.contactId,
      opportunityId: input.opportunityId,
      leadId: lead.id,
    });
    await audit(tx, input.workspaceId, input.actor, "lead.assigned", { type: "lead", id: lead.id }, null, {
      ownerId: owner.id,
      owner: ownerName,
      reason: owner.why,
      source: input.source,
    });
    await enqueueAlert(tx, input.workspaceId, owner.id, lead.id, "NEW_LEAD", `assigned by ${owner.why}`);
    return lead;
  };
  return input.tx ? run(input.tx) : db.transaction(run);
}

/** Acknowledge: only the current owner can, and only while the lead is open. */
export async function acknowledgeLead(workspaceId: string, leadId: string, actor: { id: string; label: string }, how = "clicked Acknowledge") {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [l] = await tx
      .update(leads)
      .set({
        status: "ACKNOWLEDGED",
        acknowledgedAt: now,
        firstAcknowledgedAt: sql`coalesce(${leads.firstAcknowledgedAt}, ${now})`,
        deadlineAt: null,
        windowExpired: false,
        lastActionAt: now,
        version: sql`${leads.version} + 1`,
      })
      .where(and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId), eq(leads.ownerId, actor.id), eq(leads.status, "OPEN")))
      .returning();
    if (!l) return null;
    await activity(tx, { workspaceId, type: "lead.acknowledged", summary: `${actor.label} acknowledged the lead (${how})`, actor, contactId: l.contactId, opportunityId: l.opportunityId, leadId });
    await audit(tx, workspaceId, actor, "lead.acknowledged", { type: "lead", id: leadId }, { status: "OPEN" }, { status: "ACKNOWLEDGED", how });
    return l;
  });
}

/** Any recorded action on a contact counts as acknowledgement of the actor's own open leads, and refreshes idle time. */
export async function touchContactLeads(workspaceId: string, contactId: string, actor: { id: string; label: string }, how: string) {
  const open = await db.query.leads.findMany({
    where: and(eq(leads.workspaceId, workspaceId), eq(leads.contactId, contactId), ne(leads.status, "CLOSED")),
  });
  for (const l of open) {
    if (l.status === "OPEN" && l.ownerId === actor.id) await acknowledgeLead(workspaceId, l.id, actor, how);
    else await db.update(leads).set({ lastActionAt: new Date() }).where(eq(leads.id, l.id));
  }
}

/** Reassign a lead to a specific owner inside a locked transaction (manual or absence). Not counted as an escalation. */
async function reassignTo(tx: Tx, lead: typeof leads.$inferSelect, newOwner: string, reason: string, actor: Actor, kind: "manual" | "absence") {
  const rule = await getRule(tx, lead.workspaceId);
  const [l] = await tx
    .update(leads)
    .set({
      ownerId: newOwner,
      assignedAt: new Date(),
      status: kind === "manual" && lead.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN",
      deadlineAt: kind === "manual" && lead.status === "ACKNOWLEDGED" ? null : secs(rule.ackWindowSeconds),
      windowExpired: false,
      assignReason: reason,
      version: sql`${leads.version} + 1`,
    })
    .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
    .returning();
  if (!l) return null;
  const from = await memberLabel(tx, lead.ownerId);
  const to = await memberLabel(tx, newOwner);
  await activity(tx, { workspaceId: lead.workspaceId, type: `lead.reassigned`, summary: `Reassigned from ${from} to ${to}: ${reason}`, actor, contactId: lead.contactId, opportunityId: lead.opportunityId, leadId: lead.id });
  await audit(tx, lead.workspaceId, actor, `lead.reassigned.${kind}`, { type: "lead", id: lead.id }, { ownerId: lead.ownerId, owner: from }, { ownerId: newOwner, owner: to, reason });
  await enqueueAlert(tx, lead.workspaceId, newOwner, lead.id, "REASSIGNED", reason);
  return l;
}

export async function manualReassign(workspaceId: string, leadId: string, toMembershipId: string, actor: Actor) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const lead = await tx.query.leads.findFirst({ where: and(eq(leads.id, leadId), eq(leads.workspaceId, workspaceId)) });
    if (!lead) return { error: "Lead not found." };
    const target = await tx.query.memberships.findFirst({ where: and(eq(memberships.id, toMembershipId), eq(memberships.workspaceId, workspaceId)) });
    if (!target) return { error: "That employee is not in this workspace." };
    if (target.availability === "ON_LEAVE" || target.availability === "OFFLINE")
      return { error: `That employee is ${target.availability.replace("_", " ").toLowerCase()} and cannot take leads.` };
    if (lead.ownerId === toMembershipId) return { error: "The lead is already owned by that employee." };
    const l = await reassignTo(tx, lead, toMembershipId, `manual reassignment by ${actor.label}`, actor, "manual");
    return l ? { lead: l } : { error: "The lead changed while you were editing. Refresh and try again." };
  });
}

/** F3.6: called when an employee becomes On leave / Offline. */
export async function reassignOnAbsence(workspaceId: string, membershipId: string, status: string, actor: Actor) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const open = await tx.query.leads.findMany({
      where: and(eq(leads.workspaceId, workspaceId), eq(leads.ownerId, membershipId), eq(leads.status, "OPEN")),
    });
    let moved = 0;
    for (const lead of open) {
      const owner = await chooseInitialOwner(tx, workspaceId, [membershipId]);
      if (!owner.id || owner.id === membershipId) continue;
      if (await reassignTo(tx, lead, owner.id, `previous owner set to ${status.replace("_", " ").toLowerCase()} (${owner.why})`, actor, "absence")) moved++;
    }
    return moved;
  });
}

/** F3.5 / F3.8: escalate a single due lead. Safe under concurrency: workspace lock + version check + deadline re-check. */
export async function escalateLead(leadId: string) {
  return db.transaction(async (tx) => {
    const pre = await tx.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!pre) return null;
    await lockWorkspace(tx, pre.workspaceId);
    const lead = await tx.query.leads.findFirst({ where: eq(leads.id, leadId) });
    if (!lead || lead.status !== "OPEN" || !lead.deadlineAt || lead.deadlineAt > new Date()) return null; // someone else handled it
    const rule = await getRule(tx, lead.workspaceId);
    const chain = (rule.chain ?? []) as ChainStep[];
    const fromName = await memberLabel(tx, lead.ownerId);

    let level = lead.escalationLevel;
    let target: string | null = null;
    let stepLabel = "";
    let stepSeconds = 0;
    while (level < chain.length && !target) {
      const step = chain[level];
      level++;
      const exclude = lead.ownerId ? [lead.ownerId] : [];
      if (step.type === "NEXT_AVAILABLE") target = await pickRoundRobin(tx, lead.workspaceId, exclude);
      else if (step.type === "BACKUP") target = (await usable(tx, rule.backupId, exclude)) ? rule.backupId : null;
      else if (step.type === "MANAGER")
        target = (await usable(tx, rule.managerId, exclude)) ? rule.managerId : (await workspaceOwner(tx, lead.workspaceId)) ?? null;
      if (target === lead.ownerId) target = null;
      stepLabel = { NEXT_AVAILABLE: "next available employee", BACKUP: "designated backup", MANAGER: "manager" }[step.type];
      stepSeconds = step.seconds;
    }
    const reason = `not acknowledged by ${fromName} within the window`;

    if (!target) {
      // Chain exhausted: keep the current owner accountable, surface in the recovery queue.
      const [l] = await tx
        .update(leads)
        .set({ deadlineAt: null, windowExpired: true, escalationLevel: level, version: sql`${leads.version} + 1` })
        .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version)))
        .returning();
      if (!l) return null;
      await activity(tx, { workspaceId: lead.workspaceId, type: "lead.escalation_exhausted", summary: `Escalation chain exhausted; lead stays with ${fromName} and is in the Recovery queue`, actor: SYSTEM, contactId: lead.contactId, opportunityId: lead.opportunityId, leadId: lead.id });
      await audit(tx, lead.workspaceId, SYSTEM, "lead.escalation_exhausted", { type: "lead", id: lead.id }, { ownerId: lead.ownerId }, { ownerId: lead.ownerId, recovery: true });
      return l;
    }

    const [l] = await tx
      .update(leads)
      .set({
        ownerId: target,
        assignedAt: new Date(),
        deadlineAt: secs(stepSeconds),
        escalationLevel: level,
        escalationCount: sql`${leads.escalationCount} + 1`,
        windowExpired: false,
        assignReason: `escalated to ${stepLabel}: ${reason}`,
        version: sql`${leads.version} + 1`,
      })
      .where(and(eq(leads.id, lead.id), eq(leads.version, lead.version), eq(leads.status, "OPEN")))
      .returning();
    if (!l) return null;
    const toName = await memberLabel(tx, target);
    await activity(tx, { workspaceId: lead.workspaceId, type: "lead.escalated", summary: `Escalated from ${fromName} to ${toName} (${stepLabel}): ${reason}`, actor: SYSTEM, contactId: lead.contactId, opportunityId: lead.opportunityId, leadId: lead.id });
    await audit(tx, lead.workspaceId, SYSTEM, "lead.escalated", { type: "lead", id: lead.id }, { ownerId: lead.ownerId, owner: fromName, level: lead.escalationLevel }, { ownerId: target, owner: toName, level, step: stepLabel });
    await enqueueAlert(tx, lead.workspaceId, target, lead.id, "ESCALATED", `${reason}; you are the ${stepLabel}`);
    return l;
  });
}

export async function escalateDueLeads() {
  const due = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.status, "OPEN"), lte(leads.deadlineAt, new Date())))
    .limit(50);
  let n = 0;
  for (const d of due) {
    try {
      if (await escalateLead(d.id)) n++;
    } catch (e) {
      console.error("escalation failed", d.id, e);
    }
  }
  return n;
}

export type RecoveryItem = { leadId: string; reasons: string[] };

/** Recovery queue per glossary: unacknowledged beyond window, escalated 2+ times, idle beyond configured period (+ owner unavailable). */
export async function recoveryQueue(workspaceId: string, onlyOwner?: string) {
  const rule = await getRule(db, workspaceId);
  const idleCut = new Date(Date.now() - rule.idleSeconds * 1000);
  const now = new Date();
  const rows = await db
    .select({ lead: leads, ownerAvail: memberships.availability })
    .from(leads)
    .leftJoin(memberships, eq(memberships.id, leads.ownerId))
    .where(and(eq(leads.workspaceId, workspaceId), ne(leads.status, "CLOSED"), onlyOwner ? eq(leads.ownerId, onlyOwner) : undefined));
  const out: { lead: typeof leads.$inferSelect; reasons: string[] }[] = [];
  for (const { lead, ownerAvail } of rows) {
    const reasons: string[] = [];
    if (lead.status === "OPEN" && (lead.windowExpired || (lead.deadlineAt && lead.deadlineAt < now)))
      reasons.push("Unacknowledged beyond its window");
    if (lead.escalationCount >= 2) reasons.push(`Escalated ${lead.escalationCount} times`);
    if (lead.lastActionAt < idleCut) reasons.push(`No recorded action for over ${Math.round(rule.idleSeconds / 60)} min`);
    if (lead.status === "ACKNOWLEDGED" && (ownerAvail === "ON_LEAVE" || ownerAvail === "OFFLINE"))
      reasons.push(`Owner unavailable (${ownerAvail.replace("_", " ").toLowerCase()})`);
    if (reasons.length) out.push({ lead, reasons });
  }
  return out;
}

export async function closeLeadsForOpportunity(tx: Tx, opportunityId: string) {
  await tx.update(leads).set({ status: "CLOSED", deadlineAt: null }).where(and(eq(leads.opportunityId, opportunityId), inArray(leads.status, ["OPEN", "ACKNOWLEDGED"])));
}
