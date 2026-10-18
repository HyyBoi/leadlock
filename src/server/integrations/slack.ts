import { ProviderError } from "./registry";

/** I4 notifications adapter: Slack bot DMs (chat:write, im:write, users:read, users:read.email). */
export type SlackConfig = { botToken: string; team: string };

async function call(token: string, method: string, params: Record<string, unknown>, get = false) {
  let res: Response;
  try {
    const url = `https://slack.com/api/${method}${get ? "?" + new URLSearchParams(params as Record<string, string>) : ""}`;
    res = await fetch(url, {
      method: get ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, ...(get ? {} : { "content-type": "application/json; charset=utf-8" }) },
      body: get ? undefined : JSON.stringify(params),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new ProviderError(`Slack unreachable: ${(e as Error).message}`, true);
  }
  if (res.status === 429) throw new ProviderError(`Slack rate limit (retry after ${res.headers.get("retry-after") ?? "?"}s)`, true);
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; [k: string]: unknown };
  if (!res.ok || !json.ok) {
    const err = json.error ?? `HTTP ${res.status}`;
    const hint: Record<string, string> = {
      invalid_auth: "the bot token is invalid",
      not_authed: "no bot token",
      account_inactive: "the Slack app was uninstalled",
      users_not_found: "no Slack user with that email in this workspace",
      missing_scope: "the Slack app is missing a scope (needs chat:write, im:write, users:read, users:read.email) — reinstall it",
      channel_not_found: "the employee's Slack user could not be reached",
    };
    throw new ProviderError(`Slack: ${hint[err] ?? err}`, res.status >= 500 || err === "ratelimited" || err === "internal_error" || err === "fatal_error");
  }
  return json;
}

export const slack = {
  async check(token: string) {
    const r = (await call(token, "auth.test", {})) as { team?: string; user?: string };
    return { team: r.team ?? "", bot: r.user ?? "" };
  },
  async lookupByEmail(token: string, email: string) {
    const r = (await call(token, "users.lookupByEmail", { email }, true)) as { user?: { id: string; real_name?: string } };
    return { id: r.user!.id, name: r.user?.real_name ?? email };
  },
  async dm(token: string, userId: string, text: string, url?: string) {
    await call(token, "chat.postMessage", {
      channel: userId,
      text,
      unfurl_links: false,
      ...(url
        ? { blocks: [{ type: "section", text: { type: "mrkdwn", text } }, { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open lead" }, url, style: "primary" }] }] }
        : {}),
    });
  },
};
