import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { appUrl, ProviderError, recordEvent } from "./registry";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];
export const googleRedirectUri = () => `${appUrl()}/api/integrations/google/callback`;
export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function googleAuthUrl(state: string) {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string; error_description?: string };
  if (!res.ok) throw new ProviderError(`Google: ${json.error_description ?? json.error ?? res.status}`, res.status >= 500 || res.status === 429);
  return json;
}

export async function exchangeCode(code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: googleRedirectUri() });
  let email: string | null = null;
  if (t.id_token) {
    try {
      email = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString()).email ?? null;
    } catch {}
  }
  return { access: t.access_token!, refresh: t.refresh_token ?? null, expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000), email };
}

export async function saveConnection(workspaceId: string, membershipId: string, tok: Awaited<ReturnType<typeof exchangeCode>>) {
  const existing = await db.query.calendarConnections.findFirst({ where: eq(schema.calendarConnections.membershipId, membershipId) });
  const values = {
    workspaceId,
    membershipId,
    googleEmail: tok.email,
    accessEnc: encrypt(tok.access),
    refreshEnc: tok.refresh ? encrypt(tok.refresh) : existing?.refreshEnc ?? null,
    expiresAt: tok.expiresAt,
    status: "CONNECTED",
    lastError: null,
    updatedAt: new Date(),
  };
  await db.insert(schema.calendarConnections).values(values).onConflictDoUpdate({ target: schema.calendarConnections.membershipId, set: values });
}

/** I3.2: refresh automatically; a revoked/expired grant flips the connection to NEEDS_RECONNECT. */
export async function accessToken(membershipId: string) {
  const c = await db.query.calendarConnections.findFirst({ where: eq(schema.calendarConnections.membershipId, membershipId) });
  if (!c) throw new ProviderError("This employee has not connected a Google Calendar.", false);
  if (c.status !== "CONNECTED") throw new ProviderError("Google Calendar connection needs to be reconnected.", false);
  if (c.expiresAt.getTime() - Date.now() > 60_000) return { token: decrypt(c.accessEnc), conn: c };
  if (!c.refreshEnc) {
    await db.update(schema.calendarConnections).set({ status: "NEEDS_RECONNECT", lastError: "No refresh token" }).where(eq(schema.calendarConnections.id, c.id));
    throw new ProviderError("Google Calendar connection expired. Please reconnect.", false);
  }
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(c.refreshEnc) });
    await db
      .update(schema.calendarConnections)
      .set({ accessEnc: encrypt(t.access_token!), expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000), updatedAt: new Date() })
      .where(eq(schema.calendarConnections.id, c.id));
    await recordEvent({ workspaceId: c.workspaceId, provider: "GOOGLE", direction: "OUT", kind: "token.refresh", result: "OK", reference: c.googleEmail });
    return { token: t.access_token!, conn: c };
  } catch (e) {
    const err = e as ProviderError;
    if (!err.temporary) {
      await db.update(schema.calendarConnections).set({ status: "NEEDS_RECONNECT", lastError: err.message }).where(eq(schema.calendarConnections.id, c.id));
    }
    await recordEvent({ workspaceId: c.workspaceId, provider: "GOOGLE", direction: "OUT", kind: "token.refresh", result: "ERROR", reference: c.googleEmail, detail: err.message });
    throw e;
  }
}

async function gcal(membershipId: string, method: string, path: string, body?: unknown) {
  const { token, conn } = await accessToken(membershipId);
  let res: Response;
  try {
    res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    await recordEvent({ workspaceId: conn.workspaceId, provider: "GOOGLE", direction: "OUT", kind: `${method} ${path.split("?")[0]}`, result: "ERROR", detail: (e as Error).message });
    throw new ProviderError("Google Calendar is unreachable right now. Try again in a moment.", true);
  }
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  const ok = res.ok || (method === "DELETE" && res.status === 410);
  await recordEvent({ workspaceId: conn.workspaceId, provider: "GOOGLE", direction: "OUT", kind: `${method} ${path.split("?")[0]}`, result: ok ? "OK" : "ERROR", reference: conn.googleEmail, detail: ok ? null : JSON.stringify(json).slice(0, 300) });
  if (res.status === 401) {
    await db.update(schema.calendarConnections).set({ status: "NEEDS_RECONNECT", lastError: "Google rejected the token" }).where(eq(schema.calendarConnections.id, conn.id));
    throw new ProviderError("Google rejected the calendar token. Please reconnect your calendar.", false);
  }
  if (!ok) throw new ProviderError(`Google Calendar error ${res.status}: ${(json as { error?: { message?: string } }).error?.message ?? "request failed"}`, res.status >= 500 || res.status === 429);
  return json as Record<string, unknown>;
}

export const calendar = {
  async busy(membershipId: string, start: Date, end: Date) {
    const r = (await gcal(membershipId, "POST", "/freeBusy", { timeMin: start.toISOString(), timeMax: end.toISOString(), items: [{ id: "primary" }] })) as {
      calendars?: { primary?: { busy?: { start: string; end: string }[] } };
    };
    return r.calendars?.primary?.busy ?? [];
  },
  async create(membershipId: string, e: { title: string; description: string; start: Date; end: Date; timezone: string; attendeeEmail?: string | null }) {
    const r = await gcal(membershipId, "POST", "/calendars/primary/events", {
      summary: e.title,
      description: e.description,
      start: { dateTime: e.start.toISOString(), timeZone: e.timezone },
      end: { dateTime: e.end.toISOString(), timeZone: e.timezone },
    });
    return r.id as string;
  },
  update: (membershipId: string, eventId: string, start: Date, end: Date, timezone: string) =>
    gcal(membershipId, "PATCH", `/calendars/primary/events/${encodeURIComponent(eventId)}`, {
      start: { dateTime: start.toISOString(), timeZone: timezone },
      end: { dateTime: end.toISOString(), timeZone: timezone },
    }),
  cancel: (membershipId: string, eventId: string) => gcal(membershipId, "DELETE", `/calendars/primary/events/${encodeURIComponent(eventId)}`),
  async revoke(membershipId: string) {
    const c = await db.query.calendarConnections.findFirst({ where: eq(schema.calendarConnections.membershipId, membershipId) });
    if (!c) return;
    const tok = c.refreshEnc ? decrypt(c.refreshEnc) : decrypt(c.accessEnc);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: "POST" }).catch(() => {});
    await db.delete(schema.calendarConnections).where(eq(schema.calendarConnections.id, c.id));
  },
};
