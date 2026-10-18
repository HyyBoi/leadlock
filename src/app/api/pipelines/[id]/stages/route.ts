import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";

export const POST = api<{ id: string }>("pipeline.manage", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(["OPEN", "WON", "LOST"]).default("OPEN") }));
  const p = await db.query.pipelines.findFirst({ where: and(eq(schema.pipelines.id, params.id), eq(schema.pipelines.workspaceId, ctx.workspaceId)) });
  if (!p) throw new HttpError(404, "Pipeline not found.");
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.stages.position}), -1)::int` }).from(schema.stages).where(eq(schema.stages.pipelineId, p.id));
  const [s] = await db.insert(schema.stages).values({ workspaceId: ctx.workspaceId, pipelineId: p.id, name: b.name, kind: b.kind, position: max + 1 }).returning();
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "stage.created", { type: "stage", id: s.id }, null, { pipeline: p.name, name: s.name, kind: s.kind });
  return { stage: s };
});
