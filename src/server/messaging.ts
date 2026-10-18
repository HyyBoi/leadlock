import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { activity } from "./audit";
import { createLead, lockWorkspace, touchContactLeads } from "./leads";
import { defaultPipeline } from "./crm";
import { recordEvent } from "./integrations/registry";

const { contacts, conversations, messages, opportunities, outbox } = schema;

async function getOrCreateConversation(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0], workspaceId: string, contactId: string) {
  await tx.insert(conversations).values({ workspaceId, contactId, channel: "WHATSAPP" }).onConflictDoNothing();
  return (await tx.query.conversations.findFirst({
    where: and(eq(conversations.workspaceId, workspaceId), eq(conversations.contactId, contactId), eq(conversations.channel, "WHATSAPP")),
  }))!;
}

/** I1.1 / I1.5 / I1.8: inbound WhatsApp. Idempotent on MessageSid; unknown numbers become contact + opportunity + lead. */
export type InboundMsg = { sid: string; phone: string; body: string; name?: string };
export async function handleInbound(workspaceId: string, p: InboundMsg) {
  const sid = p.sid;
  const phone = p.phone;
  const body = p.body;
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const dup = await tx.query.messages.findFirst({ where: eq(messages.providerSid, sid), columns: { id: true } });
    if (dup) return { duplicate: true };

    let contact = await tx.query.contacts.findFirst({ where: and(eq(contacts.workspaceId, workspaceId), eq(contacts.phone, phone)) });
    let createdLead = false;
    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({ workspaceId, name: p.name || phone, phone, tags: ["whatsapp"] })
        .returning();
      const pl = await defaultPipeline(tx, workspaceId);
      const [opp] = await tx
        .insert(opportunities)
        .values({ workspaceId, contactId: contact.id, pipelineId: pl.pipeline.id, stageId: pl.firstStage.id, title: `WhatsApp enquiry from ${contact.name}` })
        .returning();
      await activity(tx, { workspaceId, type: "contact.created", summary: `Contact created from an incoming WhatsApp message`, actor: { label: "WhatsApp" }, contactId: contact.id });
      const lead = await createLead({ workspaceId, contactId: contact.id, opportunityId: opp.id, source: "WHATSAPP", message: body, actor: { label: "WhatsApp" }, tx });
      await tx.update(contacts).set({ ownerId: lead.ownerId }).where(eq(contacts.id, contact.id));
      await tx.update(opportunities).set({ ownerId: lead.ownerId }).where(eq(opportunities.id, opp.id));
      createdLead = true;
    }
    const conv = await getOrCreateConversation(tx, workspaceId, contact.id);
    await tx.insert(messages).values({ workspaceId, conversationId: conv.id, direction: "IN", body, status: "RECEIVED", providerSid: sid });
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
    await activity(tx, { workspaceId, type: "message.received", summary: `WhatsApp from customer: "${body.slice(0, 80)}"`, actor: { label: contact.name }, contactId: contact.id });
    if (/^\s*stop\s*$/i.test(body)) {
      await tx.update(contacts).set({ optedOut: true, optOutReason: "Customer replied STOP on WhatsApp" }).where(eq(contacts.id, contact.id));
    }
    return { duplicate: false, contactId: contact.id, createdLead };
  });
}

export class OptedOutError extends Error {}

/** I1.3 / I1.7 / I1.9: queue an outbound message. The outbox worker sends and retries; failures stay visible. */
export async function queueOutbound(workspaceId: string, contactId: string, body: string, actor: { id: string; label: string }) {
  const contact = await db.query.contacts.findFirst({ where: and(eq(contacts.id, contactId), eq(contacts.workspaceId, workspaceId)) });
  if (!contact) throw new Error("Contact not found");
  if (contact.optedOut) throw new OptedOutError(`${contact.name} has opted out of messages (${contact.optOutReason ?? "marked opted out"}). Messaging is blocked until they opt back in.`);
  if (!contact.phone) throw new OptedOutError(`${contact.name} has no phone number, so they can't be messaged on WhatsApp.`);
  const msg = await db.transaction(async (tx) => {
    const conv = await getOrCreateConversation(tx, workspaceId, contact.id);
    const [m] = await tx
      .insert(messages)
      .values({ workspaceId, conversationId: conv.id, direction: "OUT", body, status: "QUEUED", sentById: actor.id })
      .returning();
    await tx.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
    await tx.insert(outbox).values({ workspaceId, kind: "WHATSAPP_SEND", payload: { messageId: m.id } });
    await activity(tx, { workspaceId, type: "message.sent", summary: `${actor.label} sent a WhatsApp message: "${body.slice(0, 80)}"`, actor, contactId: contact.id });
    return m;
  });
  await touchContactLeads(workspaceId, contact.id, actor, "sent a message");
  return msg;
}

export async function retryMessage(workspaceId: string, messageId: string) {
  const m = await db.query.messages.findFirst({ where: and(eq(messages.id, messageId), eq(messages.workspaceId, workspaceId)) });
  if (!m || m.direction !== "OUT" || m.status !== "FAILED") return null;
  await db.update(messages).set({ status: "QUEUED", error: null, updatedAt: new Date() }).where(eq(messages.id, m.id));
  await db.insert(outbox).values({ workspaceId, kind: "WHATSAPP_SEND", payload: { messageId: m.id } });
  return m;
}

const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

/** I1.4: delivery status webhooks. Never downgrade (e.g. a late 'sent' after 'delivered'). */
export async function handleStatus(workspaceId: string, p: { sid: string; status: string; error?: string | null }) {
  const map: Record<string, "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED"> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };
  const next = map[p.status];
  if (!next) return;
  const m = await db.query.messages.findFirst({ where: and(eq(messages.providerSid, p.sid), eq(messages.workspaceId, workspaceId)) });
  if (!m) return;
  if ((RANK[next] ?? 0) <= (RANK[m.status] ?? 0) && next !== "FAILED") return;
  await db.update(messages).set({ status: next, error: next === "FAILED" ? p.error ?? "WhatsApp could not deliver the message." : null, updatedAt: new Date() }).where(eq(messages.id, m.id));
}

export { sql };
