import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { activity, audit } from "@/server/audit";

const scope = (ws: string, id: string) => and(eq(schema.stages.id, id), eq(schema.stages.workspaceId, ws));

export const PATCH = api<{ id: string }>("pipeline.manage", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(60).optional(), kind: z.enum(["OPEN", "WON", "LOST"]).optional(), requiredFields: z.array(z.string()).optional() }));
  const s = await db.query.stages.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!s) throw new HttpError(404, "Stage not found.");
  if (b.requiredFields) {
    const defs = await db.query.fieldDefs.findMany({ where: and(eq(schema.fieldDefs.workspaceId, ctx.workspaceId), eq(schema.fieldDefs.pipelineId, s.pipelineId)) });
    const bad = b.requiredFields.filter((k) => k !== "value" && !defs.some((d) => d.key === k));
    if (bad.length) throw new HttpError(400, `Unknown fields for this pipeline: ${bad.join(", ")}`);
  }
  const [u] = await db.update(schema.stages).set({ name: b.name ?? s.name, kind: b.kind ?? s.kind, requiredFields: b.requiredFields ?? s.requiredFields }).where(scope(ctx.workspaceId, params.id)).returning();
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "stage.updated", { type: "stage", id: s.id }, { name: s.name, kind: s.kind, requiredFields: s.requiredFields }, { name: u.name, kind: u.kind, requiredFields: u.requiredFields });
  return { stage: u };
});

/** F2.5: deleting a stage that holds opportunities requires choosing where they go. */
export const DELETE = api<{ id: string }>("pipeline.manage", async ({ req, ctx, params }) => {
  const moveTo = req.nextUrl.searchParams.get("moveTo") ?? ((await req.json().catch(() => ({}))) as { moveTo?: string }).moveTo;
  const s = await db.query.stages.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!s) throw new HttpError(404, "Stage not found.");
  const opps = await db.query.opportunities.findMany({ where: eq(schema.opportunities.stageId, s.id), columns: { id: true, contactId: true, title: true } });
  const siblings = await db.query.stages.findMany({ where: and(eq(schema.stages.pipelineId, s.pipelineId), ne(schema.stages.id, s.id)) });
  if (!siblings.length) throw new HttpError(400, "A pipeline needs at least one stage.");
  let target: typeof s | undefined;
  if (opps.length) {
    target = siblings.find((x) => x.id === moveTo);
    if (!target) throw new HttpError(409, `"${s.name}" still has ${opps.length} opportunit${opps.length === 1 ? "y" : "ies"}. Choose a stage to move them to first.`, { count: opps.length });
  }
  const actor = { id: ctx.membershipId, label: ctx.name };
  await db.transaction(async (tx) => {
    if (target) {
      await tx.update(schema.opportunities).set({ stageId: target.id }).where(eq(schema.opportunities.stageId, s.id));
      for (const o of opps) await activity(tx, { workspaceId: ctx.workspaceId, type: "opportunity.stage", summary: `Moved from ${s.name} to ${target.name} because stage "${s.name}" was deleted`, actor, contactId: o.contactId, opportunityId: o.id });
    }
    await tx.delete(schema.stages).where(eq(schema.stages.id, s.id));
    await audit(tx, ctx.workspaceId, actor, "stage.deleted", { type: "stage", id: s.id }, { name: s.name, opportunities: opps.length }, target ? { movedTo: target.name } : null);
  });
  return { ok: true };
});
