import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";
import { getRule } from "@/server/leads";

/** F3.3 / F3.5: configurable window, cap, escalation chain (levels + seconds per level), backup, manager, idle period. */
export const PUT = api("rules.manage", async ({ req, ctx }) => {
  const b = await body(req, z.object({
    ackWindowSeconds: z.coerce.number().int().min(5).max(86400),
    maxOpenLeads: z.coerce.number().int().min(1).max(1000),
    idleSeconds: z.coerce.number().int().min(10).max(30 * 86400),
    backupId: z.string().nullable().optional(),
    managerId: z.string().nullable().optional(),
    chain: z.array(z.object({ type: z.enum(["NEXT_AVAILABLE", "BACKUP", "MANAGER"]), seconds: z.coerce.number().int().min(5).max(86400) })).max(10),
  }));
  const ids = [b.backupId, b.managerId].filter(Boolean) as string[];
  if (ids.length) {
    const found = await db.query.memberships.findMany({ where: and(eq(schema.memberships.workspaceId, ctx.workspaceId), inArray(schema.memberships.id, ids)) });
    if (found.length !== new Set(ids).size) throw new HttpError(400, "Backup and manager must be members of this workspace.");
  }
  const before = await getRule(db, ctx.workspaceId);
  const next = { ackWindowSeconds: b.ackWindowSeconds, maxOpenLeads: b.maxOpenLeads, idleSeconds: b.idleSeconds, backupId: b.backupId || null, managerId: b.managerId || null, chain: b.chain, updatedAt: new Date() };
  await db.update(schema.assignmentRules).set(next).where(eq(schema.assignmentRules.id, before.id));
  const { rrCursor: _r, id: _i, updatedAt: _u, workspaceId: _w, ...prev } = before;
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "rules.updated", { type: "assignment_rules", id: before.id }, prev, { ...next, updatedAt: undefined });
  return { ok: true };
});
