import { z } from "zod";
import { eq } from "drizzle-orm";
import { api, body, HttpError } from "@/lib/api";
import { db, schema } from "@/db";

export const PUT = api(null, async ({ req, ctx }) => {
  const b = await body(req, z.object({ timezone: z.string().max(60) }));
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: b.timezone });
  } catch {
    throw new HttpError(400, "Unknown time zone. Use an IANA name like Asia/Karachi or Europe/London.");
  }
  await db.update(schema.memberships).set({ timezone: b.timezone }).where(eq(schema.memberships.id, ctx.membershipId));
  return { ok: true };
});
