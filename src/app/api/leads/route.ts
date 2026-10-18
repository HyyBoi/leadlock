import { z } from "zod";
import { api, body } from "@/lib/api";
import { db, schema } from "@/db";
import { createLead } from "@/server/leads";
import { defaultPipeline } from "@/server/crm";
import { activity } from "@/server/audit";
import { eq } from "drizzle-orm";
import { normalizePhone } from "@/lib/phone";

const Manual = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  email: z.string().trim().email().optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional(),
});

/** F3.1 manual lead entry. */
export const POST = api("crm.create", async ({ req, ctx }) => {
  const b = await body(req, Manual);
  const phone = b.phone ? normalizePhone(b.phone) : null;
  const actor = { id: ctx.membershipId, label: ctx.name };
  const lead = await db.transaction(async (tx) => {
    let contact = phone
      ? await tx.query.contacts.findFirst({ where: (c, { and }) => and(eq(c.workspaceId, ctx.workspaceId), eq(c.phone, phone)) })
      : undefined;
    if (!contact) {
      [contact] = await tx.insert(schema.contacts).values({ workspaceId: ctx.workspaceId, name: b.name, phone, email: b.email || null }).returning();
      await activity(tx, { workspaceId: ctx.workspaceId, type: "contact.created", summary: `Contact created by ${ctx.name} (manual lead)`, actor, contactId: contact.id });
    }
    const pl = await defaultPipeline(tx, ctx.workspaceId);
    const [opp] = await tx.insert(schema.opportunities).values({ workspaceId: ctx.workspaceId, contactId: contact.id, pipelineId: pl.pipeline.id, stageId: pl.firstStage.id, title: `Enquiry from ${contact.name}` }).returning();
    const l = await createLead({ workspaceId: ctx.workspaceId, contactId: contact.id, opportunityId: opp.id, source: "MANUAL", message: b.message, actor, tx });
    await tx.update(schema.opportunities).set({ ownerId: l.ownerId }).where(eq(schema.opportunities.id, opp.id));
    if (!contact.ownerId) await tx.update(schema.contacts).set({ ownerId: l.ownerId }).where(eq(schema.contacts.id, contact.id));
    return l;
  });
  return { lead };
});
