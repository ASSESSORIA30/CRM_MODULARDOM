/**
 * PROCEDÈNCIA DE CADA DADA DE CONSUM I POTÈNCIA (lògica pura, comuna a totes les entrades de Comparatives IA).
 *
 *  - Cada camp (Consum P1…P6, Consum total, Potència P1…P6) té la SEVA procedència: SIPS, Factura, Corba horària,
 *    Manual (o CRM quan és un valor desat al CRM d'origen no acreditat).
 *  - Si l'usuari modifica un valor, passa a «Manual» i es conserva la procedència ORIGINAL (font, data i valor).
 *  - Un camp buit no té procedència: mai es mostra una font fictícia.
 *  - Només es desen dates i fonts que el sistema pot acreditar (data de consulta SIPS, d'extracció de la factura…).
 */
import type { Num, SupplyInput } from "./types";

export type Origin = "sips" | "factura" | "corba" | "manual" | "crm";
export const ORIGIN_LABEL: Record<Origin, string> = { sips: "SIPS", factura: "Factura", corba: "Corba horària", manual: "Manual", crm: "CRM" };
export const ORIGIN_NATURE: Record<Origin, "real" | "calculat" | "manual" | "registre"> = { sips: "real", factura: "real", corba: "calculat", manual: "manual", crm: "registre" };
export const NATURE_LABEL = { real: "Dada real", calculat: "Dada calculada", manual: "Introduïda o modificada manualment", registre: "Dada desada al CRM (origen anterior no acreditat)" } as const;

export interface OriginInfo { origin: Origin; at: string | null; source: string | null; value: number | string | null }
export interface FieldOrigin extends OriginInfo { original: OriginInfo | null }
export type Provenance = Record<string, FieldOrigin>;

export type FieldKey = `kwh${1 | 2 | 3 | 4 | 5 | 6}` | `kw${1 | 2 | 3 | 4 | 5 | 6}` | "kwhTotal";
export const kwhKey = (i: number) => `kwh${i + 1}` as FieldKey;
export const kwKey = (i: number) => `kw${i + 1}` as FieldKey;

const empty = (v: unknown) => v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));

/**
 * Marca uns camps amb una procedència. Els valors buits ESBORREN la procedència del camp (no se n'inventa cap).
 * Si el camp tenia una procedència diferent, es conserva com a original (la primera que va tenir).
 */
export function stamp(prov: Provenance, values: Partial<Record<FieldKey, Num>>, meta: { origin: Origin; at?: string | null; source?: string | null }): Provenance {
  const out: Provenance = { ...prov };
  for (const [k, v] of Object.entries(values) as [FieldKey, Num][]) {
    if (empty(v)) { delete out[k]; continue; }
    const prev = out[k];
    const original = prev && (prev.origin !== meta.origin || prev.value !== v) ? prev.original ?? strip(prev) : prev?.original ?? null;
    out[k] = { origin: meta.origin, at: meta.at ?? null, source: meta.source ?? null, value: v, original: original && original.origin === meta.origin && original.value === v ? null : original };
  }
  return out;
}
const strip = (f: FieldOrigin): OriginInfo => ({ origin: f.origin, at: f.at, source: f.source, value: f.value });

/** Edició de l'usuari: el camp passa a «Manual» i guarda d'on venia. Si el valor no canvia, no es toca. */
export function markManual(prov: Provenance, key: FieldKey, value: Num, at: string = new Date().toISOString()): Provenance {
  const prev = prov[key];
  if (prev && prev.value === value) return prov;
  const out: Provenance = { ...prov };
  if (empty(value)) { delete out[key]; if (prev) out[`${key}:anterior`] = { ...strip(prev), original: prev.original }; return out; }
  out[key] = { origin: "manual", at, source: "Introduïda a la comparativa", value, original: prev ? (prev.origin === "manual" ? prev.original : prev.original ?? strip(prev)) : null };
  return out;
}

/** Procedència a mostrar per a un camp (null si el camp és buit o no té procedència acreditada). */
export function originOf(prov: Provenance | null | undefined, key: FieldKey, value: Num): FieldOrigin | null {
  if (empty(value)) return null;
  const p = prov?.[key];
  return p ?? null;
}

/** Compatibilitat amb esborranys antics: deriva la procedència per camp a partir de la procedència agregada. */
export function fromAggregate(supply: Pick<SupplyInput, "kwh" | "kw" | "kwhTotal">, sources: Record<string, string | null | undefined>): Provenance {
  const map = (s: string | null | undefined): Origin | null => (s === "sips" || s === "factura" || s === "manual" || s === "crm" || s === "corba" ? s : s === "calculat" ? null : null);
  let p: Provenance = {};
  const k = map(sources.kwh), w = map(sources.kw), t = map(sources.kwhTotal);
  if (k) p = stamp(p, Object.fromEntries(supply.kwh.map((v, i) => [kwhKey(i), v])), { origin: k });
  if (w) p = stamp(p, Object.fromEntries(supply.kw.map((v, i) => [kwKey(i), v])), { origin: w });
  if (t) p = stamp(p, { kwhTotal: supply.kwhTotal }, { origin: t });
  return p;
}

/* ======================================================================= validació del total */

export interface TotalCheck {
  periods: number;
  known: number;
  sum: number | null;
  total: number | null;
  difference: number | null;
  status: "ok" | "difereix" | "incomplet" | "sense_total" | "nomes_total";
  message: string | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => n.toLocaleString("ca-ES", { maximumFractionDigits: 3 });

/**
 * Total = P1 + P2 + P3 (2.0TD) o P1 + … + P6 (3.0TD i 6.1TD). Tolerància d'arrodoniment: 1 kWh o el 0,1 %.
 * Si el total i els períodes tenen procedències o finestres temporals diferents, s'avisa (no es corregeix sol).
 * Si només hi ha el total, no s'inventa cap repartiment.
 */
export function checkTotal(supply: Pick<SupplyInput, "kwh" | "kwhTotal">, periods: number, prov?: Provenance | null): TotalCheck {
  const vals = supply.kwh.slice(0, periods);
  const known = vals.filter((v) => v != null).length;
  const sum = known === periods ? r3(vals.reduce<number>((a, v) => a + (v as number), 0)) : null;
  const total = supply.kwhTotal;
  const base = { periods, known, sum, total, difference: null as number | null };
  if (periods <= 1) return { ...base, status: "ok", message: null };
  if (known === 0 && total != null) return { ...base, status: "nomes_total", message: `Només hi ha el consum total: no s'inventa el repartiment P1–P${periods}. Cal el SIPS, una factura o la corba horària.` };
  if (known > 0 && known < periods) return { ...base, status: "incomplet", message: `Falten consums de ${vals.map((v, i) => (v == null ? `P${i + 1}` : null)).filter(Boolean).join(", ")}: el total no es pot comprovar.` };
  if (sum == null) return { ...base, status: "sense_total", message: null };
  if (total == null) return { ...base, status: "sense_total", message: null };
  const difference = r3(total - sum);
  if (Math.abs(difference) <= Math.max(1, Math.abs(sum) * 0.001)) return { ...base, difference, status: "ok", message: null };
  const pt = prov?.kwhTotal?.origin, pp = prov?.[kwhKey(0)]?.origin;
  const why = pt && pp && pt !== pp ? ` El total és de ${ORIGIN_LABEL[pt]} i els períodes de ${ORIGIN_LABEL[pp]}: poden ser finestres temporals diferents.` : "";
  return { ...base, difference, status: "difereix", message: `El total (${fmt(total)} kWh) no coincideix amb la suma P1–P${periods} (${fmt(sum)} kWh): diferència de ${fmt(difference)} kWh.${why}` };
}
