import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quotePdfTexts } from "@/lib/i18n-pressupostos";
import { buildQuotePdf, type QuotePdfData } from "./quote-pdf";

// Dades fictícies
const data: QuotePdfData = {
  company: { legalName: "EMPRESA DE PROVA, S.L.", taxId: null, address: null, phone: "600 000 000", email: "prova@example.com", website: "www.example.com" },
  holders: [{ name: "Titular Primer", taxId: "00000000T", address: "Carrer Fictici 1" }, { name: "Titular Segon", taxId: null, address: null }],
  project: { title: "Habitatge de prova", code: "MD-2026-000", address: "Parcel·la de prova" },
  quote: { code: "P26-001", version: 2, issueDate: "10/11/2026", validUntil: "10/12/2026", intro: null, notes: "Nota de prova.", conditions: "Importes sin IVA.", draft: false },
  lines: [
    { kind: "base", chapter: "Base", description: "Construcción vivienda", quantityMilli: 260000, unit: "m²", unitPriceCents: 99300, discountBp: 0, vatRateBp: 1000 },
    { kind: "base", chapter: "Base", description: "Proyecto, dirección y final de obra", quantityMilli: 1000, unit: "u", unitPriceCents: 3560000, discountBp: 0, vatRateBp: 2100 },
    { kind: "extra_inicial", chapter: "Extras", description: "Cocina completa", quantityMilli: 1000, unit: "u", unitPriceCents: 1230000, discountBp: 0, vatRateBp: 1000 },
  ],
};

describe("PDF del pressupost", () => {
  it("conté totals, IVA per tipus, signatures i peu", async () => {
    const bytes = await buildQuotePdf(data, quotePdfTexts("es"));
    const dir = mkdtempSync(join(tmpdir(), "qpdf-"));
    const f = join(dir, "p.pdf");
    writeFileSync(f, bytes);
    const text = execFileSync("pdftotext", ["-layout", f, "-"]).toString();
    for (const s of ["PRESUPUESTO PERSONALIZADO", "P26-001", "Versión: 2", "Titular Primer", "NIF/NIE 00000000T",
      "Construcción vivienda (260 m² x 993,00 €)", "TOTAL PRESUPUESTO BASE", "293.780,00 € + IVA", "TOTAL EXTRAS",
      "12.300,00 € + IVA", "BASE IMPONIBLE", "306.080,00 €", "IVA 10 % (270.480,00 €)", "27.048,00 €",
      "IVA 21 % (35.600,00 €)", "7.476,00 €", "TOTAL CON IVA", "340.604,00 €", "Total llave en mano",
      "Aceptación del presupuesto", "Por MODULARDOM", "Validez del presupuesto hasta el 10/12/2026", "Página 1 de"]) {
      expect(text, s).toContain(s);
    }
  });
});

describe("PDF del pressupost (v2)", () => {
  it("separa els extres opcionals (no sumen), mostra exclusions i condicions i no mostra les excloses", async () => {
    const d: QuotePdfData = {
      ...data,
      quote: { ...data.quote, exclusions: "Licencias y tasas municipales.", paymentTerms: "Según calendario de hitos del contrato." },
      lines: [
        ...data.lines,
        { kind: "extra_inicial", status: "opcional", chapter: "", description: "Piscina 7x3 m", quantityMilli: 1000, unit: "u", unitPriceCents: 2200000, discountBp: 0, vatRateBp: 1000 },
        { kind: "extra_inicial", status: "pendent_valoracio", chapter: "", description: "Muro de contención", quantityMilli: 1000, unit: "u", unitPriceCents: 0, discountBp: 0, vatRateBp: 1000 },
        { kind: "base", status: "exclosa", chapter: "", description: "Urbanización exterior", quantityMilli: 1000, unit: "u", unitPriceCents: 500000, discountBp: 0, vatRateBp: 1000 },
      ],
    };
    const bytes = await buildQuotePdf(d, quotePdfTexts("es"));
    const dir = mkdtempSync(join(tmpdir(), "qpdf2-"));
    const f = join(dir, "p.pdf");
    writeFileSync(f, bytes);
    const text = execFileSync("pdftotext", ["-layout", f, "-"]).toString();
    for (const s of ["BASE IMPONIBLE", "306.080,00 €", "Extras opcionales (no incluidos)", "Piscina 7x3 m", "22.000,00 € + IVA",
      "Muro de contención — pendiente de valoración", "Condiciones de pago", "Según calendario", "Exclusiones", "Licencias y tasas", "MODULAR"]) {
      expect(text, s).toContain(s);
    }
    expect(text).not.toContain("Urbanización exterior");
  });
});
