"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";

export type FieldSpec = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "date" | "time" | "select" | "checkbox" | "textarea" | "hidden" | "tel";
  options?: { value: string; label: string }[];
  required?: boolean;
  defaultValue?: string | number | boolean | null;
  placeholder?: string;
  help?: string;
  step?: string;
  min?: string;
};

type Status = { kind: "idle" | "loading" | "ok" | "error"; msg?: string; conflict?: boolean; result?: Record<string, unknown> };

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error((json.error as string) ?? `Request failed (${res.status})`) as Error & { details?: Record<string, unknown> };
    err.details = json.details as Record<string, unknown>;
    throw err;
  }
  return json;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts.slice(0, -1)) cur = (cur[p] ??= {}) as Record<string, unknown>;
  cur[parts.at(-1)!] = value;
}

const get = (o: unknown, path: string) => path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], o);

/** Generic JSON form with loading / success / error states (Q10). Conflicts (409 + details.conflict) offer "proceed anyway". */
export function ApiForm(props: {
  action: string;
  method?: string;
  fields: FieldSpec[];
  extra?: Record<string, unknown>;
  submitLabel: string;
  success?: string;
  redirect?: string;
  reset?: boolean;
  resultKeys?: { key: string; label: string; link?: boolean }[];
  inline?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [st, setSt] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(force = false) {
    const form = formRef.current!;
    const data: Record<string, unknown> = { ...(props.extra ?? {}) };
    for (const f of props.fields) {
      const el = form.elements.namedItem(f.name) as HTMLInputElement | null;
      if (!el) continue;
      let v: unknown = el.value;
      if (f.type === "checkbox") v = el.checked;
      else if (f.type === "number") v = el.value === "" ? undefined : Number(el.value);
      if (v !== undefined) setPath(data, f.name, v);
    }
    if (force) data.force = true;
    setSt({ kind: "loading" });
    try {
      const out = await call(props.action, props.method ?? "POST", data);
      setSt({ kind: "ok", msg: props.success ?? "Saved.", result: out });
      if (props.reset) form.reset();
      if (props.redirect) router.push(props.redirect);
      else router.refresh();
    } catch (e) {
      const err = e as Error & { details?: Record<string, unknown> };
      setSt({ kind: "error", msg: err.message, conflict: !!err.details?.conflict });
    }
  }

  return (
    <form
      ref={formRef}
      className={props.className ?? (props.inline ? "flex flex-wrap items-end gap-2" : "grid gap-3")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {props.fields.map((f) => (
        <Field key={f.name} f={f} />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={st.kind === "loading"} aria-busy={st.kind === "loading"}>
          {st.kind === "loading" ? "Working…" : props.submitLabel}
        </button>
        {st.conflict && (
          <button type="button" className="btn btn-warn" onClick={() => submit(true)}>
            Proceed anyway
          </button>
        )}
      </div>
      <StatusLine st={st} />
      {st.kind === "ok" &&
        props.resultKeys?.map((r) => {
          const v = get(st.result, r.key);
          if (!v) return null;
          return (
            <p key={r.key} className="text-sm break-all rounded-md bg-[var(--ok-bg)] p-2">
              <strong>{r.label}:</strong>{" "}
              {r.link ? (
                <a className="link" href={String(v)} target="_blank" rel="noreferrer">
                  {String(v)}
                </a>
              ) : (
                <code>{String(v)}</code>
              )}
            </p>
          );
        })}
    </form>
  );
}

export function Field({ f }: { f: FieldSpec }) {
  const id = `f-${f.name.replace(/\W/g, "-")}`;
  if (f.type === "hidden") return <input type="hidden" name={f.name} defaultValue={String(f.defaultValue ?? "")} />;
  if (f.type === "checkbox")
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input id={id} name={f.name} type="checkbox" defaultChecked={!!f.defaultValue} className="h-4 w-4" />
        {f.label}
      </label>
    );
  return (
    <div className="grid gap-1 min-w-0">
      <label htmlFor={id} className="text-sm font-medium">
        {f.label}
        {f.required && <span aria-hidden className="text-[var(--danger)]"> *</span>}
      </label>
      {f.type === "select" ? (
        <select id={id} name={f.name} required={f.required} defaultValue={String(f.defaultValue ?? "")} className="input">
          {!f.required && <option value="">—</option>}
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : f.type === "textarea" ? (
        <textarea id={id} name={f.name} required={f.required} defaultValue={String(f.defaultValue ?? "")} placeholder={f.placeholder} rows={3} className="input" />
      ) : (
        <input
          id={id}
          name={f.name}
          type={f.type ?? "text"}
          required={f.required}
          step={f.step}
          min={f.min}
          defaultValue={f.defaultValue === null || f.defaultValue === undefined ? undefined : String(f.defaultValue)}
          placeholder={f.placeholder}
          className="input"
        />
      )}
      {f.help && <span className="text-xs text-[var(--muted)]">{f.help}</span>}
    </div>
  );
}

export function StatusLine({ st }: { st: Status }) {
  if (st.kind === "idle" || st.kind === "loading") return <span aria-live="polite" className="sr-only">{st.kind === "loading" ? "Working" : ""}</span>;
  return (
    <p role={st.kind === "error" ? "alert" : "status"} className={`text-sm rounded-md p-2 ${st.kind === "error" ? "bg-[var(--danger-bg)] text-[var(--danger)]" : "bg-[var(--ok-bg)] text-[var(--ok)]"}`}>
      {st.kind === "error" ? "⚠ " : "✓ "}
      {st.msg}
    </p>
  );
}

/** One-click API action with optional confirmation. */
export function ActionButton(props: { url: string; method?: string; body?: unknown; label: string; confirm?: string; variant?: "primary" | "ghost" | "danger" | "warn"; success?: string; redirect?: string; openResultKey?: string }) {
  const router = useRouter();
  const [st, setSt] = useState<Status>({ kind: "idle" });
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={`btn btn-${props.variant ?? "ghost"}`}
        disabled={st.kind === "loading"}
        aria-busy={st.kind === "loading"}
        onClick={async () => {
          if (props.confirm && !window.confirm(props.confirm)) return;
          setSt({ kind: "loading" });
          try {
            const out = await call(props.url, props.method ?? "POST", props.body ?? {});
            setSt({ kind: "ok", msg: props.success ?? "Done." });
            if (props.openResultKey && get(out, props.openResultKey)) window.open(String(get(out, props.openResultKey)), "_blank");
            if (props.redirect) router.push(props.redirect);
            else router.refresh();
          } catch (e) {
            setSt({ kind: "error", msg: (e as Error).message });
          }
        }}
      >
        {st.kind === "loading" ? "Working…" : props.label}
      </button>
      {st.kind !== "idle" && st.kind !== "loading" && <StatusLine st={st} />}
    </span>
  );
}

/** F3.4: visible remaining time. Color + text (never color alone). */
export function Countdown({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (!deadline) return null;
  if (now === null) return <span className="badge">…</span>;
  const left = Math.ceil((new Date(deadline).getTime() - now) / 1000);
  if (left <= 0) return <span role="timer" className="badge badge-danger">⏱ Window expired — escalating</span>;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return (
    <span role="timer" aria-label={`${left} seconds left to acknowledge`} className={`badge ${left <= 10 ? "badge-danger" : left <= 30 ? "badge-warn" : "badge-info"}`}>
      ⏱ {m}:{String(s).padStart(2, "0")} left
    </span>
  );
}

/** Q11: poll a change signature and refresh server data when anything changes. Announces new leads assigned to me. */
export function LiveRefresh() {
  const router = useRouter();
  const sig = useRef<string | null>(null);
  const mine = useRef<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/live", { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { sig: string; myOpen: number };
          if (sig.current !== null && j.sig !== sig.current) router.refresh();
          if (mine.current !== null && j.myOpen > mine.current) setBanner(`🔔 ${j.myOpen - mine.current} new lead${j.myOpen - mine.current > 1 ? "s" : ""} assigned to you — acknowledge before the timer runs out.`);
          sig.current = j.sig;
          mine.current = j.myOpen;
          document.title = j.myOpen ? `(${j.myOpen}) LeadLock` : "LeadLock";
        }
      } catch {}
      if (!stop) setTimeout(poll, 2500);
    };
    poll();
    return () => {
      stop = true;
    };
  }, [router]);
  if (!banner) return null;
  return (
    <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[var(--warn)] bg-[var(--warn-bg)] p-3 text-sm">
      <span>{banner}</span>
      <span className="flex gap-2">
        <a className="btn btn-primary" href="/app/leads">
          View my leads
        </a>
        <button className="btn btn-ghost" onClick={() => setBanner(null)}>
          Dismiss
        </button>
      </span>
    </div>
  );
}

export function Card({ title, children, actions, id }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className="card">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Role-permission matrix editor (F1.3). */
export function RoleEditor({ roleId, name, perms, all, disabled }: { roleId: string; name: string; perms: string[]; all: { key: string; label: string }[]; disabled?: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState(new Set(perms));
  const [st, setSt] = useState<Status>({ kind: "idle" });
  return (
    <fieldset className="card" disabled={disabled}>
      <legend className="px-1 font-semibold">{name}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {all.map((p) => (
          <label key={p.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={sel.has(p.key)}
              onChange={(e) => {
                const n = new Set(sel);
                if (e.target.checked) n.add(p.key);
                else n.delete(p.key);
                setSel(n);
              }}
            />
            <span>
              {p.label} <code className="text-xs text-[var(--muted)]">{p.key}</code>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          className="btn btn-primary"
          type="button"
          onClick={async () => {
            setSt({ kind: "loading" });
            try {
              await call(`/api/roles/${roleId}`, "PATCH", { permissions: [...sel] });
              setSt({ kind: "ok", msg: "Permissions saved." });
              router.refresh();
            } catch (e) {
              setSt({ kind: "error", msg: (e as Error).message });
            }
          }}
        >
          Save {name}
        </button>
        <StatusLine st={st} />
      </div>
    </fieldset>
  );
}

/** F5.5 toggle a dashboard figure on/off (remembered server-side). */
export function DashboardToggles({ items, hidden }: { items: { key: string; label: string }[]; hidden: string[] }) {
  const router = useRouter();
  const [h, setH] = useState(new Set(hidden));
  return (
    <details className="card">
      <summary className="cursor-pointer text-sm font-medium">Customize dashboard</summary>
      <div className="mt-2 flex flex-wrap gap-3">
        {items.map((i) => (
          <label key={i.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={!h.has(i.key)}
              onChange={async (e) => {
                const n = new Set(h);
                if (e.target.checked) n.delete(i.key);
                else n.add(i.key);
                setH(n);
                await call("/api/me/dashboard", "PUT", { hidden: [...n] });
                router.refresh();
              }}
            />
            {i.label}
          </label>
        ))}
      </div>
    </details>
  );
}

/** Escalation chain editor for assignment rules. */
export function RulesEditor(props: {
  rule: { ackWindowSeconds: number; maxOpenLeads: number; idleSeconds: number; backupId: string | null; managerId: string | null; chain: { type: string; seconds: number }[] };
  members: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [chain, setChain] = useState(props.rule.chain);
  const [st, setSt] = useState<Status>({ kind: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const memberOpts = [{ value: "", label: "— none —" }, ...props.members.map((m) => ({ value: m.id, label: m.name }))];
  return (
    <form
      ref={formRef}
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(formRef.current!);
        setSt({ kind: "loading" });
        try {
          await call("/api/rules", "PUT", {
            ackWindowSeconds: Number(f.get("ack")),
            maxOpenLeads: Number(f.get("max")),
            idleSeconds: Number(f.get("idle")),
            backupId: f.get("backup") || null,
            managerId: f.get("manager") || null,
            chain,
          });
          setSt({ kind: "ok", msg: "Rules saved. New timers use these values." });
          router.refresh();
        } catch (err) {
          setSt({ kind: "error", msg: (err as Error).message });
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field f={{ name: "ack", label: "Acknowledgement window (seconds)", type: "number", defaultValue: props.rule.ackWindowSeconds, min: "5", required: true }} />
        <Field f={{ name: "max", label: "Max open leads per employee", type: "number", defaultValue: props.rule.maxOpenLeads, min: "1", required: true }} />
        <Field f={{ name: "idle", label: "Recovery: idle period (seconds)", type: "number", defaultValue: props.rule.idleSeconds, min: "10", required: true }} />
        <Field f={{ name: "backup", label: "Designated backup", type: "select", options: memberOpts, defaultValue: props.rule.backupId ?? "", required: true }} />
        <Field f={{ name: "manager", label: "Manager (final escalation)", type: "select", options: memberOpts, defaultValue: props.rule.managerId ?? "", required: true }} />
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Escalation chain (after the first window expires)</legend>
        <ol className="grid gap-2">
          {chain.map((s, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2">
              <span className="w-16 text-sm text-[var(--muted)]">Level {i + 1}</span>
              <label className="grid gap-1 text-sm">
                Escalate to
                <select
                  className="input"
                  value={s.type}
                  onChange={(e) => setChain(chain.map((c, j) => (j === i ? { ...c, type: e.target.value } : c)))}
                >
                  <option value="NEXT_AVAILABLE">Next available employee</option>
                  <option value="BACKUP">Designated backup</option>
                  <option value="MANAGER">Manager</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                Seconds to acknowledge
                <input
                  className="input w-28"
                  type="number"
                  min={5}
                  value={s.seconds}
                  onChange={(e) => setChain(chain.map((c, j) => (j === i ? { ...c, seconds: Number(e.target.value) } : c)))}
                />
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => setChain(chain.filter((_, j) => j !== i))} aria-label={`Remove level ${i + 1}`}>
                Remove
              </button>
            </li>
          ))}
        </ol>
        <div>
          <button type="button" className="btn btn-ghost" onClick={() => setChain([...chain, { type: "MANAGER", seconds: 60 }])}>
            + Add level
          </button>
        </div>
      </fieldset>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary">Save rules</button>
        <StatusLine st={st} />
      </div>
    </form>
  );
}

/** Stage order editor (F2.5). */
export function StageReorder({ pipelineId, stages }: { pipelineId: string; stages: { id: string; name: string }[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(stages);
  const [st, setSt] = useState<Status>({ kind: "idle" });
  const move = (i: number, d: number) => {
    const n = [...order];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    setOrder(n);
  };
  return (
    <div className="grid gap-2">
      <ol className="grid gap-1">
        {order.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className="w-6 text-[var(--muted)]">{i + 1}.</span>
            <span className="flex-1">{s.name}</span>
            <button type="button" className="btn btn-ghost px-2" onClick={() => move(i, -1)} aria-label={`Move ${s.name} up`} disabled={i === 0}>
              ↑
            </button>
            <button type="button" className="btn btn-ghost px-2" onClick={() => move(i, 1)} aria-label={`Move ${s.name} down`} disabled={i === order.length - 1}>
              ↓
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            setSt({ kind: "loading" });
            try {
              await call(`/api/pipelines/${pipelineId}/reorder`, "POST", { stageIds: order.map((s) => s.id) });
              setSt({ kind: "ok", msg: "Order saved." });
              router.refresh();
            } catch (e) {
              setSt({ kind: "error", msg: (e as Error).message });
            }
          }}
        >
          Save order
        </button>
        <StatusLine st={st} />
      </div>
    </div>
  );
}

/** Opportunity stage mover (board/list) — shows the required-field message when blocked. */
export function StageSelect({ oppId, version, stageId, stages }: { oppId: string; version: number; stageId: string; stages: { id: string; name: string }[] }) {
  const router = useRouter();
  const [st, setSt] = useState<Status>({ kind: "idle" });
  return (
    <div className="grid gap-1">
      <label className="sr-only" htmlFor={`stage-${oppId}`}>
        Move to stage
      </label>
      <select
        id={`stage-${oppId}`}
        className="input"
        value={stageId}
        disabled={st.kind === "loading"}
        onChange={async (e) => {
          setSt({ kind: "loading" });
          try {
            await call(`/api/opportunities/${oppId}/move`, "POST", { stageId: e.target.value, version });
            setSt({ kind: "idle" });
            router.refresh();
          } catch (err) {
            setSt({ kind: "error", msg: (err as Error).message });
          }
        }}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {st.kind === "error" && <StatusLine st={st} />}
    </div>
  );
}
