import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCtx } from "./auth";
import { Permission } from "./permissions";

/** Server-component guard: logged in + (optionally) a permission. Pages never trust the client. */
export async function requirePage(perm?: Permission) {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (perm && !ctx.perms.has(perm)) redirect(`/app/denied?perm=${perm}`);
  return ctx;
}

export async function membersOf(workspaceId: string) {
  return db
    .select({ id: schema.memberships.id, name: schema.users.name, email: schema.users.email, level: schema.memberships.level, availability: schema.memberships.availability, receivesLeads: schema.memberships.receivesLeads, active: schema.memberships.active, roleId: schema.memberships.roleId, slackUserId: schema.memberships.slackUserId, timezone: schema.memberships.timezone })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.workspaceId, workspaceId))
    .orderBy(asc(schema.memberships.createdAt));
}

export const AVAIL_LABEL: Record<string, string> = { AVAILABLE: "Available", BUSY: "Busy", ON_LEAVE: "On leave", OFFLINE: "Offline" };
export const SOURCE_LABEL: Record<string, string> = { WEB_FORM: "Web form", WHATSAPP: "WhatsApp", MANUAL: "Manual" };
