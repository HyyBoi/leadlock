import Stripe from "stripe";
import { ProviderError } from "./registry";

/**
 * Payment provider adapter (Q14). The rest of the app only talks to PaymentProvider,
 * so swapping Stripe for another gateway means writing one new adapter.
 */
export type StripeConfig = { secretKey: string; webhookSecret: string; webhookEndpointId?: string };

export type CheckoutResult = { providerRef: string; url: string; expiresAt: Date };
export type NormalizedPaymentEvent =
  | { type: "paid"; paymentId?: string; providerRef?: string; providerPayment?: string }
  | { type: "failed"; paymentId?: string; providerPayment?: string; reason: string }
  | { type: "expired"; paymentId?: string; providerRef?: string }
  | { type: "refunded"; providerPayment?: string; paymentId?: string; refundedAmount: number; amount: number }
  | { type: "ignored" };

export const STRIPE_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
];

const client = (cfg: { secretKey: string }) => new Stripe(cfg.secretKey, { maxNetworkRetries: 1, timeout: 15000 });

function wrap(e: unknown): never {
  const err = e as { type?: string; statusCode?: number; message?: string };
  const temporary = err.type === "StripeConnectionError" || err.type === "StripeAPIError" || err.statusCode === 429 || (err.statusCode ?? 0) >= 500;
  throw new ProviderError(`Stripe: ${err.message ?? "request failed"}`, temporary);
}

export const stripeProvider = {
  async verifyKey(secretKey: string) {
    if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_"))
      throw new ProviderError("Use a TEST mode secret key (starts with sk_test_). Live keys are refused.", false);
    try {
      await client({ secretKey }).balance.retrieve();
    } catch (e) {
      wrap(e);
    }
  },

  async createWebhook(secretKey: string, url: string) {
    try {
      const ep = await client({ secretKey }).webhookEndpoints.create({ url, enabled_events: STRIPE_EVENTS, description: "LeadLock" });
      return { id: ep.id, secret: ep.secret! };
    } catch (e) {
      wrap(e);
    }
  },

  async deleteWebhook(cfg: StripeConfig) {
    if (!cfg.webhookEndpointId) return;
    try {
      await client(cfg).webhookEndpoints.del(cfg.webhookEndpointId);
    } catch {
      /* already gone */
    }
  },

  async createCheckout(
    cfg: StripeConfig,
    p: { paymentId: string; workspaceId: string; amount: number; currency: string; title: string; email?: string | null; successUrl: string; cancelUrl: string },
  ): Promise<CheckoutResult> {
    const expiresAt = new Date(Date.now() + 31 * 60 * 1000);
    try {
      const s = await client(cfg).checkout.sessions.create(
        {
          mode: "payment",
          line_items: [{ quantity: 1, price_data: { currency: p.currency, unit_amount: p.amount, product_data: { name: p.title } } }],
          success_url: p.successUrl,
          cancel_url: p.cancelUrl,
          customer_email: p.email ?? undefined,
          client_reference_id: p.paymentId,
          metadata: { paymentId: p.paymentId, workspaceId: p.workspaceId },
          payment_intent_data: { metadata: { paymentId: p.paymentId, workspaceId: p.workspaceId } },
          expires_at: Math.floor(expiresAt.getTime() / 1000),
        },
        { idempotencyKey: `checkout-${p.paymentId}` },
      );
      return { providerRef: s.id, url: s.url!, expiresAt };
    } catch (e) {
      wrap(e);
    }
  },

  async expireCheckout(cfg: StripeConfig, providerRef: string) {
    try {
      await client(cfg).checkout.sessions.expire(providerRef);
    } catch (e) {
      wrap(e);
    }
  },

  /** I2.3: signature checked against the raw body before anything else happens. Throws on mismatch. */
  verifyAndParse(cfg: StripeConfig, rawBody: string, signature: string | null) {
    if (!signature) throw new Error("Missing Stripe-Signature header");
    return Stripe.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
  },

  normalize(ev: Stripe.Event): NormalizedPaymentEvent {
    switch (ev.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = ev.data.object as Stripe.Checkout.Session;
        if (s.payment_status !== "paid") return { type: "ignored" };
        return { type: "paid", paymentId: s.metadata?.paymentId, providerRef: s.id, providerPayment: (s.payment_intent as string) ?? undefined };
      }
      case "checkout.session.async_payment_failed": {
        const s = ev.data.object as Stripe.Checkout.Session;
        return { type: "failed", paymentId: s.metadata?.paymentId, reason: "Asynchronous payment failed" };
      }
      case "checkout.session.expired": {
        const s = ev.data.object as Stripe.Checkout.Session;
        return { type: "expired", paymentId: s.metadata?.paymentId, providerRef: s.id };
      }
      case "payment_intent.payment_failed": {
        const pi = ev.data.object as Stripe.PaymentIntent;
        return { type: "failed", paymentId: pi.metadata?.paymentId, providerPayment: pi.id, reason: pi.last_payment_error?.message ?? "Card was declined" };
      }
      case "charge.refunded": {
        const ch = ev.data.object as Stripe.Charge;
        return { type: "refunded", providerPayment: ch.payment_intent as string, paymentId: ch.metadata?.paymentId, refundedAmount: ch.amount_refunded, amount: ch.amount };
      }
      default:
        return { type: "ignored" };
    }
  },
};
