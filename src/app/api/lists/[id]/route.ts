import { and, eq } from "drizzle-orm";
import { api } from "@/lib/api";
import { db, schema } from "@/db";

export const DELETE = api<{ id: string }>("crm.view", async ({ ctx, params }) => {
  await db.delete(schema.savedLists).where(and(eq(schema.savedLists.id, params.id), eq(schema.savedLists.workspaceId, ctx.workspaceId), eq(schema.savedLists.ownerId, ctx.membershipId)));
  return { ok: true };
});
