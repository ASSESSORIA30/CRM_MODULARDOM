// Converteix el resultat del motor en partides de pressupost editables, amb el preu de catàleg
// de referència (per detectar després qualsevol preu modificat a mà).
import type { DbLine } from "@/lib/quotes/parse-lines";
import type { ConfigInput, EngineResult, TariffParams } from "./engine";

const EXTRA_KEYS = new Set(["cuina", "coberta", "installacions", "garatge"]);
const CONCEPT: Record<string, string> = {
  construccio: "construccio", arquitecte: "projecte_direccio", fonamentacio: "cimentacio", escomeses: "escomeses", distribucio: "construccio",
};

export function engineToQuoteLines(p: TariffParams, c: ConfigInput, r: EngineResult, locale: "ca" | "es"): DbLine[] {
  return r.lines.map((l) => {
    const isExtra = EXTRA_KEYS.has(l.key) || l.key.startsWith("extra:");
    const vat = Math.round((l.vat === "arquitectura" ? p.iva_arquitecte_pct : p.iva_obra_pct) * 100);
    const label = l.label[locale] + (l.detail ? ` — ${l.detail[locale]}` : "");
    const perM2 = l.quantity != null && l.unitPriceCents != null;
    const unitPrice = perM2 ? l.unitPriceCents! : (l.originalCents ?? l.amountCents);
    return {
      chapter: isExtra ? (locale === "es" ? "Extras" : "Extres") : (locale === "es" ? "Vivienda" : "Habitatge"),
      kind: isExtra ? "extra_inicial" : "base", status: "inclosa",
      concept_type: isExtra ? "extra_constructiu" : CONCEPT[l.key] ?? "construccio",
      description: label, quantity: (perM2 ? l.quantity! : 1).toFixed(3), unit: perM2 ? "m²" : "u",
      unit_price_cents: unitPrice, discount_bp: l.discountPct ? Math.round(l.discountPct * 100) : 0, vat_rate_bp: vat,
      catalog_key: l.key, catalog_unit_price_cents: unitPrice, needs_review: Boolean(l.pending), source_ref: `configurador · ${c.metres} m²`,
      constructor_visible: false,
    };
  });
}
