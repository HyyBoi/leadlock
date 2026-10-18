import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getIntegration, markOk, recordEvent } from "@/server/integrations/registry";
import { explainWaError, fromWa, MetaWebhook, verifyMeta, WhatsAppConfig } from "@/server/integrations/whatsapp";
import { handleInbound, handleStatus } from "@/server/messaging";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Meta's one-time webhook verification handshake (hub.challenge). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const integ = await getIntegration<WhatsAppConfig>(ws, "WHATSAPP");
  const sp = req.nextUrl.searchParams;
  if (integ && sp.get("hub.mode") === "subscribe" && same(sp.get("hub.verify_token") ?? "", integ.config.verifyToken)) {
    await recordEvent({ workspaceId: ws, provider: "WHATSAPP", direction: "IN", kind: "webhook.verify", result: "OK" });
    return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  if (integ) await recordEvent({ workspaceId: ws, provider: "WHATSAPP", direction: "IN", kind: "webhook.verify", result: "REJECTED", detail: "Verify token mismatch" });
  return new NextResponse("Forbidden", { status: 403 });
}

/** I1.1 / I1.2 / I1.4 / I1.8: signature-verified, idempotent inbound messages and delivery statuses. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const integ = await getIntegration<WhatsAppConfig>(ws, "WHATSAPP");
  if (!integ) return new NextResponse("Not configured", { status: 404 });
  const raw = await req.text();
  if (!verifyMeta(integ.config.appSecret, raw, req.headers.get("x-hub-signature-256"))) {
    await recordEvent({ workspaceId: ws, provider: "WHATSAPP", direction: "IN", kind: "webhook", result: "REJECTED", detail: "Invalid X-Hub-Signature-256: request forged or altered" });
    return new NextResponse("Invalid signature", { status: 403 });
  }
  let payload: MetaWebhook;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }
  let failed = false;
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value;
      if (!v) continue;
      if (v.metadata?.phone_number_id && v.metadata.phone_number_id !== integ.config.phoneNumberId) continue; // not this workspace's number
      for (const m of v.messages ?? []) {
        const body = m.text?.body ?? m.button?.text ?? `[${m.type} message]`;
        const name = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        try {
          const r = await handleInbound(ws, { sid: m.id, phone: fromWa(m.from), body, name });
          await recordEvent({ workspaceId: ws, provider: "WHATSAPP", direction: "IN", kind: "message.inbound", result: r.duplicate ? "DUPLICATE" : "OK", reference: m.id, detail: r.duplicate ? "Already processed; ignored" : r.createdLead ? "New contact + lead created" : "Attached to existing contact" });
        } catch (e) {
          failed = true;
          await recordEvent({ workspaceId: ws, provider: "WHATSAPP", direction: "IN", kind: "message.inbound", result: "ERROR", reference: m.id, detail: (e as Error).message });
        }
      }
      for (const s of v.statuses ?? []) {
        const err = s.errors?.[0];
        const fresh = await recordEvent({ workspaceId: ws, provider: "WHATSAPP", direction: "IN", kind: `message.${s.status}`, result: "OK", reference: s.id, dedupeKey: `wa:status:${s.id}:${s.status}`, detail: err ? `(${err.code}) ${err.title ?? ""} ${err.error_data?.details ?? ""}` : null });
        if (fresh) await handleStatus(ws, { sid: s.id, status: s.status, error: err ? `(${err.code}) ${explainWaError(err.code, err.error_data?.details ?? err.message ?? err.title)}` : null });
      }
    }
  }
  if (failed) return new NextResponse("Error", { status: 500 }); // Meta retries; duplicates are ignored by message id
  await markOk(ws, "WHATSAPP");
  return NextResponse.json({ ok: true });
}
