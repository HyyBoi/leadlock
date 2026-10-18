import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";
import { reassignOnAbsence } from "@/server/leads";

/** F1.2: change level/role/lead routing. Nobody but the Owner can touch the Owner; only the Owner grants Admin. */
export const PATCH = api<{ id: string }>("members.manage", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ level: z.enum(["ADMIN", "USER"]).optional(), roleId: z.string().optional(), receivesLeads: z.boolean().optional(), active: z.boolean().optional() }));
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, params.id), eq(schema.memberships.workspaceId, ctx.workspaceId)) });
  if (!m) throw new HttpError(404, "Member not found.");
  if (m.level === "OWNER") throw new HttpError(403, "The workspace Owner cannot be modified here.");
  if (ctx.level !== "OWNER" && (m.level === "ADMIN" || b.level === "ADMIN")) throw new HttpError(403, "Only the Owner can change Admins or promote someone to Admin.");
  if (m.id === ctx.membershipId && b.active === false) throw new HttpError(400, "You can't deactivate yourself.");
  if (b.roleId) {
    const r = await db.query.roles.findFirst({ where: and(eq(schema.roles.id, b.roleId), eq(schema.roles.workspaceId, ctx.workspaceId)) });
    if (!r) throw new HttpError(400, "Role not found in this workspace.");
  }
  const before = { level: m.level, roleId: m.roleId, receivesLeads: m.receivesLeads, active: m.active };
  const after = { level: b.level ?? m.level, roleId: b.roleId ?? m.roleId, receivesLeads: b.receivesLeads ?? m.receivesLeads, active: b.active ?? m.active };
  await db.update(schema.memberships).set(after).where(eq(schema.memberships.id, m.id));
  if (after.active === false) await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, m.userId), eq(schema.sessions.workspaceId, ctx.workspaceId)));
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "member.updated", { type: "membership", id: m.id }, before, after);
  if (after.active === false || after.receivesLeads === false) await reassignOnAbsence(ctx.workspaceId, m.id, "OFFLINE", { id: ctx.membershipId, label: ctx.name });
  return { ok: true };
});
