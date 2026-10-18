export const PERMISSIONS = {
  "crm.view": "View contacts, companies and opportunities",
  "crm.create": "Create CRM records",
  "crm.edit": "Edit CRM records",
  "crm.delete": "Delete CRM records",
  "crm.export": "Export CRM records",
  "crm.view_value": "See opportunity values",
  "leads.view_all": "See every lead and conversation (not just own)",
  "leads.reassign": "Manually reassign leads",
  "rules.manage": "Manage assignment & escalation rules",
  "pipeline.manage": "Manage pipelines, stages and custom fields",
  "integrations.manage": "Connect, change or remove integrations",
  "audit.view": "View the audit history",
  "members.manage": "Invite members, set levels, roles and permissions",
  "payments.create": "Create payment requests",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: { name: string; permissions: Permission[] }[] = [
  { name: "Admin", permissions: ALL_PERMISSIONS },
  {
    name: "Manager",
    permissions: ["crm.view", "crm.create", "crm.edit", "crm.export", "crm.view_value", "leads.view_all", "leads.reassign", "audit.view", "payments.create"],
  },
  { name: "Sales", permissions: ["crm.view", "crm.create", "crm.edit", "payments.create"] },
];

export function effectivePermissions(level: string, rolePerms: string[] | null | undefined): Set<Permission> {
  if (level === "OWNER") return new Set(ALL_PERMISSIONS);
  return new Set((rolePerms ?? []).filter((p): p is Permission => p in PERMISSIONS));
}
