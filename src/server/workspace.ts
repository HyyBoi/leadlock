import { eq } from "drizzle-orm";
import { db, schema, Tx } from "@/db";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { DEFAULT_STAGES } from "./crm";

export const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "workspace";

/** F1.1: signing up creates a workspace with default roles, a pipeline and assignment rules; the user becomes Owner. */
export async function createWorkspaceWithOwner(tx: Tx, company: string, userId: string) {
  let slug = slugify(company);
  if (await tx.query.workspaces.findFirst({ where: eq(schema.workspaces.slug, slug) })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const [ws] = await tx.insert(schema.workspaces).values({ name: company, slug }).returning();
  const roles = await tx
    .insert(schema.roles)
    .values(DEFAULT_ROLES.map((r) => ({ workspaceId: ws.id, name: r.name, permissions: r.permissions })))
    .returning();
  const [owner] = await tx
    .insert(schema.memberships)
    .values({ workspaceId: ws.id, userId, level: "OWNER", roleId: roles.find((r) => r.name === "Admin")!.id })
    .returning();
  const [pl] = await tx.insert(schema.pipelines).values({ workspaceId: ws.id, name: "Sales" }).returning();
  await tx.insert(schema.stages).values(DEFAULT_STAGES.map((s, i) => ({ workspaceId: ws.id, pipelineId: pl.id, name: s.name, kind: s.kind, position: i })));
  await tx.insert(schema.assignmentRules).values({ workspaceId: ws.id, managerId: owner.id });
  return { ws, owner, roles, pipeline: pl };
}

export async function workspaceBySlug(slug: string) {
  return db.query.workspaces.findFirst({ where: eq(schema.workspaces.slug, slug) });
}
