import { z } from "zod";
import { api, body } from "@/lib/api";
import { db, schema } from "@/db";

export const POST = api("crm.view", async ({ req, ctx }) => {
  const b = await body(req, z.object({
    name: z.string().trim().min(1).max(60),
    filters: z.object({
      q: z.string().optional(), tag: z.string().optional(), stageId: z.string().optional(), ownerId: z.string().optional(),
      source: z.string().optional(), createdFrom: z.string().optional(), createdTo: z.string().optional(),
      field: z.object({ key: z.string(), value: z.string() }).optional(),
    }),
  }));
  const clean = Object.fromEntries(Object.entries(b.filters).filter(([, v]) => v !== "" && v !== undefined));
  const [l] = await db.insert(schema.savedLists).values({ workspaceId: ctx.workspaceId, ownerId: ctx.membershipId, name: b.name, filters: clean }).returning();
  return { list: l };
});
