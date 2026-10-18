import { and, eq, ne } from "drizzle-orm";
import { api, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { activity, audit } from "@/server/audit";

export const POST = api<{ id: string }>("crm.edit", async ({ ctx, params }) => {
  const lead = await db.query.leads.findFirst({ where: and(eq(schema.leads.id, params.id), eq(schema.leads.workspaceId, ctx.workspaceId)) });
  if (!lead) throw new HttpError(404, "Lead not found.");
  if (lead.ownerId !== ctx.membershipId && !ctx.perms.has("leads.view_all")) throw new HttpError(403, "Only the lead's owner or a manager can close it.");
  const [l] = await db.update(schema.leads).set({ status: "CLOSED", deadlineAt: null, lastActionAt: new Date() }).where(and(eq(schema.leads.id, lead.id), ne(schema.leads.status, "CLOSED"))).returning();
  if (l) {
    const actor = { id: ctx.membershipId, label: ctx.name };
    await activity(db, { workspaceId: ctx.workspaceId, type: "lead.closed", summary: `${ctx.name} closed the lead`, actor, contactId: lead.contactId, leadId: lead.id });
    await audit(db, ctx.workspaceId, actor, "lead.closed", { type: "lead", id: lead.id }, { status: lead.status }, { status: "CLOSED" });
  }
  return { ok: true };
});
