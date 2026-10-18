import { NextRequest, NextResponse } from "next/server";
import { ZodError, ZodType } from "zod";
import { Ctx, getCtx } from "./auth";
import { Permission } from "./permissions";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const forbidden = (perm?: string) =>
  new HttpError(403, perm ? `You don't have the "${perm}" permission.` : "You are not allowed to do this.");
export const notFound = (what = "Record") => new HttpError(404, `${what} not found.`);
export const conflict = (msg: string) => new HttpError(409, msg);
export const bad = (msg: string, details?: unknown) => new HttpError(400, msg, details);

type Handler<P> = (args: { req: NextRequest; ctx: Ctx; params: P }) => Promise<unknown>;

/** CSRF defence for cookie-authenticated mutations: Origin must match this host. */
function checkOrigin(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) throw new HttpError(403, "Missing Origin header.");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw new HttpError(403, "Cross-site request blocked.");
}

export function toResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  if (e instanceof ZodError)
    return NextResponse.json(
      { error: "Some fields are invalid: " + e.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ") },
      { status: 400 },
    );
  console.error(e);
  return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
}

/** Authenticated, workspace-scoped, permission-checked API route. */
export function api<P = Record<string, string>>(perm: Permission | Permission[] | null, handler: Handler<P>) {
  return async (req: NextRequest, { params }: { params: Promise<P> }) => {
    try {
      checkOrigin(req);
      const ctx = await getCtx();
      if (!ctx) throw new HttpError(401, "Please log in again.");
      const needs = perm == null ? [] : Array.isArray(perm) ? perm : [perm];
      for (const p of needs) if (!ctx.perms.has(p)) throw forbidden(p);
      const out = await handler({ req, ctx, params: await params });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return toResponse(e);
    }
  };
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw bad("Request body must be JSON.");
  }
  return schema.parse(raw);
}
