import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { calendar } from "@/server/integrations/google";
import { ProviderError } from "@/server/integrations/registry";
import { activity } from "@/server/audit";
import { zonedToUtc } from "@/lib/time";

const scope = (ws: string, id: string) => and(eq(schema.appointments.id, id), eq(schema.appointments.workspaceId, ws));

/** I3.6: reschedule updates the Google event and the activity history. */
export const PATCH = api<{ id: string }>("crm.edit", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/) }));
  const a = await db.query.appointments.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!a || a.status !== "SCHEDULED") throw new HttpError(404, "Appointment not found or already cancelled.");
  const start = zonedToUtc(b.date, b.time, a.timezone);
  const end = new Date(start.getTime() + (a.endAt.getTime() - a.startAt.getTime()));
  try {
    if (a.googleEventId) await calendar.update(a.membershipId, a.googleEventId, start, end, a.timezone);
  } catch (e) {
    throw new HttpError(e instanceof ProviderError && e.temporary ? 503 : 409, (e as Error).message);
  }
  await db.update(schema.appointments).set({ startAt: start, endAt: end }).where(eq(schema.appointments.id, a.id));
  await activity(db, { workspaceId: ctx.workspaceId, type: "appointment.rescheduled", summary: `${ctx.name} rescheduled "${a.title}" to ${b.date} ${b.time} (${a.timezone})`, actor: { id: ctx.membershipId, label: ctx.name }, contactId: a.contactId, opportunityId: a.opportunityId });
  return { ok: true };
});

export const DELETE = api<{ id: string }>("crm.edit", async ({ ctx, params }) => {
  const a = await db.query.appointments.findFirst({ where: scope(ctx.workspaceId, params.id) });
  if (!a || a.status !== "SCHEDULED") throw new HttpError(404, "Appointment not found or already cancelled.");
  try {
    if (a.googleEventId) await calendar.cancel(a.membershipId, a.googleEventId);
  } catch (e) {
    throw new HttpError(e instanceof ProviderError && e.temporary ? 503 : 409, (e as Error).message);
  }
  await db.update(schema.appointments).set({ status: "CANCELLED" }).where(eq(schema.appointments.id, a.id));
  await activity(db, { workspaceId: ctx.workspaceId, type: "appointment.cancelled", summary: `${ctx.name} cancelled "${a.title}"`, actor: { id: ctx.membershipId, label: ctx.name }, contactId: a.contactId, opportunityId: a.opportunityId });
  return { ok: true };
});
