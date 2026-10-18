import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { activity } from "@/server/audit";
import { touchContactLeads } from "@/server/leads";

export const POST = api<{ id: string }>("crm.edit", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ text: z.string().trim().min(1).max(4000), kind: z.enum(["note", "call"]).default("note"), opportunityId: z.string().optional() }));
  const c = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, params.id), eq(schema.contacts.workspaceId, ctx.workspaceId)) });
  if (!c) throw new HttpError(404, "Contact not found.");
  const actor = { id: ctx.membershipId, label: ctx.name };
  await activity(db, { workspaceId: ctx.workspaceId, type: b.kind === "call" ? "call.logged" : "note.added", summary: `${b.kind === "call" ? "Call logged" : "Note"}: ${b.text}`, actor, contactId: c.id, opportunityId: b.opportunityId ?? null });
  await touchContactLeads(ctx.workspaceId, c.id, actor, b.kind === "call" ? "logged a call" : "added a note");
  return { ok: true };
});
