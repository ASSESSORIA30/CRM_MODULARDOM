/**
 * MOTOR ÚNIC DE NORMALITZACIÓ I VALIDACIÓ DE TARIFES (totes les comercialitzadores).
 *
 *   Lector (adaptador de cada comercialitzadora) → normalizeOffer → validateOffer → reviewRow → Catàleg
 *
 *  · `normalizeOffer` (pur i idempotent): aplica el coneixement confirmat de l'adaptador (unitat del terme fix del gas,
 *    permanència per regla comercial), converteix les unitats al model intern conservant SEMPRE l'original, identifica
 *    les tarifes 24 hores i llegeix les condicions (permanència, penalització, renovació, vigència) del text.
 *  · `validateOffer`: incidències classificades: error de lectura o càlcul, dada essencial absent, avís i informació.
 *  · `reviewRow`: la fila de la taula de revisió abans d'importar.
 * El mateix motor s'aplica en llegir, en desar al catàleg i en reprocessar: una tarifa té les mateixes unitats i els
 * mateixos imports al lector, al catàleg, al comparador i al PDF.
 */
import { checkVersion } from "./catalog";
import { periodsOf } from "./engine";
import { INTERNAL_RULE_SOURCE, declaredPermanence, permanenceLabel, permanenceNotices, permanenceRequired } from "./permanence";
import { energyText, gasFixedText, nfmt, powerText, priceLines, type PriceLine } from "./price-display";
import { adapterFor, type SupplierAdapter } from "./supplier-adapters";
import { mergePermanence, readConditions } from "./tariff-conditions";
import { analyzePeriods, normalizeStructure } from "./tariff-periods";
import { GAS_FIXED_CRITERION, gasFixedEquivalents, parseUnit, toInternal } from "./units";
import { applyUnitRules, describeRule, UNIT_LABEL, type UnitRule } from "./unit-rules";
import { DEFAULT_PERMANENCE_RULE, POWER_UNIT_LABEL, type OfferVersion, type PermanenceRule } from "./types";

export const NORMALIZER_VERSION = "1.0.0";
export type IncidentLevel = "error" | "falta" | "avis" | "info";
export interface Incident { level: IncidentLevel; text: string }
export const INCIDENT_LABEL: Record<IncidentLevel, string> = { error: "Error de lectura o de càlcul", falta: "Dada essencial absent", avis: "Revisar", info: "Informació" };

export interface Normalized { offer: OfferVersion; changes: string[]; autoVerified: string[]; adapter: SupplierAdapter }

const unitUnknown = (u: string | null | undefined) => !u || !parseUnit(u) || /no indicada/i.test(u);

/** Normalitza una tarifa (idempotent: aplicar-la dues vegades dona el mateix resultat). */
export function normalizeOffer(input: OfferVersion, opts: { adapter?: SupplierAdapter; rule?: PermanenceRule; unitRules?: UnitRule[] } = {}): Normalized {
  const adapter = opts.adapter ?? adapterFor(input.supplierName);
  const changes: string[] = [];
  const autoVerified: string[] = [];
  let o: OfferVersion = { ...input };

  // 1 · Terme fix del gas sense unitat al document: la de l'adaptador, si Direcció l'ha confirmada
  const g = o.units?.gasFixed;
  if (o.energyType === "gas" && g?.value != null && unitUnknown(g.unit) && adapter.gasFixedUnit) {
    const c = toInternal(g.value, adapter.gasFixedUnit.unit, "terme_fix_gas");
    if (c.ok && c.value != null) {
      o = { ...o, gasFixedEurDay: c.value, units: { ...o.units!, gasFixed: { value: g.value, unit: adapter.gasFixedUnit.unit }, formulas: [...new Set([...(o.units?.formulas ?? []), `Terme fix: ${c.formula}`])].slice(0, 20) } };
      changes.push(`Terme fix del gas en ${adapter.gasFixedUnit.unit}: ${c.formula}`);
    }
  }
  if (o.energyType === "gas" && adapter.gasFixedUnit && o.units?.gasFixed?.unit === adapter.gasFixedUnit.unit) autoVerified.push(`Unitat del terme fix: ${adapter.gasFixedUnit.source}`);
  // 1b · Regles d'unitat apreses i aprovades (Supabase): mateix motor per a lectures noves i reprocessament
  if (opts.unitRules?.length) {
    const ur = applyUnitRules(o, opts.unitRules);
    o = ur.offer;
    for (const a of ur.applied) { changes.push(a.formula); autoVerified.push(`Unitat confirmada per regla apresa: ${describeRule(a.rule)} (${UNIT_LABEL[a.rule.unit] ?? a.rule.unit})`); }
    for (const pr of ur.problems) changes.push(`⚠ ${pr}`);
  }

  // 2 · 24 hores: un únic preu per a tots els períodes
  const st = normalizeStructure(o);
  if (st.changed) { o = st.offer; changes.push(st.changed); }

  // 3 · Permanència: regla comercial de l'adaptador (reconeguda automàticament) o el que diu el document
  const ruled = adapter.permanence?.(o) ?? null;
  const current = declaredPermanence(o);
  if (ruled && current.status === "no_informada" && !o.permanence?.exception) {
    o = { ...o, permanence: { ...ruled, months: current.months ?? ruled.months } };
    changes.push(`Permanència reconeguda automàticament (${ruled.source}); durada ${ruled.months ? `${ruled.months} mesos` : "no especificada al document"}.`);
  }
  if (ruled && declaredPermanence(o).status === "amb" && declaredPermanence(o).source === ruled.source) autoVerified.push(ruled.source ?? "Permanència per regla comercial");
  if (!ruled && current.status === "no_informada") {
    const read = readConditions([o.conditions, o.penalty].filter(Boolean).join("\n"));
    const merged = mergePermanence(o.permanence, o.permanenceMonths, read);
    if (merged && merged.status !== "no_informada" && JSON.stringify(merged) !== JSON.stringify(o.permanence ?? null)) {
      o = { ...o, permanence: merged };
      changes.push(`Permanència llegida de les condicions: ${merged.status === "sense" ? "sense permanència" : merged.months ? `${merged.months} mesos` : "sí, durada no especificada"}.`);
    }
  }
  // 4 · Regla comercial interna (totes les comercialitzadores): fixa 3.0TD/6.1TD sense cap dada → amb permanència.
  //     Si el document diu «sense», es manté (és una contradicció per revisar, no s'inventa res).
  const rule = opts.rule ?? DEFAULT_PERMANENCE_RULE;
  const after = declaredPermanence(o);
  if (after.status === "no_informada" && !after.exception && permanenceRequired(o, rule)) {
    o = { ...o, permanence: { status: "amb", months: o.permanenceMonths != null && o.permanenceMonths > 0 ? o.permanenceMonths : null, startNote: null, cancellation: null, penalty: o.penalty ?? null, source: INTERNAL_RULE_SOURCE, exception: null } };
    changes.push("Permanència aplicada per la regla comercial interna (tarifa fixa 3.0TD/6.1TD); la durada i la penalització no s'inventen.");
  }
  const p = declaredPermanence(o);
  if (p.status === "amb" && p.months != null && o.permanenceMonths !== p.months) o = { ...o, permanenceMonths: p.months };
  return { offer: o, changes, autoVerified, adapter };
}

/** Incidències de la tarifa, classificades. Les condicions verificades automàticament no generen cap confirmació. */
export function validateOffer(o: OfferVersion): Incident[] {
  const out: Incident[] = [];
  const c = checkVersion(o);
  for (const e of c.errors) out.push({ level: /^Falta|no reconegut/.test(e) ? "falta" : "error", text: e });
  for (const w of c.warnings) out.push({ level: "avis", text: w });
  for (const i of c.info) out.push({ level: "info", text: i });
  // checkVersion ja inclou la validació de períodes; aquí només s'hi afegeixen els avisos no bloquejants de permanència
  for (const n of permanenceNotices(o)) out.push({ level: "info", text: n });
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.text) ? false : (seen.add(x.text), true)));
}

export interface ReviewRow {
  supplier: string;
  product: string;
  supplyType: string;
  accessTariff: string;
  modality: string;
  prices: PriceLine[];
  pricesText: { energy: string; power: string; gasFixed: string | null };
  originalUnits: string[];
  normalized: string[];
  permanence: string;
  commissions: string[];
  validity: string;
  incidents: Incident[];
  autoVerified: string[];
  /** Hi ha errors reals o dades essencials absents (la resta no demana cap confirmació manual) */
  blocking: boolean;
}

const MODALITY: Record<string, string> = { fix24h: "Preu fix", periodes: "Preu fix", indexat: "Indexada", mixt: "Mixta" };

/** Fila de la taula de revisió abans d'importar. `commissions` només s'informa per a qui té accés econòmic. */
export function reviewRow(o: OfferVersion, opts: { commissions?: string[]; extra?: Incident[]; autoVerified?: string[] } = {}): ReviewRow {
  const gas = o.energyType === "gas";
  const a = analyzePeriods(o);
  const per = periodsOf(o.accessTariff, o.energyType);
  const orig: string[] = [];
  if (o.units?.energy) orig.push(`Energia: ${o.units.energy.unit}`);
  if (o.units?.power) orig.push(`Potència: ${o.units.power.unit}`);
  if (o.units?.gasFixed) orig.push(`Terme fix: ${o.units.gasFixed.unit || "no indicada al document"}`);
  if (!orig.length) orig.push(gas ? "Energia: €/kWh (sense conversió)" : `Energia: €/kWh · Potència: ${POWER_UNIT_LABEL[o.powerUnit]} (sense conversió)`);
  const normalized = [...(o.units?.formulas ?? [])];
  if (gas && o.gasFixedEurDay != null) {
    const eq = gasFixedEquivalents(o.gasFixedEurDay);
    normalized.push(`Terme fix: ${nfmt(eq.perDay)} €/client·dia = ${nfmt(eq.perMonth, 4)} €/mes = ${nfmt(eq.perYear, 2)} €/any (${GAS_FIXED_CRITERION})`);
  }
  const incidents = [...validateOffer(o), ...(opts.extra ?? [])];
  return {
    supplier: o.supplierName,
    product: o.productName,
    supplyType: gas ? "Gas natural" : "Electricitat",
    accessTariff: o.accessTariff,
    modality: gas ? `Gas · ${o.contractType === "indexat" ? "indexada" : "preu fix"}` : `${MODALITY[o.contractType] ?? o.contractType} · ${a.label.ca}`,
    prices: priceLines(o, per),
    pricesText: { energy: energyText(o), power: gas ? "—" : powerText(o), gasFixed: gas ? gasFixedText(o) : null },
    originalUnits: orig,
    normalized: [...new Set(normalized)],
    permanence: permanenceLabel(o).replace(/^Permanència: /, ""),
    commissions: opts.commissions ?? [],
    validity: `${o.validFrom ?? "—"} → ${o.validTo ?? (o.commercial ? "fins a un annex nou" : "sense data de fi")}`,
    incidents,
    autoVerified: [...new Set(opts.autoVerified ?? [])],
    blocking: incidents.some((i) => i.level === "error" || i.level === "falta"),
  };
}

/** Normalitza i valida d'un sol cop (lectors, importació i reprocessament). */
export function runEngine(o: OfferVersion, opts: { adapter?: SupplierAdapter; commissions?: string[]; unitRules?: UnitRule[] } = {}) {
  const n = normalizeOffer(o, opts);
  return { ...n, review: reviewRow(n.offer, { commissions: opts.commissions, autoVerified: n.autoVerified }) };
}
