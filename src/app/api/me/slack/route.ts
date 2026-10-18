import { z } from "zod";
import { eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { getIntegration, ProviderError, recordEvent } from "@/server/integrations/registry";
import { slack, SlackConfig } from "@/server/integrations/slack";

/** I4.3: each employee routes alerts to their own Slack user (looked up by email) and gets a test DM. */
export const POST = api(null, async ({ req, ctx }) => {
  const b = await body(req, z.object({ email: z.string().trim().toLowerCase().email() }));
  const s = await getIntegration<SlackConfig>(ctx.workspaceId, "SLACK");
  if (!s) throw new HttpError(409, "Slack alerts are not connected for this workspace yet. Ask an admin to connect Slack on the Integrations page.");
  try {
    const u = await slack.lookupByEmail(s.config.botToken, b.email);
    await slack.dm(s.config.botToken, u.id, `✅ LeadLock alerts are now linked to you, ${ctx.name}. Lead assignments and escalations will arrive here.`);
    await db.update(schema.memberships).set({ slackUserId: u.id, slackEmail: b.email }).where(eq(schema.memberships.id, ctx.membershipId));
    await recordEvent({ workspaceId: ctx.workspaceId, provider: "SLACK", direction: "OUT", kind: "user.link", result: "OK", reference: u.id });
    return { ok: true };
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError(400, `${e.message}. Use the email of your account in the "${s.config.team}" Slack workspace.`);
    throw e;
  }
});

export const DELETE = api(null, async ({ ctx }) => {
  await db.update(schema.memberships).set({ slackUserId: null, slackEmail: null }).where(eq(schema.memberships.id, ctx.membershipId));
  return { ok: true };
});
