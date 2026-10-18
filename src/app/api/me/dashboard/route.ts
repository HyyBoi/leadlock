import { z } from "zod";
import { eq } from "drizzle-orm";
import { api, body } from "@/lib/api";
import { db, schema } from "@/db";

/** F5.5: remember which dashboard figures are hidden, per user. */
export const PUT = api(null, async ({ req, ctx }) => {
  const b = await body(req, z.object({ hidden: z.array(z.string().max(40)).max(30) }));
  await db.update(schema.memberships).set({ dashboardHidden: b.hidden }).where(eq(schema.memberships.id, ctx.membershipId));
  return { ok: true };
});
