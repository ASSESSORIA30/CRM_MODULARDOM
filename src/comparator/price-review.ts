/**
 * CONFIRMACIÓ DE PREUS DEL CONTRACTE ACTUAL (part pura, testejable).
 *
 * Cada preu que el comparador farà servir (energia P1–P6 o preu únic, potència P1–P6, terme fix del gas) té un estat:
 *  · verificat     → calculat automàticament amb preus explícits de la factura i totes les comprovacions superades;
 *  · completar     → falta i és imprescindible (hi ha consum o potència en aquest període);
 *  · revisar       → discrepància real o lectura ambigua: cal que algú la miri;
 *  · manual        → introduït, corregit o confirmat per l'usuari;
 *  · no_necessari  → no hi ha preu ni consum en aquest període (P1/P2 no facturats, p. ex.): no s'inventa ni es posa zero.
 * La confirmació només és obligatòria si hi ha algun «completar» o «revisar». El valor que es mostra és EXACTAMENT el
 * que entra al càlcul (`current`), no una còpia.
 */
import { periodsOf } from "./engine";
import type { InvoiceData } from "./invoice";
import type { PeriodBreakdown } from "./energy-breakdown";
import { POWER_UNIT_LABEL, type Num, type PriceSheet, type SupplyInput } from "./types";

export type PriceState = "verificat" | "completar" | "revisar" | "manual" | "no_necessari";
export const PRICE_STATE_LABEL: Record<PriceState, string> = {
  verificat: "Calculat i verificat",
  completar: "Falta: cal completar-lo",
  revisar: "Cal revisar",
  manual: "Confirmat manualment",
  no_necessari: "No facturat (no cal)",
};

export interface PriceReviewState {
  confirmedAt: string | null;
  confirmedBy: string | null;
  /** Valors confirmats per l'usuari (clau → valor). Si el valor canvia després, deixa d'estar confirmat. */
  values: Record<string, number | null>;
  /** Valors editats a mà: el valor que hi havia abans (factura) per poder-lo recuperar */
  manual: Record<string, { original: number | null; at: string }>;
}
export const emptyPriceReview = (): PriceReviewState => ({ confirmedAt: null, confirmedBy: null, values: {}, manual: {} });

export interface PriceRow {
  key: string; // e1..e6 · e24 · p1..p6 · gfix
  kind: "energia" | "potencia" | "terme_fix";
  period: number | null;
  label: string;
  value: Num;
  unit: string;
  state: PriceState;
  origin: string;
  reason: string | null;
  breakdown: PeriodBreakdown | null;
  /** Preu original de potència abans de passar-lo a €/kW·dia (si la factura el donava en una altra unitat) */
  converted: string | null;
}

const same = (a: Num | undefined, b: Num | undefined) => a != null && b != null && Math.abs(a - b) < 5e-10;
const pageTxt = (p: number | null | undefined) => (p ? ` p.${p}` : "");
const methodTxt = (m: string | undefined) => (m === "ia" ? "lector IA" : m === "manual" ? "corregit a mà" : "lectura del text");

export function priceRows(input: { supply: SupplyInput; current: PriceSheet; invoice?: InvoiceData | null; review?: PriceReviewState | null }): PriceRow[] {
  const { supply: s, current: cur } = input;
  const inv = input.invoice ?? null;
  const rv = input.review ?? emptyPriceReview();
  const gas = s.energyType === "gas";
  const per = periodsOf(s.accessTariff, s.energyType);
  const rows: PriceRow[] = [];
  const state = (key: string, value: Num, needed: boolean, fromInvoice: { value: Num; confirm: boolean; page: number | null; method?: string } | null, breakdown: PeriodBreakdown | null, label: string): Pick<PriceRow, "state" | "origin" | "reason"> => {
    const manual = rv.manual[key];
    if (value != null && (manual || (rv.confirmedAt && key in rv.values && same(rv.values[key], value)))) {
      return { state: "manual", origin: manual ? `Modificat a mà${manual.original != null ? ` (factura: ${manual.original})` : ""}` : "Confirmat per l'usuari", reason: null };
    }
    if (breakdown?.status === "pendent" && (value == null || !same(value, fromInvoice?.value))) {
      if (value != null) return { state: "manual", origin: "Introduït a mà", reason: null };
      return { state: needed ? "revisar" : "no_necessari", origin: `Factura${pageTxt(fromInvoice?.page)}`, reason: breakdown.note };
    }
    if (value == null) return needed ? { state: "completar", origin: "Sense dada", reason: `Falta ${label}: hi ha ${key.startsWith("p") ? "potència contractada" : "consum"} en aquest període. Introdueix-lo a mà.` } : { state: "no_necessari", origin: "No apareix a la factura", reason: key.startsWith("e") ? "Sense consum facturat en aquest període: no s'inventa cap preu ni es posa zero." : null };
    if (fromInvoice && same(fromInvoice.value, value)) {
      const calc = breakdown && breakdown.status !== "pendent" ? `${breakdown.status === "reconstruit" ? "calculat (suma de components)" : "terme d'energia"}` : methodTxt(fromInvoice.method);
      const origin = `Factura${pageTxt(fromInvoice.page)} · ${calc}`;
      if (breakdown?.parts.some((p) => p.calculated && !p.duplicate) || fromInvoice.confirm) return { state: "revisar", origin, reason: breakdown?.checks?.find((c) => /revisar/.test(c)) ?? "Lectura amb dubtes: comprova el valor." };
      return { state: "verificat", origin, reason: null };
    }
    return { state: "manual", origin: inv ? "Introduït a mà" : "Introduït a mà (sense factura)", reason: null };
  };

  const kwhNeeded = (i: number) => (s.kwh[i] ?? 0) > 0;
  const anyKwh = s.kwh.some((x) => (x ?? 0) > 0) || (s.kwhTotal ?? 0) > 0;
  if (gas || cur.contractType === "fix24h") {
    const fi = inv ? { ...inv.energyPrice[0], value: inv.energyPrice.find((f) => f.value != null)?.value ?? null } : null;
    rows.push({ key: "e24", kind: "energia", period: null, label: gas ? "Preu energia (€/kWh)" : "Preu únic 24 h (€/kWh)", value: cur.energy24h, unit: "€/kWh", breakdown: null, converted: null, ...state("e24", cur.energy24h, anyKwh, fi, null, "el preu de l'energia") });
  } else {
    for (let i = 0; i < per.energy; i++) {
      const b = inv?.energyBreakdown?.find((x) => x.period === i + 1) ?? null;
      rows.push({ key: `e${i + 1}`, kind: "energia", period: i + 1, label: `Energia P${i + 1}`, value: cur.energy[i], unit: "€/kWh", breakdown: b, converted: null, ...state(`e${i + 1}`, cur.energy[i], kwhNeeded(i), inv?.energyPrice[i] ?? null, b, `el preu d'energia de P${i + 1}`) });
    }
  }
  if (gas) {
    rows.push({ key: "gfix", kind: "terme_fix", period: null, label: "Terme fix", value: cur.gasFixedEurDay, unit: "€/dia", breakdown: null, converted: null, ...state("gfix", cur.gasFixedEurDay, true, inv?.gasFixedEurDay ?? null, null, "el terme fix") });
  } else {
    for (let i = 0; i < per.power; i++) {
      const fromInv = inv && cur.powerUnit === "eur_kw_dia" ? inv.powerPrice[i] : null;
      const o = inv?.powerPriceOriginal?.[i];
      rows.push({ key: `p${i + 1}`, kind: "potencia", period: i + 1, label: `Potència P${i + 1}`, value: cur.power[i], unit: POWER_UNIT_LABEL[cur.powerUnit], breakdown: null, converted: o ? `${o.value} ${o.unit} → €/kW·dia (${o.formula})` : null, ...state(`p${i + 1}`, cur.power[i], (s.kw[i] ?? 0) > 0, fromInv, null, `el preu de potència de P${i + 1}`) });
    }
  }
  return rows;
}

export interface PriceSummary { needsAction: boolean; canConfirm: boolean; missing: string[]; toReview: string[]; verified: number; manual: number; allAuto: boolean; confirmed: boolean }
export function priceSummary(rows: PriceRow[], review?: PriceReviewState | null): PriceSummary {
  const missing = rows.filter((r) => (r.state === "completar" || r.state === "revisar") && r.value == null).map((r) => r.label);
  const toReview = rows.filter((r) => r.state === "revisar").map((r) => r.label);
  const needsAction = rows.some((r) => r.state === "completar" || r.state === "revisar");
  const used = rows.filter((r) => r.state !== "no_necessari");
  return {
    needsAction, canConfirm: missing.length === 0, missing, toReview,
    verified: rows.filter((r) => r.state === "verificat").length, manual: rows.filter((r) => r.state === "manual").length,
    allAuto: used.length > 0 && used.every((r) => r.state === "verificat"),
    confirmed: !!review?.confirmedAt && !needsAction,
  };
}

/** «Confirmar preus i continuar»: guarda els valors tal com són ara (només si no en falta cap d'imprescindible). */
export function confirmPrices(rows: PriceRow[], review: PriceReviewState | null | undefined, who: string | null, now = new Date().toISOString()): PriceReviewState {
  const missing = priceSummary(rows).missing;
  if (missing.length) throw new Error(`Falten preus imprescindibles: ${missing.join(", ")}`);
  const values: Record<string, number | null> = {};
  for (const r of rows) if (r.state !== "no_necessari") values[r.key] = r.value;
  return { ...(review ?? emptyPriceReview()), confirmedAt: now, confirmedBy: who, values };
}

/** L'usuari edita un preu: queda «manual» i es guarda el valor anterior (per poder tornar-hi). */
export function markPriceManual(review: PriceReviewState | null | undefined, key: string, previous: Num, now = new Date().toISOString()): PriceReviewState {
  const r = review ?? emptyPriceReview();
  return { ...r, manual: { ...r.manual, [key]: r.manual[key] ?? { original: previous, at: now } } };
}
export function clearPriceManual(review: PriceReviewState | null | undefined, key: string): PriceReviewState {
  const r = review ?? emptyPriceReview();
  const manual = { ...r.manual };
  const values = { ...r.values };
  delete manual[key];
  delete values[key];
  return { ...r, manual, values };
}
