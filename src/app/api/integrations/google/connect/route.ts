import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCtx } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { googleAuthUrl, googleConfigured } from "@/server/integrations/google";
import { appUrl } from "@/server/integrations/registry";

/** I3.1: each employee connects their OWN Google account via OAuth consent (state cookie protects against CSRF). */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.redirect(`${appUrl()}/login`);
  if (!googleConfigured()) return NextResponse.redirect(`${appUrl()}/app/profile?error=google_not_configured`);
  const state = randomToken(16);
  (await cookies()).set("g_state", `${state}.${ctx.membershipId}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return NextResponse.redirect(googleAuthUrl(state));
}
