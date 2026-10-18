import { and, eq } from "drizzle-orm";
import { api, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { getIntegration, ProviderError } from "@/server/integrations/registry";
import { stripeProvider, StripeConfig } from "@/server/integrations/stripe";

/** Ends a checkout early at Stripe; the resulting checkout.session.expired webhook updates the status. */
export const POST = api<{ id: string }>("payments.create", async ({ ctx, params }) => {
  const p = await db.query.payments.findFirst({ where: and(eq(schema.payments.id, params.id), eq(schema.payments.workspaceId, ctx.workspaceId)) });
  if (!p || !p.providerRef) throw new HttpError(404, "Payment not found.");
  if (p.status !== "PENDING" && p.status !== "FAILED") throw new HttpError(409, `This payment is already ${p.status.toLowerCase()}.`);
  const integ = await getIntegration<StripeConfig>(ctx.workspaceId, "STRIPE");
  if (!integ) throw new HttpError(409, "Stripe is not connected.");
  try {
    await stripeProvider.expireCheckout(integ.config, p.providerRef);
  } catch (e) {
    throw new HttpError(502, (e as ProviderError).message);
  }
  return { ok: true };
});
