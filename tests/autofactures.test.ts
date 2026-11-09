/**
 * Migració 033 · Autofactures i cobraments: lector local, correspondències, estats independents i diferències.
 * Dades fictícies (cap NIF, CUPS ni import real).
 */
import { describe, expect, it } from "vitest";
import { collectionState, effectiveMode, proposeMatches, readSelfInvoiceText, reconcile, sameRetailer, settlementState, type StatementForMatch } from "@/core/self-billing";

const AF = [
  "COMERCIALITZADORA FICTÍCIA SL",
  "AUTOFACTURA - Facturación realizada por el destinatario",
  "Nº Factura: AF-2026-0042",
  "Fecha de emisión: 05/11/2026",
  "Periodo: 01/10/2026 - 31/10/2026",
  "Referencia liquidación: LIQ-OCT-26",
  "Base imponible 1.250,00 €",
  "IVA 21% 262,50 €",
  "Total a percibir 1.512,50 €",
].join("\n");

const st = (p: Partial<StatementForMatch> = {}): StatementForMatch => ({ id: "s1", retailer: "Comercialitzadora Fictícia", reference: "LIQ-OCT-26", received_at: "2026-11-02", period_from: "2026-10-01", period_to: "2026-10-31", declared_total: null, conciliated: "1250.00", total: "1250.00", selfInvoiced: "0.00", billingMode: "autofactura", hasOwnInvoice: false, ...p });

describe("lector local d'autofactures", () => {
  it("detecta l'autofactura i n'extreu número, data, base, IVA, total, període i referència", () => {
    const r = readSelfInvoiceText(AF);
    expect(r.isSelfInvoice).toBe(true);
    expect([r.number.value, r.issueDate.value, r.base.value, r.vatRate.value, r.vat.value, r.total.value]).toEqual(["AF-2026-0042", "2026-11-05", "1250.00", "21", "262.50", "1512.50"]);
    expect([r.periodFrom.value, r.periodTo.value]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(r.references).toContain("LIQ-OCT-26");
    expect(r.warnings).toEqual([]);
    expect(r.base.evidence).toMatch(/Base imponible/);
  });
  it("no inventa dades: un document sense marques d'autofactura ni imports queda buit i amb avisos", () => {
    const r = readSelfInvoiceText("Factura ordinària\nGràcies per la confiança");
    expect(r.isSelfInvoice).toBe(false);
    expect([r.base.value, r.total.value, r.number.value]).toEqual([null, null, null]);
    expect(r.warnings.join(" ")).toMatch(/no diu que sigui una autofactura/);
  });
  it("avisa si base + IVA − retenció no quadra amb el total", () => {
    const r = readSelfInvoiceText(AF.replace("1.512,50", "1.600,00"));
    expect(r.warnings.join(" ")).toMatch(/no quadra/);
  });
});

describe("correspondències amb liquidacions", () => {
  it("proposa la liquidació per comercialitzadora, import, període i referència", () => {
    const p = proposeMatches({ retailer: "COMERCIALITZADORA FICTÍCIA SL", base: "1250.00", issueDate: "2026-11-05", periodTo: "2026-10-31", references: ["LIQ-OCT-26"] }, [st(), st({ id: "s2", reference: "LIQ-SET-26", period_to: "2026-09-30", conciliated: "800", total: "800" }), st({ id: "s3", retailer: "Una Altra Energia" })]);
    expect(p.map((x) => x.statementId)).toEqual(["s1", "s2"]); // la d'una altra comercialitzadora no es proposa
    expect(p[0].score).toBeGreaterThan(p[1].score);
    expect(p[0].reasons.join(" ")).toMatch(/base coincideix/);
    expect(p[0].amount).toBe("1250.00");
  });
  it("bloqueja les que ja tenen factura pròpia i avisa si ja estan autofacturades", () => {
    const [a] = proposeMatches({ retailer: "Comercialitzadora Fictícia", base: "100", issueDate: null }, [st({ hasOwnInvoice: true })]);
    expect(a.blocked).toMatch(/factura emesa per Assessoria 3.0/);
    const [b] = proposeMatches({ retailer: "Comercialitzadora Fictícia", base: "1250", issueDate: null }, [st({ selfInvoiced: "1250.00" })]);
    expect(b.discrepancies.join(" ")).toMatch(/ja té 1250.00 € coberts/);
  });
  it("comparació de noms de comercialitzadora tolerant a SL/SA i accents", () => {
    expect(sameRetailer("NUFRI ENERGÍA S.L.", "Nufri")).toBe(true);
    expect(sameRetailer("Nufri", "Naturgy")).toBe(false);
  });
});

describe("estats independents de liquidació i de cobrament", () => {
  const L = (amount: string, match_status: string, collected = "0", expected_amount: string | null = null) => ({ amount, match_status, collected, expected_amount });
  it("carregar una autofactura no canvia el cobrament (només el cobrat real compta)", () => {
    const lines = [L("500", "conciliat"), L("750", "conciliat")];
    expect(collectionState(lines)).toBe("pendent");
    expect(settlementState(lines)).toBe("liquidada");
    const r = reconcile(lines, "1250.00");
    expect([r.selfInvoiced, r.collected, r.pendingCollection]).toEqual(["1250.00", "0.00", "1250.00"]);
    expect(r.discrepancies).toEqual([]);
  });
  it("cobrament parcial i total", () => {
    expect(collectionState([L("500", "conciliat", "500"), L("750", "conciliat", "100")])).toBe("parcial");
    expect(collectionState([L("500", "conciliat", "500"), L("750", "conciliat", "750")])).toBe("total");
    expect(reconcile([L("500", "conciliat", "500"), L("750", "conciliat", "100")]).pendingCollection).toBe("650.00");
  });
  it("discrepàncies: esperat ≠ liquidat, autofacturat ≠ liquidat, línies sense conciliar", () => {
    const lines = [L("500", "conciliat", "0", "520"), L("750", "diferencia", "0", "700")];
    expect(settlementState(lines)).toBe("discrepancies");
    const r = reconcile(lines, "1300");
    expect(r.discrepancies.join(" ")).toMatch(/Esperat 1220.00 € ≠ liquidat 1250.00 €/);
    expect(r.discrepancies.join(" ")).toMatch(/Autofacturat 1300.00 € ≠ liquidat 1250.00 €/);
    expect(r.discrepancies.join(" ")).toMatch(/1 línies encara no conciliades/);
    expect(settlementState([L("500", "conciliat")], true)).toBe("discrepancies");
  });
  it("les línies descartades o duplicades no compten com a liquidades", () => {
    expect(reconcile([L("500", "conciliat"), L("500", "descartat")]).liquidated).toBe("500.00");
    expect(settlementState([L("500", "pendent")])).toBe("pendent");
  });
  it("mode efectiu: el de la liquidació mana sobre el de la comercialitzadora", () => {
    expect(effectiveMode("factura_propia", "autofactura")).toBe("factura_propia");
    expect(effectiveMode(null, "mixt")).toBe("mixt");
    expect(effectiveMode(null, null)).toBe("factura_propia");
  });
});
