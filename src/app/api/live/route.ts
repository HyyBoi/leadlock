import { NextResponse } from "next/server";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCtx } from "@/lib/auth";

/** Q11: cheap change-signature polled by the client; when it changes the page refreshes its server data. */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await db.execute(sql`select
    (select coalesce(max(greatest(${schema.leads.createdAt}, coalesce(${schema.leads.assignedAt}, ${schema.leads.createdAt}), coalesce(${schema.leads.acknowledgedAt}, ${schema.leads.createdAt}))), 'epoch') from ${schema.leads} where ${schema.leads.workspaceId} = ${ctx.workspaceId}) as l,
    (select coalesce(max(${schema.messages.updatedAt}), 'epoch') from ${schema.messages} where ${schema.messages.workspaceId} = ${ctx.workspaceId}) as m,
    (select coalesce(max(${schema.payments.updatedAt}), 'epoch') from ${schema.payments} where ${schema.payments.workspaceId} = ${ctx.workspaceId}) as p,
    (select count(*) from ${schema.activities} where ${schema.activities.workspaceId} = ${ctx.workspaceId}) as a`);
  const myOpen = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(and(eq(schema.leads.workspaceId, ctx.workspaceId), eq(schema.leads.ownerId, ctx.membershipId), eq(schema.leads.status, "OPEN")));
  void gt; void ne;
  const row = r.rows[0] as Record<string, unknown>;
  return NextResponse.json({ sig: JSON.stringify(row), myOpen: myOpen[0].n });
}
