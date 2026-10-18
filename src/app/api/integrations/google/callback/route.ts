import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCtx } from "@/lib/auth";
import { exchangeCode, saveConnection } from "@/server/integrations/google";
import { appUrl, recordEvent } from "@/server/integrations/registry";
import { audit } from "@/server/audit";
import { db } from "@/db";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.redirect(`${appUrl()}/login`);
  const jar = await cookies();
  const [state, membershipId] = (jar.get("g_state")?.value ?? "").split(".");
  jar.delete("g_state");
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return NextResponse.redirect(`${appUrl()}/app/profile?error=${encodeURIComponent(sp.get("error")!)}`);
  if (!state || state !== sp.get("state") || membershipId !== ctx.membershipId) return NextResponse.redirect(`${appUrl()}/app/profile?error=state_mismatch`);
  try {
    const tok = await exchangeCode(sp.get("code") ?? "");
    await saveConnection(ctx.workspaceId, ctx.membershipId, tok);
    await recordEvent({ workspaceId: ctx.workspaceId, provider: "GOOGLE", direction: "IN", kind: "oauth.connected", result: "OK", reference: tok.email });
    await audit(db, ctx.workspaceId, { id: ctx.membershipId, label: ctx.name }, "integration.calendar_connected", { type: "calendar", id: ctx.membershipId }, null, { google: tok.email, refreshToken: !!tok.refresh });
    return NextResponse.redirect(`${appUrl()}/app/profile?connected=google`);
  } catch (e) {
    await recordEvent({ workspaceId: ctx.workspaceId, provider: "GOOGLE", direction: "IN", kind: "oauth.connected", result: "ERROR", detail: (e as Error).message });
    return NextResponse.redirect(`${appUrl()}/app/profile?error=${encodeURIComponent((e as Error).message)}`);
  }
}
