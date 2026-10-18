import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf, AVAIL_LABEL, SOURCE_LABEL } from "@/lib/page";
import { fieldsFor, money, serializeOpp } from "@/server/crm";
import { canSeeContact } from "@/server/visibility";
import { ActionButton, ApiForm, Card, StageSelect, Countdown } from "@/components/ui";
import { customFieldSpecs } from "@/components/fieldspec";
import { statusBadge } from "@/components/LeadRow";
import { fmt } from "@/lib/time";
import { PROVIDER_INFO } from "@/server/integrations/registry";

const MSG_BADGE: Record<string, string> = { QUEUED: "badge", SENT: "badge badge-info", DELIVERED: "badge badge-ok", READ: "badge badge-ok", FAILED: "badge badge-danger", RECEIVED: "badge" };
const PAY_BADGE: Record<string, string> = { PENDING: "badge badge-warn", PAID: "badge badge-ok", FAILED: "badge badge-danger", EXPIRED: "badge", REFUNDED: "badge badge-info", PARTIALLY_REFUNDED: "badge badge-info" };

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("crm.view");
  const { id } = await params;
  const c = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, id), eq(schema.contacts.workspaceId, ctx.workspaceId)) });
  if (!c) notFound();
  const tz = ctx.timezone;
  const [members, cdefs, companies, pipelines, allStages, opps, leads, conv, pays, appts, acts, conns] = await Promise.all([
    membersOf(ctx.workspaceId),
    fieldsFor(ctx.workspaceId, "CONTACT"),
    db.query.companies.findMany({ where: eq(schema.companies.workspaceId, ctx.workspaceId) }),
    db.query.pipelines.findMany({ where: eq(schema.pipelines.workspaceId, ctx.workspaceId), orderBy: asc(schema.pipelines.position) }),
    db.query.stages.findMany({ where: eq(schema.stages.workspaceId, ctx.workspaceId), orderBy: asc(schema.stages.position) }),
    db.query.opportunities.findMany({ where: eq(schema.opportunities.contactId, c.id), orderBy: desc(schema.opportunities.createdAt) }),
    db.query.leads.findMany({ where: eq(schema.leads.contactId, c.id), orderBy: desc(schema.leads.createdAt) }),
    db.query.conversations.findFirst({ where: eq(schema.conversations.contactId, c.id) }),
    db.query.payments.findMany({ where: eq(schema.payments.contactId, c.id), orderBy: desc(schema.payments.createdAt) }),
    db.query.appointments.findMany({ where: eq(schema.appointments.contactId, c.id), orderBy: desc(schema.appointments.startAt) }),
    db.query.activities.findMany({ where: eq(schema.activities.contactId, c.id), orderBy: desc(schema.activities.createdAt), limit: 100 }),
    db.query.calendarConnections.findMany({ where: eq(schema.calendarConnections.workspaceId, ctx.workspaceId) }),
  ]);
  const oppDefs = await db.query.fieldDefs.findMany({ where: and(eq(schema.fieldDefs.workspaceId, ctx.workspaceId), eq(schema.fieldDefs.entity, "OPPORTUNITY")), orderBy: asc(schema.fieldDefs.position) });
  const msgs = conv ? await db.query.messages.findMany({ where: eq(schema.messages.conversationId, conv.id), orderBy: asc(schema.messages.createdAt) }) : [];
  const seeConv = canSeeContact(ctx, c);
  const owner = members.find((m) => m.id === c.ownerId);
  const canEdit = ctx.perms.has("crm.edit");
  const name = (mid: string | null) => members.find((m) => m.id === mid)?.name ?? "—";
  const connected = new Map(conns.map((x) => [x.membershipId, x]));
  const collected = pays.filter((p) => p.paidAt).reduce((s, p) => s + p.amount - p.refundedAmount, 0);

  return (
    <div className="grid gap-4">
      <header className="grid gap-2">
        <p className="text-sm"><Link className="link" href="/app/contacts">← Contacts</Link></p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{c.name}</h1>
          {c.tags.map((t) => <span key={t} className="badge">{t}</span>)}
          {c.optedOut && <span className="badge badge-danger">Opted out of messages</span>}
        </div>
        <p className="text-sm">{c.phone} {c.email && `· ${c.email}`} · Assigned employee: <strong>{owner?.name ?? "—"}</strong> {owner && AVAIL_LABEL[owner.availability]}</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="grid min-w-0 gap-4">
          {leads.length > 0 && (
            <Card title="Leads">
              <ul className="grid gap-2">{leads.map((l) => <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm"><Link className="link" href={`/app/leads/${l.id}`}>{SOURCE_LABEL[l.source]} lead</Link>{statusBadge(l)}{l.status === "OPEN" && <Countdown deadline={l.deadlineAt?.toISOString() ?? null} />}<span>owner: {name(l.ownerId)}</span>{l.status === "OPEN" && l.ownerId === ctx.membershipId && <ActionButton url={`/api/leads/${l.id}/ack`} label="Acknowledge" variant="primary" />}</li>)}</ul>
            </Card>
          )}

          <Card title="Opportunities" id="opportunities">
            <div className="grid gap-4">
              {opps.map((raw) => {
                const o = serializeOpp(raw, ctx);
                const st = allStages.filter((s) => s.pipelineId === o.pipelineId);
                const stage = st.find((s) => s.id === o.stageId)!;
                const defs = oppDefs.filter((d) => d.pipelineId === o.pipelineId);
                const pl = pipelines.find((p) => p.id === o.pipelineId);
                const oPays = pays.filter((p) => p.opportunityId === o.id);
                return (
                  <article key={o.id} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold">{o.title}</h3>
                        <p className="text-sm text-[var(--muted)]">{pl?.name} pipeline · owner {name(o.ownerId)} · value {o.valueHidden ? <span className="badge" title="You don't have permission to see values">•••• hidden</span> : money(o.value, o.currency)}</p>
                        {stage.requiredFields.length > 0 && <p className="text-xs text-[var(--muted)]">“{stage.name}” requires: {stage.requiredFields.join(", ")}</p>}
                      </div>
                      {canEdit && <div className="w-48"><StageSelect oppId={o.id} version={o.version} stageId={o.stageId} stages={st} /></div>}
                    </div>
                    {canEdit && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm link">Edit details & {pl?.name} fields</summary>
                        <div className="mt-2">
                          <ApiForm action={`/api/opportunities/${o.id}`} method="PATCH" submitLabel="Save opportunity" extra={{ version: o.version }} className="grid gap-3 sm:grid-cols-2" fields={[
                            { name: "title", label: "Title", defaultValue: o.title, required: true },
                            ...(o.valueHidden ? [] : [{ name: "value", label: `Value (${o.currency.toUpperCase()})`, type: "number" as const, step: "0.01", defaultValue: o.value / 100 }]),
                            ...customFieldSpecs(defs, o.customValues),
                          ]} />
                        </div>
                      </details>
                    )}
                    <div className="mt-3 grid gap-2">
                      <h4 className="text-sm font-semibold">Payments for this opportunity</h4>
                      {oPays.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className={PAY_BADGE[p.status]}>{p.status.replace("_", " ")}</span>
                          <span>{money(p.amount, p.currency)}{p.refundedAmount > 0 && ` (refunded ${money(p.refundedAmount, p.currency)})`}</span>
                          <span className="text-[var(--muted)]">requested by {name(p.requestedById)} · {fmt(p.createdAt, tz)} · ref {p.providerRef?.slice(0, 18) ?? "—"}…</span>
                          {p.lastError && <span className="text-[var(--danger)]">{p.lastError}</span>}
                          {p.url && p.status === "PENDING" && <a className="link" href={p.url} target="_blank" rel="noreferrer">Payment link</a>}
                          {(p.status === "PENDING" || p.status === "FAILED") && p.providerRef && ctx.perms.has("payments.create") && <ActionButton url={`/api/payments/${p.id}/expire`} label="Expire now" confirm="End this payment link now?" success="Expiry requested — status updates when Stripe confirms." />}
                        </div>
                      ))}
                      {ctx.perms.has("payments.create") && (
                        <ApiForm action="/api/payments" inline submitLabel="Create payment link" success="Payment link created." extra={{ opportunityId: o.id }} resultKeys={[{ key: "payment.url", label: "Link", link: true }, { key: "sent", label: "WhatsApp" }]} fields={[
                          { name: "amount", label: "Amount", type: "number", step: "0.01", required: true, defaultValue: o.valueHidden || !o.value ? "" : o.value / 100 },
                          { name: "currency", label: "Currency", type: "select", required: true, defaultValue: o.currency, options: ["usd", "eur", "gbp", "pkr", "aed"].map((x) => ({ value: x, label: x.toUpperCase() })) },
                          { name: "sendWhatsApp", label: "Send link on WhatsApp", type: "checkbox", defaultValue: !c.optedOut && !!c.phone },
                        ]} />
                      )}
                    </div>
                    {ctx.perms.has("crm.delete") && <div className="mt-2"><ActionButton url={`/api/opportunities/${o.id}`} method="DELETE" variant="danger" label="Delete opportunity" confirm={`Delete "${o.title}" and its payments history?`} /></div>}
                  </article>
                );
              })}
              {ctx.perms.has("crm.create") && (
                <details>
                  <summary className="cursor-pointer text-sm link">+ New opportunity</summary>
                  <ApiForm action="/api/opportunities" submitLabel="Create opportunity" extra={{ contactId: c.id }} className="mt-2 grid gap-3 sm:grid-cols-2" fields={[
                    { name: "title", label: "Title", required: true },
                    { name: "pipelineId", label: "Pipeline", type: "select", required: true, options: pipelines.map((p) => ({ value: p.id, label: p.name })) },
                    ...(ctx.perms.has("crm.view_value") ? [{ name: "value", label: "Value", type: "number" as const, step: "0.01" }] : []),
                  ]} />
                </details>
              )}
            </div>
          </Card>

          <Card title="WhatsApp conversation" id="conversation">
            {!seeConv ? <p className="text-sm">This conversation belongs to {owner?.name}. You need the “see every lead and conversation” permission to view it.</p> : (
              <div className="grid gap-3">
                <p className="text-xs text-[var(--muted)]">Assigned employee: {owner?.name ?? "—"} · {PROVIDER_INFO.WHATSAPP.cannot[0]}.</p>
                <ol className="grid max-h-[420px] gap-2 overflow-y-auto" aria-label="Messages">
                  {msgs.map((m) => (
                    <li key={m.id} className={`max-w-[85%] rounded-lg p-2 text-sm ${m.direction === "IN" ? "bg-[var(--bg)]" : "ml-auto bg-[var(--info-bg)]"}`}>
                      <p className="whitespace-pre-wrap break-words">{m.body}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--muted)]">
                        {m.direction === "IN" ? "Customer" : name(m.sentById)} · {fmt(m.createdAt, tz)} <span className={MSG_BADGE[m.status]}>{m.status.toLowerCase()}</span>
                      </p>
                      {m.error && <p className="text-xs text-[var(--danger)]">{m.error}</p>}
                      {m.status === "FAILED" && m.direction === "OUT" && canEdit && <ActionButton url={`/api/messages/${m.id}/retry`} label="Retry" />}
                    </li>
                  ))}
                  {!msgs.length && <li className="text-sm text-[var(--muted)]">No messages yet.</li>}
                </ol>
                {canEdit && (c.optedOut ? (
                  <p role="note" className="rounded-md bg-[var(--danger-bg)] p-2 text-sm text-[var(--danger)]">Messaging is blocked: {c.name} opted out ({c.optOutReason}). Respect their choice; opt them back in only if they ask.</p>
                ) : !c.phone ? <p className="text-sm">Add a phone number to message this contact.</p> : (
                  <ApiForm action={`/api/contacts/${c.id}/messages`} submitLabel="Send WhatsApp" success="Queued — status updates as Twilio reports it." reset fields={[{ name: "body", label: "Reply", type: "textarea", required: true }]} />
                ))}
                {canEdit && <ActionButton url={`/api/contacts/${c.id}/optout`} body={{ optedOut: !c.optedOut }} label={c.optedOut ? "Opt back in to messages" : "Mark as opted out"} confirm={c.optedOut ? "Only do this if the customer asked to receive messages again." : "Block all messages to this contact?"} />}
              </div>
            )}
          </Card>

          <Card title="Appointments" id="appointments">
            <ul className="grid gap-2">
              {appts.map((a) => (
                <li key={a.id} className="grid gap-1 rounded-lg border border-[var(--border)] p-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><strong>{a.title}</strong><span className={a.status === "SCHEDULED" ? "badge badge-ok" : "badge"}>{a.status.toLowerCase()}</span></div>
                  <span>With {name(a.membershipId)} · {fmt(a.startAt, a.timezone)}–{fmt(a.endAt, a.timezone, false)} ({a.timezone}){a.timezone !== tz && ` = ${fmt(a.startAt, tz)} your time (${tz})`}</span>
                  {a.status === "SCHEDULED" && canEdit && (
                    <div className="flex flex-wrap items-end gap-2">
                      <ApiForm action={`/api/appointments/${a.id}`} method="PATCH" inline submitLabel="Reschedule" success="Rescheduled in Google Calendar." fields={[
                        { name: "date", label: "New date", type: "date", required: true, defaultValue: a.startAt.toLocaleDateString("en-CA", { timeZone: a.timezone }) },
                        { name: "time", label: `Time (${a.timezone})`, type: "time", required: true, defaultValue: a.startAt.toLocaleTimeString("en-GB", { timeZone: a.timezone, hour: "2-digit", minute: "2-digit" }) },
                      ]} />
                      <ActionButton url={`/api/appointments/${a.id}`} method="DELETE" variant="danger" label="Cancel" confirm="Cancel this appointment and remove it from Google Calendar?" />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm link">+ Book appointment</summary>
                <p className="mt-2 text-xs text-[var(--muted)]">Only employees with a connected Google Calendar can be booked. Busy times are checked before booking.</p>
                <ul className="text-xs">{members.filter((m) => m.active).map((m) => { const cn = connected.get(m.id); return <li key={m.id}>{m.name}: {cn ? (cn.status === "CONNECTED" ? `✅ calendar connected (${cn.googleEmail})` : "⚠ calendar needs reconnecting") : "❌ no calendar connected — can't be booked"}</li>; })}</ul>
                <ApiForm action="/api/appointments" submitLabel="Book on Google Calendar" success="Booked — it's on the employee's Google Calendar." extra={{ contactId: c.id }} className="mt-2 grid gap-3 sm:grid-cols-2" fields={[
                  { name: "title", label: "Title", required: true, defaultValue: `Meeting with ${c.name}` },
                  { name: "membershipId", label: "Employee", type: "select", required: true, defaultValue: c.ownerId ?? "", options: members.filter((m) => connected.get(m.id)?.status === "CONNECTED").map((m) => ({ value: m.id, label: m.name })) },
                  { name: "opportunityId", label: "Opportunity", type: "select", options: opps.map((o) => ({ value: o.id, label: o.title })) },
                  { name: "date", label: "Date", type: "date", required: true },
                  { name: "time", label: "Start time", type: "time", required: true },
                  { name: "durationMin", label: "Duration (min)", type: "number", required: true, defaultValue: 30 },
                  { name: "timezone", label: "Time zone of the time entered", required: true, defaultValue: tz, help: "IANA name, e.g. Asia/Karachi, Europe/London" },
                ]} />
              </details>
            )}
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Card title="Summary">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-[var(--muted)]">Collected</dt><dd>{money(collected)}</dd>
              <dt className="text-[var(--muted)]">Awaiting payment</dt><dd>{money(pays.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0))}</dd>
              <dt className="text-[var(--muted)]">Company</dt><dd>{companies.find((x) => x.id === c.companyId)?.name ?? "—"}</dd>
              {cdefs.map((d) => <Fragment key={d.id}><dt className="text-[var(--muted)]">{d.name}</dt><dd>{String(c.customValues[d.key] ?? "—")}</dd></Fragment>)}
            </dl>
          </Card>
          {canEdit && (
            <Card title="Log activity">
              <ApiForm action={`/api/contacts/${c.id}/notes`} submitLabel="Save" success="Logged." reset fields={[
                { name: "kind", label: "Type", type: "select", required: true, options: [{ value: "note", label: "Note" }, { value: "call", label: "Call log" }] },
                { name: "text", label: "Details", type: "textarea", required: true },
              ]} />
            </Card>
          )}
          {canEdit && (
            <Card title="Edit contact">
              <ApiForm action={`/api/contacts/${c.id}`} method="PATCH" submitLabel="Save contact" extra={{ version: c.version }} fields={[
                { name: "name", label: "Name", required: true, defaultValue: c.name },
                { name: "phone", label: "Phone", type: "tel", defaultValue: c.phone },
                { name: "email", label: "Email", type: "email", defaultValue: c.email },
                { name: "companyId", label: "Company", type: "select", defaultValue: c.companyId, options: companies.map((x) => ({ value: x.id, label: x.name })) },
                { name: "tags", label: "Tags", defaultValue: c.tags.join(", ") },
                ...customFieldSpecs(cdefs, c.customValues),
              ]} />
              {ctx.perms.has("crm.delete") && <div className="mt-3"><ActionButton url={`/api/contacts/${c.id}`} method="DELETE" variant="danger" label="Delete contact" confirm="Delete this contact and everything linked to it (opportunities, leads, messages, payments, appointments)?" redirect="/app/contacts" /></div>}
            </Card>
          )}
          <Card title="Activity history">
            <ol className="grid gap-2 text-sm">
              {acts.map((a) => <li key={a.id} className="border-l-2 border-[var(--border)] pl-2"><p>{a.summary}</p><p className="text-xs text-[var(--muted)]">{a.actorLabel} · {fmt(a.createdAt, tz)}</p></li>)}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
void inArray;
