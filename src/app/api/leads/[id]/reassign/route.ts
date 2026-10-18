import { z } from "zod";
import { api, body, HttpError } from "@/lib/api";
import { manualReassign } from "@/server/leads";

export const POST = api<{ id: string }>("leads.reassign", async ({ req, ctx, params }) => {
  const b = await body(req, z.object({ membershipId: z.string().min(1) }));
  const r = await manualReassign(ctx.workspaceId, params.id, b.membershipId, { id: ctx.membershipId, label: ctx.name });
  if ("error" in r) throw new HttpError(409, r.error!);
  return r;
});
