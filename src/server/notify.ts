import { eq } from "drizzle-orm";
import { schema, Tx } from "@/db";
import { appUrl } from "./integrations/registry";

const KIND_LABEL = { NEW_LEAD: "🆕 New lead assigned to you", ESCALATED: "🔺 Lead ESCALATED to you", REASSIGNED: "↪️ Lead reassigned to you" };

/** Queue an out-of-app alert (I4). Delivery + retries happen in the outbox worker. */
export async function enqueueAlert(
  tx: Tx,
  workspaceId: string,
  membershipId: string | null,
  leadId: string,
  kind: keyof typeof KIND_LABEL,
  reason: string,
) {
  if (!membershipId) return;
  const lead = await tx.query.leads.findFirst({ where: eq(schema.leads.id, leadId), with: undefined });
  const contact = lead ? await tx.query.contacts.findFirst({ where: eq(schema.contacts.id, lead.contactId) }) : null;
  const url = `${appUrl()}/app/leads/${leadId}`;
  const text =
    `*${KIND_LABEL[kind]}*\n` +
    `*Lead:* ${contact?.name ?? "Unknown"}${contact?.phone ? ` (${contact.phone})` : ""}\n` +
    `*Source:* ${lead?.source.replace("_", " ").toLowerCase()}\n` +
    `*Reason:* ${reason}\n` +
    `<${url}|Open the lead>`;
  await tx.insert(schema.outbox).values({ workspaceId, kind: "ALERT", payload: { membershipId, leadId, text, url } });
}
