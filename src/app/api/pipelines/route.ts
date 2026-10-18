import { z } from "zod";
import { api, body } from "@/lib/api";
import { db, schema } from "@/db";
import { DEFAULT_STAGES } from "@/server/crm";
import { audit } from "@/server/audit";

export const POST = api("pipeline.manage", async ({ req, ctx }) => {
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(60) }));
  const p = await db.transaction(async (tx) => {
    const [p] = await tx.insert(schema.pipelines).values({ workspaceId: ctx.workspaceId, name: b.name, position: 1 }).returning();
    await tx.insert(schema.stages).values(DEFAULT_STAGES.map((s, i) => ({ workspaceId: ctx.workspaceId, pipelineId: p.id, name: s.name, kind: s.kind, position: i })));
    await audit(tx, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "pipeline.created", { type: "pipeline", id: p.id }, null, { name: b.name });
    return p;
  });
  return { pipeline: p };
});
