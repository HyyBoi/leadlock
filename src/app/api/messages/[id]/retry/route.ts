import { api, HttpError } from "@/lib/api";
import { retryMessage } from "@/server/messaging";

export const POST = api<{ id: string }>("crm.edit", async ({ ctx, params }) => {
  const m = await retryMessage(ctx.workspaceId, params.id);
  if (!m) throw new HttpError(409, "Only failed outgoing messages can be retried.");
  return { ok: true };
});
