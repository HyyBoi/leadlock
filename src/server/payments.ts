import { and, eq, or, sql, SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { activity } from "./audit";
import { money } from "./crm";
import { stripeProvider, StripeConfig, NormalizedPaymentEvent } from "./integrations/stripe";
import { appUrl, getIntegration, markError, markOk, ProviderError, recordEvent } from "./integrations/registry";
import { HttpError } from "@/lib/api";

const { payments, opportunities, contacts } = schema;

export async function createPaymentRequest(
  workspaceId: string,
  opportunityId: string,
  amount: number,
  currency: string,
  actor: { id: string; label: string },
) {
  const integ = await getIntegration<StripeConfig>(workspaceId, "STRIPE");
  if (!integ) throw new HttpError(409, "Payments are not connected for this workspace. An admin can connect Stripe on the Integrations page.");
  const opp = await db.query.opportunities.findFirst({ where: and(eq(opportunities.id, opportunityId), eq(opportunities.workspaceId, workspaceId)) });
  if (!opp) throw new HttpError(404, "Opportunity not found.");
  const contact = (await db.query.contacts.findFirst({ where: eq(contacts.id, opp.contactId) }))!;
  const [p] = await db
    .insert(payments)
    .values({ workspaceId, opportunityId, contactId: opp.contactId, requestedById: actor.id, amount, currency })
    .returning();
  try {
    const r = await stripeProvider.createCheckout(integ.config, {
      paymentId: p.id,
      workspaceId,
      amount,
      currency,
      title: opp.title,
      email: contact.email,
      successUrl: `${appUrl()}/pay/thanks`,
      cancelUrl: `${appUrl()}/pay/cancelled`,
    });
    await db.update(payments).set({ providerRef: r.providerRef, url: r.url, updatedAt: new Date() }).where(eq(payments.id, p.id));
    await recordEvent({ workspaceId, provider: "STRIPE", direction: "OUT", kind: "checkout.create", result: "OK", reference: r.providerRef });
    await markOk(workspaceId, "STRIPE");
    await activity(db, { workspaceId, type: "payment.requested", summary: `${actor.label} requested ${money(amount, currency)} (Stripe checkout)`, actor, contactId: opp.contactId, opportunityId });
    return { ...p, providerRef: r.providerRef, url: r.url };
  } catch (e) {
    const err = e as ProviderError;
    await db.update(payments).set({ status: "FAILED", lastError: `Could not create checkout: ${err.message}` }).where(eq(payments.id, p.id));
    await recordEvent({ workspaceId, provider: "STRIPE", direction: "OUT", kind: "checkout.create", result: "ERROR", detail: err.message });
    await markError(workspaceId, "STRIPE", err.message);
    throw new HttpError(502, `Stripe did not create the payment link: ${err.message}${err.temporary ? " Please try again in a moment." : ""}`);
  }
}

/** I2.2 / I2.4 / I2.5: apply a verified, de-duplicated provider event with monotonic status rules. */
export async function applyPaymentEvent(workspaceId: string, ev: NormalizedPaymentEvent) {
  if (ev.type === "ignored") return "ignored";
  const keys: SQL[] = [];
  if ("paymentId" in ev && ev.paymentId) keys.push(eq(payments.id, ev.paymentId));
  if ("providerRef" in ev && ev.providerRef) keys.push(eq(payments.providerRef, ev.providerRef));
  if ("providerPayment" in ev && ev.providerPayment) keys.push(eq(payments.providerPayment, ev.providerPayment));
  if (!keys.length) return "no-match";
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(and(eq(payments.workspaceId, workspaceId), or(...keys))).for("update");
    if (!p) return "no-match";
    const label = { label: "Stripe" };
    const base = { workspaceId, actor: label, contactId: p.contactId, opportunityId: p.opportunityId };
    if (ev.type === "paid") {
      if (p.status === "PAID" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") return "already";
      await tx.update(payments).set({ status: "PAID", paidAt: new Date(), providerPayment: ev.providerPayment ?? p.providerPayment, lastError: null, updatedAt: new Date() }).where(eq(payments.id, p.id));
      await activity(tx, { ...base, type: "payment.paid", summary: `Payment of ${money(p.amount, p.currency)} received` });
    } else if (ev.type === "failed") {
      if (p.status !== "PENDING" && p.status !== "FAILED") return "already";
      await tx.update(payments).set({ status: "FAILED", lastError: ev.reason, providerPayment: ev.providerPayment ?? p.providerPayment, updatedAt: new Date() }).where(eq(payments.id, p.id));
      await activity(tx, { ...base, type: "payment.failed", summary: `Payment attempt failed: ${ev.reason}` });
    } else if (ev.type === "expired") {
      if (p.status !== "PENDING" && p.status !== "FAILED") return "already";
      const why = p.status === "FAILED" ? "customer's payment failed and the link expired" : "link expired / abandoned without payment";
      await tx.update(payments).set({ status: "EXPIRED", lastError: why, updatedAt: new Date() }).where(eq(payments.id, p.id));
      await activity(tx, { ...base, type: "payment.expired", summary: `Payment link expired (${why})` });
    } else if (ev.type === "refunded") {
      const refunded = Math.max(p.refundedAmount, ev.refundedAmount);
      if (refunded === p.refundedAmount) return "already";
      const status = refunded >= p.amount ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await tx.update(payments).set({ status, refundedAmount: refunded, updatedAt: new Date() }).where(eq(payments.id, p.id));
      await activity(tx, { ...base, type: "payment.refunded", summary: `Refund of ${money(refunded - p.refundedAmount, p.currency)} recorded from Stripe` });
    }
    return "applied";
  });
}

/** Glossary: collected = webhook-confirmed payments minus confirmed refunds. */
export const collectedSql = sql<number>`coalesce(sum(case when ${payments.paidAt} is not null then ${payments.amount} - ${payments.refundedAmount} else 0 end), 0)::int`;
