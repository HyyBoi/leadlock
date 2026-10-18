import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";
import { ALL_PERMISSIONS } from "@/lib/permissions";

/** F1.3: grant/remove permissions on a role (not tied to role names). */
export const PATCH = api<{ id: string }>("members.manage", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])) }));
  const r = await db.query.roles.findFirst({ where: and(eq(schema.roles.id, params.id), eq(schema.roles.workspaceId, ctx.workspaceId)) });
  if (!r) throw new HttpError(404, "Role not found.");
  if (ctx.level !== "OWNER" && b.permissions.includes("members.manage") !== r.permissions.includes("members.manage"))
    throw new HttpError(403, "Only the Owner can grant or remove the member-management permission.");
  await db.update(schema.roles).set({ permissions: b.permissions }).where(eq(schema.roles.id, r.id));
  const added = b.permissions.filter((p) => !r.permissions.includes(p));
  const removed = r.permissions.filter((p) => !b.permissions.includes(p));
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "role.permissions_changed", { type: "role", id: r.id }, { permissions: r.permissions }, { permissions: b.permissions, added, removed });
  return { ok: true };
});
