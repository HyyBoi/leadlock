import { db, schema, Tx } from "@/db";

type Actor = { id?: string | null; label: string };
export const SYSTEM: Actor = { id: null, label: "System" };

export async function audit(
  tx: Tx | typeof db,
  workspaceId: string,
  actor: Actor,
  action: string,
  target: { type: string; id?: string | null },
  before?: unknown,
  after?: unknown,
) {
  await tx.insert(schema.auditLogs).values({
    workspaceId,
    actorId: actor.id ?? null,
    actorLabel: actor.label,
    action,
    targetType: target.type,
    targetId: target.id ?? null,
    before: before === undefined ? null : (before as object),
    after: after === undefined ? null : (after as object),
  });
}

export async function activity(
  tx: Tx | typeof db,
  a: {
    workspaceId: string;
    type: string;
    summary: string;
    actor: Actor;
    contactId?: string | null;
    opportunityId?: string | null;
    leadId?: string | null;
    data?: unknown;
  },
) {
  await tx.insert(schema.activities).values({
    workspaceId: a.workspaceId,
    type: a.type,
    summary: a.summary,
    actorId: a.actor.id ?? null,
    actorLabel: a.actor.label,
    contactId: a.contactId ?? null,
    opportunityId: a.opportunityId ?? null,
    leadId: a.leadId ?? null,
    data: (a.data ?? null) as object,
  });
}
