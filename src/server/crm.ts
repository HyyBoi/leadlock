import { and, asc, eq, ilike, isNull, or, sql, SQL, gte, lte, exists, desc } from "drizzle-orm";
import { db, schema, Tx } from "@/db";
import type { ListFilters } from "@/db/schema";
import { Ctx } from "@/lib/auth";
import { bad } from "@/lib/api";

const { pipelines, stages, fieldDefs, contacts, opportunities, leads } = schema;

export const DEFAULT_STAGES: { name: string; kind: "OPEN" | "WON" | "LOST" }[] = [
  { name: "New", kind: "OPEN" },
  { name: "Contacted", kind: "OPEN" },
  { name: "Proposal", kind: "OPEN" },
  { name: "Won", kind: "WON" },
  { name: "Lost", kind: "LOST" },
];

export async function defaultPipeline(tx: Tx | typeof db, workspaceId: string) {
  const pipeline = await tx.query.pipelines.findFirst({ where: eq(pipelines.workspaceId, workspaceId), orderBy: [asc(pipelines.position), asc(pipelines.createdAt)] });
  if (!pipeline) throw new Error("Workspace has no pipeline");
  const firstStage = (await tx.query.stages.findFirst({ where: eq(stages.pipelineId, pipeline.id), orderBy: asc(stages.position) }))!;
  return { pipeline, firstStage };
}

export async function fieldsFor(workspaceId: string, entity: "CONTACT" | "OPPORTUNITY", pipelineId?: string | null) {
  return db.query.fieldDefs.findMany({
    where: and(
      eq(fieldDefs.workspaceId, workspaceId),
      eq(fieldDefs.entity, entity),
      entity === "CONTACT" ? isNull(fieldDefs.pipelineId) : eq(fieldDefs.pipelineId, pipelineId!),
    ),
    orderBy: [asc(fieldDefs.position), asc(fieldDefs.createdAt)],
  });
}

type Def = typeof fieldDefs.$inferSelect;

/** Server-side validation + coercion of custom field values against their definitions. Unknown keys are dropped. */
export function cleanCustomValues(defs: Def[], input: Record<string, unknown> | undefined, prev: Record<string, unknown> = {}) {
  const out: Record<string, unknown> = { ...prev };
  for (const d of defs) {
    if (!input || !(d.key in input)) continue;
    const v = input[d.key];
    if (v === null || v === "" || v === undefined) {
      delete out[d.key];
      continue;
    }
    switch (d.type) {
      case "TEXT":
        out[d.key] = String(v).slice(0, 2000);
        break;
      case "NUMBER": {
        const n = Number(v);
        if (!Number.isFinite(n)) throw bad(`"${d.name}" must be a number.`);
        out[d.key] = n;
        break;
      }
      case "DATE":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad(`"${d.name}" must be a date (YYYY-MM-DD).`);
        out[d.key] = String(v);
        break;
      case "DROPDOWN":
        if (!d.options.includes(String(v))) throw bad(`"${d.name}" must be one of: ${d.options.join(", ")}.`);
        out[d.key] = String(v);
        break;
      case "CHECKBOX":
        out[d.key] = v === true || v === "true" || v === "on";
        break;
    }
  }
  return out;
}

/** F1.4: one serializer for every place an opportunity leaves the server. */
export function serializeOpp<T extends { value: number }>(o: T, ctx: Ctx): T & { valueHidden: boolean } {
  if (ctx.perms.has("crm.view_value")) return { ...o, valueHidden: false };
  return { ...o, value: 0, valueHidden: true };
}

export const money = (minor: number, currency = "usd") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(minor / 100);

/** F2.4: which required fields are missing for the target stage. "value" refers to the built-in amount. */
export function missingRequired(stage: { requiredFields: string[] }, opp: { value: number; customValues: Record<string, unknown> }, defs: Def[]) {
  return stage.requiredFields.filter((k) => {
    if (k === "value") return !(opp.value > 0);
    const v = opp.customValues?.[k];
    return v === undefined || v === null || v === "" || v === false;
  }).map((k) => (k === "value" ? "Value" : defs.find((d) => d.key === k)?.name ?? k));
}

/** F2.6: filter builder shared by the contacts list and saved lists (evaluated live, so lists auto-update). */
export function contactWhere(workspaceId: string, f: ListFilters): SQL {
  const conds: (SQL | undefined)[] = [eq(contacts.workspaceId, workspaceId)];
  if (f.q) conds.push(or(ilike(contacts.name, `%${f.q}%`), ilike(contacts.email, `%${f.q}%`), ilike(contacts.phone, `%${f.q}%`)));
  if (f.tag) conds.push(sql`${f.tag} = any(${contacts.tags})`);
  if (f.ownerId) conds.push(eq(contacts.ownerId, f.ownerId));
  if (f.createdFrom) conds.push(gte(contacts.createdAt, new Date(f.createdFrom)));
  if (f.createdTo) conds.push(lte(contacts.createdAt, new Date(f.createdTo + "T23:59:59Z")));
  if (f.stageId)
    conds.push(exists(db.select({ x: sql`1` }).from(opportunities).where(and(eq(opportunities.contactId, contacts.id), eq(opportunities.stageId, f.stageId)))));
  if (f.source)
    conds.push(exists(db.select({ x: sql`1` }).from(leads).where(and(eq(leads.contactId, contacts.id), sql`${leads.source} = ${f.source}`))));
  if (f.field?.key && f.field.value !== undefined && f.field.value !== "")
    conds.push(sql`${contacts.customValues} ->> ${f.field.key} = ${f.field.value}`);
  return and(...conds)!;
}

export const PAGE_SIZE = 25;

export async function listContacts(workspaceId: string, f: ListFilters, page = 1) {
  const where = contactWhere(workspaceId, f);
  const [rows, total] = await Promise.all([
    db.query.contacts.findMany({ where, orderBy: desc(contacts.createdAt), limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, with: undefined }),
    db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(where),
  ]);
  return { rows, total: total[0].n };
}
