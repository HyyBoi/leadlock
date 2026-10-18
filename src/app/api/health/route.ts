import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { tick } from "@/server/worker";

/** Health check for uptime pings; also nudges the worker (harmless: tick is idempotent). */
export async function GET() {
  await db.execute(sql`select 1`);
  void tick();
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
