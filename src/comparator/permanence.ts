/**
 * PERMANÈNCIA (lògica pura). Regla comercial d'Assessoria 3.0, configurable per Direcció: les tarifes de preu FIX
 * 3.0TD i 6.1TD del catàleg han de tenir permanència. Mai es mostra «Sense permanència» si és obligatòria o si no
 * consta expressament que no n'hi ha; mai s'inventa una durada.
 */
import { normalizeTariff } from "./engine";
import { DEFAULT_PERMANENCE_RULE, type OfferVersion, type PermanenceInfo, type PermanenceRule } from "./types";

type O = Pick<OfferVersion, "permanenceMonths" | "permanence" | "accessTariff" | "contractType" | "energyType">;

/**
 * Origen de la permanència quan l'aplica la REGLA COMERCIAL INTERNA (no la diu el document de la comercialitzadora).
 * Es distingeix sempre de les condicions oficials: no s'hi inventa cap durada ni penalització.
 */
export const INTERNAL_RULE_SOURCE = "Regla comercial interna d'Assessoria 3.0: tarifa fixa 3.0TD/6.1TD amb permanència (durada i penalització segons les condicions de la comercialitzadora)";
const ruled = (o: O): PermanenceInfo => ({ status: "amb", months: o.permanenceMonths != null && o.permanenceMonths > 0 ? o.permanenceMonths : null, startNote: null, cancellation: null, penalty: null, source: INTERNAL_RULE_SOURCE, exception: null });

/** Permanència tal com consta a les dades (sense aplicar la regla interna). */
export function declaredPermanence(o: O): PermanenceInfo {
  if (o.permanence) return { ...o.permanence, months: o.permanence.months ?? (o.permanence.status === "amb" ? o.permanenceMonths ?? null : null) };
  if (o.permanenceMonths != null && o.permanenceMonths > 0) return { status: "amb", months: o.permanenceMonths, startNote: null, cancellation: null, penalty: null, source: null, exception: null };
  return { status: "no_informada", months: null, startNote: null, cancellation: null, penalty: null, source: null, exception: null };
}

/**
 * Permanència EFECTIVA (font única per al catàleg, les comparatives, el rànquing i els PDF): la declarada i, si la
 * tarifa és fixa 3.0TD/6.1TD sense cap dada de permanència ni excepció de Direcció, «amb» per la regla interna.
 * Si les condicions oficials diuen «sense», NO es canvia: és una contradicció que revisa l'administració.
 */
export function permanenceOf(o: O, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): PermanenceInfo {
  const p = declaredPermanence(o);
  if (p.status === "no_informada" && !p.exception && permanenceRequired(o, rule)) return ruled(o);
  return p;
}

/** La permanència ve de la regla interna (no de les condicions oficials). */
export const isRuleDerived = (p: PermanenceInfo) => p.source === INTERNAL_RULE_SOURCE;

/** La regla de permanència obligatòria s'aplica a aquesta tarifa? (fixa 3.0TD / 6.1TD per defecte) */
export function permanenceRequired(o: Pick<O, "accessTariff" | "contractType" | "energyType">, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): boolean {
  if (!rule.enabled || o.energyType === "gas") return false;
  const t = normalizeTariff(o.accessTariff);
  return !!t && rule.tariffs.map((x) => normalizeTariff(x)).includes(t) && rule.contractTypes.includes(o.contractType);
}

/** Contradicció: les condicions oficials diuen «sense permanència» però la regla interna l'exigeix (sense excepció). */
export function permanenceConflict(o: O, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): boolean {
  const p = declaredPermanence(o);
  return p.status === "sense" && !p.exception && permanenceRequired(o, rule);
}

/**
 * Només es pot dir «sense permanència» (etiqueta, filtre, rànquing, PDF) si consta expressament i, en una tarifa fixa
 * 3.0TD/6.1TD, si Direcció hi ha documentat una excepció.
 */
export function hasNoPermanence(o: O, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): boolean {
  return permanenceOf(o, rule).status === "sense" && !permanenceConflict(o, rule);
}

/**
 * Incidències que impedeixen activar la tarifa o emetre definitivament una proposta amb ella.
 * Una permanència existent SENSE durada al document no és cap incidència: la durada queda sense determinar (no
 * s'inventen 12 mesos ni cap altra xifra) i es mostra com a avís informatiu (`permanenceNotices`).
 */
export function permanenceIssues(o: O, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): string[] {
  return permanenceConflict(o, rule)
    ? ["Revisió administrativa: les condicions oficials indiquen «sense permanència», però la regla interna d'Assessoria 3.0 l'exigeix a les tarifes fixes 3.0TD/6.1TD. Confirma-ho amb la comercialitzadora o documenta una excepció (Direcció). No s'inventa cap condició."]
    : [];
}

/** Avisos informatius (no bloquegen): p. ex. permanència existent amb la durada no especificada al document. */
export function permanenceNotices(o: O, rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): string[] {
  const p = permanenceOf(o, rule);
  const out: string[] = [];
  if (p.status === "amb" && isRuleDerived(p)) out.push("Permanència aplicada per la regla comercial interna (tarifa fixa 3.0TD/6.1TD): la durada i la penalització s'han de confirmar amb les condicions de la comercialitzadora");
  else if (p.status === "amb" && (p.months == null || p.months <= 0)) out.push(`Permanència: sí, durada no especificada al document${p.source ? ` (${p.source})` : ""}`);
  return out;
}

/** Text per a la pantalla i el PDF (mateixa funció a tot arreu). Mai «Sense permanència» per a una fixa 3.0TD/6.1TD. */
export function permanenceLabel(o: O, lang: "ca" | "es" = "ca", rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): string {
  const p = permanenceOf(o, rule);
  const ca = lang === "ca";
  if (permanenceConflict(o, rule)) return ca ? "Permanència: pendent de revisió administrativa" : "Permanencia: pendiente de revisión administrativa";
  if (p.status === "amb" && p.months) return ca ? `Permanència: ${p.months} mesos` : `Permanencia: ${p.months} meses`;
  if (p.status === "amb" && isRuleDerived(p)) return ca ? "Permanència: sí (durada segons condicions de la comercialitzadora)" : "Permanencia: sí (duración según condiciones de la comercializadora)";
  if (p.status === "amb") return ca ? "Permanència: sí (durada no especificada al document)" : "Permanencia: sí (duración no especificada en el documento)";
  if (p.status === "sense") return ca ? "Sense permanència" : "Sin permanencia";
  return ca ? "Permanència: no informada" : "Permanencia: no informada";
}

/** Text de permanència d'una oferta dins d'una comparativa: les emeses amb el motor 1.0.x conserven el text original. */
export function snapshotPermanenceLabel(o: O, engineVersion: string, lang: "ca" | "es" = "ca", rule: PermanenceRule = DEFAULT_PERMANENCE_RULE): string {
  // les tarifes fixes 3.0TD/6.1TD sempre amb la lògica actual (mai «Sense permanència» per manca de mesos)
  if (/^1\.0\./.test(engineVersion) && !permanenceRequired(o, rule)) {
    const ca = lang === "ca";
    return o.permanenceMonths ? (ca ? `Permanència: ${o.permanenceMonths} mesos` : `Permanencia: ${o.permanenceMonths} meses`) : ca ? "Sense permanència" : "Sin permanencia";
  }
  return permanenceLabel(o, lang, rule);
}
