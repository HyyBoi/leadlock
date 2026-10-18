import Link from "next/link";
import { asc, eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { listContacts, PAGE_SIZE, fieldsFor } from "@/server/crm";
import { ApiForm, Card, ActionButton } from "@/components/ui";
import type { ListFilters } from "@/db/schema";
import { ago } from "@/lib/time";

type SP = { q?: string; tag?: string; stageId?: string; ownerId?: string; source?: string; createdFrom?: string; createdTo?: string; fieldKey?: string; fieldValue?: string; page?: string; list?: string };

export default async function Contacts({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePage("crm.view");
  const sp = await searchParams;
  const lists = await db.query.savedLists.findMany({ where: and(eq(schema.savedLists.workspaceId, ctx.workspaceId), eq(schema.savedLists.ownerId, ctx.membershipId)) });
  const active = lists.find((l) => l.id === sp.list);
  const filters: ListFilters = active?.filters ?? {
    q: sp.q, tag: sp.tag, stageId: sp.stageId, ownerId: sp.ownerId, source: sp.source, createdFrom: sp.createdFrom, createdTo: sp.createdTo,
    field: sp.fieldKey ? { key: sp.fieldKey, value: sp.fieldValue ?? "" } : undefined,
  };
  const page = Math.max(1, Number(sp.page ?? 1));
  const { rows, total } = await listContacts(ctx.workspaceId, filters, page);
  const members = await membersOf(ctx.workspaceId);
  const stages = await db.select({ id: schema.stages.id, name: schema.stages.name, pipeline: schema.pipelines.name }).from(schema.stages).innerJoin(schema.pipelines, eq(schema.pipelines.id, schema.stages.pipelineId)).where(eq(schema.stages.workspaceId, ctx.workspaceId)).orderBy(asc(schema.pipelines.position), asc(schema.stages.position));
  const cfields = await fieldsFor(ctx.workspaceId, "CONTACT");
  const companies = await db.query.companies.findMany({ where: eq(schema.companies.workspaceId, ctx.workspaceId) });
  const qs = (o: Record<string, string | undefined>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const exportQs = new URLSearchParams(Object.entries({ q: filters.q, tag: filters.tag, stageId: filters.stageId, ownerId: filters.ownerId, source: filters.source }).filter(([, v]) => v) as [string, string][]).toString();
  const sel = (name: string, label: string, opts: { value: string; label: string }[], v?: string) => (
    <label className="grid gap-1 text-sm">{label}<select name={name} defaultValue={v ?? ""} className="input"><option value="">Any</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
  );
  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Contacts</h1>
        {ctx.perms.has("crm.export") && <a className="btn btn-ghost" href={`/api/contacts/export?${exportQs}`}>⬇ Export CSV</a>}
      </header>
      {lists.length > 0 && (
        <nav aria-label="Saved lists" className="flex flex-wrap gap-2">
          <Link href="/app/contacts" className={`btn ${!active ? "btn-primary" : "btn-ghost"}`}>All contacts</Link>
          {lists.map((l) => <span key={l.id} className="inline-flex gap-1"><Link href={`/app/contacts?list=${l.id}`} className={`btn ${active?.id === l.id ? "btn-primary" : "btn-ghost"}`}>📋 {l.name}</Link><ActionButton url={`/api/lists/${l.id}`} method="DELETE" label="✕" confirm={`Delete list "${l.name}"?`} /></span>)}
        </nav>
      )}
      {!active && (
        <form className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="grid gap-1 text-sm">Search<input name="q" defaultValue={sp.q} className="input" placeholder="name, email, phone" /></label>
          <label className="grid gap-1 text-sm">Tag<input name="tag" defaultValue={sp.tag} className="input" placeholder="e.g. vip" /></label>
          {sel("stageId", "Has opportunity in stage", stages.map((s) => ({ value: s.id, label: `${s.pipeline} · ${s.name}` })), sp.stageId)}
          {sel("ownerId", "Owner", members.map((m) => ({ value: m.id, label: m.name })), sp.ownerId)}
          {sel("source", "Lead source", [{ value: "WEB_FORM", label: "Web form" }, { value: "WHATSAPP", label: "WhatsApp" }, { value: "MANUAL", label: "Manual" }], sp.source)}
          <label className="grid gap-1 text-sm">Created from<input type="date" name="createdFrom" defaultValue={sp.createdFrom} className="input" /></label>
          <label className="grid gap-1 text-sm">Created to<input type="date" name="createdTo" defaultValue={sp.createdTo} className="input" /></label>
          {cfields.length > 0 && <div className="grid grid-cols-2 gap-2">{sel("fieldKey", "Custom field", cfields.map((f) => ({ value: f.key, label: f.name })), sp.fieldKey)}<label className="grid gap-1 text-sm">equals<input name="fieldValue" defaultValue={sp.fieldValue} className="input" /></label></div>}
          <div className="flex items-end gap-2"><button className="btn btn-primary">Apply filters</button><Link className="btn btn-ghost" href="/app/contacts">Clear</Link></div>
        </form>
      )}
      {!active && Object.values(filters).some(Boolean) && (
        <Card title="Save these filters as a list">
          <ApiForm action="/api/lists" inline submitLabel="Save list" success="Saved — the list updates automatically as records change." extra={{ filters: JSON.parse(JSON.stringify(filters)) }} fields={[{ name: "name", label: "List name", required: true }]} />
        </Card>
      )}
      {active && <p className="text-sm text-[var(--muted)]">Saved list “{active.name}” — criteria: {JSON.stringify(active.filters)}. Re-evaluated every time you open it.</p>}
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>Name</th><th>Phone / email</th><th>Tags</th><th>Owner</th><th>Created</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><Link className="link font-medium" href={`/app/contacts/${c.id}`}>{c.name}</Link>{c.optedOut && <span className="badge badge-danger ml-1">opted out</span>}</td>
                <td className="text-sm">{c.phone}<div className="text-[var(--muted)]">{c.email}</div></td>
                <td>{c.tags.map((t) => <span key={t} className="badge mr-1">{t}</span>)}</td>
                <td>{members.find((m) => m.id === c.ownerId)?.name ?? "—"}</td>
                <td className="text-sm">{ago(c.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="p-4 text-sm text-[var(--muted)]">No contacts match these filters.</p>}
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>{total} contacts · page {page} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="btn btn-ghost" href={qs({ page: String(page - 1) })}>← Previous</Link>}
            {page * PAGE_SIZE < total && <Link className="btn btn-ghost" href={qs({ page: String(page + 1) })}>Next →</Link>}
          </span>
        </div>
      </div>
      {ctx.perms.has("crm.create") && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="New contact">
            <ApiForm action="/api/contacts" submitLabel="Create contact" success="Contact created." reset fields={[
              { name: "name", label: "Name", required: true },
              { name: "phone", label: "Phone", type: "tel" },
              { name: "email", label: "Email", type: "email" },
              { name: "companyId", label: "Company", type: "select", options: companies.map((c) => ({ value: c.id, label: c.name })) },
              { name: "tags", label: "Tags", placeholder: "comma separated" },
              ...cfields.map((f) => ({ name: `customValues.${f.key}`, label: f.name, type: f.type === "NUMBER" ? "number" as const : f.type === "DATE" ? "date" as const : f.type === "CHECKBOX" ? "checkbox" as const : f.type === "DROPDOWN" ? "select" as const : "text" as const, options: f.options.map((o) => ({ value: o, label: o })) })),
            ]} />
          </Card>
          <Card title="New company">
            <ApiForm action="/api/companies" submitLabel="Create company" success="Company created." reset fields={[{ name: "name", label: "Company name", required: true }, { name: "domain", label: "Website" }]} />
            <ul className="mt-3 grid gap-1 text-sm">{companies.map((c) => <li key={c.id}>🏢 {c.name}</li>)}</ul>
          </Card>
        </div>
      )}
    </div>
  );
}
