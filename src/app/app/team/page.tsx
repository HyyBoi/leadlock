import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePage, membersOf, AVAIL_LABEL } from "@/lib/page";
import { ApiForm, Card, RoleEditor } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { ACKED_LEAD_POLICY } from "@/server/leads";

const STATUS_OPTS = Object.entries(AVAIL_LABEL).map(([value, label]) => ({ value, label }));

export default async function Team() {
  const ctx = await requirePage();
  const members = await membersOf(ctx.workspaceId);
  const roles = await db.query.roles.findMany({ where: eq(schema.roles.workspaceId, ctx.workspaceId) });
  const conns = await db.query.calendarConnections.findMany({ where: eq(schema.calendarConnections.workspaceId, ctx.workspaceId) });
  const manage = ctx.perms.has("members.manage");
  const setOthers = manage || ctx.perms.has("leads.reassign");
  const all = Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label }));
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Team & roles</h1>
      <p className="text-sm text-[var(--muted)]">{ACKED_LEAD_POLICY}</p>
      <div className="card scroll-x">
        <table className="table">
          <thead><tr><th>Member</th><th>Level / role</th><th>Availability</th><th>Calendar</th><th>Telegram</th>{manage && <th>Manage</th>}</tr></thead>
          <tbody>
            {members.map((m) => {
              const cal = conns.find((c) => c.membershipId === m.id);
              const editable = manage && m.level !== "OWNER" && (ctx.level === "OWNER" || m.level !== "ADMIN");
              return (
                <tr key={m.id} className={m.active ? "" : "opacity-60"}>
                  <td><strong>{m.name}</strong><div className="text-xs">{m.email}</div>{!m.receivesLeads && <span className="badge">doesn&apos;t receive leads</span>}{!m.active && <span className="badge badge-danger">deactivated</span>}</td>
                  <td>{m.level}<div className="text-xs">{roles.find((r) => r.id === m.roleId)?.name ?? "—"}</div></td>
                  <td className="min-w-44">{(setOthers || m.id === ctx.membershipId) ? <ApiForm action={`/api/members/${m.id}/availability`} inline submitLabel="Set" success="Updated." fields={[{ name: "status", label: AVAIL_LABEL[m.availability], type: "select", required: true, defaultValue: m.availability, options: STATUS_OPTS }]} /> : AVAIL_LABEL[m.availability]}</td>
                  <td>{cal ? (cal.status === "CONNECTED" ? <span className="badge badge-ok">✓ connected</span> : <span className="badge badge-danger">needs reconnect</span>) : <span className="badge">not connected</span>}</td>
                  <td>{m.telegramChatId ? <span className="badge badge-ok">✓ linked</span> : <span className="badge">not linked</span>}</td>
                  {manage && <td className="min-w-56">{editable ? (
                    <details><summary className="cursor-pointer link text-sm">Edit</summary>
                      <ApiForm action={`/api/members/${m.id}`} method="PATCH" submitLabel="Save" success="Member updated." fields={[
                        { name: "level", label: "Level", type: "select", required: true, defaultValue: m.level, options: [{ value: "USER", label: "User" }, ...(ctx.level === "OWNER" ? [{ value: "ADMIN", label: "Admin" }] : [])] },
                        { name: "roleId", label: "Role", type: "select", required: true, defaultValue: m.roleId, options: roles.map((r) => ({ value: r.id, label: r.name })) },
                        { name: "receivesLeads", label: "Receives new leads", type: "checkbox", defaultValue: m.receivesLeads },
                        { name: "active", label: "Active (can log in)", type: "checkbox", defaultValue: m.active },
                      ]} />
                    </details>) : <span className="text-xs text-[var(--muted)]">{m.level === "OWNER" ? "Owner can't be modified" : "Only the Owner can edit Admins"}</span>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {manage && (
        <Card title="Invite a member">
          <ApiForm action="/api/members" submitLabel="Invite" success="Member added. Share the temporary password with them privately." reset className="grid gap-3 sm:grid-cols-2" resultKeys={[{ key: "tempPassword", label: "Temporary password (shown once)" }]} fields={[
            { name: "name", label: "Name", required: true },
            { name: "email", label: "Email", type: "email", required: true },
            { name: "level", label: "Level", type: "select", required: true, options: [{ value: "USER", label: "User" }, ...(ctx.level === "OWNER" ? [{ value: "ADMIN", label: "Admin" }] : [])] },
            { name: "roleId", label: "Role (permissions)", type: "select", required: true, options: roles.map((r) => ({ value: r.id, label: r.name })) },
          ]} />
        </Card>
      )}
      {manage && (
        <section className="grid gap-3">
          <h2 className="text-xl font-bold">Roles & permissions</h2>
          <p className="text-sm text-[var(--muted)]">Permissions are attached to roles, not to level names. The Owner always has every permission. A “Manager” is just a role.</p>
          <div className="grid gap-3 lg:grid-cols-2">{roles.map((r) => <RoleEditor key={r.id} roleId={r.id} name={r.name} perms={r.permissions} all={all} />)}</div>
          <Card title="New role"><ApiForm action="/api/roles" inline submitLabel="Create role" success="Role created — set its permissions above." fields={[{ name: "name", label: "Role name", required: true }]} /></Card>
        </section>
      )}
    </div>
  );
}
