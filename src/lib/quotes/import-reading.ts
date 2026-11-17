// Lector IA de pressupostos importats (PDF, Excel, Word). La IA només transcriu: cada partida amb
// el seu origen. Aquest mòdul comprova la coherència i marca per revisar tot el que no quadra o no
// es pot identificar amb seguretat. Res no es desa com a pressupost fins que l'usuari ho valida.
import { z } from "zod";
import { amountOnPage, strictAmountCents } from "@/lib/contracts/reading";
import { centsToInput } from "@/lib/money";
import type { LineKind, LineStatus } from "./calc";
import type { EditorLine } from "./load";

export const IMPORT_PROMPT_VERSION = "pressupost-import-v1";
const cents = z.number().int().min(-1e12).max(1e12);

export const importLineSchema = z.object({
  chapter: z.string().max(120).nullable(),
  kind: z.enum(["base", "extra", "extra_posterior", "descompte"]),
  status: z.enum(["inclosa", "opcional", "pendent_valoracio", "exclosa"]),
  description: z.string().min(1).max(1000),
  quantity: z.number().min(0).max(1e9).nullable(),
  unit: z.string().max(20).nullable(),
  unit_price_cents: cents.nullable(),
  amount_cents: cents.nullable(),
  amount_text: z.string().max(60).nullable(),
  vat_pct: z.number().min(0).max(100).nullable(),
  is_architecture: z.boolean(),
  page: z.number().int().min(1).max(2000).nullable(),
  row: z.string().max(40).nullable(),
  source_text: z.string().max(800),
  uncertain: z.boolean(),
  uncertain_reason: z.string().max(300).nullable(),
});
export const importReadingSchema = z.object({
  lines: z.array(importLineSchema).max(400),
  declared_taxable_cents: cents.nullable(),
  declared_vat_cents: cents.nullable(),
  declared_total_cents: cents.nullable(),
  totals_text: z.string().max(300).nullable(),
  vat_notes: z.string().max(1000).nullable(),
  payment_terms: z.string().max(3000).nullable(),
  exclusions: z.array(z.string().max(600)).max(60),
  conditions: z.array(z.string().max(600)).max(60),
  validity: z.string().max(300).nullable(),
  undetermined: z.array(z.object({ field: z.string().max(100), reason: z.string().max(400) })).max(50),
});
export type ImportReading = z.infer<typeof importReadingSchema>;

const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
export const importJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    lines: S("array", { items: S("object", {
      properties: {
        chapter: S(["string", "null"]), kind: S("string", { enum: ["base", "extra", "extra_posterior", "descompte"] }),
        status: S("string", { enum: ["inclosa", "opcional", "pendent_valoracio", "exclosa"], description: "inclosa = suma al total; opcional = extra opcional no inclòs; pendent_valoracio = sense import definit; exclosa = el document diu que no s'inclou" }),
        description: S("string"), quantity: S(["number", "null"]), unit: S(["string", "null"]),
        unit_price_cents: S(["integer", "null"], { description: "Preu unitari sense IVA en cèntims, només si està escrit" }),
        amount_cents: S(["integer", "null"], { description: "Import de la partida sense IVA en cèntims, només si està escrit" }),
        amount_text: S(["string", "null"], { description: "Import exactament com està escrit" }),
        vat_pct: S(["number", "null"], { description: "Tipus d'IVA si el document l'indica per a aquesta partida" }),
        is_architecture: S("boolean", { description: "Honoraris de projecte, direcció d'obra o arquitectura" }),
        page: S(["integer", "null"]), row: S(["string", "null"], { description: "Full i fila d'un Excel (p. ex. 'Full 1 fila 12')" }),
        source_text: S("string", { description: "Fragment literal del document (màx. 300 caràcters)" }),
        uncertain: S("boolean", { description: "true si no estàs segur de la lectura" }), uncertain_reason: S(["string", "null"]),
      },
      required: ["chapter", "kind", "status", "description", "quantity", "unit", "unit_price_cents", "amount_cents", "amount_text",
        "vat_pct", "is_architecture", "page", "row", "source_text", "uncertain", "uncertain_reason"],
    }) }),
    declared_taxable_cents: S(["integer", "null"]), declared_vat_cents: S(["integer", "null"]), declared_total_cents: S(["integer", "null"]),
    totals_text: S(["string", "null"]), vat_notes: S(["string", "null"]), payment_terms: S(["string", "null"]),
    exclusions: S("array", { items: S("string") }), conditions: S("array", { items: S("string") }), validity: S(["string", "null"]),
    undetermined: S("array", { items: S("object", { properties: { field: S("string"), reason: S("string") }, required: ["field", "reason"] }) }),
  },
  required: ["lines", "declared_taxable_cents", "declared_vat_cents", "declared_total_cents", "totals_text", "vat_notes", "payment_terms",
    "exclusions", "conditions", "validity", "undetermined"],
};

export const IMPORT_SYSTEM = `Ets un lector de pressupostos d'obra de ModularDom. Transcriu el document a l'eina.
Regles obligatòries:
- Copia només el que hi ha escrit. No inventis partides, quantitats, preus ni imports. No completis cap buit.
- Imports SENSE IVA en cèntims d'euro (35.600,00 € = 3560000), i copia el text literal de l'import.
- Una partida per línia del document, en el mateix ordre, amb pàgina (PDF) o full i fila (Excel) i un fragment literal.
- Distingeix les partides incloses al total, els extres opcionals (no sumen), les pendents de valoració i les excloses.
- Si un import o una quantitat no es llegeix amb seguretat, deixa'l a null i marca uncertain = true amb el motiu.
- L'IVA només si el document l'indica. Els totals declarats, tal com apareixen.
- Exclusions, condicions de pagament i validesa: copia-les literalment.`;

export type ImportWarning = { kind: string; message: string };
export type ImportPreview = { lines: EditorLine[]; warnings: ImportWarning[] };

const EUR = (c: number) => `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const KIND: Record<ImportReading["lines"][number]["kind"], LineKind> = { base: "base", extra: "extra_inicial", extra_posterior: "extra_posterior", descompte: "descompte" };
const qtyText = (q: number) => String(Math.round(q * 1000) / 1000).replace(".", ",");

/**
 * Converteix la lectura en partides editables i marca per revisar les que:
 * són dubtoses, no tenen import, tenen preu × quantitat ≠ import, l'import no apareix al text,
 * o no indiquen l'IVA. textPages: text del document (per pàgines o un sol bloc) si n'hi ha.
 */
export function previewFromReading(r: ImportReading, textPages: string[] | null): ImportPreview {
  const warnings: ImportWarning[] = [];
  const lines: EditorLine[] = r.lines.map((l) => {
    const reasons: string[] = [];
    if (l.uncertain) reasons.push(l.uncertain_reason || "lectura dubtosa");
    let qty = l.quantity;
    let price = l.unit_price_cents;
    const amount = l.amount_cents;
    if (amount == null && l.status !== "pendent_valoracio") reasons.push("sense import");
    if (amount != null && l.amount_text && strictAmountCents(l.amount_text) != null && Math.abs(strictAmountCents(l.amount_text)!) !== Math.abs(amount)) reasons.push(`import escrit "${l.amount_text}"`);
    if (qty == null && price == null && amount != null) { qty = 1; price = amount; }
    else if (qty != null && price == null && amount != null) {
      const p = amount / qty;
      if (qty > 0 && Number.isInteger(Math.round(p * 1000) / 1000) && Number.isInteger(p)) price = p; else { reasons.push("preu unitari no indicat"); price = amount; qty = 1; }
    } else if (qty == null && price != null) { qty = 1; }
    if (qty != null && price != null && amount != null && Math.abs(Math.round(qty * price) - amount) > 1) reasons.push(`quantitat × preu (${EUR(Math.round(qty * price))}) ≠ import (${EUR(amount)})`);
    if (amount != null && textPages) {
      const pages = l.page != null && textPages[l.page - 1] != null ? [textPages[l.page - 1]] : textPages;
      if (!pages.some((t) => amountOnPage(Math.abs(amount), t))) reasons.push("l'import no apareix al document");
    }
    if (l.vat_pct == null) reasons.push("IVA no indicat");
    const vat = l.vat_pct != null ? Math.round(l.vat_pct * 100) : l.is_architecture ? 2100 : 1000;
    const kind = KIND[l.kind];
    return {
      chapter: l.chapter ?? "", kind, status: l.status as LineStatus, conceptType: l.is_architecture ? "projecte_direccio" : kind === "base" ? "construccio" : "extra_constructiu",
      description: l.description, quantity: qty != null ? qtyText(qty) : "", unit: l.unit ?? "u",
      unitPrice: price != null ? centsToInput(Math.abs(price)) : "", discount: "", vatRateBp: vat,
      needsReview: reasons.filter((x) => x !== "IVA no indicat").length > 0,
      sourceRef: [l.page ? `pàg. ${l.page}` : l.row ?? "", reasons.length ? `⚠ ${reasons.join("; ")}` : ""].filter(Boolean).join(" · ").slice(0, 200),
      constructorVisible: false,
    };
  });
  // Totals declarats contra la suma de les partides incloses
  const included = r.lines.filter((l) => l.status === "inclosa" && l.amount_cents != null).reduce((s, l) => s + (l.kind === "descompte" ? -Math.abs(l.amount_cents!) : l.amount_cents!), 0);
  if (r.declared_taxable_cents != null && r.declared_taxable_cents !== included) {
    warnings.push({ kind: "suma", message: `La suma de les partides incloses (${EUR(included)}) no coincideix amb la base declarada (${EUR(r.declared_taxable_cents)}).` });
  }
  if (r.lines.some((l) => l.vat_pct == null)) warnings.push({ kind: "iva", message: "Algunes partides no indiquen l'IVA: s'ha proposat 10 % obra i 21 % arquitectura. Revisa-ho." });
  for (const u of r.undetermined) warnings.push({ kind: "no_determinable", message: `${u.field}: ${u.reason}` });
  return { lines, warnings };
}
