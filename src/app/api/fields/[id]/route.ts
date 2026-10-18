import { and, eq, sql } from "drizzle-orm";
import { api, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";

/** Deleting a field removes it from definitions, stage requirements and stored values (Q4: no dangling data). */
export const DELETE = api<{ id: string }>("pipeline.manage", async ({ ctx, params }) => {
  const f = await db.query.fieldDefs.findFirst({ where: and(eq(schema.fieldDefs.id, params.id), eq(schema.fieldDefs.workspaceId, ctx.workspaceId)) });
  if (!f) throw new HttpError(404, "Field not found.");
  await db.transaction(async (tx) => {
    if (f.entity === "OPPORTUNITY") {
      await tx.execute(sql`update opportunities set custom_values = custom_values - ${f.key} where pipeline_id = ${f.pipelineId}`);
      await tx.execute(sql`update stages set required_fields = array_remove(required_fields, ${f.key}) where pipeline_id = ${f.pipelineId}`);
    } else {
      await tx.execute(sql`update contacts set custom_values = custom_values - ${f.key} where workspace_id = ${ctx.workspaceId}`);
    }
    await tx.delete(schema.fieldDefs).where(eq(schema.fieldDefs.id, f.id));
    await audit(tx, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "field.deleted", { type: "field", id: f.id }, { name: f.name, type: f.type, entity: f.entity }, null);
  });
  return { ok: true };
});
