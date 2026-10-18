import { and, eq } from "drizzle-orm";
import { api, HttpError } from "@/lib/api";
import { db, schema } from "@/db";
import { calendar } from "@/server/integrations/google";
import { zonedToUtc } from "@/lib/time";

/** I3.4: show the employee's busy blocks for a day before booking. */
export const GET = api("crm.view", async ({ req, ctx }) => {
  const sp = req.nextUrl.searchParams;
  const m = await db.query.memberships.findFirst({ where: and(eq(schema.memberships.id, sp.get("membershipId") ?? ""), eq(schema.memberships.workspaceId, ctx.workspaceId)) });
  if (!m) throw new HttpError(404, "Employee not found.");
  const tz = sp.get("tz") || m.timezone;
  const date = sp.get("date") ?? new Date().toISOString().slice(0, 10);
  try {
    const busy = await calendar.busy(m.id, zonedToUtc(date, "00:00", tz), zonedToUtc(date, "23:59", tz));
    return { busy };
  } catch (e) {
    throw new HttpError(409, (e as Error).message);
  }
});
