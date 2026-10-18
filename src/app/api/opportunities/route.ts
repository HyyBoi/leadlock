import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { cleanCustomValues, fieldsFor } from "@/server/crm";
import { activity } from "@/server/audit";

export const POST = api("crm.create", async ({ req, ctx }) => {
  const b = await body(req, z.object({
    contactId: z.string(), pipelineId: z.string(), title: z.string().trim().min(1).max(160),
    value: z.coerce.number().min(0).max(1e9).optional(), currency: z.string().length(3).default("usd"),
    customValues: z.record(z.string(), z.unknown()).optional(),
  }));
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, b.contactId), eq(schema.contacts.workspaceId, ctx.workspaceId)) });
  const pipeline = await db.query.pipelines.findFirst({ where: and(eq(schema.pipelines.id, b.pipelineId), eq(schema.pipelines.workspaceId, ctx.workspaceId)) });
  if (!contact || !pipeline) throw new HttpError(404, "Contact or pipeline not found.");
  const first = await db.query.stages.findFirst({ where: eq(schema.stages.pipelineId, pipeline.id), orderBy: asc(schema.stages.position) });
  if (!first) throw new HttpError(400, "This pipeline has no stages yet.");
  const defs = await fieldsFor(ctx.workspaceId, "OPPORTUNITY", pipeline.id);
  const canValue = ctx.perms.has("crm.view_value");
  const [o] = await db.insert(schema.opportunities).values({
    workspaceId: ctx.workspaceId, contactId: contact.id, pipelineId: pipeline.id, stageId: first.id, title: b.title,
    value: canValue ? Math.round((b.value ?? 0) * 100) : 0, currency: b.currency.toLowerCase(), ownerId: ctx.membershipId,
    customValues: cleanCustomValues(defs, b.customValues),
  }).returning();
  await activity(db, { workspaceId: ctx.workspaceId, type: "opportunity.created", summary: `${ctx.name} created opportunity "${o.title}" in ${pipeline.name}`, actor: { id: ctx.membershipId, label: ctx.name }, contactId: contact.id, opportunityId: o.id });
  return { opportunity: { id: o.id } };
});
