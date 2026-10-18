import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";

export const POST = api<{ id: string }>("pipeline.manage", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ stageIds: z.array(z.string()).min(1) }));
  const p = await db.query.pipelines.findFirst({ where: and(eq(schema.pipelines.id, params.id), eq(schema.pipelines.workspaceId, ctx.workspaceId)) });
  if (!p) throw new HttpError(404, "Pipeline not found.");
  const current = await db.query.stages.findMany({ where: eq(schema.stages.pipelineId, p.id) });
  if (current.length !== b.stageIds.length || !current.every((s) => b.stageIds.includes(s.id))) throw new HttpError(400, "The stage list is out of date. Refresh and try again.");
  await db.transaction(async (tx) => {
    for (const [i, id] of b.stageIds.entries()) await tx.update(schema.stages).set({ position: i }).where(eq(schema.stages.id, id));
    await audit(tx, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "stages.reordered", { type: "pipeline", id: p.id },
      current.sort((a, b) => a.position - b.position).map((s) => s.name), b.stageIds.map((id) => current.find((s) => s.id === id)!.name));
  });
  return { ok: true };
});
