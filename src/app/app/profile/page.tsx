import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, AVAIL_LABEL } from "@/lib/page";
import { ApiForm, ActionButton, Card } from "@/components/ui";
import { googleConfigured } from "@/server/integrations/google";

export default async function Profile({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const ctx = await requirePage();
  const sp = await searchParams;
  const me = (await db.query.memberships.findFirst({ where: eq(schema.memberships.id, ctx.membershipId) }))!;
  const cal = await db.query.calendarConnections.findFirst({ where: eq(schema.calendarConnections.membershipId, me.id) });
  return (
    <div className="grid max-w-2xl gap-4">
      <h1 className="text-2xl font-bold">My profile</h1>
      {sp.error && <p role="alert" className="rounded-md bg-[var(--danger-bg)] p-2 text-sm text-[var(--danger)]">Calendar connection failed: {sp.error === "google_not_configured" ? "Google OAuth isn't configured on the server yet (GOOGLE_CLIENT_ID / SECRET)." : sp.error}</p>}
      {sp.connected && <p role="status" className="rounded-md bg-[var(--ok-bg)] p-2 text-sm text-[var(--ok)]">Google Calendar connected ✓</p>}
      <Card title="My availability">
        <p className="mb-2 text-sm">Currently: <strong>{AVAIL_LABEL[me.availability]}</strong>. Only “Available” employees receive new leads. Going On leave / Offline immediately hands your unacknowledged leads to a colleague.</p>
        <ApiForm action={`/api/members/${me.id}/availability`} inline submitLabel="Update" success="Availability updated." fields={[{ name: "status", label: "Status", type: "select", required: true, defaultValue: me.availability, options: Object.entries(AVAIL_LABEL).map(([value, label]) => ({ value, label })) }]} />
      </Card>
      <Card title="Time zone">
        <ApiForm action="/api/me/profile" method="PUT" inline submitLabel="Save" success="Time zone saved." fields={[{ name: "timezone", label: "IANA time zone", required: true, defaultValue: me.timezone, help: "e.g. Asia/Karachi, Europe/London, America/New_York" }]} />
      </Card>
      <Card title="Google Calendar">
        {cal ? (
          <div className="grid gap-2 text-sm">
            <p>{cal.status === "CONNECTED" ? <span className="badge badge-ok">✓ Connected</span> : <span className="badge badge-danger">Needs reconnecting</span>} {cal.googleEmail}</p>
            {cal.lastError && <p className="text-[var(--danger)]">{cal.lastError}</p>}
            <div className="flex gap-2">{cal.status !== "CONNECTED" && <a className="btn btn-primary" href="/api/integrations/google/connect">Reconnect</a>}<ActionButton url="/api/integrations/google/disconnect" label="Disconnect" variant="danger" confirm="Disconnect your calendar? You won't be bookable until you reconnect." /></div>
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <p>Not connected — customers can&apos;t be booked with you until you connect.</p>
            {googleConfigured() ? <a className="btn btn-primary w-fit" href="/api/integrations/google/connect">Connect Google Calendar</a> : <p className="text-[var(--muted)]">Google OAuth is not configured on the server yet.</p>}
          </div>
        )}
      </Card>
      <Card title="Slack alerts">
        <p className="mb-2 text-sm">{me.slackUserId ? `✅ Linked to ${me.slackEmail}. Lead assignments and escalations are sent to you as a Slack DM.` : "Not linked. Enter the email you use in the team's Slack workspace — you'll get a test DM."}</p>
        <ApiForm action="/api/me/slack" inline submitLabel={me.slackUserId ? "Re-link" : "Link Slack"} success="Linked — check Slack for a test message." fields={[{ name: "email", label: "Slack email", type: "email", required: true, defaultValue: me.slackEmail ?? "" }]} />
        {me.slackUserId && <div className="mt-2"><ActionButton url="/api/me/slack" method="DELETE" label="Unlink" /></div>}
      </Card>
    </div>
  );
}
