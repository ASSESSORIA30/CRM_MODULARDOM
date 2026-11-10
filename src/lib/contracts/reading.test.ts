import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { amountOnPage, flattenMilestones, readingSchema, strictAmountCents, verifyReading, vatFromText, type ContractReading } from "./reading";

// Fites verificades a mà del contracte de referència (anonimitzat)
type Fx = { contracte_preu_total_cents: number; pressupost_acceptat_cents: number;
  fases: { codi: string; nom: string; import_declarat_cents: number; import_declarat_text?: string; pagina: number; fites: { codi: string; concepte: string; import_cents: number }[] }[] };
const fx = JSON.parse(readFileSync("tests/fixtures/contracte-referencia.fites.json", "utf8")) as Fx;
const eur = (c: number) => `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`;

function readingFromFixture(): ContractReading {
  return readingSchema.parse({
    holders: [{ name: "Titular 1", tax_id: null, page: 1 }], contractor: { name: "Empresa contractista", tax_id: null, page: 1 },
    site_address: { text: "Parcel·la de prova", page: 1 }, cadastral_ref: null,
    document_date: "2026-10-13", signed_date: null, total_cents: fx.contracte_preu_total_cents, total_text: "496.280,00 €", total_page: 2,
    vat_clause: { text: "IVA al tipus legal vigent", page: 2 }, chapters: [],
    phases: fx.fases.map((f) => ({
      code: f.codi, name: f.nom, is_extra: f.codi.startsWith("F4"), declared_amount_cents: f.import_declarat_cents,
      declared_amount_text: f.import_declarat_text ?? eur(f.import_declarat_cents), page: f.pagina,
      milestones: f.fites.map((m) => ({ code: m.codi, concept: m.concepte, amount_cents: m.import_cents, amount_text: eur(m.import_cents),
        vat_text: null, trigger_condition: m.concepte, page: f.pagina, source_text: m.concepte })),
      no_milestones_reason: f.fites.length ? null : "L'annex no indica venciments per a aquest extra",
    })),
    payment_terms: { text: "3 dies hàbils", page: 2 }, later_extras_rule: { text: "50/30/20", page: 3 },
    deadlines: [], special_conditions: [], linked_documents: [], modifications: [], undetermined: [],
  });
}

describe("lector de contractes", () => {
  it("llegeix imports en format espanyol i detecta formats anòmals", () => {
    expect(strictAmountCents("35.600,00 €")).toBe(3560000);
    expect(strictAmountCents("5.750,00 + IVA")).toBe(575000);
    expect(strictAmountCents("5.000 €")).toBe(500000);
    expect(strictAmountCents("35.600€")).toBe(3560000);
    expect(strictAmountCents("39.5000,00 €")).toBeNull();
    expect(vatFromText("IVA 21 %")).toBe(2100);
    expect(vatFromText("al tipo legal vigente")).toBeNull();
  });

  it("aplana 37 fites en ordre i suggereix el tipus de concepte", () => {
    const flat = flattenMilestones(readingFromFixture());
    expect(flat).toHaveLength(37);
    expect(flat.map((m) => m.position)).toEqual(Array.from({ length: 37 }, (_, i) => i + 1));
    expect(flat[0].concept_type).toBe("projecte_direccio");
    expect(flat.find((m) => m.code === "F2.01")?.concept_type).toBe("cimentacio");
    expect(flat.filter((m) => m.is_extra)).toHaveLength(16);
    expect(flat.every((m) => m.vat_rate_bp === null)).toBe(true);
  });

  it("detecta les discrepàncies conegudes del cas de referència", () => {
    const r = readingFromFixture();
    const d = verifyReading(r, { taxableCents: fx.pressupost_acceptat_cents, extrasCents: 16300000 }, null);
    const kinds = d.map((x) => x.kind);
    // 300 € entre pressupost i contracte
    const pc = d.find((x) => x.kind === "pressupost_contracte")!;
    expect(pc.expected_cents! - pc.found_cents!).toBe(30000);
    // 3 extres sense fites: cuina, terrassa P1, altures (33.050 €)
    const sense = d.filter((x) => x.kind === "sense_fites");
    expect(sense.map((x) => x.refs[0].code)).toEqual(["F4.1", "F4.5", "F4.9"]);
    const falten = d.find((x) => x.kind === "fites_falten")!;
    expect(falten.expected_cents! - falten.found_cents!).toBe(3305000);
    // "39.5000,00 €"
    expect(d.some((x) => x.kind === "format_import" && x.refs[0].code === "F2")).toBe(true);
    expect(kinds).toContain("data_signatura");
    expect(kinds).toContain("iva_no_determinable");
    // Cap fase amb fites té la suma malament
    expect(kinds).not.toContain("suma_fase");
    expect(kinds).not.toContain("extres_pressupost");
  });

  it("detecta fites duplicades, sumes de fase i imports inexistents a la pàgina", () => {
    const r = readingFromFixture();
    r.phases[0].milestones.push({ ...r.phases[0].milestones[0] });
    const d = verifyReading(r, null, ["Pàgina sense cap import"].concat(Array(60).fill("")));
    expect(d.some((x) => x.kind === "codi_duplicat")).toBe(true);
    expect(d.some((x) => x.kind === "fita_duplicada")).toBe(true);
    expect(d.some((x) => x.kind === "suma_fase" && x.refs[0].code === "F1")).toBe(true);
    expect(d.some((x) => x.kind === "fites_sobren" || x.kind === "fites_falten")).toBe(true);
    const r2 = readingFromFixture();
    const pages = Array(60).fill("");
    pages[15] = "F1.01 Inicio proyecto ejecutivo 17.800,00 € F1.02 Visado 17.800,00 €";
    const d2 = verifyReading(r2, null, pages);
    expect(d2.filter((x) => x.kind === "import_no_trobat" && x.refs[0].code?.startsWith("F1"))).toHaveLength(0);
    expect(d2.some((x) => x.kind === "import_no_trobat" && x.refs[0].code === "F2.01")).toBe(true);
  });

  it("troba imports escrits de diverses maneres", () => {
    expect(amountOnPage(575000, "Hito: 5.750,00 + IVA")).toBe(true);
    expect(amountOnPage(500000, "importe 5.000 € a la firma")).toBe(true);
    expect(amountOnPage(3560000, "total 35.600€")).toBe(true);
    expect(amountOnPage(3560000, "total 135.600,00 €")).toBe(false);
    expect(amountOnPage(1780000, "17.800,00")).toBe(true);
  });

  it("rebutja respostes de la IA que no compleixen l'esquema", () => {
    const bad = { ...readingFromFixture(), total_cents: -5 };
    expect(readingSchema.safeParse(bad).success).toBe(false);
    const bad2 = JSON.parse(JSON.stringify(readingFromFixture()));
    bad2.phases[0].milestones[0].amount_cents = 12.5;
    expect(readingSchema.safeParse(bad2).success).toBe(false);
  });
});
