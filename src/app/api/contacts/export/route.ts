import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { api } from "@/lib/api";
import { db, schema } from "@/db";
import { contactWhere, serializeOpp } from "@/server/crm";
import { audit } from "@/server/audit";

const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;

/** F1.3 export permission + F1.4 value masking in exports (+ CSV-injection safe). */
export const GET = api("crm.export", async ({ req, ctx }) => {
  const sp = req.nextUrl.searchParams;
  const filters = { q: sp.get("q") ?? undefined, tag: sp.get("tag") ?? undefined, stageId: sp.get("stageId") ?? undefined, ownerId: sp.get("ownerId") ?? undefined, source: sp.get("source") ?? undefined };
  const rows = await db.query.contacts.findMany({ where: contactWhere(ctx.workspaceId, filters), limit: 5000 });
  const opps = rows.length ? await db.query.opportunities.findMany({ where: and(eq(schema.opportunities.workspaceId, ctx.workspaceId), inArray(schema.opportunities.contactId, rows.map((r) => r.id))) }) : [];
  const lines = [["Name", "Email", "Phone", "Tags", "Opportunity", "Value"].map(csv).join(",")];
  for (const r of rows) {
    const mine = opps.filter((o) => o.contactId === r.id);
    if (!mine.length) lines.push([r.name, r.email, r.phone, r.tags.join(";"), "", ""].map(csv).join(","));
    for (const o of mine.map((o) => serializeOpp(o, ctx)))
      lines.push([r.name, r.email, r.phone, r.tags.join(";"), o.title, o.valueHidden ? "hidden" : (o.value / 100).toFixed(2)].map(csv).join(","));
  }
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "crm.exported", { type: "contacts" }, null, { rows: rows.length, valuesIncluded: ctx.perms.has("crm.view_value") });
  return new NextResponse(lines.join("\n"), { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=contacts.csv" } });
});
