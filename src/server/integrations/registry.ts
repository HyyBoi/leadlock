import { and, eq } from "drizzle-orm";
import { db, schema, Tx } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";

export type ProviderName = "TWILIO" | "STRIPE" | "GOOGLE" | "TELEGRAM";

export const PROVIDER_INFO: Record<ProviderName, { title: string; purpose: string; can: string[]; cannot: string[] }> = {
  TWILIO: {
    title: "WhatsApp (Twilio Sandbox)",
    purpose: "Talk to customers and capture leads from incoming WhatsApp messages.",
    can: ["Receive messages and create leads/contacts", "Reply from the platform", "Track sent / delivered / read / failed"],
    cannot: [
      "Reach phones that have not joined the sandbox (send the join phrase first)",
      "Keep a phone joined for more than 3 days (rejoin after that)",
      "Send faster than 1 message every 3 seconds or use custom templates",
    ],
  },
  STRIPE: {
    title: "Payments (Stripe test mode)",
    purpose: "Collect payments for opportunities and see their status on the customer record.",
    can: ["Create hosted checkout links in any currency", "Confirm payments by signed webhook", "Show failed, expired and refunded outcomes"],
    cannot: [
      "Move real money: test mode only accepts Stripe test cards (4242 4242 4242 4242)",
      "Create links that expire sooner than 30 minutes (use 'Expire now' to end one early)",
      "See card numbers: card details are entered only on Stripe's hosted page",
    ],
  },
  GOOGLE: {
    title: "Calendar (Google Calendar)",
    purpose: "Book appointments on employees' real Google Calendars.",
    can: ["Each employee connects their own Google account", "Check busy times before booking", "Create, reschedule and cancel events"],
    cannot: [
      "Connect Google accounts that are not listed as test users while the Google app is in testing",
      "Keep a connection longer than 7 days while the Google app is in testing (reconnect after that)",
      "Book employees who have not connected a calendar",
    ],
  },
  TELEGRAM: {
    title: "Escalation alerts (Telegram bot)",
    purpose: "Alert employees outside the app when a lead is assigned or escalated to them.",
    can: ["Deliver alerts within seconds", "Route each alert to the employee's own Telegram chat", "Retry failed alerts automatically"],
    cannot: [
      "Message an employee who has not pressed Start on the bot (use 'Link Telegram' on your profile)",
      "Send more than about 30 messages per second",
    ],
  },
};

export async function getIntegration<T = Record<string, string>>(workspaceId: string, provider: ProviderName) {
  const row = await db.query.integrations.findFirst({
    where: and(eq(schema.integrations.workspaceId, workspaceId), eq(schema.integrations.provider, provider)),
  });
  if (!row || !row.configEnc || row.status === "NOT_CONNECTED") return null;
  return { row, config: JSON.parse(decrypt(row.configEnc)) as T };
}

export async function saveIntegration(
  tx: Tx | typeof db,
  workspaceId: string,
  provider: ProviderName,
  config: Record<string, string> | null,
  hints: Record<string, string>,
) {
  const values = {
    workspaceId,
    provider,
    status: (config ? "CONNECTED" : "NOT_CONNECTED") as "CONNECTED" | "NOT_CONNECTED",
    configEnc: config ? encrypt(JSON.stringify(config)) : null,
    hints,
    lastError: null,
    lastErrorAt: null,
    lastSuccessAt: config ? new Date() : null,
    updatedAt: new Date(),
  };
  await tx
    .insert(schema.integrations)
    .values(values)
    .onConflictDoUpdate({ target: [schema.integrations.workspaceId, schema.integrations.provider], set: values });
}

export async function markOk(workspaceId: string, provider: ProviderName) {
  await db
    .update(schema.integrations)
    .set({ lastSuccessAt: new Date(), status: "CONNECTED" })
    .where(and(eq(schema.integrations.workspaceId, workspaceId), eq(schema.integrations.provider, provider)));
}

export async function markError(workspaceId: string, provider: ProviderName, error: string, setErrorStatus = false) {
  await db
    .update(schema.integrations)
    .set({ lastErrorAt: new Date(), lastError: error.slice(0, 500), ...(setErrorStatus ? { status: "ERROR" as const } : {}) })
    .where(and(eq(schema.integrations.workspaceId, workspaceId), eq(schema.integrations.provider, provider)));
}

/** I5.4: every inbound event and outbound call lands here. Returns false if dedupeKey was already seen. */
export async function recordEvent(e: {
  workspaceId: string;
  provider: ProviderName;
  direction: "IN" | "OUT";
  kind: string;
  result: "OK" | "REJECTED" | "ERROR" | "DUPLICATE" | "RETRY" | "SKIPPED";
  reference?: string | null;
  detail?: string | null;
  dedupeKey?: string | null;
}) {
  const rows = await db
    .insert(schema.integrationEvents)
    .values({ ...e, detail: e.detail?.slice(0, 1000) ?? null })
    .onConflictDoNothing({ target: schema.integrationEvents.dedupeKey })
    .returning({ id: schema.integrationEvents.id });
  return rows.length > 0;
}

/** Workspace ids in webhook URLs must exist; never trust them beyond lookup. */
export async function workspaceExists(id: string) {
  return !!(await db.query.workspaces.findFirst({ where: eq(schema.workspaces.id, id), columns: { id: true } }));
}

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Classify provider HTTP failures: 429 and 5xx/network are temporary (retry), other 4xx are permanent. */
export class ProviderError extends Error {
  constructor(message: string, public temporary: boolean) {
    super(message);
  }
}
