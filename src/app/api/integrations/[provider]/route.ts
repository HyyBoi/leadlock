import { z } from "zod";
import { api, body, HttpError } from "@/lib/api";
import { db } from "@/db";
import { mask, randomToken } from "@/lib/crypto";
import { audit } from "@/server/audit";
import { appUrl, getIntegration, ProviderError, recordEvent, saveIntegration } from "@/server/integrations/registry";
import { twilioCheck, TwilioConfig } from "@/server/integrations/twilio";
import { stripeProvider, StripeConfig } from "@/server/integrations/stripe";
import { telegram, TelegramConfig } from "@/server/integrations/telegram";
import { normalizePhone } from "@/lib/phone";

const isPublic = () => appUrl().startsWith("https://");

/** I5.2 / I5.3 / I5.7: per-workspace credentials, validated with the provider, stored encrypted, masked in the UI, audited. */
export const POST = api<{ provider: string }>("integrations.manage", async ({ req, ctx, params }) => {
  const provider = params.provider.toUpperCase();
  const actor = { id: ctx.membershipId, label: ctx.name };
  try {
    if (provider === "TWILIO") {
      const b = await body(req, z.object({ accountSid: z.string().trim().regex(/^AC[0-9a-f]{32}$/i, "must look like AC…"), authToken: z.string().trim().min(16), from: z.string().trim().min(8) }));
      const cfg: TwilioConfig = { accountSid: b.accountSid, authToken: b.authToken, from: normalizePhone(b.from.replace(/^whatsapp:/, "")) };
      await twilioCheck(cfg);
      await saveIntegration(db, ctx.workspaceId, "TWILIO", cfg, { accountSid: mask(cfg.accountSid), authToken: mask(cfg.authToken), from: cfg.from });
    } else if (provider === "STRIPE") {
      const b = await body(req, z.object({ secretKey: z.string().trim().min(10), webhookSecret: z.string().trim().optional() }));
      await stripeProvider.verifyKey(b.secretKey);
      const old = await getIntegration<StripeConfig>(ctx.workspaceId, "STRIPE");
      if (old) await stripeProvider.deleteWebhook(old.config);
      let cfg: StripeConfig;
      if (isPublic()) {
        const ep = await stripeProvider.createWebhook(b.secretKey, `${appUrl()}/api/webhooks/stripe/${ctx.workspaceId}`);
        cfg = { secretKey: b.secretKey, webhookSecret: ep.secret, webhookEndpointId: ep.id };
      } else {
        if (!b.webhookSecret) throw new HttpError(400, "Running locally: paste the whsec_… secret printed by `stripe listen`.");
        cfg = { secretKey: b.secretKey, webhookSecret: b.webhookSecret };
      }
      await saveIntegration(db, ctx.workspaceId, "STRIPE", cfg, { secretKey: mask(cfg.secretKey), webhookSecret: mask(cfg.webhookSecret), webhook: cfg.webhookEndpointId ?? "manual" });
    } else if (provider === "TELEGRAM") {
      const b = await body(req, z.object({ botToken: z.string().trim().regex(/^\d+:[\w-]{30,}$/, "must look like 123456:ABC…") }));
      const me = await telegram.getMe(b.botToken);
      const secret = randomToken(24);
      if (isPublic()) await telegram.setWebhook(b.botToken, `${appUrl()}/api/webhooks/telegram/${ctx.workspaceId}`, secret);
      const cfg: TelegramConfig = { botToken: b.botToken, botUsername: me.username, webhookSecret: secret };
      await saveIntegration(db, ctx.workspaceId, "TELEGRAM", cfg, { botToken: mask(b.botToken), bot: `@${me.username}` });
    } else throw new HttpError(404, "Unknown integration.");
  } catch (e) {
    if (e instanceof ProviderError) {
      await recordEvent({ workspaceId: ctx.workspaceId, provider: provider as "TWILIO", direction: "OUT", kind: "connect", result: "ERROR", detail: e.message });
      throw new HttpError(400, `Couldn't connect: ${e.message}`);
    }
    throw e;
  }
  await recordEvent({ workspaceId: ctx.workspaceId, provider: provider as "TWILIO", direction: "OUT", kind: "connect", result: "OK" });
  await audit(db, ctx.workspaceId, actor, "integration.connected", { type: "integration", id: provider }, null, { provider });
  return { ok: true };
});

export const DELETE = api<{ provider: string }>("integrations.manage", async ({ ctx, params }) => {
  const provider = params.provider.toUpperCase() as "TWILIO" | "STRIPE" | "TELEGRAM";
  if (!["TWILIO", "STRIPE", "TELEGRAM"].includes(provider)) throw new HttpError(404, "Unknown integration.");
  const cur = await getIntegration(ctx.workspaceId, provider);
  if (cur && provider === "STRIPE") await stripeProvider.deleteWebhook(cur.config as unknown as StripeConfig);
  if (cur && provider === "TELEGRAM") await telegram.deleteWebhook((cur.config as unknown as TelegramConfig).botToken).catch(() => {});
  await saveIntegration(db, ctx.workspaceId, provider, null, {});
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "integration.disconnected", { type: "integration", id: provider }, { provider, connected: !!cur }, { connected: false });
  return { ok: true };
});
