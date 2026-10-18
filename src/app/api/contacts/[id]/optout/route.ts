import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { activity } from "@/server/audit";

export const POST = api<{ id: string }>("crm.edit", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ optedOut: z.boolean(), reason: z.string().max(200).optional() }));
  const [c] = await db.update(schema.contacts).set({ optedOut: b.optedOut, optOutReason: b.optedOut ? b.reason || `Marked opted out by ${ctx.name}` : null }).where(and(eq(schema.contacts.id, params.id), eq(schema.contacts.workspaceId, ctx.workspaceId))).returning();
  if (!c) throw new HttpError(404, "Contact not found.");
  await activity(db, { workspaceId: ctx.workspaceId, type: "contact.optout", summary: b.optedOut ? `${ctx.name} marked the contact as opted out of messages` : `${ctx.name} opted the contact back in`, actor: { id: ctx.membershipId, label: ctx.name }, contactId: c.id });
  return { ok: true };
});
