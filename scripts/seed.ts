/**
 * Demo data: `npm run seed` (uses DATABASE_URL). Creates the "Sunrise Solar" workspace with
 * an owner, a manager, two sales reps, a second pipeline with different fields, contacts,
 * opportunities and 300 extra contacts for pagination. Password for every user: demo12345
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const url = process.env.DATABASE_URL!;
const pool = new pg.Pool({ connectionString: url, ssl: /localhost/.test(url) ? false : { rejectUnauthorized: false } });
const db = drizzle(pool, { schema });

const ALL = ["crm.view", "crm.create", "crm.edit", "crm.delete", "crm.export", "crm.view_value", "leads.view_all", "leads.reassign", "rules.manage", "pipeline.manage", "integrations.manage", "audit.view", "members.manage", "payments.create"];

async function main() {
  const existing = await db.query.workspaces.findFirst({ where: eq(schema.workspaces.slug, "sunrise-solar") });
  if (existing) {
    console.log("Demo workspace already exists (slug sunrise-solar). Nothing to do.");
    return;
  }
  const hash = await bcrypt.hash("demo12345", 12);
  const mk = async (name: string, email: string) => {
    const found = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (found) return found;
    return (await db.insert(schema.users).values({ name, email, passwordHash: hash }).returning())[0];
  };
  const [ws] = await db.insert(schema.workspaces).values({ name: "Sunrise Solar", slug: "sunrise-solar" }).returning();
  const roles = await db.insert(schema.roles).values([
    { workspaceId: ws.id, name: "Admin", permissions: ALL },
    { workspaceId: ws.id, name: "Manager", permissions: ["crm.view", "crm.create", "crm.edit", "crm.export", "crm.view_value", "leads.view_all", "leads.reassign", "audit.view", "payments.create"] },
    { workspaceId: ws.id, name: "Sales", permissions: ["crm.view", "crm.create", "crm.edit", "payments.create"] },
  ]).returning();
  const role = (n: string) => roles.find((r) => r.name === n)!.id;
  const people = [
    { u: await mk("Hannan (Owner)", "owner@sunrise.demo"), level: "OWNER" as const, role: "Admin", leads: false },
    { u: await mk("Maria (Manager)", "manager@sunrise.demo"), level: "ADMIN" as const, role: "Manager", leads: false },
    { u: await mk("Atta (Sales)", "atta@sunrise.demo"), level: "USER" as const, role: "Sales", leads: true },
    { u: await mk("Adeen (Sales)", "adeen@sunrise.demo"), level: "USER" as const, role: "Sales", leads: true },
  ];
  const ms = [];
  for (const p of people) ms.push((await db.insert(schema.memberships).values({ workspaceId: ws.id, userId: p.u.id, level: p.level, roleId: role(p.role), receivesLeads: p.leads }).returning())[0]);
  const [owner, manager, atta, adeen] = ms;
  await db.insert(schema.assignmentRules).values({ workspaceId: ws.id, ackWindowSeconds: 30, maxOpenLeads: 5, backupId: adeen.id, managerId: manager.id, idleSeconds: 600, chain: [{ type: "NEXT_AVAILABLE", seconds: 30 }, { type: "BACKUP", seconds: 30 }, { type: "MANAGER", seconds: 60 }] });

  const mkPipeline = async (name: string, pos: number) => {
    const [p] = await db.insert(schema.pipelines).values({ workspaceId: ws.id, name, position: pos }).returning();
    const st = await db.insert(schema.stages).values(["New", "Site survey", "Proposal", "Won", "Lost"].map((n, i) => ({ workspaceId: ws.id, pipelineId: p.id, name: n, position: i, kind: (n === "Won" ? "WON" : n === "Lost" ? "LOST" : "OPEN") as "OPEN" }))).returning();
    return { p, st };
  };
  const res = await mkPipeline("Residential", 0);
  const com = await mkPipeline("Commercial", 1);
  await db.insert(schema.fieldDefs).values([
    { workspaceId: ws.id, entity: "CONTACT", name: "City", key: "city", type: "DROPDOWN", options: ["Islamabad", "Rawalpindi", "Lahore", "Karachi"] },
    { workspaceId: ws.id, entity: "OPPORTUNITY", pipelineId: res.p.id, name: "Roof type", key: "roof_type", type: "DROPDOWN", options: ["Concrete", "Tin", "Tile"] },
    { workspaceId: ws.id, entity: "OPPORTUNITY", pipelineId: res.p.id, name: "System size (kW)", key: "system_size_kw", type: "NUMBER", position: 1 },
    { workspaceId: ws.id, entity: "OPPORTUNITY", pipelineId: com.p.id, name: "NTN number", key: "ntn_number", type: "TEXT" },
    { workspaceId: ws.id, entity: "OPPORTUNITY", pipelineId: com.p.id, name: "Survey date", key: "survey_date", type: "DATE", position: 1 },
    { workspaceId: ws.id, entity: "OPPORTUNITY", pipelineId: com.p.id, name: "Net metering", key: "net_metering", type: "CHECKBOX", position: 2 },
  ]);
  // F2.4 demo: Proposal requires value + system size in Residential, NTN in Commercial
  await db.update(schema.stages).set({ requiredFields: ["value", "system_size_kw"] }).where(eq(schema.stages.id, res.st[2].id));
  await db.update(schema.stages).set({ requiredFields: ["ntn_number"] }).where(eq(schema.stages.id, com.st[2].id));

  const [co] = await db.insert(schema.companies).values({ workspaceId: ws.id, name: "Margalla Textiles", domain: "margallatex.pk" }).returning();
  const cities = ["Islamabad", "Rawalpindi", "Lahore", "Karachi"];
  const first = ["Ali", "Sara", "Usman", "Ayesha", "Bilal", "Fatima", "Hamza", "Zainab", "Omar", "Hira"];
  const last = ["Khan", "Ahmed", "Malik", "Qureshi", "Butt", "Raza", "Sheikh", "Iqbal"];
  for (let i = 0; i < 300; i++) {
    const owner_ = [atta, adeen][i % 2];
    const [c] = await db.insert(schema.contacts).values({
      workspaceId: ws.id, name: `${first[i % 10]} ${last[i % 8]} ${i + 1}`, phone: `+92300${String(1000000 + i).padStart(7, "0")}`,
      email: `customer${i + 1}@example.com`, tags: i % 7 === 0 ? ["vip"] : i % 3 === 0 ? ["referral"] : [], ownerId: owner_.id,
      companyId: i % 25 === 0 ? co.id : null, customValues: { city: cities[i % 4] }, createdAt: new Date(Date.now() - i * 3600_000),
    }).returning();
    if (i < 40) {
      const pl = i % 4 === 0 ? com : res;
      const stage = pl.st[i % 3];
      await db.insert(schema.opportunities).values({
        workspaceId: ws.id, contactId: c.id, pipelineId: pl.p.id, stageId: stage.id, ownerId: owner_.id,
        title: `${pl.p.name} solar system`, value: (3 + (i % 9)) * 25000_00 / 10, currency: "usd",
        customValues: pl === res ? { roof_type: "Concrete", ...(stage.position === 2 ? { system_size_kw: 10 } : {}) } : { ...(stage.position === 2 ? { ntn_number: "1234567-8" } : {}) },
      });
    }
  }
  console.log(`Seeded workspace "Sunrise Solar". Log in as owner@sunrise.demo / demo12345 (also manager@, atta@, adeen@sunrise.demo). Public form: /f/sunrise-solar`);
  void owner;
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
