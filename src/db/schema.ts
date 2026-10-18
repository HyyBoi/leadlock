import {
  pgTable, text, integer, boolean, timestamp, jsonb, pgEnum, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { randomUUID } from "crypto";

const id = () => text("id").primaryKey().$defaultFn(() => randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true });
const created = () => ts("created_at").notNull().defaultNow();
const ws = () => text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" });

export const levelEnum = pgEnum("level", ["OWNER", "ADMIN", "USER"]);
export const availabilityEnum = pgEnum("availability", ["AVAILABLE", "BUSY", "ON_LEAVE", "OFFLINE"]);
export const fieldTypeEnum = pgEnum("field_type", ["TEXT", "NUMBER", "DATE", "DROPDOWN", "CHECKBOX"]);
export const fieldEntityEnum = pgEnum("field_entity", ["CONTACT", "OPPORTUNITY"]);
export const stageKindEnum = pgEnum("stage_kind", ["OPEN", "WON", "LOST"]);
export const leadSourceEnum = pgEnum("lead_source", ["WEB_FORM", "WHATSAPP", "MANUAL"]);
export const leadStatusEnum = pgEnum("lead_status", ["OPEN", "ACKNOWLEDGED", "CLOSED"]);
export const msgStatusEnum = pgEnum("message_status", ["QUEUED", "SENT", "DELIVERED", "READ", "FAILED", "RECEIVED"]);
export const payStatusEnum = pgEnum("payment_status", ["PENDING", "PAID", "FAILED", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED"]);
export const providerEnum = pgEnum("provider", ["TWILIO", "STRIPE", "GOOGLE", "TELEGRAM", "WHATSAPP", "SLACK"]);
export const integStatusEnum = pgEnum("integration_status", ["NOT_CONNECTED", "CONNECTED", "ERROR"]);
export const outboxStatusEnum = pgEnum("outbox_status", ["PENDING", "DONE", "FAILED"]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: created(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: created(),
});

export const sessions = pgTable("sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: ws(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: created(),
});

export const loginAttempts = pgTable("login_attempts", {
  id: id(),
  key: text("key").notNull(),
  success: boolean("success").notNull(),
  createdAt: created(),
}, (t) => [index("login_attempts_key_idx").on(t.key, t.createdAt)]);

export const roles = pgTable("roles", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  permissions: text("permissions").array().notNull().default([]),
  createdAt: created(),
}, (t) => [uniqueIndex("roles_ws_name").on(t.workspaceId, t.name)]);

export const memberships = pgTable("memberships", {
  id: id(),
  workspaceId: ws(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  level: levelEnum("level").notNull().default("USER"),
  roleId: text("role_id").references(() => roles.id, { onDelete: "set null" }),
  availability: availabilityEnum("availability").notNull().default("AVAILABLE"),
  receivesLeads: boolean("receives_leads").notNull().default(true),
  timezone: text("timezone").notNull().default("Asia/Karachi"),
  telegramChatId: text("telegram_chat_id"),
  telegramLinkToken: text("telegram_link_token").unique(),
  slackUserId: text("slack_user_id"),
  slackEmail: text("slack_email"),
  dashboardHidden: text("dashboard_hidden").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
}, (t) => [uniqueIndex("memberships_ws_user").on(t.workspaceId, t.userId)]);

export const companies = pgTable("companies", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  domain: text("domain"),
  createdAt: created(),
});

export const contacts = pgTable("contacts", {
  id: id(),
  workspaceId: ws(),
  companyId: text("company_id").references(() => companies.id, { onDelete: "set null" }),
  ownerId: text("owner_id").references(() => memberships.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  tags: text("tags").array().notNull().default([]),
  optedOut: boolean("opted_out").notNull().default(false),
  optOutReason: text("opt_out_reason"),
  customValues: jsonb("custom_values").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("contacts_ws_phone").on(t.workspaceId, t.phone),
  index("contacts_ws_created").on(t.workspaceId, t.createdAt),
]);

export const pipelines = pgTable("pipelines", {
  id: id(),
  workspaceId: ws(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: created(),
});

export const stages = pgTable("stages", {
  id: id(),
  workspaceId: ws(),
  pipelineId: text("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  kind: stageKindEnum("kind").notNull().default("OPEN"),
  requiredFields: text("required_fields").array().notNull().default([]),
});

export const fieldDefs = pgTable("field_defs", {
  id: id(),
  workspaceId: ws(),
  entity: fieldEntityEnum("entity").notNull(),
  pipelineId: text("pipeline_id").references(() => pipelines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  key: text("key").notNull(),
  type: fieldTypeEnum("type").notNull(),
  options: text("options").array().notNull().default([]),
  position: integer("position").notNull().default(0),
  createdAt: created(),
});

export const opportunities = pgTable("opportunities", {
  id: id(),
  workspaceId: ws(),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  pipelineId: text("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "restrict" }),
  stageId: text("stage_id").notNull().references(() => stages.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").references(() => memberships.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  value: integer("value").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  customValues: jsonb("custom_values").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),
  closedAt: ts("closed_at"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("opps_ws_stage").on(t.workspaceId, t.stageId)]);

export const leads = pgTable("leads", {
  id: id(),
  workspaceId: ws(),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  source: leadSourceEnum("source").notNull(),
  status: leadStatusEnum("status").notNull().default("OPEN"),
  message: text("message"),
  ownerId: text("owner_id").references(() => memberships.id, { onDelete: "set null" }),
  assignedAt: ts("assigned_at"),
  firstAssignedAt: ts("first_assigned_at"),
  acknowledgedAt: ts("acknowledged_at"),
  firstAcknowledgedAt: ts("first_acknowledged_at"),
  deadlineAt: ts("deadline_at"),
  escalationLevel: integer("escalation_level").notNull().default(0),
  escalationCount: integer("escalation_count").notNull().default(0),
  windowExpired: boolean("window_expired").notNull().default(false),
  lastActionAt: ts("last_action_at").notNull().defaultNow(),
  assignReason: text("assign_reason"),
  version: integer("version").notNull().default(1),
  createdAt: created(),
}, (t) => [index("leads_due").on(t.workspaceId, t.status, t.deadlineAt)]);

export type ChainStep = { type: "NEXT_AVAILABLE" | "BACKUP" | "MANAGER"; seconds: number };

export const assignmentRules = pgTable("assignment_rules", {
  id: id(),
  workspaceId: ws().unique(),
  ackWindowSeconds: integer("ack_window_seconds").notNull().default(60),
  maxOpenLeads: integer("max_open_leads").notNull().default(10),
  chain: jsonb("chain").$type<ChainStep[]>().notNull().default([
    { type: "NEXT_AVAILABLE", seconds: 60 },
    { type: "BACKUP", seconds: 60 },
    { type: "MANAGER", seconds: 120 },
  ]),
  backupId: text("backup_id").references(() => memberships.id, { onDelete: "set null" }),
  managerId: text("manager_id").references(() => memberships.id, { onDelete: "set null" }),
  idleSeconds: integer("idle_seconds").notNull().default(600),
  rrCursor: text("rr_cursor"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const activities = pgTable("activities", {
  id: id(),
  workspaceId: ws(),
  contactId: text("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
  leadId: text("lead_id").references(() => leads.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  actorId: text("actor_id"),
  actorLabel: text("actor_label").notNull(),
  summary: text("summary").notNull(),
  data: jsonb("data"),
  createdAt: created(),
}, (t) => [index("activities_contact").on(t.workspaceId, t.contactId, t.createdAt)]);

// Audit rows are protected by a DB trigger (see drizzle/0001_audit_guard.sql): no UPDATE or DELETE.
export const auditLogs = pgTable("audit_logs", {
  id: id(),
  workspaceId: text("workspace_id").notNull(),
  actorId: text("actor_id"),
  actorLabel: text("actor_label").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: created(),
}, (t) => [index("audit_ws_created").on(t.workspaceId, t.createdAt)]);

export type ListFilters = {
  q?: string; tag?: string; stageId?: string; ownerId?: string; source?: string;
  createdFrom?: string; createdTo?: string; field?: { key: string; value: string };
};

export const savedLists = pgTable("saved_lists", {
  id: id(),
  workspaceId: ws(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<ListFilters>().notNull(),
  createdAt: created(),
});

export const conversations = pgTable("conversations", {
  id: id(),
  workspaceId: ws(),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("WHATSAPP"),
  lastMessageAt: ts("last_message_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("conv_ws_contact_channel").on(t.workspaceId, t.contactId, t.channel)]);

export const messages = pgTable("messages", {
  id: id(),
  workspaceId: ws(),
  conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // IN | OUT
  body: text("body").notNull(),
  status: msgStatusEnum("status").notNull(),
  providerSid: text("provider_sid").unique(),
  error: text("error"),
  sentById: text("sent_by_id"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: id(),
  workspaceId: ws(),
  opportunityId: text("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  requestedById: text("requested_by_id"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: payStatusEnum("status").notNull().default("PENDING"),
  lastError: text("last_error"),
  providerRef: text("provider_ref").unique(),
  providerPayment: text("provider_payment"),
  url: text("url"),
  refundedAmount: integer("refunded_amount").notNull().default(0),
  paidAt: ts("paid_at"),
  createdAt: created(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const appointments = pgTable("appointments", {
  id: id(),
  workspaceId: ws(),
  contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  opportunityId: text("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
  membershipId: text("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  startAt: ts("start_at").notNull(),
  endAt: ts("end_at").notNull(),
  timezone: text("timezone").notNull(),
  googleEventId: text("google_event_id"),
  status: text("status").notNull().default("SCHEDULED"),
  createdAt: created(),
});

export const calendarConnections = pgTable("calendar_connections", {
  id: id(),
  workspaceId: ws(),
  membershipId: text("membership_id").notNull().unique().references(() => memberships.id, { onDelete: "cascade" }),
  googleEmail: text("google_email"),
  accessEnc: text("access_enc").notNull(),
  refreshEnc: text("refresh_enc"),
  expiresAt: ts("expires_at").notNull(),
  status: text("status").notNull().default("CONNECTED"),
  lastError: text("last_error"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const integrations = pgTable("integrations", {
  id: id(),
  workspaceId: ws(),
  provider: providerEnum("provider").notNull(),
  status: integStatusEnum("status").notNull().default("NOT_CONNECTED"),
  configEnc: text("config_enc"),
  hints: jsonb("hints").$type<Record<string, string>>().notNull().default({}),
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("integrations_ws_provider").on(t.workspaceId, t.provider)]);

export const integrationEvents = pgTable("integration_events", {
  id: id(),
  workspaceId: ws(),
  provider: providerEnum("provider").notNull(),
  direction: text("direction").notNull(), // IN | OUT
  kind: text("kind").notNull(),
  reference: text("reference"),
  dedupeKey: text("dedupe_key").unique(),
  result: text("result").notNull(), // OK | REJECTED | ERROR | DUPLICATE | RETRY
  detail: text("detail"),
  createdAt: created(),
}, (t) => [index("ievents_ws_created").on(t.workspaceId, t.createdAt)]);

export const outbox = pgTable("outbox", {
  id: id(),
  workspaceId: ws(),
  kind: text("kind").notNull(), // WHATSAPP_SEND | TELEGRAM_ALERT
  payload: jsonb("payload").$type<Record<string, string>>().notNull(),
  status: outboxStatusEnum("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(4),
  nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: created(),
}, (t) => [index("outbox_due").on(t.status, t.nextAttemptAt)]);
