import { z } from "zod";
import { eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { cleanCustomValues, fieldsFor } from "@/server/crm";
import { activity } from "@/server/audit";
import { normalizePhone } from "@/lib/phone";
import { ContactBody, checkCompany, parseTags } from "@/server/contact-input";

export const POST = api("crm.create", async ({ req, ctx }) => {
  const b = await body(req, ContactBody);
  const defs = await fieldsFor(ctx.workspaceId, "CONTACT");
  const phone = b.phone ? normalizePhone(b.phone) : null;
  if (phone && (await db.query.contacts.findFirst({ where: (c, { and }) => and(eq(c.workspaceId, ctx.workspaceId), eq(c.phone, phone)) })))
    throw new HttpError(409, "A contact with this phone number already exists.");
  const [c] = await db
    .insert(schema.contacts)
    .values({
      workspaceId: ctx.workspaceId,
      name: b.name,
      email: b.email || null,
      phone,
      companyId: await checkCompany(ctx.workspaceId, b.companyId || undefined),
      tags: parseTags(b.tags),
      ownerId: ctx.membershipId,
      customValues: cleanCustomValues(defs, b.customValues),
    })
    .returning();
  await activity(db, { workspaceId: ctx.workspaceId, type: "contact.created", summary: `${ctx.name} created the contact`, actor: { id: ctx.membershipId, label: ctx.name }, contactId: c.id });
  return { contact: c };
});
