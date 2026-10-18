import { Ctx } from "@/lib/auth";

/** I1.6: conversations are visible to the assigned employee, or to anyone with leads.view_all. */
export const canSeeContact = (ctx: Ctx, c: { ownerId: string | null }) =>
  ctx.perms.has("leads.view_all") || !c.ownerId || c.ownerId === ctx.membershipId;
