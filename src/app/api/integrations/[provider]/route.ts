import { z } from "zod";
import { api, body, HttpError } from "@/lib/api";
import { db } from "@/db";
import { mask, randomToken } from "@/lib/crypto";
import { audit } from "@/server/audit";
import { appUrl, getIntegration, ProviderError, recordEvent, saveIntegration } from "@/server/integrations/registry";
import { whatsapp, WhatsAppConfig } from "@/server/integrations/whatsapp";
import { stripeProvider, StripeConfig } from "@/server/integrations/stripe";
import { slack } from "@/server/integrations/slack";

const isPublic = () => appUrl().startsWith("https://");

/** I5.2 / I5.3 / I5.7: per-workspace credentials, validated with the provider, stored encrypted, masked in the UI, audited. */
export const POST = api<{ provider: string }>("integrations.manage", async ({ req, ctx, params }) => {
  const provider = params.provider.toUpperCase();
  const actor = { id: ctx.membershipId, label: ctx.name };
  try {
    if (provider === "WHATSAPP") {
      const b = await body(req, z.object({ phoneNumberId: z.string().trim().regex(/^\d{6,}$/, "must be the numeric Phone number ID"), accessToken: z.string().trim().min(20), appSecret: z.string().trim().regex(/^[0-9a-f]{32}$/i, "must be the 32-character App secret") }));
      const old = await getIntegration<WhatsAppConfig>(ctx.workspaceId, "WHATSAPP");
      const cfg: WhatsAppConfig = { phoneNumberId: b.phoneNumberId, accessToken: b.accessToken, appSecret: b.appSecret, verifyToken: old?.config.verifyToken ?? randomToken(18) };
      const info = await whatsapp.check(cfg);
      cfg.displayNumber = info.display;
      await saveIntegration(db, ctx.workspaceId, "WHATSAPP", cfg, { number: `${info.display} (${info.name})`, phoneNumberId: cfg.phoneNumberId, accessToken: mask(cfg.accessToken), appSecret: mask(cfg.appSecret) });
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
    } else if (provider === "SLACK") {
      const b = await body(req, z.object({ botToken: z.string().trim().startsWith("xoxb-", "must be the Bot User OAuth Token (xoxb-…)") }));
      const me = await slack.check(b.botToken);
      await saveIntegration(db, ctx.workspaceId, "SLACK", { botToken: b.botToken, team: me.team }, { workspace: me.team, bot: me.bot, botToken: mask(b.botToken) });
    } else throw new HttpError(404, "Unknown integration.");
  } catch (e) {
    if (e instanceof ProviderError) {
      await recordEvent({ workspaceId: ctx.workspaceId, provider: provider as "WHATSAPP", direction: "OUT", kind: "connect", result: "ERROR", detail: e.message });
      throw new HttpError(400, `Couldn't connect: ${e.message}`);
    }
    throw e;
  }
  await recordEvent({ workspaceId: ctx.workspaceId, provider: provider as "WHATSAPP", direction: "OUT", kind: "connect", result: "OK" });
  await audit(db, ctx.workspaceId, actor, "integration.connected", { type: "integration", id: provider }, null, { provider });
  return { ok: true };
});

export const DELETE = api<{ provider: string }>("integrations.manage", async ({ ctx, params }) => {
  const provider = params.provider.toUpperCase() as "WHATSAPP" | "STRIPE" | "SLACK";
  if (!["WHATSAPP", "STRIPE", "SLACK"].includes(provider)) throw new HttpError(404, "Unknown integration.");
  const cur = await getIntegration(ctx.workspaceId, provider);
  if (cur && provider === "STRIPE") await stripeProvider.deleteWebhook(cur.config as unknown as StripeConfig);
  await saveIntegration(db, ctx.workspaceId, provider, null, {});
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "integration.disconnected", { type: "integration", id: provider }, { provider, connected: !!cur }, { connected: false });
  return { ok: true };
});
