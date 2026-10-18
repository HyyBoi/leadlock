import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { audit } from "@/server/audit";
import { reassignOnAbsence } from "@/server/leads";

/** F3.2 / F3.6: employees set their own status; Owner/Admin (members.manage) or a manager (leads.reassign) can set anyone's. */
export const POST = api<{ id: string }>(null, async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ status: z.enum(["AVAILABLE", "BUSY", "ON_LEAVE", "OFFLINE"]) }));
  const self = params.id === ctx.membershipId;
  if (!self && !ctx.perms.has("members.manage") && !ctx.perms.has("leads.reassign")) throw new HttpError(403, "You can only change your own availability.");
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, params.id), eq(schema.memberships.workspaceId, ctx.workspaceId)) });
  if (!m) throw new HttpError(404, "Member not found.");
  await db.update(schema.memberships).set({ availability: b.status }).where(eq(schema.memberships.id, m.id));
  const actor = { id: ctx.membershipId, label: ctx.name };
  await audit(db, ctx.workspaceId, actor, "member.availability", { type: "membership", id: m.id }, { availability: m.availability }, { availability: b.status });
  let moved = 0;
  if (b.status === "ON_LEAVE" || b.status === "OFFLINE") moved = await reassignOnAbsence(ctx.workspaceId, m.id, b.status, actor);
  return { ok: true, reassigned: moved };
});
