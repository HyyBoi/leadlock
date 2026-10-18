import { z } from "zod";
import { api, body } from "@/lib/api";
import { createPaymentRequest } from "@/server/payments";
import { queueOutbound, OptedOutError } from "@/server/messaging";
import { money } from "@/server/crm";

/** I2.1: payment request from an opportunity; optionally sent to the customer on WhatsApp. */
export const POST = api("payments.create", async ({ req, ctx }) => {
  const b = await body(req, z.object({
    opportunityId: z.string(), amount: z.coerce.number().positive().max(1_000_000),
    currency: z.enum(["usd", "eur", "gbp", "pkr", "aed"]).default("usd"), sendWhatsApp: z.boolean().default(false),
  }));
  const actor = { id: ctx.membershipId, label: ctx.name };
  const p = await createPaymentRequest(ctx.workspaceId, b.opportunityId, Math.round(b.amount * 100), b.currency, actor);
  let sent: string | null = null;
  if (b.sendWhatsApp && p.url) {
    try {
      await queueOutbound(ctx.workspaceId, p.contactId, `Here is your secure payment link for ${money(p.amount, p.currency)}: ${p.url}`, actor);
      sent = "queued";
    } catch (e) {
      sent = e instanceof OptedOutError ? e.message : "Link created but could not be sent on WhatsApp.";
    }
  }
  return { payment: { id: p.id, url: p.url }, sent };
});
