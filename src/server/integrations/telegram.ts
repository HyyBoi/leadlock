import { ProviderError } from "./registry";

export type TelegramConfig = { botToken: string; botUsername: string; webhookSecret: string };

async function call(token: string, method: string, payload: unknown) {
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new ProviderError(`Telegram unreachable: ${(e as Error).message}`, true);
  }
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
  if (!res.ok || !json.ok) {
    const temp = res.status === 429 || res.status >= 500;
    throw new ProviderError(`Telegram ${res.status}: ${json.description ?? "unknown error"}`, temp);
  }
  return json.result;
}

export const telegram = {
  getMe: (token: string) => call(token, "getMe", {}) as Promise<{ username: string }>,
  setWebhook: (token: string, url: string, secret: string) =>
    call(token, "setWebhook", { url, secret_token: secret, allowed_updates: ["message"] }),
  deleteWebhook: (token: string) => call(token, "deleteWebhook", {}),
  send: (token: string, chatId: string, text: string) =>
    call(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }),
};
