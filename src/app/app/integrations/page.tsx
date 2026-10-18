import { Fragment } from "react";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { ApiForm, ActionButton, Card } from "@/components/ui";
import { PROVIDER_INFO, ProviderName, appUrl, getIntegration } from "@/server/integrations/registry";
import { WhatsAppConfig } from "@/server/integrations/whatsapp";
import { googleConfigured, googleRedirectUri } from "@/server/integrations/google";
import { fmt, ago } from "@/lib/time";

const STATUS: Record<string, string> = { CONNECTED: "badge badge-ok", ERROR: "badge badge-danger", NOT_CONNECTED: "badge" };

/** I5.1 central integrations page: status, last success, recent errors, limits, sync history. */
export default async function Integrations({ searchParams }: { searchParams: Promise<{ provider?: string; result?: string }> }) {
  const ctx = await requirePage("integrations.manage");
  const sp = await searchParams;
  const rows = await db.query.integrations.findMany({ where: eq(schema.integrations.workspaceId, ctx.workspaceId) });
  const conns = await db.query.calendarConnections.findMany({ where: eq(schema.calendarConnections.workspaceId, ctx.workspaceId) });
  const members = await membersOf(ctx.workspaceId);
  const events = await db.query.integrationEvents.findMany({
    where: and(eq(schema.integrationEvents.workspaceId, ctx.workspaceId), sp.provider ? eq(schema.integrationEvents.provider, sp.provider as ProviderName) : undefined, sp.result ? eq(schema.integrationEvents.result, sp.result) : undefined),
    orderBy: desc(schema.integrationEvents.createdAt), limit: 100,
  });
  const errorsFor = (p: string) => events.filter((e) => e.provider === p && ["ERROR", "REJECTED"].includes(e.result)).slice(0, 3);
  const wa = await getIntegration<WhatsAppConfig>(ctx.workspaceId, "WHATSAPP");
  const waVerify = wa?.config.verifyToken;
  const failedAlerts = await db.query.outbox.findMany({ where: and(eq(schema.outbox.workspaceId, ctx.workspaceId), eq(schema.outbox.status, "FAILED")), orderBy: desc(schema.outbox.createdAt), limit: 10 });
  const forms: Record<string, React.ReactNode> = {
    WHATSAPP: <ApiForm action="/api/integrations/whatsapp" submitLabel="Connect / update" success="WhatsApp connected. Now set the webhook in Meta (steps above)." fields={[
      { name: "phoneNumberId", label: "Phone number ID (Meta → WhatsApp → API Setup)", required: true },
      { name: "accessToken", label: "Access token", type: "password", required: true },
      { name: "appSecret", label: "App secret (App settings → Basic)", type: "password", required: true },
    ]} />,
    STRIPE: <ApiForm action="/api/integrations/stripe" submitLabel="Connect / update" success="Stripe connected — webhook endpoint created automatically." fields={[
      { name: "secretKey", label: "Secret key (test mode)", type: "password", required: true, placeholder: "sk_test_…" },
      ...(appUrl().startsWith("https://") ? [] : [{ name: "webhookSecret", label: "Webhook signing secret (local only)", type: "password" as const, placeholder: "whsec_… from stripe listen" }]),
    ]} />,
    SLACK: <ApiForm action="/api/integrations/slack" submitLabel="Connect / update" success="Slack connected. Each employee now links their Slack email on My profile." fields={[
      { name: "botToken", label: "Bot User OAuth Token (xoxb-…)", type: "password", required: true },
    ]} />,
  };
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Integrations</h1>
      <p className="text-sm text-[var(--muted)]">Credentials belong to this workspace only, are stored encrypted on the server and are never shown in full. If one provider is down, everything else keeps working.</p>
      <div className="grid gap-4 xl:grid-cols-2">
        {(["WHATSAPP", "STRIPE", "SLACK"] as const).map((p) => {
          const r = rows.find((x) => x.provider === p);
          const info = PROVIDER_INFO[p];
          return (
            <Card key={p} title={info.title} actions={<span className={STATUS[r?.status ?? "NOT_CONNECTED"]}>{(r?.status ?? "NOT_CONNECTED").replace("_", " ").toLowerCase()}</span>}>
              <p className="text-sm">{info.purpose}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-[var(--muted)]">Last worked</dt><dd>{r?.lastSuccessAt ? `${fmt(r.lastSuccessAt, ctx.timezone)} (${ago(r.lastSuccessAt)})` : "never"}</dd>
                {Object.entries(r?.hints ?? {}).map(([k, v]) => <Fragment key={k}><dt className="text-[var(--muted)]">{k}</dt><dd><code>{v}</code></dd></Fragment>)}
                {p === "WHATSAPP" && <><dt className="text-[var(--muted)]">Callback URL</dt><dd className="break-all"><code>{appUrl()}/api/webhooks/whatsapp/{ctx.workspaceId}</code></dd>{waVerify && <><dt className="text-[var(--muted)]">Verify token</dt><dd className="break-all"><code>{waVerify}</code></dd></>}</>}
              </dl>
              {p === "WHATSAPP" && <p className="mt-1 text-xs text-[var(--muted)]">After connecting: Meta app → WhatsApp → Configuration → Webhook → Edit → paste the Callback URL and Verify token → Verify and save → Webhook fields → Subscribe to <strong>messages</strong>.</p>}
              {errorsFor(p).length > 0 && <div className="mt-2 grid gap-1"><p className="text-sm font-medium text-[var(--danger)]">Recent errors</p>{errorsFor(p).map((e) => <p key={e.id} className="text-xs text-[var(--danger)]">{ago(e.createdAt)} · {e.kind}: {e.detail}</p>)}</div>}
              <details className="mt-2"><summary className="cursor-pointer text-sm link">What it can and can&apos;t do</summary>
                <ul className="mt-1 list-disc pl-5 text-sm">{info.can.map((c) => <li key={c}>✓ {c}</li>)}{info.cannot.map((c) => <li key={c}>✗ {c}</li>)}</ul>
              </details>
              <details className="mt-2"><summary className="cursor-pointer text-sm link">{r?.status === "CONNECTED" ? "Update credentials" : "Connect"}</summary><div className="mt-2">{forms[p]}</div></details>
              {r?.status !== "NOT_CONNECTED" && r && <div className="mt-2"><ActionButton url={`/api/integrations/${p.toLowerCase()}`} method="DELETE" variant="danger" label="Disconnect" confirm={`Disconnect ${info.title}?`} /></div>}
            </Card>
          );
        })}
        <Card title={PROVIDER_INFO.GOOGLE.title} actions={<span className={googleConfigured() ? "badge badge-ok" : "badge badge-danger"}>{googleConfigured() ? "app configured" : "not configured"}</span>}>
          <p className="text-sm">{PROVIDER_INFO.GOOGLE.purpose} Each employee connects their own account from <strong>My profile</strong>.</p>
          <p className="mt-1 text-xs text-[var(--muted)]">OAuth redirect URI to register in Google Cloud: <code className="break-all">{googleRedirectUri()}</code></p>
          <ul className="mt-2 grid gap-1 text-sm">{members.filter((m) => m.active).map((m) => { const c = conns.find((x) => x.membershipId === m.id); return <li key={m.id}>{m.name}: {c ? (c.status === "CONNECTED" ? <span className="badge badge-ok">✓ {c.googleEmail}</span> : <span className="badge badge-danger">needs reconnect: {c.lastError}</span>) : <span className="badge">not connected</span>}</li>; })}</ul>
          {errorsFor("GOOGLE").map((e) => <p key={e.id} className="text-xs text-[var(--danger)]">{ago(e.createdAt)} · {e.kind}: {e.detail}</p>)}
          <details className="mt-2"><summary className="cursor-pointer text-sm link">What it can and can&apos;t do</summary><ul className="mt-1 list-disc pl-5 text-sm">{PROVIDER_INFO.GOOGLE.can.map((c) => <li key={c}>✓ {c}</li>)}{PROVIDER_INFO.GOOGLE.cannot.map((c) => <li key={c}>✗ {c}</li>)}</ul></details>
        </Card>
      </div>
      {failedAlerts.length > 0 && (
        <Card title="Failed alerts & sends (visible to admins)">
          <ul className="grid gap-1 text-sm">{failedAlerts.map((f) => <li key={f.id}><span className="badge badge-danger">{f.kind.toLowerCase()}</span> after {f.attempts} attempt(s): {f.lastError} <span className="text-xs text-[var(--muted)]">{ago(f.createdAt)}</span></li>)}</ul>
        </Card>
      )}
      <Card title="Synchronization history" actions={<form className="flex flex-wrap gap-2" method="get">
        <select name="provider" defaultValue={sp.provider ?? ""} className="input w-auto" aria-label="Provider"><option value="">All providers</option>{["WHATSAPP", "STRIPE", "GOOGLE", "SLACK"].map((p) => <option key={p}>{p}</option>)}</select>
        <select name="result" defaultValue={sp.result ?? ""} className="input w-auto" aria-label="Result"><option value="">All results</option>{["OK", "ERROR", "REJECTED", "DUPLICATE", "RETRY"].map((p) => <option key={p}>{p}</option>)}</select>
        <button className="btn btn-ghost">Filter</button></form>}>
        <div className="scroll-x">
          <table className="table">
            <thead><tr><th>Time</th><th>Provider</th><th>Direction</th><th>Event</th><th>Result</th><th>Reference / detail</th></tr></thead>
            <tbody>{events.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-sm">{fmt(e.createdAt, ctx.timezone)}</td><td>{e.provider}</td><td>{e.direction === "IN" ? "⬇ inbound" : "⬆ outbound"}</td><td className="text-sm">{e.kind}</td>
                <td><span className={e.result === "OK" ? "badge badge-ok" : e.result === "DUPLICATE" || e.result === "RETRY" ? "badge badge-warn" : "badge badge-danger"}>{e.result}</span></td>
                <td className="text-xs break-all"><code>{e.reference}</code> {e.detail}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
