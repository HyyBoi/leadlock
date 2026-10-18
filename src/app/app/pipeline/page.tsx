import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf } from "@/lib/page";
import { money, serializeOpp } from "@/server/crm";
import { StageSelect } from "@/components/ui";

/** F2.5 board: one column per stage; move cards with the stage selector (keyboard accessible). */
export default async function Pipeline({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const ctx = await requirePage("crm.view");
  const sp = await searchParams;
  const pipelines = await db.query.pipelines.findMany({ where: eq(schema.pipelines.workspaceId, ctx.workspaceId), orderBy: [asc(schema.pipelines.position), asc(schema.pipelines.createdAt)] });
  const p = pipelines.find((x) => x.id === sp.p) ?? pipelines[0];
  if (!p) return <p>No pipelines yet.</p>;
  const stages = await db.query.stages.findMany({ where: eq(schema.stages.pipelineId, p.id), orderBy: asc(schema.stages.position) });
  const opps = await db.select({ o: schema.opportunities, contact: schema.contacts.name }).from(schema.opportunities).innerJoin(schema.contacts, eq(schema.contacts.id, schema.opportunities.contactId)).where(and(eq(schema.opportunities.workspaceId, ctx.workspaceId), eq(schema.opportunities.pipelineId, p.id))).limit(500);
  const members = await membersOf(ctx.workspaceId);
  const canEdit = ctx.perms.has("crm.edit");
  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <nav aria-label="Pipelines" className="flex flex-wrap gap-2">{pipelines.map((x) => <Link key={x.id} href={`/app/pipeline?p=${x.id}`} className={`btn ${x.id === p.id ? "btn-primary" : "btn-ghost"}`}>{x.name}</Link>)}</nav>
      </header>
      <div className="scroll-x">
        <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-3 pb-2">
          {stages.map((s) => {
            const cards = opps.filter((x) => x.o.stageId === s.id).map((x) => ({ ...serializeOpp(x.o, ctx), contact: x.contact }));
            const total = cards.reduce((t, c) => t + c.value, 0);
            return (
              <section key={s.id} className="card grid content-start gap-2" aria-label={`${s.name} stage`}>
                <h2 className="font-semibold">{s.name} <span className="text-sm font-normal text-[var(--muted)]">· {cards.length}{ctx.perms.has("crm.view_value") && ` · ${money(total)}`}</span></h2>
                {s.kind !== "OPEN" && <span className="badge">{s.kind === "WON" ? "Won stage" : "Lost stage"}</span>}
                {s.requiredFields.length > 0 && <p className="text-xs text-[var(--muted)]">Requires: {s.requiredFields.join(", ")}</p>}
                {cards.map((o) => (
                  <article key={o.id} className="rounded-lg border border-[var(--border)] p-2 text-sm">
                    <Link className="link font-medium" href={`/app/contacts/${o.contactId}#opportunities`}>{o.title}</Link>
                    <p className="text-xs text-[var(--muted)]">{o.contact} · {members.find((m) => m.id === o.ownerId)?.name ?? "unassigned"} · {o.valueHidden ? "value hidden" : money(o.value, o.currency)}</p>
                    {canEdit && <div className="mt-2"><StageSelect oppId={o.id} version={o.version} stageId={o.stageId} stages={stages} /></div>}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
