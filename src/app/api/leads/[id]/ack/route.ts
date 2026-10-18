import { api, HttpError } from "@/lib/api";
import { acknowledgeLead } from "@/server/leads";

export const POST = api<{ id: string }>(null, async ({ ctx, params }) => {
  const l = await acknowledgeLead(ctx.workspaceId, params.id, { id: ctx.membershipId, label: ctx.name });
  if (!l) throw new HttpError(409, "Only the current owner can acknowledge, and only while the lead is waiting. It may have just been escalated — refresh to see who owns it now.");
  return { lead: l };
});
