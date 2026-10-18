import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession } from "@/lib/auth";
import { HttpError, toResponse } from "@/lib/api";
import { createWorkspaceWithOwner } from "@/server/workspace";
import { audit } from "@/server/audit";

const Body = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "must be at least 8 characters").max(200),
  company: z.string().trim().min(2).max(80),
});

export async function POST(req: NextRequest) {
  try {
    const b = Body.parse(await req.json());
    if (await db.query.users.findFirst({ where: eq(schema.users.email, b.email) }))
      throw new HttpError(409, "An account with this email already exists. Log in instead.");
    const passwordHash = await bcrypt.hash(b.password, 12);
    const ws = await db.transaction(async (tx) => {
      const [u] = await tx.insert(schema.users).values({ name: b.name, email: b.email, passwordHash }).returning();
      const r = await createWorkspaceWithOwner(tx, b.company, u.id);
      await audit(tx, r.ws.id, { id: r.owner.id, label: b.name }, "workspace.created", { type: "workspace", id: r.ws.id }, null, { name: b.company, owner: b.email });
      return { userId: u.id, wsId: r.ws.id };
    });
    await createSession(ws.userId, ws.wsId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toResponse(e);
  }
}
