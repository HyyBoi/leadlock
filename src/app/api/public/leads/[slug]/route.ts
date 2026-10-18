import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { toResponse, HttpError } from "@/lib/api";
import { workspaceBySlug } from "@/server/workspace";
import { createLead } from "@/server/leads";
import { defaultPipeline } from "@/server/crm";
import { activity } from "@/server/audit";
import { normalizePhone } from "@/lib/phone";

const Form = z.object({
  name: z.string().trim().min(2, "please enter your name").max(120),
  phone: z.string().trim().min(7, "please enter a valid phone number").max(30),
  email: z.string().trim().email().optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional(),
  website: z.string().max(0).optional(), // honeypot
});

/** F3.1 public web form intake (no login). Rate-limited per IP. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const ws = await workspaceBySlug((await params).slug);
    if (!ws) throw new HttpError(404, "This form is not available.");
    const b = Form.parse(await req.json());
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    const key = `form|${ws.id}|${ip}`;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginAttempts).where(and(eq(schema.loginAttempts.key, key), gt(schema.loginAttempts.createdAt, new Date(Date.now() - 60_000))));
    if (n >= 10) throw new HttpError(429, "Too many submissions. Please wait a minute.");
    await db.insert(schema.loginAttempts).values({ key, success: true });
    const phone = normalizePhone(b.phone);
    const actor = { label: "Web form" };
    await db.transaction(async (tx) => {
      let contact = await tx.query.contacts.findFirst({ where: and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.phone, phone)) });
      if (!contact) {
        [contact] = await tx.insert(schema.contacts).values({ workspaceId: ws.id, name: b.name, phone, email: b.email || null, tags: ["web"] }).returning();
        await activity(tx, { workspaceId: ws.id, type: "contact.created", summary: "Contact created from the public web form", actor, contactId: contact.id });
      }
      const pl = await defaultPipeline(tx, ws.id);
      const [opp] = await tx.insert(schema.opportunities).values({ workspaceId: ws.id, contactId: contact.id, pipelineId: pl.pipeline.id, stageId: pl.firstStage.id, title: `Web enquiry from ${contact.name}` }).returning();
      const l = await createLead({ workspaceId: ws.id, contactId: contact.id, opportunityId: opp.id, source: "WEB_FORM", message: b.message, actor, tx });
      await tx.update(schema.opportunities).set({ ownerId: l.ownerId }).where(eq(schema.opportunities.id, opp.id));
      if (!contact.ownerId) await tx.update(schema.contacts).set({ ownerId: l.ownerId }).where(eq(schema.contacts.id, contact.id));
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
