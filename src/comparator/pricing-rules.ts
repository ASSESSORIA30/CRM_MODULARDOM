/**
 * Fase 15 · REGLES DE LECTURA DEL MODEL DE PREU (aprenentatge per comercialitzadora, amb control de versions).
 *
 * Quan l'usuari corregeix la interpretació d'una tarifa («és preu base + FEE», «és indexada», «el FEE és en €/MWh»,
 * «no permet FEE»), la correcció es desa com a regla ESTRUCTURADA de la comercialitzadora (o d'un producte) a la
 * biblioteca de regles (`tariff_rule_library`, kind «lectura»). Les regles aprovades s'apliquen a les lectures
 * següents; mai no modifiquen retroactivament les tarifes ja desades (cal reprocessar-les i validar-ho).
 */
import type { FeeAllowed, FeeUnit, PricingModel } from "./pricing-model";

export interface PricingReadingRule {
  id: string;
  kind: "pricing";
  title: string;
  supplier: string;
  /** null = regla general de la comercialitzadora; si no, text que ha de contenir el nom del producte */
  product: string | null;
  model: PricingModel;
  feeAllowed?: FeeAllowed | null;
  feeUnit?: FeeUnit | null;
  version: number;
  status: "aprovada" | "proposada" | "rebutjada" | "substituida";
  instruction?: string | null;
  createdBy?: string | null;
  approvedBy?: string | null;
}

const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameSupplier = (a: string, b: string) => { const x = fold(a).split(" ")[0], y = fold(b).split(" ")[0]; return !!x && x === y; };

/** Clau estable de la biblioteca (una sola regla aprovada per clau; les noves la substitueixen). */
export const pricingRuleKey = (product: string | null) => `pricing:${product ? fold(product).slice(0, 60) : "*"}`;

/** Regla aplicable: només APROVADES; la de producte guanya a la general; dins del mateix abast, la versió més alta. */
export function pickPricingRule(rules: PricingReadingRule[], supplier: string, product: string): PricingReadingRule | null {
  const ok = rules.filter((r) => r.status === "aprovada" && sameSupplier(r.supplier, supplier) && (!r.product || fold(product).includes(fold(r.product))));
  return ok.sort((a, b) => (b.product ? 1 : 0) - (a.product ? 1 : 0) || b.version - a.version)[0] ?? null;
}

/**
 * Interpreta una correcció escrita («Corregir amb IA»). Retorna una regla PROPOSADA (l'usuari tria l'abast i, si no és
 * Direcció, queda pendent d'aprovació) o una pregunta si no s'entén.
 */
export function parsePricingCorrection(msg: string, ctx: { supplier: string; productName: string | null; allProducts?: boolean }): { rule: Omit<PricingReadingRule, "id" | "version" | "status"> | null; reply: string } {
  const n = fold(msg);
  const product = ctx.allProducts || /\b(totes|todas|tots|todos)\b/.test(n) ? null : ctx.productName;
  const scope = product ? `«${product}»` : `totes les tarifes de ${ctx.supplier}`;
  const unit: FeeUnit | null = /mwh/.test(n) ? "eur_mwh" : /kwh/.test(n) ? "eur_kwh" : null;
  const forbid = /no (permet|admet|accepta|permite|admite)\b.*\b(fee|marge|margen)|sense fee|sin fee/.test(n);
  let model: PricingModel | null = null;
  if (/(index|omie|pool|mercat|mercado)/.test(n)) model = /(fee|marge|margen).*(addicional|adicional|configurable|permes|permet|autoritzat|autorizado)/.test(n) && !forbid ? "INDEXED_BASE_FEE" : "INDEXED";
  else if (/(preu|precio|price) base|base \+ ?(fee|marge|margen)|sense marge|sin margen|fee configurable/.test(n)) model = "FIXED_BASE_FEE";
  else if (/(preu|precio) (fix )?final|ja (es|és) final|ya es final|no (es|és) base/.test(n)) model = "FIXED_FINAL";
  if (!model && unit) return { rule: null, reply: `Entesa la unitat (${unit === "eur_mwh" ? "€/MWh" : "€/kWh"}), però digues també el tipus: «és preu base + FEE», «és indexada» o «és un preu final».` };
  if (!model) return { rule: null, reply: "No ho he entès prou bé. Prova amb: «és preu base + FEE en €/MWh», «és indexada i el marge és de la comercialitzadora», «és indexada i permet FEE addicional», «és un preu final» o «no permet afegir FEE»." };
  const feeAllowed: FeeAllowed = forbid ? "no" : model === "FIXED_BASE_FEE" || model === "INDEXED_BASE_FEE" ? "si" : "pendent";
  const label = { FIXED_FINAL: "preu fix final", FIXED_BASE_FEE: "preu base + FEE", INDEXED: "indexada (marge de la comercialitzadora)", INDEXED_BASE_FEE: "indexada + FEE addicional autoritzat" }[model];
  return {
    rule: { kind: "pricing", title: `${ctx.supplier}${product ? ` · ${product}` : ""}: ${label}${unit ? ` (FEE en ${unit === "eur_mwh" ? "€/MWh" : "€/kWh"})` : ""}${forbid ? " · sense FEE" : ""}`, supplier: ctx.supplier, product, model, feeAllowed, feeUnit: unit, instruction: msg.slice(0, 2000) },
    reply: `Entès: ${scope} és ${label}${unit ? `; el FEE s'expressa en ${unit === "eur_mwh" ? "€/MWh" : "€/kWh"}` : ""}${forbid ? "; no s'hi pot afegir FEE" : ""}. Es guardarà com a regla de lectura (versió nova) i s'aplicarà a les lectures següents; no canvia cap tarifa ja desada.`,
  };
}
