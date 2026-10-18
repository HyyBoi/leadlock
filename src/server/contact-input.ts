import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { HttpError } from "@/lib/api";

export const ContactBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  companyId: z.string().optional().or(z.literal("")),
  tags: z.string().max(300).optional(),
  customValues: z.record(z.string(), z.unknown()).optional(),
  version: z.number().int().optional(),
});

export const parseTags = (s?: string) => (s ? [...new Set(s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20) : []);

export async function checkCompany(workspaceId: string, companyId?: string) {
  if (!companyId) return null;
  const c = await db.query.companies.findFirst({ where: (t, { and }) => and(eq(t.id, companyId), eq(t.workspaceId, workspaceId)) });
  if (!c) throw new HttpError(400, "That company does not exist in this workspace.");
  return c.id;
}

