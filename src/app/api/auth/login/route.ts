import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession } from "@/lib/auth";
import { HttpError, toResponse } from "@/lib/api";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });
const WINDOW_MIN = 15;
const MAX_FAILS = 5;
// Constant-time-ish: always run bcrypt even for unknown emails.
const DUMMY = "$2a$12$CwTycUXWue0Thq9StjUM0uJ8.5dGkqWZbG3yI1D6C5y5jE5bqY0yK";

export async function POST(req: NextRequest) {
  try {
    const b = Body.parse(await req.json());
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    const key = `${b.email}|${ip}`;
    const since = new Date(Date.now() - WINDOW_MIN * 60_000);
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.loginAttempts)
      .where(and(eq(schema.loginAttempts.key, key), eq(schema.loginAttempts.success, false), gt(schema.loginAttempts.createdAt, since)));
    if (n >= MAX_FAILS) throw new HttpError(429, `Too many failed attempts. Wait ${WINDOW_MIN} minutes and try again.`);

    const user = await db.query.users.findFirst({ where: eq(schema.users.email, b.email) });
    const ok = await bcrypt.compare(b.password, user?.passwordHash ?? DUMMY);
    await db.insert(schema.loginAttempts).values({ key, success: ok && !!user });
    if (!user || !ok) throw new HttpError(401, `Email or password is incorrect. ${Math.max(0, MAX_FAILS - n - 1)} attempts left.`);
    const m = await db.query.memberships.findFirst({
      where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.active, true)),
      orderBy: asc(schema.memberships.createdAt),
    });
    if (!m) throw new HttpError(403, "Your access to this workspace has been removed. Contact your workspace owner.");
    await createSession(user.id, m.workspaceId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
