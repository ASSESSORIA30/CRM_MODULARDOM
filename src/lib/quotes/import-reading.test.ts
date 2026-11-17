import { describe, expect, it } from "vitest";
import { importReadingSchema, previewFromReading, type ImportReading } from "./import-reading";

const line = (o: Partial<ImportReading["lines"][number]>): ImportReading["lines"][number] => ({
  chapter: null, kind: "base", status: "inclosa", description: "Partida", quantity: null, unit: null, unit_price_cents: null,
  amount_cents: null, amount_text: null, vat_pct: 10, is_architecture: false, page: 1, row: null, source_text: "", uncertain: false, uncertain_reason: null, ...o,
});
const reading = (lines: ImportReading["lines"], taxable: number | null = null): ImportReading => importReadingSchema.parse({
  lines, declared_taxable_cents: taxable, declared_vat_cents: null, declared_total_cents: null, totals_text: null, vat_notes: null,
  payment_terms: null, exclusions: [], conditions: [], validity: null, undetermined: [],
});

describe("lector de pressupostos importats", () => {
  it("una partida coherent i present al text no cal revisar-la", () => {
    const p = previewFromReading(reading([line({ description: "Construcción", quantity: 150, unit: "m²", unit_price_cents: 99300, amount_cents: 14895000, amount_text: "148.950,00 €" })], 14895000),
      ["Construcción 150 m² 993,00 € 148.950,00 €"]);
    expect(p.lines[0]).toMatchObject({ quantity: "150", unitPrice: "993,00", needsReview: false, status: "inclosa", kind: "base" });
    expect(p.warnings).toEqual([]);
  });
  it("marca per revisar: dubtes, sense import, càlcul incoherent i import inexistent al document", () => {
    const p = previewFromReading(reading([
      line({ description: "A", amount_cents: 100000, uncertain: true, uncertain_reason: "text borrós" }),
      line({ description: "B" }),
      line({ description: "C", quantity: 2, unit_price_cents: 1000, amount_cents: 3000 }),
      line({ description: "D", amount_cents: 777700 }),
    ]), ["A 1.000,00 € C 30,00 €"]);
    expect(p.lines.map((l) => l.needsReview)).toEqual([true, true, true, true]);
    expect(p.lines[2].sourceRef).toContain("quantitat × preu");
    expect(p.lines[3].sourceRef).toContain("no apareix");
  });
  it("no inventa preus: si només hi ha import, quantitat 1 i preu = import escrit", () => {
    const p = previewFromReading(reading([line({ description: "Piscina", kind: "extra", status: "opcional", amount_cents: 2200000, amount_text: "22.000 €" })]), null);
    expect(p.lines[0]).toMatchObject({ quantity: "1", unitPrice: "22000,00", kind: "extra_inicial", status: "opcional", needsReview: false });
  });
  it("proposa l'IVA per defecte però ho avisa, i compara amb la base declarada", () => {
    const p = previewFromReading(reading([
      line({ description: "Honorarios", amount_cents: 2130000, vat_pct: null, is_architecture: true }),
      line({ description: "Obra", amount_cents: 1000000, vat_pct: null }),
    ], 3200000), null);
    expect(p.lines.map((l) => l.vatRateBp)).toEqual([2100, 1000]);
    expect(p.warnings.map((w) => w.kind)).toEqual(["suma", "iva"]);
  });
});
