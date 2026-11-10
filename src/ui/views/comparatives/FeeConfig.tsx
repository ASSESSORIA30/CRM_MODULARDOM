"use client";
/**
 * Fase 15 · PREU BASE + FEE (interfície).
 *  · `FeeConfigEditor`   CONFIGURACIÓ DEL FEE COMERCIAL a l'editor del catàleg (només Direcció la pot modificar).
 *  · `FeeEditorPanel`    EDITAR FEE dins del comparador: recalcula a l'instant preus finals, cost, estalvi i remuneració
 *                        estimada sense tornar a consultar el SIPS. No modifica el catàleg (instantània de la comparativa).
 *  · `PricingConfirm`    confirmació de la lectura (CONFIRMAR TARIFA · EDITAR · CORREGIR AMB IA).
 * Tots els FEE es desen en €/kWh; el selector €/kWh ↔ €/MWh només canvia com s'escriuen i es mostren.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Pencil, ShieldCheck, Sparkles } from "lucide-react";
import {
  FEE_UNIT_LABEL, PENDING_COMMISSION, PRICING_MODEL_LABEL, PRICING_MODELS, emptyPricing, energyMargin, estimateRemuneration, feeByPeriod, feeFromEurKwh, feeToEurKwh, finalEnergyPrices, fmtFee,
  iberdrolaOmieLevel, isFeeModel, isIberdrolaOmie, isIndexedModel, parseNumber, pickRemunerationRule, validateFee, type FeeOverride, type FeeUnit, type PricingConfig, type PricingModel, type RemunerationRule,
} from "@/comparator/pricing-model";
import { parsePricingCorrection } from "@/comparator/pricing-rules";
import { periodsOf } from "@/comparator/engine";
import type { Num, OfferEvaluation, OfferVersion } from "@/comparator/types";
import { Badge, Button, Notice } from "../../components/ui";

const f6 = (v: Num) => (v == null ? "—" : v.toLocaleString("ca-ES", { minimumFractionDigits: 3, maximumFractionDigits: 6 }));
const eur = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
const per = (o: Pick<OfferVersion, "accessTariff" | "energyType">) => (o.energyType === "gas" ? 1 : periodsOf(o.accessTariff, o.energyType).energy);
const single = (o: OfferVersion) => o.energyType === "gas" || o.contractType === "fix24h";

/** Camp numèric en la unitat triada; desa en €/kWh. */
function FeeInput({ label, value, unit, onChange, disabled }: { label: string; value: Num; unit: FeeUnit; onChange: (v: Num) => void; disabled?: boolean }) {
  return (
    <label className="block"><span className="label">{label}</span>
      <input key={`${unit}-${value}`} className="input tnum" inputMode="decimal" disabled={disabled} defaultValue={feeFromEurKwh(value, unit) ?? ""} aria-label={label}
        onBlur={(e) => { const n = parseNumber(e.target.value); onChange(e.target.value.trim() === "" ? null : feeToEurKwh(n, unit)); }} /></label>
  );
}

/* ======================================================================= catàleg */

export function FeeConfigEditor({ o, set, isDirector }: { o: OfferVersion; set: (p: Partial<OfferVersion>) => void; isDirector: boolean }) {
  const cfg = o.pricing ?? null;
  const periods = per(o);
  const one = single(o);
  // al catàleg NOMÉS hi ha preus base: el preu desat és el preu base i el FEE es decideix a cada comparativa
  const setCfg = (p: Partial<PricingConfig>) => {
    const next = { ...(cfg ?? emptyPricing()), ...p };
    if (isFeeModel(next.model)) {
      const clean = { ...next, fee: { mode: "unic" as const, single: null, periods: Array(6).fill(null) }, feeEnabled: false };
      set({ pricing: clean, ...(next.model === "FIXED_BASE_FEE" ? (one ? { energy24h: next.baseEnergy24h } : { energy: [...next.baseEnergy] }) : {}) });
    } else set({ pricing: next });
  };
  const chooseModel = (m: PricingModel | "") => {
    if (!m) { set({ pricing: null }); return; }
    const base = cfg ?? { ...emptyPricing(m), baseEnergy: [...o.energy], baseEnergy24h: o.energy24h };
    setCfg({ model: m, feeAllowed: m === "FIXED_BASE_FEE" ? "si" : m === "INDEXED_BASE_FEE" ? "si" : base.feeAllowed });
  };
  const ro = !isDirector;
  return (
    <section className="space-y-2 rounded-xl border border-brand/30 bg-brand/[0.03] p-3" data-testid="config-fee">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12.5px] font-semibold uppercase tracking-wide">Model de preu</p>
        <select className="input h-8 w-auto py-0" aria-label="Model de preu" value={cfg?.model ?? ""} disabled={ro || isIberdrolaOmie(o)} onChange={(e) => chooseModel(e.target.value as PricingModel | "")}>
          <option value="">Model no informat (preu final)</option>
          {PRICING_MODELS.map((m) => <option key={m} value={m}>{PRICING_MODEL_LABEL[m]}</option>)}
        </select>
        {ro && <span className="text-[11.5px] text-muted">Només Direcció pot canviar el model i el marge recomanat.</span>}
      </div>
      {cfg?.detection && <p className="text-[11.5px] text-muted">Detecció: {cfg.detection.evidence.join(" · ") || "—"} (confiança {Math.round(cfg.detection.confidence * 100)} %){cfg.detection.confirmedBy ? ` · confirmada per ${cfg.detection.confirmedBy}` : ""}</p>}
      {cfg && isIberdrolaOmie(o) && <Notice tone="blue">Pla OMIE d&apos;Iberdrola{iberdrolaOmieLevel(o.productName) ? ` · nivell «${iberdrolaOmieLevel(o.productName)}»` : ""}: marge fixat per Iberdrola ({cfg.supplierMarginEurMWh ?? "—"} €/MWh). No s&apos;hi pot afegir cap FEE; per canviar de marge, tria un altre nivell del Pla OMIE.</Notice>}
      {cfg && isIndexedModel(cfg.model) && !isIberdrolaOmie(o) && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block"><span className="label">Marge de la comercialitzadora (€/MWh)</span><input className="input tnum" disabled={ro} defaultValue={cfg.supplierMarginEurMWh ?? ""} onBlur={(e) => setCfg({ supplierMarginEurMWh: parseNumber(e.target.value) })} /></label>
          <label className="block"><span className="label">FEE addicional d&apos;Assessoria 3.0 permès</span><select className="input" disabled={ro} value={cfg.feeAllowed} onChange={(e) => { const v = e.target.value as PricingConfig["feeAllowed"]; setCfg({ feeAllowed: v, model: v === "si" ? "INDEXED_BASE_FEE" : "INDEXED" }); }}><option value="si">Sí (autoritzat al contracte)</option><option value="no">No</option><option value="pendent">Pendent de confirmar</option></select></label>
          <p className="self-end text-[11.5px] text-muted">La fórmula original es conserva. El FEE, si està autoritzat, es posa a cada comparativa com a component separat.</p>
        </div>
      )}
      {cfg && cfg.model === "FIXED_BASE_FEE" && (
        <>
          <div className="grid gap-2 sm:grid-cols-7">
            {(one ? [0] : Array.from({ length: periods }, (_, i) => i)).map((i) => (
              <label key={i} className="block"><span className="label">Preu base {one ? "(únic)" : `P${i + 1}`} €/kWh</span>
                <input className="input tnum" disabled={ro} defaultValue={(one ? cfg.baseEnergy24h : cfg.baseEnergy[i]) ?? ""} onBlur={(e) => { const v = parseNumber(e.target.value); if (one) setCfg({ baseEnergy24h: v }); else setCfg({ baseEnergy: cfg.baseEnergy.map((x, j) => (j === i ? v : x)) }); }} /></label>
            ))}
          </div>
          <Notice tone="blue">Al catàleg es desen <b>només els preus base</b> de la comercialitzadora. La tarifa es pot validar i activar sense cap FEE: el <b>FEE comercial es decideix a cada comparativa</b> (cada client i cada proposta poden tenir-ne un de diferent).</Notice>
        </>
      )}
      {cfg && isFeeModel(cfg.model) && (
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="block"><span className="label">Unitat</span><select className="input" aria-label="Unitat del FEE" disabled={ro} value={cfg.feeInputUnit} onChange={(e) => setCfg({ feeInputUnit: e.target.value as FeeUnit })}><option value="eur_kwh">€/kWh</option><option value="eur_mwh">€/MWh</option></select></label>
          <FeeInput label={`Marge recomanat (${FEE_UNIT_LABEL[cfg.feeInputUnit]}) · només avisa`} unit={cfg.feeInputUnit} value={cfg.recommendedFee} disabled={ro} onChange={(v) => setCfg({ recommendedFee: v })} />
          <FeeInput label={`Màxim contractual real (${FEE_UNIT_LABEL[cfg.feeInputUnit]}) · opcional`} unit={cfg.feeInputUnit} value={cfg.contractMaxFee} disabled={ro} onChange={(v) => setCfg({ contractMaxFee: v })} />
          <label className="block"><span className="label">Base de càlcul</span><select className="input" disabled={ro} value={cfg.feeBasis} onChange={(e) => setCfg({ feeBasis: e.target.value as PricingConfig["feeBasis"] })}><option value="abans_descomptes">FEE abans de descomptes</option><option value="despres_descomptes">FEE després de descomptes</option></select></label>
          <label className="block sm:col-span-3"><span className="label">Condicions / font</span><input className="input" disabled={ro} defaultValue={cfg.termsSource ?? ""} onBlur={(e) => setCfg({ termsSource: e.target.value.trim() || null })} /></label>
          {isDirector && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={cfg.allowNegative} onChange={(e) => setCfg({ allowNegative: e.target.checked })} /> Regla comercial que autoritza FEE negatius</label>}
        </div>
      )}
    </section>
  );
}

/* ======================================================================= comparador */

export function FeeEditorPanel({ offer, value, onChange, evaluation, kwh, kwhTotal, kw, remuneration, readOnly }: {
  offer: OfferVersion; value: FeeOverride | null | undefined; onChange: (v: FeeOverride | null) => void; evaluation: OfferEvaluation | null;
  kwh: Num[]; kwhTotal: Num; kw: Num[]; remuneration: RemunerationRule[] | null; readOnly?: boolean;
}) {
  const cfg = offer.pricing!;
  const periods = per(offer);
  const one = single(offer);
  const idx = offer.contractType === "indexat";
  // per defecte: FEE zero (preu final = preu base). El FEE és propi d'aquesta comparativa i d'aquesta opció.
  const cur: FeeOverride = value ?? { mode: "unic", single: 0, periods: Array(6).fill(null), inputUnit: cfg.feeInputUnit ?? "eur_kwh", enabled: true };
  const [unit, setUnit] = useState<FeeUnit>(cur.inputUnit);
  const editable = !readOnly && (cfg.model === "FIXED_BASE_FEE" || cfg.feeAllowed === "si");
  const chk = validateFee(cfg, cur, periods, { enabled: true });
  const applied = feeByPeriod(cur, periods);
  const margin = energyMargin(offer, kwh, kwhTotal);
  const rem = remuneration ? estimateRemuneration(pickRemunerationRule(remuneration, offer, new Date().toISOString().slice(0, 10)), { margin: margin?.total ?? null, kwhTotal, kwSum: kw.reduce<number>((a, x) => a + (x ?? 0), 0) }) : null;
  const push = (p: Partial<FeeOverride>) => onChange({ ...cur, ...p, inputUnit: unit, enabled: true });
  const finals = idx ? offer.indexedReference?.energy ?? [] : one ? [offer.energy24h] : offer.energy;
  const det = evaluation?.cost.detail?.energy ?? [];
  const rows = (one ? [0] : Array.from({ length: periods }, (_, i) => i)).map((i) => {
    const d = one ? det[0] : det.find((x) => x.period === i + 1);
    return { label: one ? "Únic" : `P${i + 1}`, base: one ? cfg.baseEnergy24h : cfg.baseEnergy[i], fee: applied[i], final: (one ? finals[0] : finals[i]) ?? null, kwh: one ? kwhTotal : kwh[i] ?? null, cost: d?.amount ?? null };
  });
  return (
    <div className="mt-2 rounded-lg border border-brand/40 bg-brand/[0.03] p-2 text-[11.5px]" data-testid="fee-comercial">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-brand">FEE comercial</span>
        <Badge tone={idx ? "blue" : "green"}>{PRICING_MODEL_LABEL[cfg.model]}</Badge>
        <select className="input h-7 w-auto py-0 text-[11.5px]" aria-label="Unitat del FEE" value={unit} onChange={(e) => { const u = e.target.value as FeeUnit; setUnit(u); if (value) onChange({ ...cur, inputUnit: u }); }}><option value="eur_kwh">€/kWh</option><option value="eur_mwh">€/MWh</option></select>
        {!one && <select className="input h-7 w-auto py-0 text-[11.5px]" aria-label="FEE únic o per període" disabled={!editable} value={cur.mode} onChange={(e) => push({ mode: e.target.value as "unic" | "periodes", periods: e.target.value === "periodes" && !value?.periods?.some((x) => x != null) ? Array.from({ length: 6 }, (_, i) => (i < periods ? cur.single ?? 0 : null)) : cur.periods })}><option value="unic">FEE únic (P1–P{periods})</option><option value="periodes">FEE per període</option></select>}
        {(cur.mode === "unic" || one) && <span className="w-28"><FeeInput label={`FEE (${FEE_UNIT_LABEL[unit]})`} unit={unit} value={cur.single} disabled={!editable} onChange={(v) => push({ single: v ?? 0 })} /></span>}
        {value && editable && <button type="button" className="text-brand underline" onClick={() => onChange(null)}>FEE a zero</button>}
      </div>
      {!editable && !readOnly && <Notice tone="amber">{cfg.feeAllowed === "no" ? "Les condicions de la comercialitzadora no permeten afegir FEE." : "FEE addicional pendent de confirmar a les condicions comercials."}</Notice>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-[11px]">
          <thead className="text-left text-[10px] uppercase text-muted"><tr><th className="py-0.5 pr-2">Període</th><th className="pr-2">Preu base (€/kWh)</th><th className="pr-2">FEE ({FEE_UNIT_LABEL[unit]})</th><th className="pr-2">Preu final (€/kWh)</th><th className="pr-2 text-right">Consum anual (kWh)</th><th className="text-right">Cost energia</th></tr></thead>
          <tbody className="tnum">{rows.map((r, i) => (
            <tr key={r.label} className="border-t border-line">
              <td className="py-0.5 pr-2">{r.label}</td><td className="pr-2">{f6(r.base)}</td>
              <td className="pr-2">{cur.mode === "periodes" && !one ? <input className="input h-6 w-24 py-0 text-[11px]" aria-label={`FEE ${r.label}`} disabled={!editable} key={`${unit}-${cur.periods[i]}`} defaultValue={feeFromEurKwh(cur.periods[i] ?? 0, unit) ?? ""} onBlur={(e) => { const n = parseNumber(e.target.value); push({ periods: Array.from({ length: 6 }, (_, j) => (j === i ? (e.target.value.trim() === "" ? 0 : feeToEurKwh(n, unit)) : cur.periods[j] ?? (j < periods ? 0 : null))) }); }} /> : (feeFromEurKwh(r.fee, unit) ?? 0).toLocaleString("ca-ES", { maximumFractionDigits: 6 })}</td>
              <td className="pr-2 font-semibold">{f6(r.final)}</td><td className="pr-2 text-right">{r.kwh == null ? "—" : r.kwh.toLocaleString("ca-ES")}</td><td className="text-right">{eur(r.cost)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {chk.warnings.map((w) => <p key={w} className="mt-1 flex items-center gap-1 font-semibold text-pend"><AlertTriangle size={12} /> {w}</p>)}
      {chk.errors.length > 0 && <p className="mt-1 text-lost">{chk.errors.join(" ")}</p>}
      {evaluation && <p className="mt-1"><span className="text-muted">Cost anual estimat:</span> <b>{eur(evaluation.cost.ok ? evaluation.cost.total : null)}</b> · <span className="text-muted">Estalvi respecte de la tarifa actual:</span> <b className={(evaluation.saving ?? 0) >= 0 ? "text-cont" : "text-lost"}>{eur(evaluation.saving)}</b>{idx && <span className="text-muted"> (indexada: estimació, no garantit)</span>}</p>}
      {remuneration && rem && (
        <p className="mt-0.5" data-testid="remuneracio-fee"><span className="text-muted">Marge anual teòric:</span> {eur(margin?.total ?? null)} · <span className="text-muted">Remuneració estimada:</span> <b>{rem.amount != null ? eur(rem.amount) : PENDING_COMMISSION}</b> <span className="text-[10.5px] text-muted">({rem.formula})</span></p>
      )}
      <p className="mt-0.5 text-[10.5px] text-muted">Preu final = preu base + FEE (€/MWh ÷ 1.000). Només afecta aquesta opció d&apos;aquesta comparativa; la tarifa del catàleg no canvia i no es torna a consultar el SIPS.</p>
    </div>
  );
}

/** Regles de remuneració (només si l'usuari té accés econòmic; si l'API ho denega, no es mostra res). */
export function useRemunerationRules(): RemunerationRule[] | null {
  const [rules, setRules] = useState<RemunerationRule[] | null>(null);
  useEffect(() => { fetch("/api/tariffs?r=fee_remuneration", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: { rules?: RemunerationRule[] } | null) => setRules(j?.rules ?? null)).catch(() => setRules(null)); }, []);
  return rules;
}

/* ======================================================================= confirmació de la lectura */

export function PricingConfirm({ offer, onConfirm, onEdit, onCorrect }: { offer: OfferVersion; onConfirm: () => void; onEdit: () => void; onCorrect: (rule: NonNullable<ReturnType<typeof parsePricingCorrection>["rule"]>, reply: string) => void }) {
  const cfg = offer.pricing!;
  const periods = per(offer);
  const one = single(offer);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const fin = useMemo(() => (isFeeModel(cfg.model) ? finalEnergyPrices(cfg, cfg.fee, periods, cfg.feeEnabled && cfg.feeAllowed === "si") : null), [cfg, periods]);
  return (
    <div className="mt-1.5 space-y-1 rounded-lg border border-brand/30 bg-brand/[0.03] p-2 text-[11.5px]" data-testid="confirmacio-preu">
      <p><Badge tone={isIndexedModel(cfg.model) ? "blue" : "green"}>{PRICING_MODEL_LABEL[cfg.model]}</Badge> <span className="text-muted">confiança {Math.round((cfg.detection?.confidence ?? 0) * 100)} %</span>{cfg.detection?.confirmedBy && <Badge tone="green" className="ml-1"><ShieldCheck size={11} /> confirmada</Badge>}</p>
      {isFeeModel(cfg.model) && <p>Preus base: <span className="tnum">{one ? f6(cfg.baseEnergy24h) : cfg.baseEnergy.slice(0, periods).map((v, i) => `P${i + 1} ${f6(v)}`).join(" · ")}</span> · FEE detectat: {cfg.originalFeeText ?? "—"} · normalitzat: {fmtFee(cfg.fee.single)} · preus finals: <b className="tnum">{fin ? (one ? f6(fin.energy24h) : fin.energy.slice(0, periods).map((v) => f6(v)).join(" · ")) : "—"}</b></p>}
      {isIndexedModel(cfg.model) && <p>Marge de la comercialitzadora: {cfg.supplierMarginEurMWh ?? "—"} €/MWh · FEE addicional: {cfg.feeAllowed === "si" ? "permès" : cfg.feeAllowed === "no" ? "no permès" : "pendent de confirmar"}</p>}
      <p className="text-muted">Permanència: {offer.permanenceMonths ? `${offer.permanenceMonths} mesos` : offer.permanence?.status === "sense" ? "sense" : "no informada"} · Descomptes: {offer.template?.discountText ?? (offer.discounts.length ? offer.discounts.map((d) => d.concept).join(", ") : "cap")}</p>
      {!!cfg.detection?.evidence.length && <p className="text-muted">Evidències: {cfg.detection.evidence.join(" · ")}</p>}
      {!!cfg.detection?.warnings.length && <p className="text-pend">{cfg.detection.warnings.join(" · ")}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={onConfirm}><ShieldCheck size={12} /> CONFIRMAR TARIFA</Button>
        <Button size="sm" variant="ghost" onClick={onEdit}><Pencil size={12} /> EDITAR</Button>
        <input className="input h-7 min-w-[220px] flex-1 py-0 text-[11.5px]" placeholder="Corregir amb IA: «és preu base + FEE en €/MWh», «és indexada»…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Correcció del model de preu" />
        <Button size="sm" variant="ghost" disabled={!text.trim()} onClick={() => { const r = parsePricingCorrection(text, { supplier: offer.supplierName, productName: offer.productName }); setReply(r.reply); if (r.rule) { onCorrect(r.rule, r.reply); setText(""); } }}><Sparkles size={12} /> CORREGIR AMB IA</Button>
      </div>
      {reply && <p className="text-brand">{reply}</p>}
    </div>
  );
}
