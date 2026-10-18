import Link from "next/link";
import { asc, eq, and, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { getRule } from "@/server/leads";
import { ApiForm, Card, RulesEditor, StageReorder, ActionButton } from "@/components/ui";

export default async function Settings() {
  const ctx = await requirePage();
  const canRules = ctx.perms.has("rules.manage");
  const canPipe = ctx.perms.has("pipeline.manage");
  const rule = await getRule(db, ctx.workspaceId);
  const members = (await membersOf(ctx.workspaceId)).filter((m) => m.active);
  const pipelines = await db.query.pipelines.findMany({ where: eq(schema.pipelines.workspaceId, ctx.workspaceId), orderBy: [asc(schema.pipelines.position), asc(schema.pipelines.createdAt)] });
  const stages = await db.query.stages.findMany({ where: eq(schema.stages.workspaceId, ctx.workspaceId), orderBy: asc(schema.stages.position) });
  const defs = await db.query.fieldDefs.findMany({ where: eq(schema.fieldDefs.workspaceId, ctx.workspaceId), orderBy: asc(schema.fieldDefs.position) });
  const counts = await db.select({ stageId: schema.opportunities.stageId, n: sql<number>`count(*)::int` }).from(schema.opportunities).where(eq(schema.opportunities.workspaceId, ctx.workspaceId)).groupBy(schema.opportunities.stageId);
  const n = (id: string) => counts.find((c) => c.stageId === id)?.n ?? 0;
  const fieldRow = (d: (typeof defs)[number]) => (
    <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm"><strong>{d.name}</strong><span className="badge">{d.type.toLowerCase()}</span>{d.options.length > 0 && <span className="text-xs">{d.options.join(" / ")}</span>}<code className="text-xs text-[var(--muted)]">{d.key}</code>{canPipe && <ActionButton url={`/api/fields/${d.id}`} method="DELETE" label="Delete" variant="danger" confirm={`Delete field "${d.name}"? Its stored values are removed too.`} />}</li>
  );
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold">Pipelines & rules</h1>
      <Card title="Lead assignment & escalation rules">
        {canRules ? <RulesEditor rule={{ ...rule, chain: rule.chain }} members={members.map((m) => ({ id: m.id, name: m.name }))} /> : (
          <p className="text-sm">Window {rule.ackWindowSeconds}s · max {rule.maxOpenLeads} open leads per employee · chain: {rule.chain.map((c) => `${c.type.toLowerCase().replace("_", " ")} (${c.seconds}s)`).join(" ")}. You need “manage assignment rules” to change these.</p>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">Distribution: round-robin among employees who are Available and under the open-lead limit. Busy / On leave / Offline employees never receive new leads. If nobody is available the lead goes to the backup, then the manager, then the Owner, so it always has an owner.</p>
      </Card>

      <Card title="Contact fields (shared by all pipelines)">
        <ul className="grid gap-2">{defs.filter((d) => d.entity === "CONTACT").map(fieldRow)}</ul>
        {canPipe && <div className="mt-3"><ApiForm action="/api/fields" inline submitLabel="Add contact field" success="Field added — it's on forms and detail pages now." reset extra={{ entity: "CONTACT" }} fields={[
          { name: "name", label: "Field name", required: true },
          { name: "type", label: "Type", type: "select", required: true, options: ["TEXT", "NUMBER", "DATE", "DROPDOWN", "CHECKBOX"].map((t) => ({ value: t, label: t.toLowerCase() })) },
          { name: "options", label: "Dropdown options", placeholder: "a, b, c" },
        ]} /></div>}
      </Card>

      {pipelines.map((p) => {
        const st = stages.filter((s) => s.pipelineId === p.id);
        const pdefs = defs.filter((d) => d.pipelineId === p.id);
        return (
          <Card key={p.id} title={<>Pipeline: {p.name} <Link className="link text-sm font-normal" href={`/app/pipeline?p=${p.id}`}>open board</Link></>}>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="grid content-start gap-3">
                <h3 className="font-semibold">Stages</h3>
                <ul className="grid gap-3">
                  {st.map((s) => (
                    <li key={s.id} className="rounded-lg border border-[var(--border)] p-2">
                      <p className="text-sm"><strong>{s.name}</strong> <span className="badge">{s.kind.toLowerCase()}</span> <span className="text-xs text-[var(--muted)]">{n(s.id)} opportunities</span></p>
                      {canPipe && (
                        <details className="mt-1"><summary className="cursor-pointer text-sm link">Edit / delete</summary>
                          <div className="mt-2 grid gap-3">
                            <ApiForm action={`/api/stages/${s.id}`} method="PATCH" submitLabel="Save stage" success="Stage saved." fields={[
                              { name: "name", label: "Name", required: true, defaultValue: s.name },
                              { name: "kind", label: "Kind", type: "select", required: true, defaultValue: s.kind, options: [{ value: "OPEN", label: "Open" }, { value: "WON", label: "Won" }, { value: "LOST", label: "Lost" }] },
                            ]} />
                            <RequiredFields stageId={s.id} current={s.requiredFields} options={[{ key: "value", name: "Value" }, ...pdefs.map((d) => ({ key: d.key, name: d.name }))]} />
                            {n(s.id) > 0 ? (
                              <ApiForm action={`/api/stages/${s.id}`} method="DELETE" inline submitLabel="Move opportunities & delete" success="Stage deleted." fields={[{ name: "moveTo", label: `Move its ${n(s.id)} opportunities to`, type: "select", required: true, options: st.filter((x) => x.id !== s.id).map((x) => ({ value: x.id, label: x.name })) }]} />
                            ) : <ActionButton url={`/api/stages/${s.id}`} method="DELETE" variant="danger" label="Delete stage" confirm={`Delete stage "${s.name}"?`} />}
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
                {canPipe && <ApiForm action={`/api/pipelines/${p.id}/stages`} inline submitLabel="Add stage" success="Stage added." reset fields={[{ name: "name", label: "New stage", required: true }, { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "OPEN", label: "Open" }, { value: "WON", label: "Won" }, { value: "LOST", label: "Lost" }] }]} />}
                {canPipe && <><h4 className="text-sm font-semibold">Reorder</h4><StageReorder pipelineId={p.id} stages={st.map((s) => ({ id: s.id, name: s.name }))} /></>}
              </div>
              <div className="grid content-start gap-3">
                <h3 className="font-semibold">{p.name} opportunity fields</h3>
                <ul className="grid gap-2">{pdefs.map(fieldRow)}</ul>
                {!pdefs.length && <p className="text-sm text-[var(--muted)]">No custom fields for this pipeline yet.</p>}
                {canPipe && <ApiForm action="/api/fields" submitLabel="Add field to this pipeline" success="Field added." reset extra={{ entity: "OPPORTUNITY", pipelineId: p.id }} fields={[
                  { name: "name", label: "Field name", required: true },
                  { name: "type", label: "Type", type: "select", required: true, options: ["TEXT", "NUMBER", "DATE", "DROPDOWN", "CHECKBOX"].map((t) => ({ value: t, label: t.toLowerCase() })) },
                  { name: "options", label: "Dropdown options", placeholder: "a, b, c" },
                ]} />}
              </div>
            </div>
          </Card>
        );
      })}
      {canPipe && <Card title="New pipeline"><ApiForm action="/api/pipelines" inline submitLabel="Create pipeline" success="Pipeline created with default stages." reset fields={[{ name: "name", label: "Pipeline name", required: true }]} /></Card>}
    </div>
  );
}

import { RequiredFields } from "@/components/RequiredFields";
void and;
