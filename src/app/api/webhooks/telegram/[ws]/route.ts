import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getIntegration, recordEvent } from "@/server/integrations/registry";
import { telegram, TelegramConfig } from "@/server/integrations/telegram";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** I4.3: /start <token> links an employee's Telegram chat. Verified via secret_token header. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const integ = await getIntegration<TelegramConfig>(ws, "TELEGRAM");
  if (!integ) return new NextResponse("Not configured", { status: 404 });
  if (!same(req.headers.get("x-telegram-bot-api-secret-token") ?? "", integ.config.webhookSecret)) {
    await recordEvent({ workspaceId: ws, provider: "TELEGRAM", direction: "IN", kind: "update", result: "REJECTED", detail: "Bad secret token" });
    return new NextResponse("Forbidden", { status: 403 });
  }
  const u = (await req.json()) as { update_id: number; message?: { chat: { id: number }; text?: string; from?: { username?: string } } };
  const fresh = await recordEvent({ workspaceId: ws, provider: "TELEGRAM", direction: "IN", kind: "update", result: "OK", reference: String(u.update_id), dedupeKey: `tg:${ws}:${u.update_id}` });
  if (!fresh || !u.message?.text) return NextResponse.json({ ok: true });
  const m = u.message.text.match(/^\/start\s+(\S+)/);
  if (m) {
    const member = await db.query.memberships.findFirst({ where: eq(schema.memberships.telegramLinkToken, m[1]) });
    if (member && member.workspaceId === ws) {
      await db.update(schema.memberships).set({ telegramChatId: String(u.message.chat.id), telegramLinkToken: null }).where(eq(schema.memberships.id, member.id));
      await telegram.send(integ.config.botToken, String(u.message.chat.id), "✅ Linked! You'll get lead alerts here.").catch(() => {});
    } else {
      await telegram.send(integ.config.botToken, String(u.message.chat.id), "This link has expired. Generate a new one from your LeadLock profile.").catch(() => {});
    }
  }
  return NextResponse.json({ ok: true });
}
