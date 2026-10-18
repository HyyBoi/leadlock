import { NextRequest, NextResponse } from "next/server";
import { appUrl, getIntegration, recordEvent } from "@/server/integrations/registry";
import { TwilioConfig, verifyTwilio } from "@/server/integrations/twilio";
import { handleStatus } from "@/server/messaging";

/** I1.4: delivery status callbacks (signature-verified). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const integ = await getIntegration<TwilioConfig>(ws, "TWILIO");
  if (!integ) return new NextResponse("Not configured", { status: 404 });
  const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
  if (!verifyTwilio(integ.config, req.headers.get("x-twilio-signature"), `${appUrl()}/api/webhooks/twilio/${ws}/status`, form)) {
    await recordEvent({ workspaceId: ws, provider: "TWILIO", direction: "IN", kind: "message.status", result: "REJECTED", reference: form.MessageSid ?? null, detail: "Invalid X-Twilio-Signature" });
    return new NextResponse("Invalid signature", { status: 403 });
  }
  const fresh = await recordEvent({ workspaceId: ws, provider: "TWILIO", direction: "IN", kind: `message.${form.MessageStatus}`, result: "OK", reference: form.MessageSid, dedupeKey: `twilio:status:${form.MessageSid}:${form.MessageStatus}`, detail: form.ErrorCode ? `Error ${form.ErrorCode}` : null });
  if (fresh) await handleStatus(ws, form);
  return new NextResponse(null, { status: 204 });
}
