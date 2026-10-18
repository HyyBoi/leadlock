import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { fieldsFor, missingRequired } from "@/server/crm";
import { activity } from "@/server/audit";
import { closeLeadsForOpportunity, touchContactLeads } from "@/server/leads";

/** F2.4 / F2.5: stage moves with required-field gate and optimistic locking. */
export const POST = api<{ id: string }>("crm.edit", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ stageId: z.string(), version: z.number().int().optional() }));
  const o = await db.query.opportunities.findFirst({ where: and(eq(schema.opportunities.id, params.id), eq(schema.opportunities.workspaceId, ctx.workspaceId)) });
  if (!o) throw new HttpError(404, "Opportunity not found.");
  const to = await db.query.stages.findFirst({ where: and(eq(schema.stages.id, b.stageId), eq(schema.stages.pipelineId, o.pipelineId)) });
  if (!to) throw new HttpError(400, "That stage is not part of this opportunity's pipeline.");
  if (to.id === o.stageId) return { ok: true };
  const from = (await db.query.stages.findFirst({ where: eq(schema.stages.id, o.stageId) }))!;
  const defs = await fieldsFor(ctx.workspaceId, "OPPORTUNITY", o.pipelineId);
  const missing = missingRequired(to, o, defs);
  if (missing.length) throw new HttpError(422, `Can't move to "${to.name}" yet: fill in ${missing.join(", ")} first.`, { missing });
  const actor = { id: ctx.membershipId, label: ctx.name };
  await db.transaction(async (tx) => {
    const [u] = await tx.update(schema.opportunities)
      .set({ stageId: to.id, closedAt: to.kind === "OPEN" ? null : new Date(), version: sql`${schema.opportunities.version} + 1`, updatedAt: new Date() })
      .where(and(eq(schema.opportunities.id, o.id), eq(schema.opportunities.version, b.version ?? o.version))).returning();
    if (!u) throw new HttpError(409, "Someone else moved or edited this opportunity just now. Refresh and try again.");
    await activity(tx, { workspaceId: ctx.workspaceId, type: "opportunity.stage", summary: `${ctx.name} moved "${o.title}" from ${from.name} to ${to.name}`, actor, contactId: o.contactId, opportunityId: o.id });
    if (to.kind !== "OPEN") await closeLeadsForOpportunity(tx, o.id);
  });
  await touchContactLeads(ctx.workspaceId, o.contactId, actor, "changed the stage");
  return { ok: true };
});
