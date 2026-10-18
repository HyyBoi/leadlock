import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { calendar } from "@/server/integrations/google";
import { ProviderError } from "@/server/integrations/registry";
import { activity } from "@/server/audit";
import { touchContactLeads } from "@/server/leads";
import { zonedToUtc } from "@/lib/time";

/** I3.3 / I3.4 / I3.5: book on the employee's real calendar after checking busy times. Stored as UTC + IANA zone. */
export const POST = api("crm.edit", async ({ req, ctx }) => {
  const b = await body(req, z.object({
    contactId: z.string(), opportunityId: z.string().optional().or(z.literal("")), membershipId: z.string(),
    title: z.string().trim().min(1).max(160), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/),
    durationMin: z.coerce.number().int().min(10).max(480), timezone: z.string(), force: z.boolean().default(false),
  }));
  const contact = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, b.contactId), eq(schema.contacts.workspaceId, ctx.workspaceId)) });
  const member = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, b.membershipId), eq(schema.memberships.workspaceId, ctx.workspaceId)) });
  if (!contact || !member) throw new HttpError(404, "Contact or employee not found.");
  const conn = await db.query.calendarConnections.findFirst({ where: eq(schema.calendarConnections.membershipId, member.id) });
  if (!conn) throw new HttpError(409, "This employee has not connected a Google Calendar, so they can't be booked. They can connect it from their Profile page.");
  if (conn.status !== "CONNECTED") throw new HttpError(409, "This employee's Google Calendar connection has expired or was revoked. They need to reconnect it from their Profile page.");
  let start: Date;
  try {
    start = zonedToUtc(b.date, b.time, b.timezone);
  } catch {
    throw new HttpError(400, "Unknown time zone.");
  }
  const end = new Date(start.getTime() + b.durationMin * 60000);
  if (start.getTime() < Date.now() - 60000) throw new HttpError(400, "That time is in the past.");
  try {
    const busy = await calendar.busy(member.id, start, end);
    if (busy.length && !b.force)
      throw new HttpError(409, `The employee is busy then (${busy.map((x) => `${new Date(x.start).toLocaleTimeString("en-GB", { timeZone: b.timezone, hour: "2-digit", minute: "2-digit" })}–${new Date(x.end).toLocaleTimeString("en-GB", { timeZone: b.timezone, hour: "2-digit", minute: "2-digit" })}`).join(", ")} ${b.timezone}). Pick another time or book anyway.`, { conflict: true });
    const eventId = await calendar.create(member.id, { title: b.title, description: `Booked from LeadLock with ${contact.name}${contact.phone ? ` (${contact.phone})` : ""}`, start, end, timezone: b.timezone, attendeeEmail: contact.email });
    const [a] = await db.insert(schema.appointments).values({ workspaceId: ctx.workspaceId, contactId: contact.id, opportunityId: b.opportunityId || null, membershipId: member.id, title: b.title, startAt: start, endAt: end, timezone: b.timezone, googleEventId: eventId }).returning();
    const actor = { id: ctx.membershipId, label: ctx.name };
    await activity(db, { workspaceId: ctx.workspaceId, type: "appointment.created", summary: `${ctx.name} booked "${b.title}" on ${b.date} ${b.time} (${b.timezone})`, actor, contactId: contact.id, opportunityId: b.opportunityId || null });
    await touchContactLeads(ctx.workspaceId, contact.id, actor, "booked an appointment");
    return { appointment: a };
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError(e.temporary ? 503 : 409, e.message);
    throw e;
  }
});
