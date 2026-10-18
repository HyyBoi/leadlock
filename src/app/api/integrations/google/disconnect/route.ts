import { api } from "@/lib/api";
import { db } from "@/db";
import { calendar } from "@/server/integrations/google";
import { audit } from "@/server/audit";

export const POST = api(null, async ({ ctx }) => {
  await calendar.revoke(ctx.membershipId);
  await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "integration.calendar_disconnected", { type: "calendar", id: ctx.membershipId }, { connected: true }, { connected: false });
  return { ok: true };
});
