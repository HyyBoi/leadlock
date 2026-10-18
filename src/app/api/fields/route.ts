import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";

/** F2.2 / F2.3: custom fields per entity; opportunity fields belong to one pipeline. */
export const POST = api("pipeline.manage", async ({ req, ctx }) => {
  const b = await body(req, z.object({
    name: z.string().trim().min(1).max(60), type: z.enum(["TEXT", "NUMBER", "DATE", "DROPDOWN", "CHECKBOX"]),
    entity: z.enum(["CONTACT", "OPPORTUNITY"]), pipelineId: z.string().optional(), options: z.string().max(500).optional(),
  }));
  if (b.entity === "OPPORTUNITY") {
    if (!b.pipelineId) throw new HttpError(400, "Choose which pipeline this field belongs to.");
    const p = await db.query.pipelines.findFirst({ where: and(eq(schema.pipelines.id, b.pipelineId), eq(schema.pipelines.workspaceId, ctx.workspaceId)) });
    if (!p) throw new HttpError(404, "Pipeline not found.");
  }
  const options = b.type === "DROPDOWN" ? (b.options ?? "").split(",").map((o) => o.trim()).filter(Boolean) : [];
  if (b.type === "DROPDOWN" && options.length < 2) throw new HttpError(400, "A dropdown needs at least two comma-separated options.");
  const key = b.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "").slice(0, 40) || "field";
  const existing = await db.query.fieldDefs.findMany({ where: and(eq(schema.fieldDefs.workspaceId, ctx.workspaceId), eq(schema.fieldDefs.entity, b.entity)) });
  if (existing.some((d) => d.key === key && (d.pipelineId ?? null) === (b.entity === "OPPORTUNITY" ? b.pipelineId : null))) throw new HttpError(409, `A field called "${b.name}" already exists here.`);
  const [f] = await db.insert(schema.fieldDefs).values({ workspaceId: ctx.workspaceId, entity: b.entity, pipelineId: b.entity === "OPPORTUNITY" ? b.pipelineId! : null, name: b.name, key, type: b.type, options, position: existing.length }).returning();
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "field.created", { type: "field", id: f.id }, null, { name: f.name, type: f.type, entity: f.entity, options });
  return { field: f };
});
