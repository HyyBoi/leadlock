import { z } from "zod";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";
import { ALL_PERMISSIONS } from "@/lib/permissions";

export const POST = api("members.manage", async ({ req, ctx }) => {
  const b = await body(req, z.object({ name: z.string().trim().min(2).max(40), permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).default([]) }));
  try {
    const [r] = await db.insert(schema.roles).values({ workspaceId: ctx.workspaceId, name: b.name, permissions: b.permissions }).returning();
    await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "role.created", { type: "role", id: r.id }, null, { name: r.name, permissions: r.permissions });
    return { role: r };
  } catch {
    throw new HttpError(409, "A role with this name already exists.");
  }
});
