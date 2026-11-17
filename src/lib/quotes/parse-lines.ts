// Validació de les partides que arriben de l'editor (esborrany o importació) → format de la BD.
import { z } from "zod";
import { parseEurosToCents } from "@/lib/money";
import { LINE_KINDS, LINE_STATUSES, parseQuantityMilli } from "./calc";

export const editorLineSchema = z.object({
  chapter: z.string().trim().max(120).default(""),
  kind: z.enum(LINE_KINDS as [string, ...string[]]),
  status: z.enum(LINE_STATUSES as [string, ...string[]]).default("inclosa"),
  conceptType: z.string().max(40).default(""),
  description: z.string().trim().min(1).max(1000),
  quantity: z.string().max(30),
  unit: z.string().trim().max(20).default("u"),
  unitPrice: z.string().max(40),
  discount: z.string().max(10).default(""),
  vatRateBp: z.number().int().min(0).max(10000),
  catalogKey: z.string().max(60).nullable().default(null),
  catalogUnitPriceCents: z.number().int().nullable().default(null),
  needsReview: z.boolean().default(false),
  sourceRef: z.string().max(200).default(""),
  constructorVisible: z.boolean().default(false),
});

export type DbLine = {
  chapter: string; kind: string; status: string; concept_type: string | null; description: string; quantity: string | null;
  unit: string; unit_price_cents: number | null; discount_bp: number; vat_rate_bp: number; catalog_key: string | null;
  catalog_unit_price_cents: number | null; needs_review: boolean; source_ref: string | null; constructor_visible: boolean;
};

export function parseEditorLines(raw: unknown[]): { rows: DbLine[]; errors: Record<number, string[]> } {
  const errors: Record<number, string[]> = {};
  const rows: DbLine[] = [];
  raw.forEach((item, i) => {
    const bad = (f: string) => { (errors[i] ??= []).push(f); };
    const r = editorLineSchema.safeParse(item);
    if (!r.success) { for (const issue of r.error.issues) bad(String(issue.path[0] ?? "line")); return; }
    const l = r.data;
    const qty = parseQuantityMilli(l.quantity);
    if (qty == null) bad("quantity");
    let price: number | null = null;
    try { price = parseEurosToCents(l.unitPrice); } catch { /* invàlid */ }
    if (price == null) bad("unitPrice");
    else if (l.kind === "descompte") price = -Math.abs(price);
    else if (price < 0) bad("unitPrice");
    const disc = l.discount.trim() === "" ? 0 : Math.round(Number(l.discount.replace(",", ".")) * 100);
    if (!Number.isFinite(disc) || disc < 0 || disc > 10000) bad("discount");
    rows.push({
      chapter: l.chapter, kind: l.kind, status: l.status, concept_type: l.conceptType || null, description: l.description,
      quantity: qty == null ? null : (qty / 1000).toFixed(3), unit: l.unit || "u", unit_price_cents: price, discount_bp: disc,
      vat_rate_bp: l.vatRateBp, catalog_key: l.catalogKey, catalog_unit_price_cents: l.catalogUnitPriceCents,
      needs_review: l.needsReview, source_ref: l.sourceRef || null, constructor_visible: l.constructorVisible,
    });
  });
  return { rows, errors };
}
