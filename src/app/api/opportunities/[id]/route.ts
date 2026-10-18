import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { cleanCustomValues, fieldsFor, missingRequired, money } from "@/server/crm";
import { activity, audit } from "@/server/audit";
import { touchContactLeads } from "@/server/leads";

const scope = (ws: string, id: string) => and(eq(schema.opportunities.id, id), eq(schema.opportunities.workspaceId, ws));

export const PATCH = api<{ id: string }>("crm.edit", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({
    title: z.string().trim().min(1).max(160).optional(), value: z.coerce.number().min(0).max(1e9).optional(),
    currency: z.string().length(3).optional(), customValues: z.record(z.string(), z.unknown()).optional(), version: z.number().int(),
  }));
  const o = await db.query.opportunities.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!o) throw new HttpError(404, "Opportunity not found.");
  if (b.value !== undefined && !ctx.perms.has("crm.view_value")) throw new HttpError(403, `You don't have the "crm.view_value" permission, so you can't change the value.`);
  const defs = await fieldsFor(ctx.workspaceId, "OPPORTUNITY", o.pipelineId);
  const next = {
    title: b.title ?? o.title,
    value: b.value !== undefined ? Math.round(b.value * 100) : o.value,
    currency: (b.currency ?? o.currency).toLowerCase(),
    customValues: cleanCustomValues(defs, b.customValues, o.customValues),
  };
  // Required fields of the CURRENT stage must stay filled.
  const stage = (await db.query.stages.findFirst({ where: eq(schema.stages.id, o.stageId) }))!;
  const missing = missingRequired(stage, next, defs);
  if (missing.length) throw new HttpError(422, `"${stage.name}" requires ${missing.join(", ")}. Fill them before saving.`);
  const [u] = await db.update(schema.opportunities).set({ ...next, version: sql`${schema.opportunities.version} + 1`, updatedAt: new Date() })
    .where(and(scope(ctx.workspaceId, params.id), eq(schema.opportunities.version, b.version))).returning();
  if (!u) throw new HttpError(409, "Someone else changed this opportunity while you were editing. Reload and try again.");
  const changes: string[] = [];
  if (next.title !== o.title) changes.push(`title "${o.title}" "${next.title}"`);
  if (next.value !== o.value) changes.push(`value ${money(o.value, o.currency)} ${money(next.value, next.currency)}`);
  for (const d of defs) if (JSON.stringify(o.customValues[d.key]) !== JSON.stringify(next.customValues[d.key])) changes.push(`${d.name} "${o.customValues[d.key] ?? ""}" "${next.customValues[d.key] ?? ""}"`);
  if (changes.length) {
    const actor = { id: ctx.membershipId, label: ctx.name };
    await activity(db, { workspaceId: ctx.workspaceId, type: "opportunity.edited", summary: `${ctx.name} changed ${changes.join("; ")}`, actor, contactId: o.contactId, opportunityId: o.id });
    await touchContactLeads(ctx.workspaceId, o.contactId, actor, "edited the opportunity");
  }
  return { ok: true };
});

export const DELETE = api<{ id: string }>("crm.delete", async ({ ctx, params }) => {
  const o = await db.query.opportunities.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!o) throw new HttpError(404, "Opportunity not found.");
  await db.transaction(async (tx) => {
    await tx.delete(schema.opportunities).where(scope(ctx.workspaceId, params.id));
    await audit(tx, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "opportunity.deleted", { type: "opportunity", id: o.id }, { title: o.title, value: o.value, stageId: o.stageId }, null);
  });
  return { ok: true };
});
