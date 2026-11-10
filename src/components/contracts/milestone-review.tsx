"use client";

// Pantalla de revisió de fites: acceptar, corregir, reordenar, afegir, eliminar, fusionar i dividir.
// Cada canvi es desa a la base de dades (que bloqueja tot un cop validat el contracte).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addMilestoneAction, deleteMilestoneAction, mergeMilestonesAction, moveMilestoneAction, saveMilestoneAction, splitMilestoneAction,
} from "@/app/(app)/projectes/[id]/contractes/actions";
import type { ContractTexts } from "@/lib/i18n-pressupostos";
import { centsToInput, formatCents } from "@/lib/money";
import { formatRate } from "@/lib/quotes/calc";

export type ReviewMilestone = {
  id: string; position: number; code: string | null; phase: string | null; concept: string; amountCents: number;
  vatRateBp: number | null; conceptType: string | null; triggerCondition: string | null; isExtra: boolean;
  sourcePage: number | null; sourceText: string | null; origin: string; confirmed: boolean; billingStatus: string;
};

const cell = "w-full rounded border border-navy/15 bg-white px-2 py-1 text-sm focus:border-gold focus:outline-none disabled:bg-slate-50";

function Row({ m, locked, T, errors, vatRates, conceptTypes, docUrl, selected, onSelect, first, last }: {
  m: ReviewMilestone; locked: boolean; T: ContractTexts; errors: Record<string, string>; vatRates: number[];
  conceptTypes: { code: string; label: string }[]; docUrl: string | null; selected: boolean; onSelect: (v: boolean) => void; first: boolean; last: boolean;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    code: m.code ?? "", phase: m.phase ?? "", concept: m.concept, amount: centsToInput(m.amountCents),
    vatRateBp: m.vatRateBp == null ? "" : String(m.vatRateBp), conceptType: m.conceptType ?? "", triggerCondition: m.triggerCondition ?? "", confirmed: m.confirmed,
  });
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setDirty(true); setErr(null); };
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) { setDirty(false); router.refresh(); } else setErr(errors[r.error ?? ""] ?? T.errors[r.error ?? ""] ?? errors.genericError);
  });
  const save = (confirmed = f.confirmed) => run(() => saveMilestoneAction({ id: m.id, ...f, confirmed }));

  return (
    <tr className={`align-top ${m.confirmed ? "bg-emerald-50/50" : ""}`} data-testid="milestone-row">
      <td className="p-1 pt-2">{!locked && <input type="checkbox" aria-label={T.merge} checked={selected} onChange={(e) => onSelect(e.target.checked)} />}</td>
      <td className="p-1 pt-2 text-xs text-muted">{m.position}</td>
      <td className="p-1"><input aria-label={T.code} value={f.code} disabled={locked} onChange={(e) => set({ code: e.target.value })} className={cell + " w-20 font-mono"} /></td>
      <td className="p-1">
        <input aria-label={T.phase} value={f.phase} disabled={locked} onChange={(e) => set({ phase: e.target.value })} className={cell} />
        {m.isExtra && <span className="mt-1 inline-block rounded bg-gold-light px-1.5 text-[11px] font-semibold text-navy">{T.extra}</span>}
      </td>
      <td className="p-1">
        <textarea aria-label={T.concept} rows={2} value={f.concept} disabled={locked} onChange={(e) => set({ concept: e.target.value })} className={cell} />
        <textarea aria-label={T.trigger} rows={1} placeholder={T.trigger} value={f.triggerCondition} disabled={locked} onChange={(e) => set({ triggerCondition: e.target.value })} className={cell + " mt-1 text-xs"} />
      </td>
      <td className="p-1"><input aria-label={T.amount} inputMode="decimal" value={f.amount} disabled={locked} onChange={(e) => set({ amount: e.target.value })} className={cell + " w-28 text-right tabular-nums"} /></td>
      <td className="p-1">
        <select aria-label={T.vat} value={f.vatRateBp} disabled={locked} onChange={(e) => set({ vatRateBp: e.target.value })} className={cell + (f.vatRateBp === "" ? " border-amber-400" : "")}>
          <option value="">—</option>
          {vatRates.map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
        </select>
        <select aria-label={T.concept} value={f.conceptType} disabled={locked} onChange={(e) => set({ conceptType: e.target.value })} className={cell + " mt-1 text-xs"}>
          <option value="">—</option>
          {conceptTypes.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
        </select>
      </td>
      <td className="p-1 text-xs">
        {m.sourcePage && docUrl ? <a href={`${docUrl}#page=${m.sourcePage}`} target="_blank" rel="noopener" className="font-semibold text-navy underline">{T.page} {m.sourcePage}</a> : null}
        <span className="ml-1 text-muted">{T.origin[m.origin] ?? m.origin}</span>
        {m.sourceText && <p className="mt-1 line-clamp-4 italic text-muted" title={m.sourceText}>«{m.sourceText}»</p>}
      </td>
      <td className="p-1 pt-2 text-center">
        <input type="checkbox" aria-label={T.confirmed} checked={f.confirmed} disabled={locked || pending}
          onChange={(e) => { set({ confirmed: e.target.checked }); save(e.target.checked); }} />
      </td>
      <td className="whitespace-nowrap p-1 text-right">
        {!locked && (
          <>
            {dirty && <button type="button" onClick={() => save()} disabled={pending} className="mr-1 rounded bg-navy px-2 py-1 text-xs font-semibold text-white">{T.saveRow}</button>}
            <button type="button" aria-label={T.up} title={T.up} disabled={first || pending} onClick={() => run(() => moveMilestoneAction(m.id, -1))} className="px-1 text-muted disabled:opacity-30">↑</button>
            <button type="button" aria-label={T.down} title={T.down} disabled={last || pending} onClick={() => run(() => moveMilestoneAction(m.id, 1))} className="px-1 text-muted disabled:opacity-30">↓</button>
            <button type="button" title={T.split} disabled={pending} className="px-1 text-xs text-navy"
              onClick={() => { const v = window.prompt(T.splitPrompt, ""); if (v) run(() => splitMilestoneAction(m.id, v.split(";").map((s) => s.trim()).filter(Boolean))); }}>✂</button>
            <button type="button" title={T.del} aria-label={T.del} disabled={pending} onClick={() => run(() => deleteMilestoneAction(m.id))} className="px-1 text-red-700">✕</button>
          </>
        )}
        {err && <p role="alert" className="mt-1 max-w-48 whitespace-normal text-left text-xs text-red-700">{err}</p>}
      </td>
    </tr>
  );
}

export function MilestoneReview({ contractId, milestones, locked, totalCents, T, errors, vatRates, conceptTypes, docUrl }: {
  contractId: string; milestones: ReviewMilestone[]; locked: boolean; totalCents: number | null; T: ContractTexts;
  errors: Record<string, string>; vatRates: number[]; conceptTypes: { code: string; label: string }[]; docUrl: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sum = milestones.reduce((s, m) => s + m.amountCents, 0);
  const diff = totalCents == null ? null : totalCents - sum;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) { setSelected([]); setErr(null); router.refresh(); } else setErr(errors[r.error ?? ""] ?? T.errors[r.error ?? ""] ?? errors.genericError);
  });

  // Subtotals per fase
  const phases = new Map<string, number>();
  for (const m of milestones) phases.set(m.phase ?? "—", (phases.get(m.phase ?? "—") ?? 0) + m.amountCents);

  return (
    <div className="space-y-3" data-testid="milestone-review">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg bg-surface px-3 py-2 text-sm">
        <span>{T.sum}: <b className="tabular-nums" data-testid="milestones-sum">{formatCents(sum)}</b></span>
        {diff != null && (diff === 0
          ? <span className="font-semibold text-emerald-700">✓ {T.ok}</span>
          : <span className="font-semibold text-red-700">{T.diff}: {formatCents(diff)}</span>)}
        <span className="text-muted">{milestones.filter((m) => m.confirmed).length}/{milestones.length} {T.confirmed.toLowerCase()}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="w-6 p-1" /><th className="w-6 p-1">#</th><th className="p-1">{T.code}</th><th className="w-48 p-1">{T.phase}</th><th className="p-1">{T.concept}</th>
              <th className="p-1 text-right">{T.amount}</th><th className="w-36 p-1">{T.vat}</th><th className="w-56 p-1">{T.source}</th><th className="p-1">{T.confirmed}</th><th className="p-1" /></tr>
          </thead>
          <tbody>
            {milestones.map((m, i) => (
              <Row key={`${m.id}-${m.position}-${m.amountCents}-${m.confirmed}`} m={m} locked={locked} T={T} errors={errors} vatRates={vatRates} conceptTypes={conceptTypes}
                docUrl={docUrl} first={i === 0} last={i === milestones.length - 1} selected={selected.includes(m.id)}
                onSelect={(v) => setSelected((s) => (v ? [...s, m.id] : s.filter((x) => x !== m.id)))} />
            ))}
          </tbody>
        </table>
      </div>
      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => run(() => addMilestoneAction({ contractId, afterPosition: null, isExtra: false, phase: null }))}
            className="rounded-md border border-navy/15 bg-white px-3 py-1.5 text-sm text-navy" data-testid="add-milestone">{T.add}</button>
          <button type="button" disabled={pending || selected.length < 2} onClick={() => run(() => mergeMilestonesAction(selected))}
            className="rounded-md border border-navy/15 bg-white px-3 py-1.5 text-sm text-navy disabled:opacity-40">{T.merge} ({selected.length})</button>
          {err && <span role="alert" className="text-sm text-red-700">{err}</span>}
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-navy">{T.phase}: subtotals</summary>
        <ul className="mt-1 grid gap-1 sm:grid-cols-2">
          {[...phases.entries()].map(([p, s]) => <li key={p} className="flex justify-between gap-3 border-b border-navy/5"><span>{p}</span><span className="tabular-nums">{formatCents(s)}</span></li>)}
        </ul>
      </details>
    </div>
  );
}
