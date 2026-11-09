/**
 * PREUS AMB UNITATS (una sola manera de mostrar-los a tot el CRM: lector, catàleg, comparatives i PDF).
 * Cap import surt sense la seva unitat. Quan el document feia servir una altra unitat, es mostra també l'original.
 */
import { gasFixedEquivalents } from "./units";
import { POWER_UNIT_LABEL, type Num, type PriceSheet } from "./types";

type Lang = "ca" | "es";
export const nfmt = (v: number | null | undefined, max = 6, lang: Lang = "ca") => (v == null || !Number.isFinite(v) ? "—" : v.toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { maximumFractionDigits: max }));
const join = (xs: Num[], lang: Lang) => xs.filter((x): x is number => x != null).map((x) => nfmt(x, 6, lang)).join(" / ");

export interface PriceLine { label: string; value: number | null; unit: string }

/** Energia amb unitat: «0,247928 €/kWh (24 hores)» o «0,31 / 0,22 / 0,18 €/kWh (P1–P3)». */
export function energyText(o: Pick<PriceSheet, "contractType" | "energy" | "energy24h" | "indexedReference">, lang: Lang = "ca"): string {
  if (o.contractType === "fix24h" || (o.energy24h != null && o.energy.every((x) => x == null))) return o.energy24h == null ? "—" : `${nfmt(o.energy24h, 6, lang)} €/kWh (${lang === "es" ? "24 horas" : "24 hores"})`;
  const src = o.contractType === "indexat" ? o.indexedReference?.energy ?? [] : o.energy;
  const n = src.reduce<number>((a, x, i) => (x != null ? i + 1 : a), 0);
  if (!n) return o.contractType === "indexat" ? (lang === "es" ? "Indexada (sin referencia)" : "Indexada (sense referència)") : "—";
  return `${join(src, lang)} €/kWh (${n === 1 ? "P1" : `P1–P${n}`}${o.contractType === "indexat" ? (lang === "es" ? ", referencia estimada" : ", referència estimada") : ""})`;
}

/** Potència amb unitat i, si el document en feia servir una altra, l'original: «0,0759 / 0,0019 €/kW·dia (doc.: 27,7 / 0,72 €/kW·any)». */
export function powerText(o: Pick<PriceSheet, "power" | "powerUnit" | "units">, lang: Lang = "ca"): string {
  if (!o.power.some((x) => x != null)) return "—";
  const orig = o.units?.power && o.units.power.unit !== POWER_UNIT_LABEL[o.powerUnit] ? ` (${lang === "es" ? "doc." : "doc."}: ${join(o.units.power.values, lang)} ${o.units.power.unit})` : "";
  return `${join(o.power, lang)} ${POWER_UNIT_LABEL[o.powerUnit]}${orig}`;
}

/** Terme fix del gas: unitat ORIGINAL del document + valor normalitzat i equivalents: «5,17 €/mes (0,169973 €/client·dia · 62,04 €/any)». */
export function gasFixedText(o: Pick<PriceSheet, "gasFixedEurDay" | "units">, lang: Lang = "ca"): string {
  const g = o.units?.gasFixed;
  const eq = gasFixedEquivalents(o.gasFixedEurDay);
  const norm = eq.perDay == null ? null : `${nfmt(eq.perDay, 6, lang)} €/${lang === "es" ? "cliente·día" : "client·dia"} · ${nfmt(eq.perYear, 2, lang)} €/${lang === "es" ? "año" : "any"}`;
  if (g?.value != null && g.unit && !/client·dia|cliente\/d[ií]a|cliente·d[ií]a/i.test(g.unit)) return `${nfmt(g.value, 6, lang)} ${g.unit}${norm ? ` (${norm})` : lang === "es" ? " (sin convertir: unidad por confirmar)" : " (sense convertir: unitat per confirmar)"}`;
  return norm ?? "—";
}

/** Línies de preus per a la taula de revisió (cada valor amb la seva unitat). */
export function priceLines(o: PriceSheet & { energyType: "luz" | "gas" }, periods: { energy: number; power: number }): PriceLine[] {
  const out: PriceLine[] = [];
  if (o.energyType === "gas") {
    out.push({ label: "Terme variable", value: o.energy24h, unit: "€/kWh" });
    out.push({ label: "Terme fix", value: o.gasFixedEurDay, unit: "€/client·dia" });
    return out;
  }
  if (o.contractType === "fix24h") out.push({ label: "Energia 24 h", value: o.energy24h, unit: "€/kWh" });
  else {
    const src = o.contractType === "indexat" ? o.indexedReference?.energy ?? [] : o.energy;
    for (let i = 0; i < periods.energy; i++) out.push({ label: `Energia P${i + 1}`, value: src[i] ?? null, unit: "€/kWh" });
  }
  for (let i = 0; i < periods.power; i++) out.push({ label: `Potència P${i + 1}`, value: o.power[i] ?? null, unit: POWER_UNIT_LABEL[o.powerUnit] });
  return out;
}
