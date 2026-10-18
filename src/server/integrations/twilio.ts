import twilio from "twilio";
import { ProviderError } from "./registry";

export type TwilioConfig = { accountSid: string; authToken: string; from: string };

export const toWhatsApp = (phone: string) => (phone.startsWith("whatsapp:") ? phone : `whatsapp:${phone}`);
export const fromWhatsApp = (addr: string) => addr.replace(/^whatsapp:/, "");

/** I1.2: Twilio signs the exact public URL + POST params with the auth token. */
export function verifyTwilio(cfg: TwilioConfig, signature: string | null, url: string, params: Record<string, string>) {
  if (!signature) return false;
  return twilio.validateRequest(cfg.authToken, signature, url, params);
}

export async function twilioCheck(cfg: TwilioConfig) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}.json`, {
    headers: { authorization: "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64") },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new ProviderError(`Twilio rejected these credentials (HTTP ${res.status}).`, false);
}

export async function twilioSend(cfg: TwilioConfig, to: string, body: string, statusCallback: string) {
  let res: Response;
  try {
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: "Basic " + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64"),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: toWhatsApp(cfg.from), To: toWhatsApp(to), Body: body, StatusCallback: statusCallback }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new ProviderError(`Twilio unreachable: ${(e as Error).message}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
  if (!res.ok) {
    throw new ProviderError(`Twilio ${res.status}${json.code ? ` (code ${json.code})` : ""}: ${json.message ?? "send failed"}`, res.status === 429 || res.status >= 500);
  }
  return { sid: json.sid!, status: json.status ?? "queued" };
}
