import { and, eq, sql } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { cleanCustomValues, fieldsFor } from "@/server/crm";
import { activity, audit } from "@/server/audit";
import { normalizePhone } from "@/lib/phone";
import { ContactBody, checkCompany, parseTags } from "@/server/contact-input";

const scope = (ws: string, id: string) => and(eq(schema.contacts.id, id), eq(schema.contacts.workspaceId, ws));

export const PATCH = api<{ id: string }>("crm.edit", async ({ req, ctx, params }) => {
  const b = await body(req, ContactBody);
  const c = await db.query.contacts.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!c) throw new HttpError(404, "Contact not found.");
  const defs = await fieldsFor(ctx.workspaceId, "CONTACT");
  const next = {
    name: b.name,
    email: b.email || null,
    phone: b.phone ? normalizePhone(b.phone) : null,
    companyId: await checkCompany(ctx.workspaceId, b.companyId || undefined),
    tags: parseTags(b.tags),
    customValues: cleanCustomValues(defs, b.customValues, c.customValues),
  };
  // Q4: optimistic concurrency — reject if someone else saved first.
  const [u] = await db
    .update(schema.contacts)
    .set({ ...next, version: sql`${schema.contacts.version} + 1`, updatedAt: new Date() })
    .where(and(scope(ctx.workspaceId, params.id), eq(schema.contacts.version, b.version ?? c.version)))
    .returning();
  if (!u) throw new HttpError(409, "Someone else changed this contact while you were editing. Reload to see their changes, then edit again.");
  const changed = Object.keys(next).filter((k) => JSON.stringify((c as Record<string, unknown>)[k]) !== JSON.stringify((next as Record<string, unknown>)[k]));
  if (changed.length)
    await activity(db, { workspaceId: ctx.workspaceId, type: "contact.edited", summary: `${ctx.name} edited ${changed.join(", ")}`, actor: { id: ctx.membershipId, label: ctx.name }, contactId: c.id, data: { before: Object.fromEntries(changed.map((k) => [k, (c as Record<string, unknown>)[k]])), after: Object.fromEntries(changed.map((k) => [k, (next as Record<string, unknown>)[k]])) } });
  return { contact: u };
});

export const DELETE = api<{ id: string }>("crm.delete", async ({ ctx, params }) => {
  const c = await db.query.contacts.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!c) throw new HttpError(404, "Contact not found.");
  await db.transaction(async (tx) => {
    // Cascades remove the contact's opportunities, leads, conversations, payments and appointments (Q4: no orphans).
    await tx.delete(schema.contacts).where(scope(ctx.workspaceId, params.id));
    await audit(tx, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "contact.deleted", { type: "contact", id: c.id }, { name: c.name, phone: c.phone, email: c.email }, null);
  });
  return { ok: true };
});
