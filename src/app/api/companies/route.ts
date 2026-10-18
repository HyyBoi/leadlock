import { z } from "zod";
import { api, body } from "@/lib/api";
import { db, schema } from "@/db";

export const POST = api("crm.create", async ({ req, ctx }) => {
  const b = await body(req, z.object({ name: z.string().trim().min(1).max(120), domain: z.string().trim().max(120).optional() }));
  const [c] = await db.insert(schema.companies).values({ workspaceId: ctx.workspaceId, name: b.name, domain: b.domain || null }).returning();
  return { company: c };
});
