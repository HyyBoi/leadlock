import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { randomToken, sha256 } from "./crypto";
import { effectivePermissions, Permission } from "./permissions";

export const SESSION_COOKIE = "ll_session";
const SESSION_DAYS = 7;

export type Ctx = {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  membershipId: string;
  level: "OWNER" | "ADMIN" | "USER";
  perms: Set<Permission>;
  timezone: string;
  sessionId: string;
};

export async function createSession(userId: string, workspaceId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.insert(schema.sessions).values({ tokenHash: sha256(token), userId, workspaceId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** Resolve the current session into a workspace-scoped context. Returns null when not logged in. */
export async function getCtx(): Promise<Ctx | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      expiresAt: schema.sessions.expiresAt,
      userId: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      workspaceId: schema.workspaces.id,
      workspaceName: schema.workspaces.name,
      workspaceSlug: schema.workspaces.slug,
      membershipId: schema.memberships.id,
      level: schema.memberships.level,
      active: schema.memberships.active,
      timezone: schema.memberships.timezone,
      rolePerms: schema.roles.permissions,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.sessions.workspaceId))
    .innerJoin(
      schema.memberships,
      and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.workspaceId, schema.workspaces.id)),
    )
    .leftJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const r = rows[0];
  if (!r || !r.active) return null;
  // Sliding expiry: extend when less than half the lifetime remains.
  if (r.expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 864e5) {
    await db
      .update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_DAYS * 864e5) })
      .where(eq(schema.sessions.id, r.sessionId));
  }
  return {
    userId: r.userId,
    name: r.name,
    email: r.email,
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    workspaceSlug: r.workspaceSlug,
    membershipId: r.membershipId,
    level: r.level,
    perms: effectivePermissions(r.level, r.rolePerms),
    timezone: r.timezone,
    sessionId: r.sessionId,
  };
}

export const can = (ctx: Ctx, p: Permission) => ctx.perms.has(p);
