import { eq } from "drizzle-orm";
import { api, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { randomToken } from "@/lib/crypto";
import { getIntegration } from "@/server/integrations/registry";
import { TelegramConfig } from "@/server/integrations/telegram";

/** I4.3: per-user routing. Generates a one-time deep link; pressing Start in Telegram links the chat. */
export const POST = api(null, async ({ ctx }) => {
  const t = await getIntegration<TelegramConfig>(ctx.workspaceId, "TELEGRAM");
  if (!t) throw new HttpError(409, "Telegram alerts are not connected for this workspace yet. Ask an admin to connect the bot on the Integrations page.");
  const token = randomToken(16);
  await db.update(schema.memberships).set({ telegramLinkToken: token }).where(eq(schema.memberships.id, ctx.membershipId));
  return { url: `https://t.me/${t.config.botUsername}?start=${token}` };
});

export const DELETE = api(null, async ({ ctx }) => {
  await db.update(schema.memberships).set({ telegramChatId: null, telegramLinkToken: null }).where(eq(schema.memberships.id, ctx.membershipId));
  return { ok: true };
});
