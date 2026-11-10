/**
 * REGLES D'UNITAT APRESES (lògica pura). Quan una persona confirma la unitat d'un import que el document no indica
 * (p. ex. «el terme fix del gas d'Iberdrola és €/mes»), la regla es desa a Supabase i el MOTOR ÚNIC de normalització
 * (`normalizeOffer`) l'aplica a totes les lectures futures compatibles i al reprocessament del catàleg.
 *
 *  · Abast: comercialitzadora (obligatori) + tipus de subministrament + concepte, i opcionalment producte, peatge
 *    i plantilla. Mai s'aplica a una altra comercialitzadora.
 *  · Només resol unitats DESCONEGUDES: si el document indica la unitat, mana el document.
 *  · Si dues regles igual d'específiques diuen unitats diferents, no se n'aplica cap (conflicte per revisar).
 *  · Conserva el valor i la unitat originals i la fórmula (€/mes × 12 ÷ 365 = €/dia).
 */
import { normalizeTariff } from "./engine";
import { parseUnit, toInternal } from "./units";
import type { OfferVersion } from "./types";

export const UNIT_CONCEPTS = ["terme_fix_gas"] as const;
export type UnitConcept = (typeof UNIT_CONCEPTS)[number];
export const CONCEPT_LABEL: Record<UnitConcept, string> = { terme_fix_gas: "Terme fix" };
/** Unitats d'origen admeses per concepte (text que entén `parseUnit`). */
export const UNIT_OPTIONS: Record<UnitConcept, Record<string, string>> = {
  terme_fix_gas: { eur_dia: "€/cliente/día", eur_mes: "€/cliente/mes", eur_any: "€/cliente/año" },
};
export const UNIT_LABEL: Record<string, string> = { eur_dia: "€/dia", eur_mes: "€/mes", eur_any: "€/any" };

export interface UnitRule {
  id: string;
  supplier: string;
  energyType: "luz" | "gas";
  concept: UnitConcept;
  /** Codi de la unitat d'origen (eur_mes…) */
  unit: string;
  product?: string | null;
  accessTariff?: string | null;
  templateName?: string | null;
  /** Plantilla per identificador (més fiable que el nom: les tarifes llegides porten `template.templateId`). */
  templateId?: string | null;
  status?: "aprovada" | "proposada" | "revocada";
  approvedBy?: string | null;
}

const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/\b(s\.?l\.?u?|s\.?a\.?u?|clientes|comercializadora|comercialitzadora|energia|energy|iberica)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** Mateixa comercialitzadora (tolerant a «S.L.», «Energía», «Comercializadora»…), mai per coincidència parcial curta. */
export function sameSupplier(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = fold(a), y = fold(b);
  if (!x || !y) return false;
  return x === y || x.split(" ")[0] === y.split(" ")[0] && x.split(" ")[0].length >= 4;
}

type O = Pick<OfferVersion, "supplierName" | "productName" | "energyType" | "accessTariff" | "source" | "gasFixedEurDay" | "units"> & { template?: OfferVersion["template"] };

/** Aquesta tarifa té el valor del concepte amb la unitat desconeguda? (és l'únic cas que una regla pot resoldre) */
export function unknownUnit(o: O, concept: UnitConcept): { value: number; unit: string } | null {
  if (concept === "terme_fix_gas") {
    const g = o.units?.gasFixed;
    if (o.energyType !== "gas" || o.gasFixedEurDay != null || g?.value == null) return null;
    return parseUnit(g.unit) && toInternal(g.value, g.unit, "terme_fix_gas").ok ? null : { value: g.value, unit: g.unit || "" };
  }
  return null;
}

/** La regla s'aplica a aquesta tarifa? (abast complet) */
export function ruleMatches(r: UnitRule, o: O): boolean {
  if (r.status && r.status !== "aprovada") return false;
  if (!sameSupplier(r.supplier, o.supplierName)) return false;
  if (r.energyType !== o.energyType) return false;
  if (r.product && !fold(o.productName).includes(fold(r.product))) return false;
  if (r.accessTariff && normalizeTariff(r.accessTariff) !== normalizeTariff(o.accessTariff)) return false;
  if (r.templateId || r.templateName) {
    // la plantilla es reconeix per identificador; el nom només com a alternativa (tarifes antigues sense templateId)
    const byId = !!r.templateId && o.template?.templateId === r.templateId;
    const byName = !!r.templateName && ((o.source ?? "").startsWith(`Plantilla «${r.templateName}»`) || o.template?.name === r.templateName);
    if (!byId && !byName) return false;
  }
  return true;
}
const specificity = (r: UnitRule) => (r.product ? 4 : 0) + (r.accessTariff ? 2 : 0) + (r.templateName || r.templateId ? 1 : 0);

/** Regla aplicable (la més específica). Conflicte = dues igual d'específiques amb unitats diferents. */
export function pickRule(rules: UnitRule[], o: O, concept: UnitConcept): { rule: UnitRule | null; conflict: UnitRule[] | null } {
  const ok = rules.filter((r) => r.concept === concept && ruleMatches(r, o));
  if (!ok.length) return { rule: null, conflict: null };
  const top = Math.max(...ok.map(specificity));
  const best = ok.filter((r) => specificity(r) === top);
  if (new Set(best.map((r) => r.unit)).size > 1) return { rule: null, conflict: best };
  return { rule: best[0], conflict: null };
}

export function describeRule(r: Pick<UnitRule, "supplier" | "energyType" | "concept" | "product" | "accessTariff" | "templateName">): string {
  return [r.supplier, r.energyType === "gas" ? "Gas" : "Electricitat", CONCEPT_LABEL[r.concept], r.product ? `producte «${r.product}»` : null, r.accessTariff ? `peatge ${r.accessTariff}` : null, r.templateName ? `plantilla «${r.templateName}»` : null].filter(Boolean).join(" — ");
}

/**
 * Aplica les regles a una tarifa (dins del motor de normalització). Retorna la tarifa amb el valor convertit i
 * l'original conservat, o els motius pels quals no s'ha aplicat.
 */
export function applyUnitRules<T extends O>(o: T, rules: UnitRule[]): { offer: T; applied: { rule: UnitRule; formula: string }[]; problems: string[] } {
  const applied: { rule: UnitRule; formula: string }[] = [];
  const problems: string[] = [];
  let next = o;
  for (const concept of UNIT_CONCEPTS) {
    const u = unknownUnit(next, concept);
    if (!u) continue;
    const { rule, conflict } = pickRule(rules, next, concept);
    if (conflict) { problems.push(`Regles d'unitat en conflicte per al ${CONCEPT_LABEL[concept].toLowerCase()}: ${conflict.map((r) => `${describeRule(r)} = ${UNIT_LABEL[r.unit] ?? r.unit}`).join(" / ")}. Cal decidir-ne una.`); continue; }
    if (!rule) continue;
    const unitText = UNIT_OPTIONS[concept][rule.unit];
    const c = toInternal(u.value, unitText, "terme_fix_gas");
    if (!c.ok || c.value == null) { problems.push(`Regla «${describeRule(rule)}»: ${c.reason ?? "no s'ha pogut convertir"}`); continue; }
    const formula = `Terme fix: ${c.formula} · regla apresa «${describeRule(rule)}»${rule.approvedBy ? ` (aprovada per ${rule.approvedBy})` : ""}`;
    next = { ...next, gasFixedEurDay: c.value, units: { ...(next.units ?? { formulas: [] }), gasFixed: { value: u.value, unit: unitText }, formulas: [...new Set([...(next.units?.formulas ?? []), formula])].slice(0, 20) } };
    applied.push({ rule, formula });
  }
  return { offer: next, applied, problems };
}

/** Incidències bloquejants que una regla d'unitat pot resoldre (la resta mai s'amaguen). */
export const isUnitBlocker = (text: string) => /sense unitat reconeguda|Falta el terme fix del gas/.test(text);

export interface RuleApplicationReport {
  rule: string;
  originalUnit: string;
  targetUnit: string;
  persisted: boolean;
  approved: boolean;
  affected: number;
  reprocessed: number;
  validated: number;
  pending: { product: string; reasons: string[] }[];
  failed: { product: string; error: string }[];
  completed: boolean;
}

/** Resposta verificable del xat: només diu «aplicada» si el reprocessament ha acabat bé. */
export function reportText(r: RuleApplicationReport): string {
  const head = r.completed && r.approved ? `Norma aplicada: ${r.rule}` : r.approved ? `Norma guardada però NO aplicada del tot: ${r.rule}` : `Norma guardada, pendent d'aprovació de Direcció: ${r.rule}`;
  const lines = [
    head,
    `• Unitat original: ${r.originalUnit}`,
    `• Unitat de destí: ${r.targetUnit}`,
    `• Regla persistent: ${r.persisted ? "guardada" : "NO guardada"}${r.approved ? "" : " (encara no s'aplica: cal l'aprovació de Direcció)"}`,
    `• Tarifes afectades: ${r.affected}`,
    `• Tarifes reprocessades correctament: ${r.reprocessed}`,
    `• Tarifes validades: ${r.validated}`,
    `• Tarifes encara pendents: ${r.pending.length}${r.pending.length ? "" : ""}`,
    ...r.pending.slice(0, 15).map((p) => `   – ${p.product}: ${p.reasons.join("; ")}`),
    ...(r.failed.length ? [`• Errors de reprocessament: ${r.failed.length}`, ...r.failed.slice(0, 10).map((f) => `   – ${f.product}: ${f.error}`)] : []),
  ];
  return lines.join("\n");
}

/**
 * Fase 15 · UN SOL APRENENTATGE per al lector i per al catàleg. Les regles d'unitat aprovades (Supabase) es tradueixen
 * a regles de lectura perquè el lector de taules (TableReader / lector universal) les apliqui igual que el motor del
 * catàleg: abans, una regla d'unitat aprovada no canviava l'estat «A revisar» del lector si la plantilla no la tenia.
 * Només s'hi inclouen les de la comercialitzadora del document (mai d'una altra).
 */
export function unitRulesAsReadingRules(rules: UnitRule[], supplier: string | null | undefined): import("./tariff-table").ReadingRule[] {
  return rules
    .filter((r) => (r.status ?? "aprovada") === "aprovada" && r.concept === "terme_fix_gas" && r.energyType === "gas" && sameSupplier(r.supplier, supplier))
    .map((r) => ({
      id: `unitat:${r.id}`,
      title: `Gas: terme fix en ${UNIT_LABEL[r.unit] ?? r.unit} (regla apresa${r.product ? ` · ${r.product}` : ""})`,
      // una regla de producte és més específica que la general de la comercialitzadora
      scope: r.product ? "producte" as const : r.templateId || r.templateName ? "plantilla" as const : "general" as const,
      match: { energyType: "gas" as const, product: r.product ?? null, tariffs: r.accessTariff ? [r.accessTariff] : null },
      set: { gasFixedUnit: r.unit as "eur_dia" | "eur_mes" | "eur_any", review: "" },
      explanation: `Regla d'unitat aprovada${r.approvedBy ? ` per ${r.approvedBy}` : ""}: ${describeRule(r)}.`,
      source: "direccio" as const,
      approved: true,
      approvedBy: r.approvedBy ?? "Direcció",
      columns: ["C"],
    }));
}
