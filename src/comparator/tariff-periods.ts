/**
 * VALIDACIÓ DE PERÍODES (lògica pura, comuna a totes les comercialitzadores).
 *
 *  - Reconeix la tarifa d'accés (2.0TD, 3.0TD, 6.1TD… i RL del gas) i quants períodes d'energia i de potència té.
 *  - Distingeix les tarifes 24 hores (un únic preu per a tots els períodes) de les tarifes per períodes.
 *  - El NÚMERO de la tarifa d'accés no és la QUANTITAT de preus: una 3.0TD per períodes té sis preus (P1–P6), mai «3».
 *  - No inventa valors: un preu en un període que la tarifa no té és un error, i un període buit és una dada absent.
 */
import { normalizeTariff, periodsOf } from "./engine";
import type { OfferVersion } from "./types";

export type Structure = "24h" | "periodes" | "indexada" | "gas";
export interface PeriodIssue { level: "error" | "avis" | "info"; text: string }
export interface PeriodAnalysis {
  tariff: string | null;
  known: boolean;
  expectedEnergy: number;
  expectedPower: number;
  structure: Structure;
  /** Quantitat de preus d'energia diferents que té realment la tarifa (1 per a les 24 hores) */
  priceCount: number;
  /** Etiqueta de la modalitat de preus: «Preu únic 24 hores», «6 preus (P1–P6)»… */
  label: { ca: string; es: string };
  /** Quantitat de preus que diu el NOM del producte («Tres precios» → 3), si en diu cap */
  nameCount: number | null;
  issues: PeriodIssue[];
}

type O = Pick<OfferVersion, "accessTariff" | "energyType" | "contractType" | "energy" | "energy24h" | "power" | "productName" | "indexedReference">;

const WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, unico: 1, unic: 1, dos: 2, tres: 3, cuatro: 4, quatre: 4, cinco: 5, cinc: 5, seis: 6, sis: 6 };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Quantitat de preus que indica el nom («Tres precios», «6 preus», «Precio único», «24h»). No es confon amb «3.0TD». */
export function priceCountFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  // es treu la tarifa d'accés del text perquè el «3» de «3.0TD» no es llegeixi com a quantitat de preus
  const n = fold(name).replace(/\b[236][.,]?\s?[0-4]\s?td\b/g, " ").replace(/\brl\.?\s?\d+\b/g, " ");
  const m = /\b(\d|un|una|uno|dos|tres|cuatro|quatre|cinco|cinc|seis|sis)\s+(precios?|preus?|periodos?|periodes?)\b/.exec(n);
  if (m) return /^\d$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]] ?? null;
  if (/\b(precio|preu)\s+(unico|unic)\b|\b24\s?h(ores|oras)?\b/.test(n)) return 1;
  return null;
}

const fmt = (v: number) => v.toLocaleString("ca-ES", { maximumFractionDigits: 6 });
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

export function analyzePeriods(o: O): PeriodAnalysis {
  const tariff = normalizeTariff(o.accessTariff);
  const per = periodsOf(o.accessTariff, o.energyType);
  const issues: PeriodIssue[] = [];
  const nameCount = priceCountFromName(o.productName);
  const gas = o.energyType === "gas";
  const range = (n: number) => (n === 1 ? "P1" : `P1–P${n}`);

  if (gas) {
    if (o.energy.some((x, i) => i > 0 && x != null)) issues.push({ level: "error", text: "Gas amb preus a P2–P6: el gas té un únic terme variable (no s'inventen períodes)." });
    if (o.power.some((x) => x != null)) issues.push({ level: "error", text: "Gas amb preus de potència: el gas no té terme de potència, té un terme fix per subministrament." });
    return { tariff, known: per.known, expectedEnergy: 1, expectedPower: 0, structure: "gas", priceCount: 1, label: { ca: "Terme variable únic (gas)", es: "Término variable único (gas)" }, nameCount, issues };
  }

  // potència: mai valors en períodes que la tarifa no té
  o.power.forEach((x, i) => { if (x != null && i >= per.power && per.known) issues.push({ level: "error", text: `Preu de potència a P${i + 1}: la ${tariff} només té ${per.power} períodes de potència (no s'inventen valors).` }); });

  if (o.contractType === "indexat") {
    const ref = o.indexedReference?.energy ?? [];
    ref.forEach((x, i) => { if (x != null && i >= per.energy && per.known) issues.push({ level: "error", text: `Preu de referència a P${i + 1}: la ${tariff} només té ${per.energy} períodes d'energia.` }); });
    return { tariff, known: per.known, expectedEnergy: per.energy, expectedPower: per.power, structure: "indexada", priceCount: per.energy, label: { ca: `Indexada (${range(per.energy)})`, es: `Indexada (${range(per.energy)})` }, nameCount, issues };
  }

  const vals = o.energy.slice(0, per.energy);
  const filled = vals.filter((x): x is number => x != null);
  o.energy.forEach((x, i) => { if (x != null && i >= per.energy && per.known) issues.push({ level: "error", text: `Preu d'energia a P${i + 1}: la ${tariff} només té ${per.energy} períodes d'energia (no s'inventen valors).` }); });

  const single = o.contractType === "fix24h" || (o.energy24h != null && filled.length === 0);
  // 24 hores: un preu únic. Si a més té preus per períodes, han de coincidir amb el preu únic.
  if (single) {
    const diff = filled.filter((x) => o.energy24h != null && !same(x, o.energy24h));
    if (diff.length) issues.push({ level: "error", text: `Tarifa 24 hores amb preus per períodes diferents del preu únic (${fmt(o.energy24h!)} €/kWh): cal decidir si és 24 hores o per períodes.` });
    if (nameCount != null && nameCount > 1) issues.push({ level: "avis", text: `El nom diu ${nameCount} preus, però la tarifa té un únic preu (24 hores).` });
    return { tariff, known: per.known, expectedEnergy: per.energy, expectedPower: per.power, structure: "24h", priceCount: 1, label: { ca: "Preu únic 24 hores", es: "Precio único 24 horas" }, nameCount, issues };
  }

  const distinct = [...new Set(filled.map((x) => x.toFixed(9)))].length;
  if (filled.length === per.energy && per.energy > 1 && distinct === 1) {
    issues.push({ level: "info", text: `Tots els períodes tenen el mateix preu (${fmt(filled[0])} €/kWh): és una tarifa 24 hores, no una tarifa amb ${per.energy} preus diferents.` });
  }
  if (filled.length > 0 && filled.length < per.energy) {
    const missing = vals.map((x, i) => (x == null ? `P${i + 1}` : null)).filter(Boolean).join(", ");
    const hint = per.energy === 6 && filled.length === 3 && vals.slice(0, 3).every((x) => x != null) ? ` Possible confusió entre el número de la tarifa (${tariff}) i la quantitat de preus: una ${tariff} per períodes té 6 preus.` : "";
    issues.push({ level: "error", text: `Falten preus d'energia (${missing}): la ${tariff} per períodes té ${per.energy} preus.${hint}` });
  }
  if (nameCount != null && nameCount !== per.energy && !(nameCount === 1 && distinct === 1)) {
    issues.push({ level: "avis", text: `El nom diu «${nameCount} preus», però una ${tariff ?? o.accessTariff} per períodes té ${per.energy} preus (${range(per.energy)}). No es confon el número de la tarifa d'accés amb la quantitat de preus.` });
  }
  const isOne = filled.length === per.energy && distinct === 1 && per.energy > 1;
  return {
    tariff, known: per.known, expectedEnergy: per.energy, expectedPower: per.power, structure: isOne ? "24h" : "periodes", priceCount: isOne ? 1 : per.energy,
    label: isOne ? { ca: "Preu únic 24 hores", es: "Precio único 24 horas" } : { ca: `${per.energy} preus (${range(per.energy)})`, es: `${per.energy} precios (${range(per.energy)})` },
    nameCount, issues,
  };
}

/**
 * Normalitza l'estructura: una tarifa «per períodes» amb el mateix preu a TOTS els períodes és una tarifa 24 hores
 * (es desa com a preu únic; el cost és idèntic). No toca les indexades, les Open d'Endesa ni les del gas.
 */
export function normalizeStructure<T extends O & { open?: unknown }>(o: T): { offer: T; changed: string | null } {
  if (o.energyType === "gas" || o.contractType !== "periodes" || o.open) return { offer: o, changed: null };
  const a = analyzePeriods(o);
  if (a.structure !== "24h") return { offer: o, changed: null };
  const v = o.energy.find((x) => x != null)!;
  return { offer: { ...o, contractType: "fix24h", energy24h: v }, changed: `Identificada com a tarifa 24 hores: ${fmt(v)} €/kWh a tots els períodes (${a.expectedEnergy}).` };
}
