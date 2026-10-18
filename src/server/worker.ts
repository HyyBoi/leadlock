import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { escalateDueLeads } from "./leads";
import { getIntegration, markError, markOk, ProviderError, recordEvent } from "./integrations/registry";
import { slack, SlackConfig } from "./integrations/slack";
import { whatsapp, WhatsAppConfig } from "./integrations/whatsapp";

type OutboxRow = { id: string; workspace_id: string; kind: string; payload: Record<string, string>; attempts: number; max_attempts: number };

class Permanent extends Error {}

async function deliver(row: OutboxRow) {
  const ws = row.workspace_id;
  if (row.kind === "ALERT") {
    const m = await db.query.memberships.findFirst({ where: eq(schema.memberships.id, row.payload.membershipId) });
    const integ = await getIntegration<SlackConfig>(ws, "SLACK");
    if (!integ) throw new Permanent("Slack alerts are not connected for this workspace.");
    if (!m?.slackUserId) throw new Permanent("Employee has not linked Slack (My profile → Slack email).");
    await slack.dm(integ.config.botToken, m.slackUserId, row.payload.text, row.payload.url);
    await recordEvent({ workspaceId: ws, provider: "SLACK", direction: "OUT", kind: "alert.send", result: "OK", reference: row.payload.leadId });
    await markOk(ws, "SLACK");
    return;
  }
  if (row.kind === "WHATSAPP_SEND") {
    const msg = await db.query.messages.findFirst({ where: eq(schema.messages.id, row.payload.messageId) });
    if (!msg || msg.status !== "QUEUED") return;
    const conv = (await db.query.conversations.findFirst({ where: eq(schema.conversations.id, msg.conversationId) }))!;
    const contact = (await db.query.contacts.findFirst({ where: eq(schema.contacts.id, conv.contactId) }))!;
    const integ = await getIntegration<WhatsAppConfig>(ws, "WHATSAPP");
    const fail = async (reason: string) => {
      await db.update(schema.messages).set({ status: "FAILED", error: reason, updatedAt: new Date() }).where(eq(schema.messages.id, msg.id));
    };
    if (!integ) {
      await fail("WhatsApp is not connected for this workspace.");
      throw new Permanent("WhatsApp is not connected.");
    }
    if (contact.optedOut) {
      await fail("Contact opted out; message not sent.");
      throw new Permanent("Contact opted out.");
    }
    try {
      const r = await whatsapp.send(integ.config, contact.phone!, msg.body);
      // Accepted by Meta = queued; the 'sent'/'delivered'/'read' webhooks advance it.
      await db.update(schema.messages).set({ providerSid: r.sid, status: "QUEUED", error: null, updatedAt: new Date() }).where(eq(schema.messages.id, msg.id));
      await recordEvent({ workspaceId: ws, provider: "WHATSAPP", direction: "OUT", kind: "message.send", result: "OK", reference: r.sid });
      await markOk(ws, "WHATSAPP");
    } catch (e) {
      const err = e as ProviderError;
      const last = row.attempts >= row.max_attempts;
      if (!err.temporary || last) await fail(err.message);
      else await db.update(schema.messages).set({ error: `Retrying: ${err.message}`, updatedAt: new Date() }).where(eq(schema.messages.id, msg.id));
      throw err.temporary ? err : new Permanent(err.message);
    }
    return;
  }
}

async function processOutbox() {
  const res = await db.execute(sql`
    update outbox set attempts = attempts + 1, next_attempt_at = now() + interval '60 seconds'
    where id in (
      select id from outbox where status = 'PENDING' and next_attempt_at <= now()
      order by next_attempt_at limit 10 for update skip locked
    ) returning id, workspace_id, kind, payload, attempts, max_attempts`);
  for (const row of res.rows as OutboxRow[]) {
    try {
      await deliver(row);
      await db.update(schema.outbox).set({ status: "DONE", lastError: null }).where(eq(schema.outbox.id, row.id));
    } catch (e) {
      const permanent = e instanceof Permanent || !(e as ProviderError).temporary;
      const exhausted = row.attempts >= row.max_attempts;
      const msg = (e as Error).message;
      const provider = row.kind === "ALERT" ? "SLACK" : "WHATSAPP";
      if (permanent || exhausted) {
        await db.update(schema.outbox).set({ status: "FAILED", lastError: msg }).where(eq(schema.outbox.id, row.id));
        await recordEvent({ workspaceId: row.workspace_id, provider, direction: "OUT", kind: row.kind.toLowerCase(), result: "ERROR", reference: row.payload.leadId ?? row.payload.messageId, detail: `${exhausted && !permanent ? `Gave up after ${row.attempts} attempts: ` : ""}${msg}` });
        await markError(row.workspace_id, provider, msg);
      } else {
        const delay = 5 * 2 ** (row.attempts - 1);
        await db.update(schema.outbox).set({ lastError: msg, nextAttemptAt: new Date(Date.now() + delay * 1000) }).where(eq(schema.outbox.id, row.id));
        await recordEvent({ workspaceId: row.workspace_id, provider, direction: "OUT", kind: row.kind.toLowerCase(), result: "RETRY", reference: row.payload.leadId ?? row.payload.messageId, detail: `Attempt ${row.attempts} failed, retrying in ${delay}s: ${msg}` });
      }
    }
  }
}

let running = false;
export async function tick() {
  if (running) return;
  running = true;
  try {
    await escalateDueLeads();
    await processOutbox();
  } catch (e) {
    console.error("[worker] tick failed", e);
  } finally {
    running = false;
  }
}

const g = globalThis as unknown as { __worker?: NodeJS.Timeout };
export function startWorker() {
  if (g.__worker || process.env.DISABLE_WORKER === "1") return;
  console.log("[worker] started: escalations + outbox every 1s");
  g.__worker = setInterval(tick, 1000);
}
