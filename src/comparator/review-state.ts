/**
 * Fase 15 · ESTAT DE REVISIÓ D'UNA TARIFA (lògica pura, servidor i navegador).
 *
 * Abans una tarifa només tenia «esborrany / activa» i el lector deia «A revisar» sense explicar per què. Ara cada tarifa
 * té un estat de revisió amb els MOTIUS concrets per concepte, separat de:
 *   · l'estat de publicació al catàleg (`status`: esborrany, activa, caducada, arxivada) i
 *   · l'estat de la plantilla de lectura (pendent, verificada…).
 *
 * Estats (per ordre de prioritat):
 *   error_lectura           el document no s'ha pogut processar (cel·les amb error, fila fallida)
 *   pendent_interpretacio   falta una dada essencial o una unitat que el CRM no ha pogut identificar
 *   pendent_aprovacio       hi ha una regla aplicada que encara no ha aprovat Direcció
 *   revisio_necessaria      hi ha una discrepància concreta (descompte dubtós, avís de lectura, error de validació)
 *   pendent_verificacio     tot és correcte però la plantilla d'origen encara no està verificada
 *   validada                totes les comprovacions obligatòries superades
 *
 * Una regla aprovada que resol l'únic bloqueig fa que la tarifa deixi d'estar pendent; mai no es marca «validada» una
 * tarifa amb un altre error pendent.
 */
import { validateOffer } from "./tariff-engine";
import { formulaMissing } from "./market";
import { periodsOf } from "./engine";
import type { OfferVersion } from "./types";

export const REVIEW_STATES = ["error_lectura", "pendent_interpretacio", "pendent_aprovacio", "revisio_necessaria", "pendent_verificacio", "validada"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  error_lectura: "Error de lectura",
  pendent_interpretacio: "Pendent d'interpretació",
  pendent_aprovacio: "Pendent d'aprovació",
  revisio_necessaria: "Revisió necessària",
  pendent_verificacio: "Pendent de verificació",
  validada: "Validada",
};
export const REVIEW_STATE_TONE: Record<ReviewState, "red" | "amber" | "blue" | "green" | "zinc"> = {
  error_lectura: "red", pendent_interpretacio: "amber", pendent_aprovacio: "blue", revisio_necessaria: "amber", pendent_verificacio: "zinc", validada: "green",
};

export interface ReviewCheck { concept: string; label: string; ok: boolean; detail: string; blocking: ReviewState | null }
export interface TariffReview { state: ReviewState; label: string; checks: ReviewCheck[]; reasons: string[] }

const UNIT_TXT: Record<string, string> = { "€/cliente/mes": "€/mes", "€/cliente/día": "€/dia", "€/cliente/año": "€/any" };

/**
 * Estat de revisió d'una tarifa. `templateVerified`: false si la plantilla d'origen encara no està verificada
 * (null/undefined = desconegut o no aplica: no bloqueja).
 */
export function tariffReview(o: OfferVersion, ctx: { templateVerified?: boolean | null } = {}): TariffReview {
  const gas = o.energyType === "gas";
  const checks: ReviewCheck[] = [];
  const stored = o.template?.checks ?? [];
  const incidents = validateOffer(o);
  const errors = incidents.filter((i) => i.level === "error");
  const missing = incidents.filter((i) => i.level === "falta");

  if (o.template?.interpStatus === "fallida") checks.push({ concept: "lectura", label: "Lectura", ok: false, detail: "el document no s'ha pogut processar en aquesta fila", blocking: "error_lectura" });

  if (gas) {
    const g = o.units?.gasFixed;
    const unit = g?.unit ? UNIT_TXT[g.unit] ?? g.unit : null;
    if (o.gasFixedEurDay != null) checks.push({ concept: "terme_fix", label: "Terme fix", ok: true, detail: `validat${unit && !/no indicada/i.test(unit) ? ` (${unit})` : ""}`, blocking: null });
    else checks.push({ concept: "terme_fix", label: "Terme fix", ok: false, detail: g?.value != null ? `unitat pendent de confirmar (valor ${g.value}, el document no indica si és €/dia, €/mes o €/any)` : "falta el terme fix", blocking: "pendent_interpretacio" });
    const tv = o.contractType === "indexat" ? !!o.formula?.marginEurMWh || !!o.indexedReference?.energy?.some((x) => x != null) : o.energy24h != null;
    checks.push({ concept: "terme_variable", label: "Terme variable", ok: tv, detail: tv ? "validat" : o.contractType === "indexat" ? "fórmula indexada pendent" : "falta el preu", blocking: tv ? null : "pendent_interpretacio" });
  } else {
    const e = o.contractType === "indexat" ? !!o.formula || !!o.indexedReference?.energy?.some((x) => x != null) : o.energy24h != null || o.energy.some((x) => x != null);
    checks.push({ concept: "energia", label: "Energia", ok: e, detail: e ? "validada" : "falten els preus d'energia", blocking: e ? null : "pendent_interpretacio" });
    const p = o.power.some((x) => x != null);
    checks.push({ concept: "potencia", label: "Potència", ok: p, detail: p ? "validada" : "falten els preus de potència", blocking: p ? null : "pendent_interpretacio" });
  }
  // si la dada falta i la lectura en sap el motiu concret (p. ex. «correspondència de preus per període pendent»), es diu aquest
  for (const c of checks) if (!c.ok) { const st = stored.find((x) => x.concept === c.concept && !x.ok); if (st) c.detail = st.detail; }
  // comprovacions de lectura desades amb la tarifa (descompte, classificació, regles); el terme fix es recalcula sempre
  for (const c of stored) {
    if (c.concept === "terme_fix" || c.concept === "terme_variable" || c.concept === "energia" || c.concept === "potencia") continue;
    const blocking: ReviewState | null = c.ok ? null : c.concept === "regles" && /pendents d'aprovar/.test(c.detail) ? "pendent_aprovacio" : c.concept === "classificacio" ? "pendent_interpretacio" : "revisio_necessaria";
    checks.push({ concept: c.concept, label: c.label, ok: c.ok, detail: c.detail, blocking });
  }
  // preu base + FEE: el FEE addicional pendent de confirmar NO bloqueja la tarifa (només no es pot editar)
  const pm = o.pricing;
  if (pm && (pm.model === "FIXED_BASE_FEE" || pm.model === "INDEXED_BASE_FEE" || pm.feeAllowed === "pendent")) {
    // el FEE no és una dada del catàleg: es decideix a cada comparativa (mai bloqueja la validació de la tarifa)
    checks.push({ concept: "fee", label: "FEE comercial", ok: pm.model === "FIXED_BASE_FEE" || pm.feeAllowed !== "pendent", detail: pm.model === "FIXED_BASE_FEE" ? "preus base desats; el FEE es decideix a cada comparativa" : pm.feeAllowed === "si" ? "FEE configurable a cada comparativa" : pm.feeAllowed === "no" ? "el contracte no permet afegir FEE" : "FEE addicional pendent de confirmar (no s'aplica)", blocking: null });
  }
  // indexades: sense la fórmula contractual completa no es poden activar per a comparatives definitives
  if (o.contractType === "indexat" && o.formula) {
    const miss = formulaMissing(o.formula, gas ? 1 : periodsOf(o.accessTariff, o.energyType).energy);
    if (miss.length) checks.push({ concept: "formula", label: "Fórmula indexada", ok: false, detail: `incompleta: falta ${miss.join(", ").toLowerCase()} (el marge sol no és el preu de l'energia)`, blocking: "revisio_necessaria" });
  }
  for (const m of missing) if (!checks.some((c) => !c.ok && c.blocking === "pendent_interpretacio" && m.text.toLowerCase().includes(c.label.toLowerCase()))) checks.push({ concept: "dada", label: "Dada essencial", ok: false, detail: m.text, blocking: "pendent_interpretacio" });
  for (const e of errors) if (!/sense unitat reconeguda/.test(e.text)) checks.push({ concept: "validacio", label: "Validació", ok: false, detail: e.text, blocking: "revisio_necessaria" });
  if (ctx.templateVerified === false) checks.push({ concept: "plantilla", label: "Plantilla", ok: false, detail: "la plantilla de lectura encara no està verificada", blocking: "pendent_verificacio" });
  else if (ctx.templateVerified === true) checks.push({ concept: "plantilla", label: "Plantilla", ok: true, detail: "verificada", blocking: null });

  const order: ReviewState[] = ["error_lectura", "pendent_interpretacio", "pendent_aprovacio", "revisio_necessaria", "pendent_verificacio"];
  const state = order.find((s) => checks.some((c) => !c.ok && c.blocking === s)) ?? "validada";
  const reasons = checks.filter((c) => !c.ok && c.blocking).map((c) => `${c.label}: ${c.detail}`);
  return { state, label: REVIEW_STATE_LABEL[state], checks, reasons };
}

/** Text curt amb el detall (p. ex. per al xat o per al resum del reprocessament). */
export function reviewText(o: OfferVersion, r: TariffReview): string {
  return [`${o.supplierName} — ${o.productName}`, ...r.checks.map((c) => `• ${c.label}: ${c.detail}`), r.state === "validada" ? "Estat: validada" : `Motiu pendent: ${r.reasons.join("; ")}`].join("\n");
}
