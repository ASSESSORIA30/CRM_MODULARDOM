/**
 * Fase 15 · MOTOR CENTRAL DE MODELS DE PREU: PREU BASE + FEE i INDEXADA + MARGE (lògica pura, servidor i navegador).
 *
 * Quatre models explícits (mai una simple etiqueta visual: el càlcul depèn del model):
 *   FIXED_FINAL        preu fix final de la comercialitzadora (no s'hi afegeix res)
 *   FIXED_BASE_FEE     preu base fix per període + FEE comercial d'Assessoria 3.0      PREU_FINAL_Pn = BASE_Pn + FEE_Pn
 *   INDEXED            indexada amb fórmula pròpia (el marge de la comercialitzadora és un component de la fórmula)
 *   INDEXED_BASE_FEE   indexada amb FEE addicional configurable, NOMÉS si el contracte ho autoritza; el FEE és un
 *                      component explícit de la fórmula (€/MWh), mai se suma «a cegues» al preu OMIE.
 *
 * Regles:
 *  · El PREU BASE no es sobreescriu mai: el preu final sempre es recalcula des de la base (idempotent, sense dobles FEE).
 *  · Tots els FEE es desen normalitzats a €/kWh amb aritmètica decimal (10 €/MWh = 0,010 €/kWh exactes).
 *  · El FEE energètic només s'aplica a l'energia, mai a la potència.
 *  · FEE recomanat (intern, només avís) ≠ màxim contractual de la comercialitzadora (error si se supera).
 *  · FEE negatiu: rebutjat llevat d'una regla comercial explícita (`allowNegative`). FEE = 0 → preu final = preu base.
 *  · FEE COMERCIAL ≠ COMISSIÓ REMUNERADA: la remuneració surt d'una regla de la comercialitzadora; sense regla confirmada
 *    → «COMISSIÓ PENDENT DE CONFIGURAR». Mai s'assumeix que el 100 % del marge és d'Assessoria 3.0.
 */
import Decimal from "decimal.js-light";
import type { Num, OfferVersion } from "./types";

export const PRICING_MODELS = ["FIXED_FINAL", "FIXED_BASE_FEE", "INDEXED", "INDEXED_BASE_FEE"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];
export const PRICING_MODEL_LABEL: Record<PricingModel, string> = {
  FIXED_FINAL: "Preu fix final",
  FIXED_BASE_FEE: "Preu fix base + FEE",
  INDEXED: "Indexada (fórmula pròpia)",
  INDEXED_BASE_FEE: "Indexada + FEE configurable",
};
export const FEE_UNITS = ["eur_kwh", "eur_mwh"] as const;
export type FeeUnit = (typeof FEE_UNITS)[number];
export const FEE_UNIT_LABEL: Record<FeeUnit, string> = { eur_kwh: "€/kWh", eur_mwh: "€/MWh" };
export type FeeMode = "unic" | "periodes";
export type FeeAllowed = "si" | "no" | "pendent";

export const isFeeModel = (m: PricingModel | null | undefined) => m === "FIXED_BASE_FEE" || m === "INDEXED_BASE_FEE";
export const isIndexedModel = (m: PricingModel | null | undefined) => m === "INDEXED" || m === "INDEXED_BASE_FEE";

/** FEE normalitzat a €/kWh. `periods` es conserva encara que el mode sigui «unic» (canviar de mode no perd res). */
export interface FeeValues { mode: FeeMode; single: Num; periods: Num[] }

export interface PricingConfig {
  model: PricingModel;
  /** Preus BASE d'energia (€/kWh) tal com els dona la comercialitzadora. Mai es modifiquen en canviar el FEE. */
  baseEnergy: Num[];
  baseEnergy24h: Num;
  /** FEE per defecte del catàleg (€/kWh). */
  fee: FeeValues;
  feeEnabled: boolean;
  /** Unitat en què s'ha introduït (només visualització; el valor sempre és €/kWh). */
  feeInputUnit: FeeUnit;
  /** FEE recomanat intern (€/kWh): només genera un avís. */
  recommendedFee: Num;
  /** Màxim contractual real de la comercialitzadora (€/kWh): superar-lo és un error. */
  contractMaxFee: Num;
  /** Regla comercial explícita que autoritza FEE negatius. */
  allowNegative: boolean;
  /** El contracte permet afegir un FEE d'Assessoria 3.0? «pendent» = no confirmat: no s'aplica cap FEE. */
  feeAllowed: FeeAllowed;
  /** Base de càlcul respecte dels descomptes percentuals d'energia de la tarifa. */
  feeBasis: "abans_descomptes" | "despres_descomptes";
  /** Indexades: marge de la comercialitzadora (€/MWh), component de la fórmula. NO és el FEE d'Assessoria 3.0. */
  supplierMarginEurMWh: Num;
  /** Document o clàusula d'on surten les condicions del FEE (traçabilitat). */
  termsSource: string | null;
  /** Versió de la configuració del FEE (s'incrementa a cada canvi del catàleg). */
  configVersion: number;
  /** FEE tal com apareixia al document (text original), si n'hi havia. */
  originalFeeText?: string | null;
  /** Lectura automàtica: evidències, confiança (0–1) i advertiments. */
  detection?: { evidence: string[]; confidence: number; warnings: string[]; confirmedBy?: string | null } | null;
  /** FEE efectivament aplicat (€/kWh per període) i d'on surt: catàleg o comparativa. El calcula `applyPricing`. */
  appliedFee?: (number | null)[] | null;
  source?: "cataleg" | "comparativa";
}

/** FEE triat en una comparativa (instantània: no modifica el catàleg). */
export interface FeeOverride { mode: FeeMode; single: Num; periods: Num[]; inputUnit: FeeUnit; enabled?: boolean; justification?: string | null }

/* ======================================================================= unitats i parseig */

const D = (v: Decimal | number | string) => new Decimal(v);
/** Precisió interna dels preus i FEE (€/kWh): 9 decimals (numeric(14,9) a Supabase). */
const DP = 9;
const r9 = (d: Decimal) => Number(d.toDecimalPlaces(DP, Decimal.ROUND_HALF_UP).toString());

/** Converteix un FEE a €/kWh amb aritmètica decimal (10 €/MWh → 0,01 €/kWh; 2 €/MWh → 0,002 €/kWh). */
export function feeToEurKwh(value: Num, unit: FeeUnit): Num {
  if (value == null || !Number.isFinite(value)) return null;
  return unit === "eur_mwh" ? r9(D(value).dividedBy(1000)) : r9(D(value));
}
/** I a l'inrevés (per mostrar-lo a la unitat d'entrada). */
export function feeFromEurKwh(value: Num, unit: FeeUnit): Num {
  if (value == null) return null;
  return unit === "eur_mwh" ? r9(D(value).times(1000)) : value;
}

/**
 * Llegeix un número escrit a mà o en un document: «0,012», «0.012», «1.234,5», «1,234.5», «10». Mai no confon una coma
 * decimal amb un separador de milers quan hi ha ambigüitat: «1,234» es llegeix com 1,234 (decimal), que és el cas
 * habitual dels preus d'energia en documents espanyols i catalans.
 */
export function parseNumber(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = raw.trim().replace(/\s|€/g, "");
  if (!s) return null;
  const neg = /^[-−]/.test(s);
  s = s.replace(/^[-−+]/, "");
  // separador de milers només quan és inequívoc (dos grups o amb decimal de l'altre signe): «0,012» i «1,234» són decimals
  if (/^\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) || /^[1-9]\d{0,2}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(,\d{3}){2,}(\.\d+)?$/.test(s) || /^[1-9]\d{0,2}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** Unitat d'un FEE en un text: «€/MWh», «eur/MWh», «€/kWh», «c€/kWh»… null si no s'indica (cal confirmar-la). */
export function parseFeeUnit(text: string | null | undefined): FeeUnit | null {
  const t = (text ?? "").toLowerCase().replace(/\s/g, "");
  if (/(€|eur|euros?)\/?mwh/.test(t)) return "eur_mwh";
  if (/(€|eur|euros?)\/?kwh/.test(t)) return "eur_kwh";
  return null;
}

/** «10 €/MWh» → 0,010 €/kWh. Sense unitat → `needsConfirmation` (no s'interpreta arbitràriament). */
export function parseFee(text: string): { value: Num; unit: FeeUnit | null; eurKwh: Num; needsConfirmation: boolean; original: string } {
  const m = text.match(/([-−]?\d[\d.,]*)\s*(c?€|eur|euros?)?\s*\/?\s*(mwh|kwh)?/i);
  const value = m ? parseNumber(m[1]) : null;
  const unit = parseFeeUnit(text);
  const centimos = /c€|cts?|c[eé]ntimos?/i.test(text) && unit === "eur_kwh";
  const v = centimos && value != null ? r9(D(value).dividedBy(100)) : value;
  return { value: v, unit, eurKwh: unit ? feeToEurKwh(v, unit) : null, needsConfirmation: value == null || !unit, original: text.trim().slice(0, 120) };
}

/* ======================================================================= configuració */

export function emptyPricing(model: PricingModel = "FIXED_FINAL"): PricingConfig {
  return {
    model, baseEnergy: Array(6).fill(null), baseEnergy24h: null, fee: { mode: "unic", single: null, periods: Array(6).fill(null) }, feeEnabled: isFeeModel(model),
    feeInputUnit: "eur_kwh", recommendedFee: null, contractMaxFee: null, allowNegative: false, feeAllowed: isFeeModel(model) ? "si" : "no", feeBasis: "abans_descomptes",
    supplierMarginEurMWh: null, termsSource: null, configVersion: 1, originalFeeText: null, detection: null,
  };
}

/** FEE per període (€/kWh) segons el mode. En mode «per període», un període sense valor és 0 només si el mode és únic. */
export function feeByPeriod(fee: Pick<FeeValues, "mode" | "single" | "periods">, periods: number): (number | null)[] {
  // un període sense valor = FEE zero (es pot deixar el FEE a zero en qualsevol període)
  return Array.from({ length: 6 }, (_, i) => (i >= periods ? null : fee.mode === "unic" ? fee.single ?? 0 : fee.periods[i] ?? 0));
}

export interface FeeCheck { errors: string[]; warnings: string[] }
/** Valida un FEE contra la configuració (servidor i navegador amb la mateixa funció). */
export function validateFee(cfg: PricingConfig, fee: Pick<FeeValues, "mode" | "single" | "periods">, periods: number, opts: { enabled?: boolean } = {}): FeeCheck {
  const errors: string[] = [], warnings: string[] = [];
  const enabled = opts.enabled ?? cfg.feeEnabled;
  const values = feeByPeriod(fee, periods).slice(0, periods);
  const any = values.some((v) => v != null && v !== 0);
  if (!isFeeModel(cfg.model)) { if (any && opts.enabled !== false) errors.push(`La tarifa és ${PRICING_MODEL_LABEL[cfg.model]}: no admet cap FEE.`); return { errors, warnings }; }
  if (!enabled) return { errors, warnings };
  // PREU BASE + FEE fix: el FEE el decideix Assessoria 3.0 a cada comparativa (sempre admès). Indexades: cal autorització.
  if (cfg.model === "INDEXED_BASE_FEE" && cfg.feeAllowed !== "si" && any) errors.push(cfg.feeAllowed === "no" ? "Les condicions de la comercialitzadora no permeten afegir un FEE." : "El FEE addicional està pendent de confirmar a les condicions comercials: no es pot aplicar.");
  if (values.some((v) => v != null && v < 0) && !cfg.allowNegative) errors.push("FEE negatiu no autoritzat (cal una regla comercial explícita).");
  const max = Math.max(...values.map((v) => v ?? 0));
  // només bloqueja un màxim contractual REAL que Direcció hagi registrat (mai un límit inventat)
  if (cfg.contractMaxFee != null && max > cfg.contractMaxFee + 1e-12) errors.push(`El FEE supera el màxim contractual registrat de la comercialitzadora (${fmtFee(cfg.contractMaxFee)}).`);
  if (cfg.recommendedFee != null && max > cfg.recommendedFee + 1e-12) warnings.push("ATENCIÓ: el FEE introduït supera el marge recomanat.");
  return { errors, warnings };
}
export const fmtFee = (v: Num, unit: FeeUnit = "eur_kwh") => (v == null ? "—" : `${(feeFromEurKwh(v, unit) ?? 0).toLocaleString("ca-ES", { maximumFractionDigits: unit === "eur_mwh" ? 3 : 6 })} ${FEE_UNIT_LABEL[unit]}`);

/* ======================================================================= preus finals */

const energyDiscountPct = (o: Pick<OfferVersion, "discounts" | "contractType">) => o.contractType === "indexat" ? 0 : o.discounts.filter((d) => d.base === "energia" && d.pct != null && d.pct > 0).reduce((a, d) => a + (d.pct ?? 0), 0);

/**
 * Preus finals d'energia = base + FEE (només energia, períodes aplicables). Si el FEE és «després de descomptes», el
 * component s'ajusta perquè el descompte percentual que aplica el motor no el redueixi (fee / (1 − %)), i així no es
 * duplica ni es perd res.
 */
export function finalEnergyPrices(cfg: Pick<PricingConfig, "baseEnergy" | "baseEnergy24h" | "feeBasis">, fee: Pick<FeeValues, "mode" | "single" | "periods">, periods: number, enabled: boolean, discountPct = 0): { energy: Num[]; energy24h: Num; applied: (number | null)[] } {
  const raw = enabled ? feeByPeriod(fee, periods) : Array.from({ length: 6 }, (_, i) => (i < periods ? 0 : null));
  const adj = (f: number | null) => (f == null ? null : cfg.feeBasis === "despres_descomptes" && discountPct > 0 && discountPct < 100 ? D(f).dividedBy(D(1).minus(D(discountPct).dividedBy(100))) : D(f));
  const energy = Array.from({ length: 6 }, (_, i) => {
    const b = cfg.baseEnergy[i];
    const f = adj(raw[i]);
    return i >= periods || b == null ? null : r9(D(b).plus(f ?? 0));
  });
  const f0 = adj(raw[0]);
  const energy24h = cfg.baseEnergy24h == null ? null : r9(D(cfg.baseEnergy24h).plus(f0 ?? 0));
  return { energy, energy24h, applied: raw };
}

const periodsFor = (o: Pick<OfferVersion, "accessTariff" | "energyType">) => {
  if (o.energyType === "gas") return 1;
  const t = (o.accessTariff ?? "").toUpperCase().replace(/\s/g, "");
  return /^2[.,]?0/.test(t) ? 3 : 6;
};

/**
 * Aplica el model de preu a una CÒPIA de l'oferta. Sense `override` fa servir el FEE per defecte del catàleg; amb
 * `override`, el de la comparativa. Sempre es calcula des del preu BASE (aplicar-ho dues vegades dona el mateix).
 */
export function applyPricing(o: OfferVersion, override?: FeeOverride | null): OfferVersion {
  const cfg = o.pricing;
  if (!cfg || !isFeeModel(cfg.model)) return o;
  const periods = periodsFor(o);
  const fee: FeeValues = override ? { mode: override.mode, single: override.single, periods: [...override.periods] } : cfg.fee;
  // sense FEE de comparativa → preu base. FIXED_BASE_FEE: FEE sempre admès; INDEXED_BASE_FEE: només si està autoritzat
  const enabled = !!override && (override.enabled ?? true) && (cfg.model === "FIXED_BASE_FEE" || cfg.feeAllowed === "si");
  const pricing: PricingConfig = { ...cfg, fee: override ? fee : cfg.fee, feeEnabled: override ? enabled : cfg.feeEnabled, feeInputUnit: override?.inputUnit ?? cfg.feeInputUnit };
  if (cfg.model === "FIXED_BASE_FEE") {
    const f = finalEnergyPrices(cfg, fee, periods, enabled, energyDiscountPct(o));
    const single = o.contractType === "fix24h" || o.energyType === "gas" || cfg.baseEnergy24h != null;
    return { ...o, energy: single ? o.energy : f.energy, energy24h: single ? f.energy24h : o.energy24h, pricing: { ...pricing, appliedFee: f.applied, source: override ? "comparativa" : "cataleg" } };
  }
  // INDEXED_BASE_FEE: el FEE és un component explícit de la fórmula (€/MWh per període), separat del marge del proveïdor
  const perPeriod = feeByPeriod(fee, periods).map((v) => (v == null || !enabled ? (v == null ? null : 0) : r9(D(v).times(1000))));
  const formula = o.formula ? { ...o.formula, feeEurMWh: perPeriod } : o.formula;
  const ref = o.indexedReference && cfg.baseEnergy.some((x) => x != null)
    ? { ...o.indexedReference, energy: Array.from({ length: 6 }, (_, i) => (cfg.baseEnergy[i] == null ? o.indexedReference!.energy[i] ?? null : r9(D(cfg.baseEnergy[i]!).plus(enabled ? feeByPeriod(fee, periods)[i] ?? 0 : 0)))), note: `${o.indexedReference.note.replace(/ · inclou FEE.*$/, "")} · inclou FEE d'Assessoria 3.0`.slice(0, 500) }
    : o.indexedReference;
  return { ...o, formula, indexedReference: ref, pricing: { ...pricing, appliedFee: enabled ? feeByPeriod(fee, periods) : feeByPeriod({ mode: "unic", single: 0, periods: [] }, periods), source: override ? "comparativa" : "cataleg" } };
}

/**
 * Normalitza una tarifa abans de desar-la al catàleg (servidor): recalcula el preu final des de la base i el FEE per
 * defecte, i valida la configuració. Tarifes sense `pricing` o FIXED_FINAL / INDEXED: no es toquen.
 */
export function normalizePricing(o: OfferVersion): { offer: OfferVersion; errors: string[]; warnings: string[] } {
  const cfg = o.pricing;
  if (!cfg) return { offer: o, errors: [], warnings: [] };
  const errors: string[] = [], warnings: string[] = [];
  const periods = periodsFor(o);
  if (cfg.model === "FIXED_BASE_FEE") {
    const single = o.contractType === "fix24h" || o.energyType === "gas";
    if (single ? cfg.baseEnergy24h == null : cfg.baseEnergy.slice(0, periods).some((x) => x == null)) errors.push("Falten preus BASE d'energia per als períodes aplicables.");
    if (o.contractType === "indexat") errors.push("Una tarifa amb preu base fix + FEE no pot ser de tipus «indexat»: tria INDEXED_BASE_FEE si és indexada.");
  }
  if (isIberdrolaOmie(o) && (isFeeModel(cfg.model) || cfg.feeAllowed === "si")) errors.push("Pla OMIE d'Iberdrola: el marge el fixa Iberdrola per nivell (Plan OMIE 0, 1, 2, 3…). No s'hi pot afegir cap FEE: tria un altre nivell.");
  if (cfg.model === "INDEXED_BASE_FEE" && o.contractType !== "indexat" && o.contractType !== "mixt") errors.push("INDEXED_BASE_FEE només és per a tarifes indexades (la fórmula de la comercialitzadora es conserva).");
  if ((cfg.model === "FIXED_BASE_FEE" || cfg.model === "FIXED_FINAL") && (o.contractType === "indexat")) warnings.push("Tarifa marcada com a fixa però de tipus indexat: revisa la classificació.");
  // EL FEE NOMÉS ES DECIDEIX A LA COMPARATIVA: al catàleg es desen únicament els preus BASE (sense FEE), i la tarifa es
  // pot validar i activar sense cap FEE. Un FEE que arribi (versions antigues, lectura) es descarta, mai s'aplica.
  const clean: PricingConfig = isFeeModel(cfg.model)
    ? { ...cfg, fee: { mode: "unic", single: null, periods: Array(6).fill(null) }, feeEnabled: false, appliedFee: null, source: "cataleg", feeAllowed: cfg.model === "FIXED_BASE_FEE" ? "si" : cfg.feeAllowed }
    : cfg;
  const offer = applyPricing({ ...o, pricing: clean });
  return { offer, errors, warnings };
}

/* ======================================================================= marge i remuneració */

/** Marge energètic anual teòric: Σ consum_Pn × FEE_Pn (períodes aplicables). Mai inclou la potència. */
export function energyMargin(o: OfferVersion, kwh: Num[], kwhTotal?: Num): { total: number; byPeriod: (number | null)[]; feeKwh: (number | null)[] } | null {
  const p = o.pricing;
  if (!p || !isFeeModel(p.model) || (p.model === "INDEXED_BASE_FEE" && p.feeAllowed !== "si")) return null;
  const periods = periodsFor(o);
  const fee = p.appliedFee ?? feeByPeriod({ mode: "unic", single: 0, periods: [] }, periods);
  const single = o.energyType === "gas" || o.contractType === "fix24h";
  let total = D(0);
  const byPeriod = Array.from({ length: 6 }, (_, i) => {
    if (i >= periods) return null;
    const k = single && i === 0 && kwhTotal != null ? kwhTotal : single ? 0 : kwh[i] ?? 0;
    if (single && i > 0) return null;
    const v = D(k ?? 0).times(fee[i] ?? 0);
    total = total.plus(v);
    return Number(v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
  });
  return { total: Number(total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString()), byPeriod, feeKwh: fee };
}

export const REMUNERATION_MODELS = ["fee_integre", "pct_fee", "fix_contracte", "per_kwh", "per_mwh", "per_kw", "mixta", "personalitzada"] as const;
export type RemunerationModel = (typeof REMUNERATION_MODELS)[number];
export const REMUNERATION_MODEL_LABEL: Record<RemunerationModel, string> = {
  fee_integre: "FEE íntegrament remunerable", pct_fee: "Percentatge del FEE", fix_contracte: "Import fix per contracte", per_kwh: "Comissió per kWh", per_mwh: "Comissió per MWh",
  per_kw: "Comissió per potència (kW)", mixta: "Mixta (% del FEE + import fix)", personalitzada: "Regla personalitzada",
};

/**
 * Com es desa cada model de remuneració a `fin_rules` (capa «proveidor»), sense crear cap taula paral·lela:
 * el `kind` i la unitat continuen complint les restriccions existents; el model concret va a `remuneration_model`.
 */
export const REMUNERATION_KIND: Record<RemunerationModel, { kind: "pct_marge" | "fix_contracte" | "per_mwh" | "per_kw"; valueHint: string }> = {
  fee_integre: { kind: "pct_marge", valueHint: "100 (%)" }, pct_fee: { kind: "pct_marge", valueHint: "% del FEE" }, fix_contracte: { kind: "fix_contracte", valueHint: "€ per contracte" },
  per_kwh: { kind: "per_mwh", valueHint: "€/MWh (1 €/MWh = 0,001 €/kWh)" }, per_mwh: { kind: "per_mwh", valueHint: "€/MWh" }, per_kw: { kind: "per_kw", valueHint: "€/kW" },
  mixta: { kind: "pct_marge", valueHint: "% del FEE (+ import fix a les condicions)" }, personalitzada: { kind: "pct_marge", valueHint: "0 (la fórmula va a la base de càlcul)" },
};

/** Regla de remuneració d'una comercialitzadora (de `fin_rules`, capa proveïdor, amb `remuneration_model`). */
export interface RemunerationRule {
  id: string; supplier: string; product: string | null; tariffProductId: string | null; model: RemunerationModel; status: "aprovada" | "pendent_aprovacio" | "esborrany" | "retirada";
  pct: number | null; eur: number | null; eurPerUnit: number | null; formula: string | null; validFrom: string; validTo: string | null; settlement: string | null; name?: string | null;
}

export interface RemunerationEstimate {
  status: "estimada" | "simulacio" | "pendent_configurar";
  amount: number | null; formula: string; note: string; rule: string | null;
}
export const PENDING_COMMISSION = "COMISSIÓ PENDENT DE CONFIGURAR";

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Regla aplicable (aprovada primer; producte concret abans que general; vigent a la data). */
export function pickRemunerationRule(rules: RemunerationRule[], o: Pick<OfferVersion, "supplierName" | "productName" | "productId">, today: string): RemunerationRule | null {
  const ok = rules.filter((r) => r.status !== "retirada" && r.status !== "esborrany" && norm(r.supplier).split(" ")[0] === norm(o.supplierName).split(" ")[0] && r.validFrom <= today && (!r.validTo || r.validTo >= today)
    && (!r.tariffProductId || r.tariffProductId === o.productId) && (!r.product || norm(o.productName).includes(norm(r.product))));
  const score = (r: RemunerationRule) => (r.status === "aprovada" ? 100 : 0) + (r.tariffProductId ? 10 : 0) + (r.product ? 5 : 0);
  return ok.sort((a, b) => score(b) - score(a) || (b.validFrom > a.validFrom ? 1 : -1))[0] ?? null;
}

const eur2 = (d: Decimal) => Number(d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString());
/** Remuneració estimada a partir del marge. És una ESTIMACIÓ teòrica: mai es marca com a cobrada. */
export function estimateRemuneration(rule: RemunerationRule | null, ctx: { margin: number | null; kwhTotal: number | null; kwSum: number | null; months?: number }): RemunerationEstimate {
  const pending = (note: string): RemunerationEstimate => ({ status: "pendent_configurar", amount: null, formula: PENDING_COMMISSION, note, rule: rule?.name ?? null });
  if (!rule) return pending("No hi ha cap regla de remuneració confirmada per a aquesta comercialitzadora. No s'assumeix que el 100 % del FEE correspon a Assessoria 3.0.");
  const st: RemunerationEstimate["status"] = rule.status === "aprovada" ? "estimada" : "simulacio";
  const m = ctx.margin != null ? D(ctx.margin) : null;
  const months = D(ctx.months ?? 12).dividedBy(12);
  const out = (amount: Decimal, formula: string): RemunerationEstimate => ({ status: st, amount: eur2(amount), formula, note: `${st === "simulacio" ? "Simulació amb una regla pendent d'aprovar. " : ""}Estimació teòrica: la liquidació real depèn del consum efectiu, la durada, els ajustaments i les regularitzacions.`, rule: rule.name ?? null });
  switch (rule.model) {
    case "fee_integre": if (!m) return pending("Falta el marge del FEE"); return out(m, `100 % del marge del FEE (${eur2(m)} €)`);
    case "pct_fee": if (!m || rule.pct == null) return pending("Falta el percentatge o el marge"); return out(m.times(rule.pct).dividedBy(100), `${rule.pct} % × ${eur2(m)} € de marge`);
    case "fix_contracte": if (rule.eur == null) return pending("Falta l'import fix"); return out(D(rule.eur), `${rule.eur} € per contracte`);
    case "per_kwh": if (rule.eurPerUnit == null || ctx.kwhTotal == null) return pending("Falta l'import per kWh o el consum"); return out(D(ctx.kwhTotal).times(rule.eurPerUnit).times(months), `${ctx.kwhTotal} kWh × ${rule.eurPerUnit} €/kWh`);
    case "per_mwh": if (rule.eurPerUnit == null || ctx.kwhTotal == null) return pending("Falta l'import per MWh o el consum"); return out(D(ctx.kwhTotal).dividedBy(1000).times(rule.eurPerUnit).times(months), `${D(ctx.kwhTotal).dividedBy(1000).toString()} MWh × ${rule.eurPerUnit} €/MWh`);
    case "per_kw": if (rule.eurPerUnit == null || !ctx.kwSum) return pending("Falta l'import per kW o la potència"); return out(D(ctx.kwSum).times(rule.eurPerUnit), `${ctx.kwSum} kW × ${rule.eurPerUnit} €/kW`);
    case "mixta": if (!m || rule.pct == null) return pending("Falta el percentatge o el marge"); return out(m.times(rule.pct).dividedBy(100).plus(rule.eur ?? 0), `${rule.pct} % × ${eur2(m)} €${rule.eur ? ` + ${rule.eur} €` : ""}`);
    case "personalitzada": return pending(`Regla personalitzada («${rule.formula ?? "sense fórmula"}»): no es calcula automàticament; cal configurar-ne la fórmula a Economia.`);
  }
}

/**
 * Conciliació FEE estimat ↔ liquidació: estimada, liquidada, cobrada, retrocomissions, regularitzacions i diferència.
 * Una estimació mai no es converteix en «cobrada»: només ho és el que consta als cobraments.
 */
export function feeCommissionReconciliation(x: { estimated: number | null; settled: number | null; collected: number | null; clawbacks?: number | null; regularizations?: number | null }) {
  const est = x.estimated != null ? D(x.estimated) : null;
  const set = x.settled != null ? D(x.settled) : null;
  const col = D(x.collected ?? 0);
  const net = set ? set.minus(x.clawbacks ?? 0).plus(x.regularizations ?? 0) : null;
  const status = !set ? "pendent_liquidacio" : col.gte(net!) ? "cobrada" : col.gt(0) ? "cobrada_parcial" : "liquidada_pendent_cobrament";
  return {
    estimated: est ? eur2(est) : null, settled: set ? eur2(set) : null, collected: eur2(col), clawbacks: x.clawbacks ?? 0, regularizations: x.regularizations ?? 0,
    netSettled: net ? eur2(net) : null,
    pending: net ? eur2(net.minus(col)) : null,
    differenceVsEstimate: est && net ? eur2(net.minus(est)) : null,
    status: status as "pendent_liquidacio" | "cobrada" | "cobrada_parcial" | "liquidada_pendent_cobrament",
  };
}

/* ======================================================================= detecció en documents */

/**
 * Iberdrola · nivell del Pla OMIE a partir del nom del producte («3.0TD Plan OMIE 2» → «2», «Plan OMIE Obras» →
 * «Obras»). Cada nivell té el seu marge fixat per Iberdrola (és un producte diferent, no un FEE configurable).
 */
export function iberdrolaOmieLevel(name: string | null | undefined): string | null {
  const m = (name ?? "").match(/plan\s+omie\s+([0-9]+|[a-zà-ú]+)/i);
  return m ? (/^\d+$/.test(m[1]) ? m[1] : m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()) : null;
}
/** Tarifa del Pla OMIE d'Iberdrola (marge fixat per Iberdrola: mai admet FEE d'Assessoria 3.0). */
export const isIberdrolaOmie = (o: Pick<OfferVersion, "supplierName" | "productName">) => /iberdrola/i.test(o.supplierName ?? "") && /plan\s+omie/i.test(o.productName ?? "");

export interface PricingDetection {
  model: PricingModel | null;
  feeAllowed: FeeAllowed;
  evidence: string[];
  confidence: number;
  needsConfirmation: boolean;
  warnings: string[];
  fee: ReturnType<typeof parseFee> | null;
  supplierMarginEurMWh: Num;
}

const RX = {
  indexed: /\bomie\b|mercado diario|mercat diari|precio indexado|preu indexat|\bindexad[ao]\b|\bindexat\b|\bpool\b|precio horario|preu horari|pass[- ]?through|f[oó]rmula de indexaci[oó]n/i,
  baseFee: /(precio|preu|coste|cost)\s+(base|de (la )?energ[ií]a)\s*\+\s*(fee|margen|marge|margen comercial)|\bbase\s*\+\s*fee\b|coste\s*\+\s*margen( comercial)?|precio sin margen|preu sense marge|margen de comercializaci[oó]n configurable|marge de comercialitzaci[oó] configurable|precio base para (el )?comercializador|fee (configurable|libre|a elegir|a definir|del (comercializador|colaborador|agente))|margen (configurable|a elegir|libre|del (comercializador|colaborador|agente))|preu base \+ marge/i,
  marginIncluded: /margen (ya )?inclu[ií]do|incluye (el )?margen|marge (ja )?incl[oò]s|precio final con margen/i,
  feeForbidden: /no (se )?(permite|admite|puede) (a[nñ]adir|incluir|aplicar) (un |ning[uú]n )?(fee|margen)|sin posibilidad de fee|fee no permitido/i,
  feeAuthorized: /fee (adicional |del (comercializador|colaborador|agente) )?(configurable|permitido|autorizado|a elegir|libre)|(se )?(permite|puede) (a[nñ]adir|incluir|aplicar) (un )?(fee|margen)|margen (adicional )?(configurable|a elegir|del (comercializador|colaborador|agente))/i,
  feeValue: /(fee|margen|marge)[^0-9\n]{0,30}([-−]?\d[\d.,]*\s*(?:c?€|eur|euros?)?\s*\/?\s*(?:mwh|kwh)?)/i,
};

/**
 * Classifica el model de preu d'un document (o d'una tarifa) a partir del context: text, notes comercials i fórmules.
 * No n'hi ha prou amb una paraula clau: una indexada amb el marge ja inclòs no rep un FEE automàtic, i si la fórmula o
 * l'autorització no són clares es demana confirmació.
 */
export function detectPricingModel(input: { text: string; productName?: string | null; supplier?: string | null; contractType?: OfferVersion["contractType"] | null }): PricingDetection {
  const text = `${input.productName ?? ""}\n${input.text ?? ""}`;
  const evidence: string[] = [], warnings: string[] = [];
  const hit = (re: RegExp, label: string) => { const m = text.match(re); if (m) evidence.push(`${label}: «${m[0].trim().slice(0, 80)}»`); return !!m; };
  const indexed = hit(RX.indexed, "Preu indexat") || input.contractType === "indexat";
  const baseFee = hit(RX.baseFee, "Preu base + marge configurable");
  const included = hit(RX.marginIncluded, "Marge ja inclòs");
  const forbidden = hit(RX.feeForbidden, "FEE no permès");
  const authorized = hit(RX.feeAuthorized, "FEE autoritzat");
  const fm = text.match(RX.feeValue);
  const fee = fm ? parseFee(fm[2]) : null;
  let supplierMarginEurMWh: Num = null;
  const iberdrola = /iberdrola/i.test(input.supplier ?? "") || /iberdrola/i.test(text);
  const planOmie = /plan\s+omie/i.test(text);

  // Iberdrola · Pla OMIE: SEMPRE indexada i el marge el FIXA Iberdrola per nivell (Plan OMIE 0, 1, 2, 3, Obras,
  // Comunidades…: cada nivell és un producte diferent). Assessoria 3.0 no hi pot triar ni afegir cap FEE: per canviar
  // de marge es tria un altre nivell (un altre producte del catàleg).
  if (iberdrola && planOmie) {
    if (fee?.eurKwh != null) supplierMarginEurMWh = r9(D(fee.eurKwh).times(1000));
    const level = iberdrolaOmieLevel(`${input.productName ?? ""} ${input.text ?? ""}`);
    evidence.push(`Iberdrola · Pla OMIE${level ? ` (nivell «${level}»)` : ""}: indexada; el marge el fixa Iberdrola per nivell i no es pot triar cap FEE`);
    return { model: "INDEXED", feeAllowed: "no", evidence, confidence: 0.95, needsConfirmation: false, warnings, fee: null, supplierMarginEurMWh };
  }
  if (indexed) {
    if (fee?.eurKwh != null && !baseFee) supplierMarginEurMWh = r9(D(fee.eurKwh).times(1000));
    if (included && !authorized) {
      warnings.push("Indexada amb el marge ja incorporat: no s'hi afegeix automàticament un segon FEE.");
      return { model: "INDEXED", feeAllowed: forbidden ? "no" : "pendent", evidence, confidence: 0.85, needsConfirmation: false, warnings, fee: null, supplierMarginEurMWh };
    }
    if ((baseFee || authorized) && !forbidden) {
      return { model: "INDEXED_BASE_FEE", feeAllowed: "si", evidence, confidence: baseFee && authorized ? 0.9 : 0.7, needsConfirmation: !(baseFee && authorized), warnings, fee: baseFee ? fee : null, supplierMarginEurMWh: baseFee ? null : supplierMarginEurMWh };
    }
    if (fee && !forbidden) warnings.push("Indexada amb un marge al document: es tracta com a marge de la comercialitzadora, no com a FEE d'Assessoria 3.0.");
    return { model: "INDEXED", feeAllowed: forbidden ? "no" : "pendent", evidence, confidence: 0.8, needsConfirmation: false, warnings, fee: null, supplierMarginEurMWh };
  }
  if (baseFee) {
    if (forbidden) warnings.push("El document parla de preu base però també diu que no es pot afegir FEE: cal confirmar-ho.");
    return { model: "FIXED_BASE_FEE", feeAllowed: forbidden ? "pendent" : "si", evidence, confidence: forbidden ? 0.5 : authorized ? 0.9 : 0.8, needsConfirmation: forbidden, warnings, fee, supplierMarginEurMWh: null };
  }
  if (fee || /\bfee\b/i.test(text)) {
    warnings.push("El document esmenta un FEE o marge però no queda clar si el preu és base o final: cal confirmar-ho.");
    return { model: null, feeAllowed: "pendent", evidence, confidence: 0.3, needsConfirmation: true, warnings, fee, supplierMarginEurMWh: null };
  }
  return { model: null, feeAllowed: "no", evidence, confidence: 0, needsConfirmation: false, warnings, fee: null, supplierMarginEurMWh: null };
}

/**
 * Configuració de preu a partir d'una detecció i dels preus llegits (que, en un model BASE + FEE, són els preus BASE).
 * Mai converteix tarifes existents sense evidències: si el model és null, no hi ha `pricing`.
 */
export function pricingFromDetection(d: PricingDetection, prices: { energy: Num[]; energy24h: Num }, opts: { termsSource?: string | null } = {}): PricingConfig | null {
  if (!d.model) return null;
  const cfg = emptyPricing(d.model);
  cfg.feeAllowed = d.feeAllowed;
  cfg.feeEnabled = false;
  cfg.supplierMarginEurMWh = d.supplierMarginEurMWh;
  cfg.termsSource = opts.termsSource ?? null;
  cfg.detection = { evidence: d.evidence.slice(0, 10), confidence: d.confidence, warnings: d.warnings.slice(0, 10) };
  if (d.model === "FIXED_BASE_FEE" || d.model === "INDEXED_BASE_FEE") {
    cfg.baseEnergy = [...prices.energy];
    cfg.baseEnergy24h = prices.energy24h;
    // no es demana ni s'aplica cap FEE en importar: el text del document es conserva només com a referència
    cfg.feeEnabled = false;
    if (d.fee) cfg.originalFeeText = d.fee.original;
  }
  return cfg;
}

/** Instantània del preu per a la comparativa (taula `comparison_pricing_snapshots` i historial). */
export function pricingSnapshot(o: OfferVersion, kwh: Num[], kwhTotal: Num) {
  const p = o.pricing;
  const periods = periodsFor(o);
  const margin = energyMargin(o, kwh, kwhTotal);
  return {
    tariffVersionId: o.id, productId: o.productId, model: p?.model ?? null,
    base: p ? { energy: p.baseEnergy.slice(0, periods), energy24h: p.baseEnergy24h } : null,
    fee: p ? { mode: p.fee.mode, applied: (p.appliedFee ?? feeByPeriod(p.fee, periods)).slice(0, periods), enabled: p.feeEnabled, inputUnit: p.feeInputUnit, source: p.source ?? "cataleg", supplierMarginEurMWh: p.supplierMarginEurMWh } : null,
    final: { energy: o.energy.slice(0, periods), energy24h: o.energy24h, formulaFeeEurMWh: o.formula?.feeEurMWh ?? null },
    consumption: { byPeriod: kwh.slice(0, periods), total: kwhTotal },
    margin,
  };
}
