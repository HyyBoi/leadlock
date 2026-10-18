import { createHmac, timingSafeEqual } from "crypto";
import { ProviderError } from "./registry";

/**
 * Messaging adapter: official WhatsApp Cloud API (Meta) in test mode.
 * Twilio's WhatsApp sandbox is unavailable in Pakistan; this keeps the same contract
 * (inbound webhook, signature check, send, delivery statuses) behind one module (Q14).
 */
export type WhatsAppConfig = { phoneNumberId: string; accessToken: string; appSecret: string; verifyToken: string; displayNumber?: string };

const GRAPH = "https://graph.facebook.com/v21.0";

/** E.164 "+923001234567" <-> WhatsApp "923001234567". */
export const toWa = (phone: string) => phone.replace(/[^\d]/g, "");
export const fromWa = (wa: string) => `+${wa.replace(/[^\d]/g, "")}`;

/** I1.2: Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>. */
export function verifyMeta(appSecret: string, rawBody: string, header: string | null) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

const FRIENDLY: Record<number, string> = {
  131030: "This phone number is not on the test recipient list. Add it in Meta → WhatsApp → API Setup → 'To' → Manage phone number list.",
  131047: "More than 24 hours have passed since the customer last messaged. WhatsApp only allows free-form replies within 24h; ask the customer to message again.",
  131026: "The message could not be delivered (the number may not be on WhatsApp).",
  190: "The WhatsApp access token expired or is invalid. Generate a new token in Meta → WhatsApp → API Setup and update it on the Integrations page.",
  131056: "Too many messages to this customer in a short time. It will be retried.",
  130429: "WhatsApp rate limit reached. It will be retried.",
};
export const explainWaError = (code?: number, fallback?: string) => (code && FRIENDLY[code]) || fallback || "WhatsApp could not deliver the message.";

async function graph(cfg: WhatsAppConfig, method: string, path: string, body?: unknown) {
  let res: Response;
  try {
    res = await fetch(`${GRAPH}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.accessToken}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new ProviderError(`WhatsApp (Meta) unreachable: ${(e as Error).message}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number }; [k: string]: unknown };
  if (!res.ok || json.error) {
    const code = json.error?.code;
    const temporary = res.status >= 500 || res.status === 429 || code === 130429 || code === 131056 || code === 1 || code === 2;
    throw new ProviderError(`${code ? `(${code}) ` : ""}${explainWaError(code, json.error?.message)}`, temporary);
  }
  return json;
}

export const whatsapp = {
  /** Validate credentials when connecting; returns the display number. */
  async check(cfg: WhatsAppConfig) {
    const r = (await graph(cfg, "GET", `/${encodeURIComponent(cfg.phoneNumberId)}?fields=display_phone_number,verified_name`)) as { display_phone_number?: string; verified_name?: string };
    return { display: r.display_phone_number ?? "", name: r.verified_name ?? "" };
  },
  async send(cfg: WhatsAppConfig, toPhone: string, text: string) {
    const r = (await graph(cfg, "POST", `/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWa(toPhone),
      type: "text",
      text: { preview_url: true, body: text },
    })) as { messages?: { id: string }[] };
    return { sid: r.messages?.[0]?.id ?? "" };
  },
};

/** Shape of the parts of Meta's webhook payload we use. */
export type MetaWebhook = {
  object?: string;
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: { id: string; from: string; type: string; timestamp?: string; text?: { body: string }; button?: { text?: string }; interactive?: unknown }[];
        statuses?: { id: string; status: string; recipient_id?: string; errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] }[];
      };
    }[];
  }[];
};
