// Motor de càlcul del configurador ModularDom — FONT ÚNICA per al CRM i per a la web.
// Reprodueix exactament les regles de www.modulardom.com/presupuesto (assets/app.js, v3),
// amb la decisió de direcció del 17/11/2026: honoraris d'arquitecte = €/m² × m² + import fix
// (sense el "preu fix" de 2.800 € que el codi antic sumava al PDF però no a la pantalla).
//
// Sense dependències: es compila també com a fitxer per a la web (public/configurador/motor.js).
// Tots els imports en cèntims enters; els preus de la tarifa en euros (com a la web).

export type ByLang = { ca: string; es: string };
export type TariffParams = {
  construccio_m2: number;          // €/m²
  fonamentacio_m2: number;         // €/m²
  arquitecte_m2: number;           // €/m²
  arquitecte_fix: number;          // €
  escomeses: number;               // €
  metres_minims: number;           // m²
  iva_obra_pct: number;            // %
  iva_arquitecte_pct: number;      // %
  intern: { habitacio: number; bany: number; safareig: number; suite_bany: number; suite_bany_vestidor: number };
  distribucio_descompte_pct: number; // % de descompte sobre la distribució interior (web: 50)
  garatge: { primer_vehicle: number; vehicle_addicional: number; max_vehicles: number };
  cuina: { basica: number; illa: number };
  installacions_m2: Record<string, { nom: ByLang; preu_m2: number }>;
  extres: Record<string, { nom: ByLang; preu: number }>;
  opcions: { habitacions: number[]; banys: number[] };
};

export type ConfigInput = {
  metres: number;
  habitacions: number;
  banys: number;
  suite: "sin" | "bano" | "bano_vestidor";
  cuina: "basica" | "isla";
  vehicles: number;
  safareig: boolean;
  installacions: string[];
  extres: string[];
};

export type LineKey = "construccio" | "arquitecte" | "fonamentacio" | "escomeses" | "distribucio" | "cuina" | "installacions" | "garatge" | `extra:${string}`;
export type EngineLine = {
  key: LineKey;
  label: ByLang;
  amountCents: number;          // import final de la línia (sense IVA)
  originalCents?: number;       // abans del descompte (distribució)
  discountPct?: number;
  vat: "obra" | "arquitectura";
  // Detall per al CRM (la web no el mostra): quantitat i preu unitari quan escau
  quantity?: number;
  unitPriceCents?: number;
  detail?: ByLang;
};
export type EngineResult = {
  lines: EngineLine[];
  baseObraCents: number;
  baseArqCents: number;
  subtotalCents: number;
  ivaObraCents: number;
  ivaArqCents: number;
  totalCents: number;
  internal: { habitacions: number; banys: number; suite: number; safareig: number }; // cost intern (no es mostra al client)
};

const LBL: Record<string, ByLang> = {
  construccio: { ca: "Construcció", es: "Construcción" },
  arquitecte: { ca: "Honoraris d'arquitecte", es: "Honorarios de arquitecto" },
  fonamentacio: { ca: "Fonamentació", es: "Cimentación" },
  escomeses: { ca: "Acometides i sanejament", es: "Acometidas y saneamiento" },
  distribucio: { ca: "Distribució interior personalitzada", es: "Distribución interior personalizada" },
  cuina: { ca: "Cuina", es: "Cocina" },
  installacions: { ca: "Instal·lacions", es: "Instalaciones" },
};
export const SUITE_LABEL: Record<ConfigInput["suite"], ByLang> = {
  sin: { ca: "Sense suite", es: "Sin suite" },
  bano: { ca: "Suite amb bany", es: "Suite con baño" },
  bano_vestidor: { ca: "Suite amb bany i vestidor", es: "Suite con baño y vestidor" },
};
export const KITCHEN_LABEL: Record<ConfigInput["cuina"], ByLang> = {
  basica: { ca: "Cuina bàsica", es: "Cocina básica" },
  isla: { ca: "Cuina amb illa", es: "Cocina con isla" },
};
const garageLabel = (n: number): ByLang => (n === 1
  ? { ca: "Garatge (1 vehicle)", es: "Garaje (1 vehículo)" }
  : { ca: `Garatge (${n} vehicles)`, es: `Garaje (${n} vehículos)` });

const eur = (e: number) => Math.round(e * 100);
/** Divisió entera amb arrodoniment meitat lluny de zero (com PostgreSQL i com Math.round per a positius). */
const pct = (cents: number, p: number) => Math.round((cents * Math.round(p * 100)) / 10000);

export type ValidationIssue = { field: string; code: string };

export function validateInput(p: TariffParams, c: ConfigInput): ValidationIssue[] {
  const e: ValidationIssue[] = [];
  if (!Number.isInteger(c.metres) || c.metres < p.metres_minims) e.push({ field: "metres", code: "min" });
  if (!p.opcions.habitacions.includes(c.habitacions)) e.push({ field: "habitacions", code: "option" });
  if (!p.opcions.banys.includes(c.banys)) e.push({ field: "banys", code: "option" });
  if (!["sin", "bano", "bano_vestidor"].includes(c.suite)) e.push({ field: "suite", code: "option" });
  if (!["basica", "isla"].includes(c.cuina)) e.push({ field: "cuina", code: "option" });
  if (!Number.isInteger(c.vehicles) || c.vehicles < 0 || c.vehicles > p.garatge.max_vehicles) e.push({ field: "vehicles", code: "option" });
  for (const k of c.installacions) if (!p.installacions_m2[k]) e.push({ field: "installacions", code: "unknown" });
  for (const k of c.extres) if (!p.extres[k]) e.push({ field: "extres", code: "unknown" });
  return e;
}

export function calculate(p: TariffParams, c: ConfigInput): EngineResult {
  const m = c.metres;
  const lines: EngineLine[] = [];
  const internal = {
    habitacions: c.habitacions * eur(p.intern.habitacio),
    banys: c.banys * eur(p.intern.bany),
    suite: c.suite === "bano" ? eur(p.intern.suite_bany) : c.suite === "bano_vestidor" ? eur(p.intern.suite_bany_vestidor) : 0,
    safareig: c.safareig ? eur(p.intern.safareig) : 0,
  };
  if (m > 0) {
    lines.push({ key: "construccio", label: LBL.construccio, amountCents: m * eur(p.construccio_m2), vat: "obra", quantity: m, unitPriceCents: eur(p.construccio_m2) });
    lines.push({ key: "arquitecte", label: LBL.arquitecte, amountCents: m * eur(p.arquitecte_m2) + eur(p.arquitecte_fix), vat: "arquitectura" });
    lines.push({ key: "fonamentacio", label: LBL.fonamentacio, amountCents: m * eur(p.fonamentacio_m2), vat: "obra", quantity: m, unitPriceCents: eur(p.fonamentacio_m2) });
    lines.push({ key: "escomeses", label: LBL.escomeses, amountCents: eur(p.escomeses), vat: "obra" });
  }
  const distOriginal = internal.habitacions + internal.banys + internal.suite + internal.safareig;
  if (distOriginal > 0) {
    lines.push({
      key: "distribucio", label: LBL.distribucio, originalCents: distOriginal, discountPct: p.distribucio_descompte_pct,
      amountCents: distOriginal - pct(distOriginal, p.distribucio_descompte_pct), vat: "obra",
    });
  }
  // Sense cuina triada (pas encara no fet a la web) no hi ha import de cuina
  const kitchen = c.cuina === "isla" ? eur(p.cuina.illa) : c.cuina === "basica" ? eur(p.cuina.basica) : 0;
  if (kitchen > 0) lines.push({ key: "cuina", label: LBL.cuina, amountCents: kitchen, vat: "obra", detail: KITCHEN_LABEL[c.cuina] });
  const inst = c.installacions.filter((k) => p.installacions_m2[k]);
  const instCents = inst.reduce((s, k) => s + m * eur(p.installacions_m2[k].preu_m2), 0);
  if (instCents > 0) {
    lines.push({
      key: "installacions", label: LBL.installacions, amountCents: instCents, vat: "obra",
      detail: { ca: inst.map((k) => p.installacions_m2[k].nom.ca).join(", "), es: inst.map((k) => p.installacions_m2[k].nom.es).join(", ") },
    });
  }
  const garage = c.vehicles ? eur(p.garatge.primer_vehicle) + (c.vehicles - 1) * eur(p.garatge.vehicle_addicional) : 0;
  if (garage > 0) lines.push({ key: "garatge", label: garageLabel(c.vehicles), amountCents: garage, vat: "obra" });
  // Extres en l'ordre en què s'han triat (com la web)
  for (const k of c.extres) {
    if (p.extres[k]) lines.push({ key: `extra:${k}`, label: p.extres[k].nom, amountCents: eur(p.extres[k].preu), vat: "obra" });
  }
  const baseArqCents = lines.filter((l) => l.vat === "arquitectura").reduce((s, l) => s + l.amountCents, 0);
  const baseObraCents = lines.filter((l) => l.vat === "obra").reduce((s, l) => s + l.amountCents, 0);
  const ivaObraCents = pct(baseObraCents, p.iva_obra_pct);
  const ivaArqCents = pct(baseArqCents, p.iva_arquitecte_pct);
  const subtotalCents = baseObraCents + baseArqCents;
  return { lines, baseObraCents, baseArqCents, subtotalCents, ivaObraCents, ivaArqCents, totalCents: subtotalCents + ivaObraCents + ivaArqCents, internal };
}
