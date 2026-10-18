import { NextRequest, NextResponse } from "next/server";
import { appUrl, getIntegration, markOk, recordEvent } from "@/server/integrations/registry";
import { TwilioConfig, verifyTwilio } from "@/server/integrations/twilio";
import { handleInbound } from "@/server/messaging";

const twiml = () => new NextResponse("<Response></Response>", { headers: { "content-type": "text/xml" } });

/** I1.1 / I1.2 / I1.8: signature-verified, idempotent inbound WhatsApp webhook. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const integ = await getIntegration<TwilioConfig>(ws, "TWILIO");
  if (!integ) return new NextResponse("Not configured", { status: 404 });
  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  const url = `${appUrl()}/api/webhooks/twilio/${ws}`;
  if (!verifyTwilio(integ.config, req.headers.get("x-twilio-signature"), url, form)) {
    await recordEvent({ workspaceId: ws, provider: "TWILIO", direction: "IN", kind: "message.inbound", result: "REJECTED", reference: form.MessageSid ?? null, detail: "Invalid X-Twilio-Signature: request forged or altered" });
    return new NextResponse("Invalid signature", { status: 403 });
  }
  try {
    const r = await handleInbound(ws, form);
    await recordEvent({ workspaceId: ws, provider: "TWILIO", direction: "IN", kind: "message.inbound", result: r.duplicate ? "DUPLICATE" : "OK", reference: form.MessageSid, detail: r.duplicate ? "Already processed; ignored" : r.createdLead ? "New contact + lead created" : "Attached to existing contact" });
    await markOk(ws, "TWILIO");
    return twiml();
  } catch (e) {
    await recordEvent({ workspaceId: ws, provider: "TWILIO", direction: "IN", kind: "message.inbound", result: "ERROR", reference: form.MessageSid, detail: (e as Error).message });
    return new NextResponse("Error", { status: 500 }); // Twilio will report it; nothing half-written thanks to the transaction
  }
}
