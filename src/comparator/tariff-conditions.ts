/**
 * PERMANÈNCIES I CONDICIONS DE LES TARIFES (lògica pura, comuna a tots els lectors).
 *
 * Llegeix del text de condicions d'un document de tarifes (castellà o català):
 *  - si hi ha permanència, i la durada NOMÉS si el document la diu (mai s'inventen 12 mesos);
 *  - la penalització, les condicions de renovació, la vigència de l'oferta i les excepcions contractuals.
 * El resultat és una proposta traçable (fragment literal): la fusió amb la tarifa no sobreescriu mai el que ja
 * consta de manera més precisa.
 */
import type { PermanenceInfo } from "./types";

export interface TariffConditions {
  permanence: "amb" | "sense" | null;
  months: number | null;
  penalty: string | null;
  renewal: string | null;
  validity: string | null;
  exceptions: string[];
  /** Fragments literals d'on surt cada dada */
  evidence: string[];
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const sentences = (t: string) => t.replace(/\s+/g, " ").split(/(?<=[.;])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const cut = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function readConditions(text: string | null | undefined): TariffConditions {
  const out: TariffConditions = { permanence: null, months: null, penalty: null, renewal: null, validity: null, exceptions: [], evidence: [] };
  if (!text?.trim()) return out;
  for (const s of sentences(text)) {
    const f = fold(s);
    if (/\b(sin|sense)\s+permanencia\b|\bno\s+(hay|existe|te|tiene|aplica)\s+(ninguna\s+)?permanencia\b|permanencia\s*:\s*(no|ninguna|sin)\b/.test(f)) {
      if (out.permanence == null) { out.permanence = "sense"; out.evidence.push(cut(s)); }
      continue;
    }
    if (/permanencia|compromiso de permanencia|compromis de permanencia/.test(f)) {
      if (out.permanence !== "sense") out.permanence = "amb";
      const m = /permanencia[^.;]{0,60}?(\d{1,3})\s*(meses|mesos|mes|anos|anys|ano|any)\b/.exec(f) ?? /(\d{1,3})\s*(meses|mesos|anos|anys)\s+de\s+permanencia/.exec(f);
      if (m && out.months == null) out.months = /^an/.test(m[2]) ? Number(m[1]) * 12 : Number(m[1]);
      out.evidence.push(cut(s));
    }
    if (/penali[sz]aci|indemnitzaci|indemnizaci/.test(f) && !out.penalty) { out.penalty = cut(s, 500); out.evidence.push(cut(s)); }
    if (/renovaci[oó]n?\s+(automatica|tacita)|renovacio\s+(automatica|tacita)|se renovara|es renovara|prorroga/.test(f) && !out.renewal) { out.renewal = cut(s, 500); out.evidence.push(cut(s)); }
    if (/^(validez|vigencia|vigencia de la oferta|validesa)\b|oferta valida|oferta vigente|valida hasta|valida fins|vigente hasta/.test(f) && !out.validity) { out.validity = cut(s, 500); out.evidence.push(cut(s)); }
    if (/(excepto|salvo|excepte|llevat de|a excepcion|no aplica a|no s.aplica a)/.test(f) && /(permanencia|penali|contrato|contracte|tarifa|cliente|client)/.test(f)) out.exceptions.push(cut(s, 300));
  }
  out.exceptions = [...new Set(out.exceptions)].slice(0, 5);
  out.evidence = [...new Set(out.evidence)].slice(0, 8);
  return out;
}

/**
 * Combina la permanència que ja té la tarifa amb la llegida a les condicions. Prioritat: el que ja consta amb durada
 * > el document > res. Mai converteix «no informada» en «sense» sense que el document ho digui.
 */
export function mergePermanence(current: PermanenceInfo | null | undefined, months: number | null | undefined, c: TariffConditions): PermanenceInfo | null {
  const cur: PermanenceInfo | null = current ?? (months != null && months > 0 ? { status: "amb", months, startNote: null, cancellation: null, penalty: null, source: null, exception: null } : null);
  if (cur && cur.status !== "no_informada" && (cur.status === "sense" || cur.months != null)) return cur;
  if (!c.permanence) return cur;
  const base: PermanenceInfo = cur ?? { status: "no_informada", months: null, startNote: null, cancellation: null, penalty: null, source: null, exception: null };
  return {
    ...base,
    status: c.permanence,
    months: c.permanence === "amb" ? base.months ?? c.months : null,
    penalty: base.penalty ?? c.penalty,
    source: base.source ?? (c.evidence[0] ? `Document: «${c.evidence[0].slice(0, 260)}»` : "Document"),
  };
}
