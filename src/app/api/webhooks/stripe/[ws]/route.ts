import { NextRequest, NextResponse } from "next/server";
import { getIntegration, markOk, recordEvent } from "@/server/integrations/registry";
import { stripeProvider, StripeConfig } from "@/server/integrations/stripe";
import { applyPaymentEvent } from "@/server/payments";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/** I2.2–I2.5: verify signature on the RAW body, de-duplicate by event id, then apply. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const integ = await getIntegration<StripeConfig>(ws, "STRIPE");
  if (!integ) return new NextResponse("Not configured", { status: 404 });
  const raw = await req.text();
  let event;
  try {
    event = stripeProvider.verifyAndParse(integ.config, raw, req.headers.get("stripe-signature"));
  } catch (e) {
    await recordEvent({ workspaceId: ws, provider: "STRIPE", direction: "IN", kind: "webhook", result: "REJECTED", detail: `Signature check failed: ${(e as Error).message.slice(0, 200)}` });
    return new NextResponse("Invalid signature", { status: 400 });
  }
  const fresh = await recordEvent({ workspaceId: ws, provider: "STRIPE", direction: "IN", kind: event.type, result: "OK", reference: event.id, dedupeKey: `stripe:${event.id}` });
  if (!fresh) {
    await recordEvent({ workspaceId: ws, provider: "STRIPE", direction: "IN", kind: event.type, result: "DUPLICATE", reference: event.id, detail: "Same event delivered again; ignored" });
    return NextResponse.json({ received: true, duplicate: true });
  }
  try {
    const outcome = await applyPaymentEvent(ws, stripeProvider.normalize(event));
    await markOk(ws, "STRIPE");
    return NextResponse.json({ received: true, outcome });
  } catch (e) {
    // Let Stripe retry: remove the dedupe marker so the retry is processed.
    await db.delete(schema.integrationEvents).where(eq(schema.integrationEvents.dedupeKey, `stripe:${event.id}`));
    await recordEvent({ workspaceId: ws, provider: "STRIPE", direction: "IN", kind: event.type, result: "ERROR", reference: event.id, detail: (e as Error).message });
    return new NextResponse("Processing error", { status: 500 });
  }
}
