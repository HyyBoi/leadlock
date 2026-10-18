import { z } from "zod";
import { api, body, HttpError } from "@/lib/api";
import { getIntegration, ProviderError, recordEvent } from "@/server/integrations/registry";
import { whatsapp, WhatsAppConfig } from "@/server/integrations/whatsapp";
import { normalizePhone } from "@/lib/phone";

/** Self-test: checks the token and sends Meta's approved hello_world template to a recipient phone. */
export const POST = api("integrations.manage", async ({ req, ctx }) => {
  const b = await body(req, z.object({ to: z.string().trim().min(8) }));
  const integ = await getIntegration<WhatsAppConfig>(ctx.workspaceId, "WHATSAPP");
  if (!integ) throw new HttpError(409, "Connect WhatsApp first.");
  try {
    const info = await whatsapp.check(integ.config);
    const id = await whatsapp.sendHelloTemplate(integ.config, normalizePhone(b.to));
    await recordEvent({ workspaceId: ctx.workspaceId, provider: "WHATSAPP", direction: "OUT", kind: "selftest.template", result: "OK", reference: id });
    return { ok: true, result: `Token valid for ${info.display}. "hello_world" sent to ${normalizePhone(b.to)} — check that phone's WhatsApp.` };
  } catch (e) {
    const msg = (e as ProviderError).message;
    await recordEvent({ workspaceId: ctx.workspaceId, provider: "WHATSAPP", direction: "OUT", kind: "selftest.template", result: "ERROR", detail: msg });
    throw new HttpError(400, msg);
  }
});
