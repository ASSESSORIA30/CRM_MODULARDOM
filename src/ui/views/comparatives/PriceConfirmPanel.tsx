"use client";
/**
 * CONFIRMACIÓ DE PREUS (final de «Contracte actual»).
 * Mostra els preus que entraran al càlcul (energia P1–P6 o preu únic, potència P1–P6, terme fix del gas) amb l'origen
 * i l'estat de cada un. «Veure càlcul» desplega, per període, de quins components surt el preu final (ATR + energia
 * lliure + altres − descomptes) i permet corregir-los: el total es recalcula a l'instant. Una correcció de classificació
 * es pot «Ensenyar a la IA» (regla persistent, amb autorització). El botó «Confirmar preus i continuar» desa els valors.
 */
import { useState } from "react";
import { CheckCircle2, ChevronDown, GraduationCap, RotateCcw } from "lucide-react";
import { ENERGY_CONCEPTS, ENERGY_CONCEPT_LABEL, type EnergyComponent, type EnergyConcept } from "@/comparator/energy-breakdown";
import { recomputeBreakdown } from "@/comparator/invoice";
import { PRICE_STATE_LABEL, clearPriceManual, confirmPrices, markPriceManual, priceRows, priceSummary, type PriceRow, type PriceState } from "@/comparator/price-review";
import { POWER_UNIT_LABEL, type Num, type PowerUnit } from "@/comparator/types";
import { serverMode } from "@/comparator/client";
import { useApp } from "@/data/store";
import { Button, Notice, cn } from "../../components/ui";
import { useWizard } from "./state";

const TONE: Record<PriceState, string> = {
  verificat: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  completar: "bg-red-500/15 text-red-700 dark:text-red-300",
  revisar: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  manual: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  no_necessari: "bg-ink/[0.06] text-muted",
};
const fmt = (v: number | null | undefined, d = 6) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 2, maximumFractionDigits: d }));
const toNum = (s: string): Num => { const t = s.replace(/\s/g, "").replace(",", "."); if (!t) return null; const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null; };
const sameNum = (a: Num, b: Num) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 5e-10);

function PriceInput({ value, onChange, label, className }: { value: Num; onChange: (v: Num) => void; label: string; className?: string }) {
  return <input aria-label={label} className={cn("input tnum h-8 py-1 text-[12.5px]", className)} inputMode="decimal" defaultValue={value ?? ""} key={String(value)} onBlur={(e) => { const v = toNum(e.target.value); if (!sameNum(v, value)) onChange(v); }} />;
}

export function PriceConfirmPanel({ onContinue }: { onContinue: () => void }) {
  const w = useWizard();
  const me = useApp((s) => s.snap?.me);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const cur = w.current;
  if (!cur) return null;
  const inv = w.invoice?.data ?? null;
  const rows = priceRows({ supply: w.supply, current: cur, invoice: inv, review: w.priceReview });
  const sum = priceSummary(rows, w.priceReview);
  const comps = inv?.energyComponents ?? [];

  /** Canvi del valor que entra al càlcul (i marca «modificat a mà», guardant el valor anterior). */
  const setValue = (r: PriceRow, v: Num) => {
    const review = markPriceManual(w.priceReview, r.key, r.value);
    if (r.key === "e24") w.setCurrent({ energy24h: v });
    else if (r.key === "gfix") w.setCurrent({ gasFixedEurDay: v });
    else if (r.kind === "energia") w.setCurrent({ energy: cur.energy.map((x, i) => (i === r.period! - 1 ? v : x)) });
    else w.setCurrent({ power: cur.power.map((x, i) => (i === r.period! - 1 ? v : x)) });
    w.set({ priceReview: review });
  };
  const restore = (r: PriceRow) => {
    const original = w.priceReview?.manual[r.key]?.original ?? null;
    const review = clearPriceManual(w.priceReview, r.key);
    if (r.key === "e24") w.setCurrent({ energy24h: original });
    else if (r.key === "gfix") w.setCurrent({ gasFixedEurDay: original });
    else if (r.kind === "energia") w.setCurrent({ energy: cur.energy.map((x, i) => (i === r.period! - 1 ? original : x)) });
    else w.setCurrent({ power: cur.power.map((x, i) => (i === r.period! - 1 ? original : x)) });
    w.set({ priceReview: review });
  };
  /** Correcció d'un component: es recalcula el total del període a l'instant i el preu passa al contracte actual. */
  const updateComps = (next: EnergyComponent[]) => {
    if (!w.invoice || !inv) return;
    const data = { ...inv, energyComponents: next };
    const { breakdown, prices } = recomputeBreakdown(data, next);
    data.energyBreakdown = breakdown;
    w.set({ invoice: { ...w.invoice, data } });
    w.setCurrent({ energy: cur.energy.map((x, i) => (breakdown.some((b) => b.period === i + 1) ? prices[i] : x)) });
  };
  const editComp = (idx: number, patch: Partial<EnergyComponent>) =>
    updateComps(comps.map((c, i) => (i === idx ? { ...c, ...patch, method: "manual" as const, original: c.original ?? { kwh: c.kwh, unitPrice: c.unitPrice, amount: c.amount }, originalConcept: patch.concept && patch.concept !== c.concept ? c.originalConcept ?? c.concept : c.originalConcept ?? null } : c)));
  const restoreComp = (idx: number) => updateComps(comps.map((c, i) => (i === idx ? { ...c, ...(c.original ?? {}), concept: c.originalConcept ?? c.concept, originalConcept: null, method: "text" as const } : c)));

  const confirm = () => {
    try {
      w.set({ priceReview: confirmPrices(rows, w.priceReview, me?.name ?? null) });
      setMsg(null);
      onContinue();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };

  const energy = rows.filter((r) => r.kind !== "potencia");
  const power = rows.filter((r) => r.kind === "potencia");
  return (
    <div id="confirmacio-preus" data-testid="confirmacio-preus" className="space-y-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13.5px] font-semibold">Preus que es faran servir a la comparativa</h4>
        <span className="text-[11.5px] text-muted">Energia en €/kWh · potència a part · sense quotes, SAS, impostos ni lloguer</span>
      </div>
      {sum.allAuto ? (
        <Notice tone="green">Tots els preus s&apos;han calculat i verificat automàticament a partir de la factura. No cal confirmar res.</Notice>
      ) : sum.needsAction ? (
        <Notice tone="amber">
          {sum.missing.length > 0 && <>Falta: <b>{sum.missing.join(", ")}</b>. Introdueix-los a mà (o tria «No tinc els preus actuals»). </>}
          {sum.toReview.filter((x) => !sum.missing.includes(x)).length > 0 && <>Cal revisar: <b>{sum.toReview.filter((x) => !sum.missing.includes(x)).join(", ")}</b>.</>}
        </Notice>
      ) : sum.confirmed ? <Notice tone="green">Preus confirmats{w.priceReview?.confirmedBy ? ` per ${w.priceReview.confirmedBy}` : ""}.</Notice> : null}

      <PriceTable title="Energia" rows={energy} open={open} setOpen={(k) => setOpen((o) => ({ ...o, [k]: !o[k] }))} onValue={setValue} onRestore={restore}
        renderDetail={(r) => r.breakdown && <Breakdown row={r} comps={comps} retailer={w.currentRetailer || inv?.retailer.value || null} onEdit={editComp} onRestore={restoreComp} />} />
      {power.length > 0 && (
        <>
          <PriceTable title="Potència" rows={power} open={open} setOpen={() => undefined} onValue={setValue} onRestore={restore} />
          <label className="flex max-w-xs items-center gap-2 text-[12px]">
            <span className="text-muted">Unitat de potència</span>
            <select className="input h-8 py-1" value={cur.powerUnit} onChange={(e) => w.setCurrent({ powerUnit: e.target.value as PowerUnit })}>
              {(Object.keys(POWER_UNIT_LABEL) as PowerUnit[]).map((u) => <option key={u} value={u}>{POWER_UNIT_LABEL[u]}</option>)}
            </select>
          </label>
        </>
      )}
      {msg && <p className="text-[12px] text-red-700 dark:text-red-300">{msg}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!sum.canConfirm && <span className="text-[12px] text-muted">Completa els preus que falten per poder confirmar.</span>}
        <Button variant="primary" data-testid="confirmar-preus" disabled={!sum.canConfirm} onClick={confirm}><CheckCircle2 size={15} /> Confirmar preus i continuar</Button>
      </div>
    </div>
  );
}

function PriceTable({ title, rows, open, setOpen, onValue, onRestore, renderDetail }: {
  title: string; rows: PriceRow[]; open: Record<string, boolean>; setOpen: (k: string) => void; onValue: (r: PriceRow, v: Num) => void; onRestore: (r: PriceRow) => void; renderDetail?: (r: PriceRow) => React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[12.5px]">
        <thead className="text-left text-[11px] text-muted"><tr><th className="py-1">{title}</th><th>Preu final</th><th>Estat</th><th>Origen</th><th className="text-right">Detall</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <RowFrag key={r.key}>
              <tr className="border-t border-line align-top" data-testid={`preu-${r.key}`}>
                <td className="py-1.5 pr-2 font-medium">{r.label}</td>
                <td className="w-44 py-1 pr-2">
                  <div className="flex items-center gap-1"><PriceInput label={r.label} value={r.value} onChange={(v) => onValue(r, v)} className={cn(r.state === "completar" && "border-red-400", r.state === "revisar" && "border-amber-400", "font-semibold")} /><span className="whitespace-nowrap text-[10.5px] text-muted">{r.unit}</span></div>
                </td>
                <td className="py-1.5 pr-2"><span data-testid={`estat-${r.key}`} className={cn("whitespace-nowrap rounded px-1.5 py-0.5 text-[10.5px] font-semibold", TONE[r.state])}>{PRICE_STATE_LABEL[r.state]}</span>{r.reason && <p className="mt-0.5 max-w-[260px] text-[11px] text-muted">{r.reason}</p>}</td>
                <td className="py-1.5 pr-2 text-[11.5px] text-muted">{r.origin}{r.converted && <p className="text-[10.5px]">{r.converted}</p>}</td>
                <td className="py-1 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {r.state === "manual" && <Button size="sm" variant="ghost" title="Torna al valor de la factura" onClick={() => onRestore(r)}><RotateCcw size={13} /></Button>}
                    {r.breakdown && renderDetail && (
                      <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-muted hover:bg-ink/5 hover:text-ink" aria-expanded={!!open[r.key]} onClick={() => setOpen(r.key)} data-testid={`veure-calcul-${r.key}`}>
                        Veure càlcul <ChevronDown size={13} className={cn("transition-transform", open[r.key] && "rotate-180")} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              {open[r.key] && renderDetail && <tr><td colSpan={5} className="pb-2">{renderDetail(r)}</td></tr>}
            </RowFrag>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function RowFrag({ children }: { children: React.ReactNode }) { return <>{children}</>; }

const KIND: Record<string, { label: string; tone: string }> = {
  extret: { label: "extret", tone: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  calculat: { label: "calculat", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  manual: { label: "modificat a mà", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
};

/** Detall d'un període: components, total destacat, origen i comprovacions. */
export function Breakdown({ row, comps, retailer, onEdit, onRestore }: { row: PriceRow; comps: EnergyComponent[]; retailer: string | null; onEdit: (idx: number, p: Partial<EnergyComponent>) => void; onRestore: (idx: number) => void }) {
  const b = row.breakdown!;
  const [teach, setTeach] = useState<number | null>(null);
  const list = comps.map((c, idx) => ({ c, idx })).filter(({ c }) => c.period === b.period);
  const dupLabels = new Set(b.parts.filter((p) => p.duplicate).map((p) => `${p.label}|${p.page}`));
  const anyManual = list.some(({ c }) => c.method === "manual");
  const state = b.status === "pendent" ? "Pendent de revisar" : anyManual ? "Recalculat amb correccions manuals" : b.verified ? "Calculat automàticament a partir de la factura" : "Calculat, però cal revisar-ho";
  return (
    <div className="space-y-2 rounded-lg bg-ink/[0.03] p-2.5" data-testid={`calcul-${row.key}`}>
      <div className="divide-y divide-line">
        {list.map(({ c, idx }) => {
          const dup = dupLabels.has(`${c.label}|${c.page}`);
          const excluded = c.concept === "inclos" || (c.concept === "energia" && b.parts.some((p) => p.concept !== "energia" && p.concept !== "inclos"));
          const kind = c.method === "manual" ? "manual" : c.unitPrice == null ? "calculat" : "extret";
          const changedConcept = c.originalConcept && c.originalConcept !== c.concept;
          return (
            <div key={idx} className={cn("grid items-center gap-2 py-1.5 sm:grid-cols-[1.7fr_1.1fr_0.8fr_auto]", (dup || excluded) && "opacity-60")}>
              <div className="min-w-0 text-[12px]">
                <select aria-label="Concepte" className="input h-7 max-w-full py-0 text-[12px] font-semibold" value={c.concept} onChange={(e) => onEdit(idx, { concept: e.target.value as EnergyConcept })}>
                  {ENERGY_CONCEPTS.map((k) => <option key={k} value={k}>{ENERGY_CONCEPT_LABEL[k]}</option>)}
                </select>
                <div className="mt-0.5 truncate text-[11px] text-muted" title={c.label}>Factura{c.page ? ` · p.${c.page}` : ""} · «{c.label}»{c.ruleId ? " · regla apresa" : ""}</div>
                {dup && <div className="text-[11px] text-amber-700 dark:text-amber-300">Línia repetida: no es torna a sumar</div>}
                {c.concept === "inclos" && <div className="text-[11px] text-muted">Ja inclòs: no se suma</div>}
              </div>
              <div className="flex items-center gap-1">
                <PriceInput label={`Preu ${ENERGY_CONCEPT_LABEL[c.concept]}`} value={c.unitPrice} onChange={(v) => onEdit(idx, { unitPrice: v })} />
                <span className="text-[10.5px] text-muted">€/kWh</span>
              </div>
              <div className="text-[11px] text-muted tnum">{c.kwh != null ? `${c.kwh.toLocaleString("ca-ES", { maximumFractionDigits: 3 })} kWh` : ""}{c.amount != null ? ` · ${fmt(c.amount, 2)} €` : ""}</div>
              <div className="flex items-center justify-end gap-1">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", KIND[kind].tone)}>{KIND[kind].label}</span>
                {c.method === "manual" && <Button size="sm" variant="ghost" title={`Original: ${fmt(c.original?.unitPrice)} €/kWh`} onClick={() => onRestore(idx)}><RotateCcw size={12} /></Button>}
                {changedConcept && <Button size="sm" variant="ghost" onClick={() => setTeach(teach === idx ? null : idx)}><GraduationCap size={13} /> Ensenyar aquesta correcció a la IA</Button>}
              </div>
              {teach === idx && <TeachRule comp={c} retailer={retailer} onClose={() => setTeach(null)} />}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-brand/[0.07] px-2.5 py-1.5">
        <span className="text-[12.5px] font-semibold">Total P{b.period}</span>
        <span className="tnum text-[14px] font-bold" data-testid={`total-${row.key}`}>{b.total == null ? "Pendent" : `${fmt(b.total)} €/kWh`}</span>
      </div>
      <p className="text-[11.5px]"><b>Estat:</b> {state}.{b.note ? ` ${b.note}` : ""}</p>
      {(b.checks ?? []).length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-muted">{b.checks!.map((c) => <li key={c}>{c}</li>)}</ul>}
      {anyManual && !list.some(({ c }) => c.originalConcept && c.originalConcept !== c.concept) && <p className="text-[11px] text-muted">Els canvis de preu o import són correccions puntuals d&apos;aquesta factura (no es converteixen en regla).</p>}
    </div>
  );
}

/** «Ensenyar aquesta correcció a la IA»: l'usuari confirma l'abast; la regla queda proposada o aprovada segons el rol. */
function TeachRule({ comp, retailer, onClose }: { comp: EnergyComponent; retailer: string | null; onClose: () => void }) {
  const role = useApp((s) => s.snap?.me.role);
  const [scope, setScope] = useState<"retailer" | "general">(retailer ? "retailer" : "general");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const label = comp.label.includes(" · ") ? comp.label.split(" · ")[0] : comp.label;
  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/invoices/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "learn", rule: { retailer: scope === "retailer" ? retailer : null, label, concept: comp.concept, previousConcept: comp.originalConcept ?? null } }) });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      setResult(r.ok ? j.message ?? "Regla desada" : `⚠ ${j.error ?? `Error ${r.status}`}`);
    } catch (e) { setResult(`⚠ ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 rounded-md border border-line bg-surface p-2.5 text-[12px] sm:col-span-4">
      <p>A partir d&apos;ara, la línia <b>«{label}»</b> es llegirà com a <b>{ENERGY_CONCEPT_LABEL[comp.concept]}</b>{comp.originalConcept ? <> (abans: {ENERGY_CONCEPT_LABEL[comp.originalConcept]})</> : null}.</p>
      <div className="flex flex-wrap gap-3">
        {retailer && <label className="flex items-center gap-1.5"><input type="radio" checked={scope === "retailer"} onChange={() => setScope("retailer")} /> Només {retailer}</label>}
        <label className={cn("flex items-center gap-1.5", role !== "admin" && "opacity-50")} title={role !== "admin" ? "Només Direcció pot crear regles per a totes les comercialitzadores" : undefined}><input type="radio" disabled={role !== "admin"} checked={scope === "general"} onChange={() => setScope("general")} /> Totes les comercialitzadores</label>
      </div>
      <p className="text-[11px] text-muted">{role === "admin" || (role === "cap_administrativa" && scope === "retailer") ? "Quedarà aprovada i s'aplicarà a les factures que es llegeixin a partir d'ara." : "Quedarà proposada: s'aplicarà quan l'aprovi Direcció o la cap d'administració."}</p>
      {result ? <p className={cn(result.startsWith("⚠") ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}>{result}</p> : null}
      <div className="flex gap-2">
        {!result?.startsWith("Regla") && <Button size="sm" variant="primary" disabled={busy || !serverMode()} onClick={() => void save()}>Desa la regla</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>Tanca</Button>
      </div>
    </div>
  );
}
