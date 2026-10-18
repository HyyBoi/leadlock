import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { OptedOutError, queueOutbound } from "@/server/messaging";
import { canSeeContact } from "@/server/visibility";

/** I1.3: reply from the platform (queued, sent by the worker, retried on temporary errors). */
export const POST = api<{ id: string }>("crm.edit", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ body: z.string().trim().min(1).max(1600) }));
  const c = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, params.id), eq(schema.contacts.workspaceId, ctx.workspaceId)) });
  if (!c || !canSeeContact(ctx, c)) throw new HttpError(404, "Contact not found.");
  try {
    return { message: await queueOutbound(ctx.workspaceId, c.id, b.body, { id: ctx.membershipId, label: ctx.name }) };
  } catch (e) {
    if (e instanceof OptedOutError) throw new HttpError(409, e.message);
    throw e;
  }
});
