"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RequiredFields({ stageId, current, options }: { stageId: string; current: string[]; options: { key: string; name: string }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState(new Set(current));
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <fieldset className="grid gap-1">
      <legend className="text-sm font-medium">Required before entering this stage</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <label key={o.key} className="flex items-center gap-1 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={sel.has(o.key)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(o.key); else n.delete(o.key); setSel(n); }} />
            {o.name}
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost" onClick={async () => {
          const r = await fetch(`/api/stages/${stageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requiredFields: [...sel] }) });
          const j = await r.json().catch(() => ({}));
          setMsg(r.ok ? { ok: true, t: "Required fields saved." } : { ok: false, t: j.error ?? "Failed" });
          if (r.ok) router.refresh();
        }}>Save required fields</button>
        {msg && <span role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>{msg.t}</span>}
      </div>
    </fieldset>
  );
}
