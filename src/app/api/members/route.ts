import { z } from "zod";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";
import { randomToken } from "@/lib/crypto";

/** F1.2: Owner/Admin invites a member and sets their level and role. Returns a one-time temporary password. */
export const POST = api("members.manage", async ({ req, ctx }) => {
  const b = await body(req, z.object({
    name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email(),
    level: z.enum(["ADMIN", "USER"]), roleId: z.string().min(1),
  }));
  const role = await db.query.roles.findFirst({ where: and(eq(schema.roles.id, b.roleId), eq(schema.roles.workspaceId, ctx.workspaceId)) });
  if (!role) throw new HttpError(400, "Choose a role from this workspace.");
  let user = await db.query.users.findFirst({ where: eq(schema.users.email, b.email) });
  let tempPassword: string | null = null;
  if (!user) {
    tempPassword = randomToken(9);
    [user] = await db.insert(schema.users).values({ name: b.name, email: b.email, passwordHash: await bcrypt.hash(tempPassword, 12) }).returning();
  }
  const exists = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.workspaceId, ctx.workspaceId)) });
  if (exists) throw new HttpError(409, "This person is already a member of the workspace.");
  const [m] = await db.insert(schema.memberships).values({ workspaceId: ctx.workspaceId, userId: user.id, level: b.level, roleId: role.id }).returning();
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "member.invited", { type: "membership", id: m.id }, null, { email: b.email, level: b.level, role: role.name });
  return { membershipId: m.id, tempPassword };
});
