/**
 * MOTOR ÚNIC DE NORMALITZACIÓ I VALIDACIÓ DE TARIFES (totes les comercialitzadores, amb adaptadors).
 * Annexos reals de Nufri (tests/fixtures/nufri) i tarifes fictícies per a la resta de casos. Sense IA ni xarxa.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { pdfText } from "@/server/doc-text";
import { parseNufriDoc, type NufriDoc } from "@/comparator/nufri-reader";
import { nufriItems } from "@/comparator/nufri-mapping";
import { convertUnit, gasFixedEquivalents, toInternal, unitCodeOf } from "@/comparator/units";
import { analyzePeriods, priceCountFromName } from "@/comparator/tariff-periods";
import { normalizeOffer, reviewRow, validateOffer } from "@/comparator/tariff-engine";
import { readConditions } from "@/comparator/tariff-conditions";
import { adapterFor } from "@/comparator/supplier-adapters";
import { permanenceIssues, permanenceLabel } from "@/comparator/permanence";
import { checkVersion } from "@/comparator/catalog";
import { aiTariffsToVersions } from "@/comparator/tariff-ai";
import { planReprocess } from "@/comparator/tariff-reprocess";
import { energyText, gasFixedText, powerText } from "@/comparator/price-display";
import { computeCost } from "@/comparator/engine";
import { buildSnapshot } from "@/comparator/snapshot";
import { comparisonSheet } from "@/comparator/sheet-view";
import { computeCommission, linkTariffRules, powerBase, type Facts, type RuleRow } from "@/core/commissions";
import { commissionUnit, formatUnitValue, unitBasis } from "@/core/units";
import { emptySheet, type OfferVersion, type SupplyInput } from "@/comparator/types";

vi.mock("server-only", () => ({}));

let L: NufriDoc, G: NufriDoc;
beforeAll(async () => {
  const pages = async (f: string) => (await pdfText(new Uint8Array(readFileSync(`tests/fixtures/nufri/${f}`)))).pages;
  L = parseNufriDoc(await pages("nufri-electricitat-2026-11-05.pdf"));
  G = parseNufriDoc(await pages("nufri-gas-2026-11-05.pdf"));
});

const offer = (p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: "o-1", supplierId: "sup:prova", supplierName: "Comercialitzadora de prova", productId: "p-1", productName: "Tarifa prova", version: 1, energyType: "luz", accessTariff: "2.0TD",
  segments: ["pyme"], permanenceMonths: null, penalty: null, durationMonths: null, priceGuaranteeMonths: null, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
  validFrom: "2026-11-01", validTo: null, source: "Prova", publishedAt: "2026-11-01", status: "esborrany", conditions: null, origin: "excel",
  contractType: "periodes", energy: [0.2, 0.15, 0.1, null, null, null], power: [0.08, 0.002, null, null, null, null], powerUnit: "eur_kw_dia", sas: { mode: "inclos", eurKwh: null }, ...p,
});
const s6 = (p: Partial<SupplyInput> = {}): SupplyInput => ({ energyType: "luz", accessTariff: "3.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [5000, 4000, 3000, 6000, 2000, 9000], kwhTotal: null, kw: [40, 40, 40, 40, 40, 40], meterRentEurMonth: null, ...p });

describe("1 · conversions d'unitats (conserven l'original)", () => {
  it("€/MWh → €/kWh, c€/kWh → €/kWh", () => {
    expect(toInternal(65, "€/MWh", "energia").value).toBe(0.065);
    expect(toInternal(12.5, "c€/kWh", "energia").value).toBe(0.125);
    expect(toInternal(0.1234, "€/kWh", "energia")).toMatchObject({ value: 0.1234, factor: "1" });
  });
  it("€/kW·any → €/kW·dia (÷365) i €/kW·mes → €/kW·dia (×12÷365), anual ↔ diari", () => {
    expect(toInternal(36.5, "€/kW/año", "potencia").value).toBe(0.1);
    expect(toInternal(3.0416666, "€/kW/mes", "potencia").value).toBeCloseTo(0.1, 6);
    expect(convertUnit(0.1, "€/kW/día", "€/kW/año").value).toBe(36.5);
    expect(convertUnit(27.703595, "€/kW/año", "€/kW/día").value).toBeCloseTo(0.075900, 6);
  });
  it("terme fix del gas en €/mes → €/dia, cost mensual, anual i d'un període (criteri documentat)", () => {
    const d = toInternal(5.17, "€/cliente/mes", "terme_fix_gas").value!;
    expect(d).toBeCloseTo((5.17 * 12) / 365, 12);
    const eq = gasFixedEquivalents(d, 30);
    expect([eq.perMonth, eq.perYear, eq.period]).toEqual([5.17, 62.04, 5.1]);
    expect(eq.criterion).toMatch(/12 mensualitats ÷ 365/);
  });
  it("no es confonen imports fixos per subministrament amb imports per potència o per consum", () => {
    expect(toInternal(2, "€/kW/año", "terme_fix_gas").ok).toBe(false);
    expect(toInternal(0.1, "€/kWh", "terme_fix_gas").ok).toBe(false);
    expect(convertUnit(5, "€/mes", "€/kW/día").ok).toBe(false);
    expect([unitBasis("eur_mes"), unitBasis("eur_kw"), unitBasis("eur_mwh"), unitBasis("eur_contracte")]).toEqual(["subministrament", "potencia", "consum", "contracte"]);
    expect([unitCodeOf("€/cliente/mes"), unitCodeOf("€/kW/año"), unitCodeOf("c€/kWh"), unitCodeOf("€/MWh"), unitCodeOf("€/contrato")]).toEqual(["eur_mes", "eur_kw_any", "cent_kwh", "eur_mwh", "eur_contracte"]);
  });
  it("comissions sempre amb unitat: €/contracte, €/MWh, €/kW, %", () => {
    expect(formatUnitValue(50, commissionUnit("fix_contracte", "eur"))).toBe("50 €/contracte");
    expect(formatUnitValue(2, commissionUnit("per_kw", "eur_kw"))).toBe("2 €/kW");
    expect(formatUnitValue(10, commissionUnit("per_mwh", "eur_mwh"))).toBe("10 €/MWh");
    expect(formatUnitValue(30, commissionUnit("pct_comissio_rebuda", "pct"))).toBe("30 %");
  });
});

describe("2 · períodes i tipus de tarifa", () => {
  it("2.0TD: 3 preus; 3.0TD i 6.1TD: 6 preus (P1–P6)", () => {
    expect(analyzePeriods(offer()).label.ca).toBe("3 preus (P1–P3)");
    const six = offer({ accessTariff: "3.0TD", energy: [0.3, 0.25, 0.2, 0.18, 0.15, 0.12], power: [0.05, 0.03, 0.01, 0.01, 0.007, 0.004] });
    expect(analyzePeriods(six).label.ca).toBe("6 preus (P1–P6)");
    expect(analyzePeriods({ ...six, accessTariff: "6.1TD" }).issues).toEqual([]);
  });
  it("el número de la tarifa d'accés no és la quantitat de preus («3.0TD» no vol dir 3 preus)", () => {
    expect(priceCountFromName("Nufri 3.0TD · Seis precios")).toBe(6);
    expect(priceCountFromName("Tarifa 3.0TD Empresa")).toBeNull();
    const bad = offer({ accessTariff: "3.0TD", productName: "Nufri 3.0TD · 3 precios", energy: [0.3, 0.25, 0.2, null, null, null], power: [0.05, 0.03, 0.01, 0.01, 0.007, 0.004] });
    const c = checkVersion(bad);
    expect(c.errors.join(" ")).toMatch(/Possible confusió entre el número de la tarifa \(3\.0TD\) i la quantitat de preus/);
    expect(c.warnings.join(" ")).toMatch(/El nom diu «3 preus».*té 6 preus/);
  });
  it("no s'inventen valors: un P4 en una 2.0TD és un error", () => {
    expect(checkVersion(offer({ energy: [0.2, 0.15, 0.1, 0.09, null, null] })).errors.join(" ")).toMatch(/P4: la 2\.0TD només té 3 períodes/);
  });
  it("24 hores: el mateix preu a tots els períodes s'identifica com a preu únic (cost idèntic)", () => {
    const flat = offer({ accessTariff: "3.0TD", energy: Array(6).fill(0.18), power: [0.05, 0.03, 0.01, 0.01, 0.007, 0.004] });
    const n = normalizeOffer(flat);
    expect([n.offer.contractType, n.offer.energy24h]).toEqual(["fix24h", 0.18]);
    expect(n.changes.join(" ")).toMatch(/tarifa 24 hores/);
    expect(analyzePeriods(n.offer).label.ca).toBe("Preu únic 24 hores");
    const a = computeCost(flat, s6()), b = computeCost(n.offer, s6());
    expect(a.total).toBe(b.total);
    // una 24 hores amb preus per períodes diferents és un error real
    expect(checkVersion(offer({ contractType: "fix24h", energy24h: 0.2, energy: [0.2, 0.1, 0.1, null, null, null] })).errors.join(" ")).toMatch(/24 hores amb preus per períodes diferents/);
  });
  it("normalitzar és idempotent", () => {
    const n1 = normalizeOffer(offer({ accessTariff: "3.0TD", supplierName: "Nufri", energy: [0.3, 0.25, 0.2, 0.18, 0.15, 0.12], power: [0.05, 0.03, 0.01, 0.01, 0.007, 0.004] }));
    const n2 = normalizeOffer(n1.offer);
    expect(n2.offer).toEqual(n1.offer);
    expect(n2.changes).toEqual([]);
  });
});

describe("3 · Nufri amb els annexos reals", () => {
  it("3.0TD: sis preus originals associats a P1–P6, mai «tres preus»", () => {
    const items = nufriItems(L, { fileName: "annex.pdf", existing: [] });
    const t30 = items.filter((i) => i.group === "3.0TD");
    expect(t30.map((i) => i.offer.productName)).toEqual(["Nufri 3.0TD · Seis precios", "Nufri 3.0TD · Seis precios · 30% descuento", "Nufri 3.0TD · Un precio", "Nufri 3.0TD · Un precio · 30% descuento"]);
    expect(items.some((i) => i.offer.accessTariff === "3.0TD" && /tres precios|3 precios/i.test(i.offer.productName))).toBe(false);
    const six = t30[0].offer;
    expect(six.energy).toEqual([0.427351, 0.375409, 0.257086, 0.212907, 0.193614, 0.242146]);
    expect(reviewRow(six).modality).toBe("Preu fix · 6 preus (P1–P6)");
    expect(reviewRow(t30[2].offer).modality).toBe("Preu fix · Preu únic 24 hores");
  });
  it("3.0TD a preu fix: permanència reconeguda automàticament, durada sense determinar i sense confirmació manual", () => {
    const t30 = nufriItems(L, { fileName: "annex.pdf", existing: [] }).filter((i) => i.group === "3.0TD");
    for (const i of t30) {
      expect(i.offer.permanence).toMatchObject({ status: "amb", months: null });
      expect(i.offer.permanenceMonths).toBeNull(); // no s'inventen 12 mesos
      expect(permanenceIssues(i.offer)).toEqual([]);
      expect(i.errors).toEqual([]);
      expect(i.autoVerified.join(" ")).toMatch(/Nufri 3\.0TD a preu fix/);
      expect(permanenceLabel(i.offer)).toBe("Permanència: sí (durada no especificada al document)");
    }
    // la 2.0TD i la indexada no hereten aquesta regla
    const others = nufriItems(L, { fileName: "annex.pdf", existing: [] }).filter((i) => i.group === "2.0TD" || i.group === "indexada");
    expect(others.every((i) => (i.offer.permanence?.status ?? "no_informada") === "no_informada")).toBe(true);
  });
  it("gas: terme fix en €/mes (regla de Nufri), conservat a la tarifa i a la taula de revisió", () => {
    const rl1 = nufriItems(G, { fileName: "gas.pdf", existing: [] }).find((i) => i.group === "gas_fix" && i.offer.accessTariff === "RL.1")!;
    expect(gasFixedText(rl1.offer)).toBe("5,17 €/cliente/mes (0,169973 €/client·dia · 62,04 €/any)");
    const row = reviewRow(rl1.offer, { autoVerified: rl1.autoVerified });
    expect(row.originalUnits).toEqual(["Terme fix: €/cliente/mes"]);
    expect(row.normalized.join(" ")).toMatch(/5,17 €\/mes/);
    expect(row.blocking).toBe(false);
  });
});

describe("4 · permanències i condicions de qualsevol comercialitzadora", () => {
  it("llegeix permanència, durada, penalització, renovació i vigència; sense durada → no s'inventa", () => {
    const c = readConditions("Permanencia de 12 meses. Penalización del 5% sobre la energía pendiente. Renovación automática anual. Validez: oferta válida hasta el 31/12/2026.");
    expect([c.permanence, c.months]).toEqual(["amb", 12]);
    expect(c.penalty).toMatch(/Penalización/);
    expect(c.renewal).toMatch(/Renovación automática/);
    expect(c.validity).toMatch(/31\/12\/2026/);
    expect(readConditions("Contrato con permanencia. Se aplicará penalización por baja anticipada.")).toMatchObject({ permanence: "amb", months: null });
    expect(readConditions("Producto sin permanencia.").permanence).toBe("sense");
    expect(readConditions("Precios fijos durante 12 meses.").permanence).toBeNull();
  });
  it("el motor aplica les condicions a una tarifa d'IA (p. ex. Gana Energía) sense adaptador específic de permanència", () => {
    const o = offer({ supplierName: "Gana Energía", accessTariff: "3.0TD", energy: [0.3, 0.25, 0.2, 0.18, 0.15, 0.12], power: [0.05, 0.03, 0.01, 0.01, 0.007, 0.004], conditions: "Permanencia de 12 meses con penalización del 5 %." });
    const n = normalizeOffer(o);
    expect(n.adapter.id).toBe("gana");
    expect([n.offer.permanence?.status, n.offer.permanence?.months, n.offer.permanenceMonths]).toEqual(["amb", 12, 12]);
    expect(permanenceIssues(n.offer)).toEqual([]);
  });
  it("adaptadors: Iberdrola, Endesa, Naturgy, Nufri, Gana, NIBA, Novaluz i genèric per a les noves", () => {
    expect(["Iberdrola", "Endesa Energía", "Naturgy", "Energía Nufri SLU", "Gana Energía", "NIBA", "Novaluz", "Nova Comercialitzadora SL"].map((s) => adapterFor(s).id)).toEqual(["iberdrola", "endesa", "naturgy", "nufri", "gana", "niba", "novaluz", "generic"]);
  });
});

describe("5 · comissions per energia, potència i període", () => {
  const base: Omit<RuleRow, "kind" | "value" | "unit" | "conditions"> = { id: "r", rule_key: "k", version: 1, name: "Regla", layer: "proveidor", retailer: "Nufri", product: null, service: null, segment: null, beneficiary_id: null, tiers: null, base_formula: null, base_validated: true, valid_from: "2026-01-01", valid_to: null, status: "aprovada", notes: null };
  const facts: Facts = { retailer: "Nufri", product: "Nufri 3.0TD · Seis precios · GALA", service: null, segment: null, refDate: "2026-11-10", annualKwh: 29000, annualKwhSource: "Prova", eligibleMwh: null, energyIncrementEurKwh: null, powerIncrementEurKwDay: null, powerKw: [40, 40, 40, 40, 40, 40], months: 12, providerAmount: null, providerAmountSource: null, tariff: "3.0TD", powerMarginEurKwYear: 2 };
  it("(40 × 6) × 2 = 480 €: suma de potències dels períodes", () => {
    expect(powerBase([40, 40, 40, 40, 40, 40], "3.0TD", "suma_kw_periodes").toString()).toBe("240");
    const r = computeCommission({ ...base, kind: "per_kw", value: "2", unit: "eur_kw", conditions: { power_basis: "suma_kw_periodes" } }, facts);
    expect([r.status, r.amount]).toEqual(["calculat", "480.00"]);
    const ep = computeCommission({ ...base, kind: "energia_potencia", value: "10", unit: "eur_mwh", conditions: { scheme: "nufri" } }, facts);
    expect(ep.components).toEqual({ energy: "290.00", power: "480.00" });
  });
  it("la fórmula no s'aplica a altres modalitats sense comprovar el document: sense base declarada no calcula", () => {
    const r = computeCommission({ ...base, retailer: "Altres", kind: "per_kw", value: "2", unit: "eur_kw", conditions: {} }, { ...facts, retailer: "Altres" });
    expect(r.status).toBe("pendent_configuracio");
    expect(computeCommission({ ...base, kind: "per_kw", value: "2", unit: "eur_kw", conditions: { power_basis: "kw_p1" } }, facts).amount).toBe("80.00");
    // 2.0TD: només P1 i P2
    expect(powerBase([5, 5, 99, 99, 99, 99], "2.0TD", "suma_kw_periodes").toString()).toBe("10");
  });
  it("vincle tarifa ↔ regles: comercialitzadora, comercial, col·laborador, fixa i retrocessió", () => {
    const rules: RuleRow[] = [
      { ...base, rule_key: "a", kind: "energia_potencia", value: "10", unit: "eur_mwh", product: "GALA", conditions: { scheme: "nufri" } },
      { ...base, rule_key: "b", layer: "comercial", kind: "pct_comissio_rebuda", value: "30", unit: "pct", conditions: {} },
      { ...base, rule_key: "c", layer: "collaborador", kind: "fix_contracte", value: "50", unit: "eur", conditions: {} },
      { ...base, rule_key: "d", kind: "retrocessio", value: "100", unit: "pct", conditions: { months: 12 } },
      { ...base, rule_key: "e", kind: "per_mwh", value: "4", unit: "eur_mwh", product: "GOLDEN", conditions: {} },
    ];
    const links = linkTariffRules({ supplierName: "Nufri", productName: "Nufri 3.0TD · Seis precios · GALA", accessTariff: "3.0TD", energyType: "luz" }, rules);
    expect(links).toEqual([
      "Comercialitzadora · per energia i potència (períodes): 10 €/MWh (potència: suma dels kW de tots els períodes) · Aprovada",
      "Comercialitzadora · retrocessió: 100 % · Aprovada",
      "Comercial · percentatge: 30 % · Aprovada",
      "Col·laborador · fixa: 50 €/contracte · Aprovada",
    ]);
  });
});

describe("6 · coherència lector → catàleg → comparador → PDF", () => {
  it("gas Nufri: el mateix import de terme fix al catàleg, al comparador i al full del PDF (amb la unitat original)", () => {
    const rl1 = nufriItems(G, { fileName: "gas.pdf", existing: [] }).find((i) => i.group === "gas_fix" && i.offer.accessTariff === "RL.1")!.offer;
    const o = { ...rl1, status: "activa" as const, validTo: "2027-12-31" };
    const sup: SupplyInput = { energyType: "gas", accessTariff: "RL.1", territory: "peninsula", segment: null, days: 30, basis: "periode_facturat", kwh: [300, null, null, null, null, null], kwhTotal: 300, kw: Array(6).fill(null), meterRentEurMonth: null };
    const cost = computeCost(o, sup);
    const fix = cost.lines.find((l) => l.key === "fix_gas")!.amount;
    expect(fix).toBe(gasFixedEquivalents(o.gasFixedEurDay, 30).period);
    const snap = buildSnapshot({ mode: "manual", supply: sup, current: null, offers: [o] }, "2026-11-06");
    const sh = comparisonSheet(snap, "ca");
    const block = sh.blocks.find((b) => b.id === "fix_gas");
    const cell = block && block.kind === "priced" ? block.rows[0].cells[1] : null;
    expect(cell?.price).toMatch(/5,17 €\/mes/);
    expect(cell?.amount).toMatch(/5,10/);
  });
  it("electricitat: els preus i les unitats del catàleg són els que fa servir el comparador", () => {
    const o = offer({ accessTariff: "3.0TD", energy: [0.3, 0.25, 0.2, 0.18, 0.15, 0.12], power: [18.25, 10.95, 3.65, 3.65, 2.555, 1.46], powerUnit: "eur_kw_any", status: "activa", validTo: "2027-12-31" });
    const n = aiTariffsToVersions({ offers: [{ productName: "Prova", accessTariff: "3.0TD", contractType: "periodes", energy: o.energy, power: o.power, powerUnit: "eur_kw_any", sas: "inclos", confidence: "alta" }] }, { fileName: "x.pdf", supplierHint: "Prova SA", existing: [] }).items[0].offer;
    expect(n.power).toEqual([0.05, 0.03, 0.01, 0.01, 0.007, 0.004]);
    expect(n.units?.power).toEqual({ values: o.power, unit: "€/kW·any" });
    expect(powerText(n)).toBe("0,05 / 0,03 / 0,01 / 0,01 / 0,007 / 0,004 €/kW·dia (doc.: 18,25 / 10,95 / 3,65 / 3,65 / 2,555 / 1,46 €/kW·any)");
    expect(energyText(n)).toBe("0,3 / 0,25 / 0,2 / 0,18 / 0,15 / 0,12 €/kWh (P1–P6)");
    const sup = s6();
    const ev = buildSnapshot({ mode: "manual", supply: sup, current: null, offers: [{ ...n, status: "activa", validTo: "2027-12-31" }] }, "2026-11-06").result.evaluations[0];
    expect(ev.cost?.detail?.power.map((p) => p.price)).toEqual([0.05, 0.03, 0.01, 0.01, 0.007, 0.004]);
    expect(ev.cost?.total).toBe(computeCost(o, sup).total); // €/kW·any directe = convertit a €/kW·dia
  });
});

describe("7 · reprocessament segur", () => {
  it("una tarifa antiga mal importada (gas Nufri sense unitat) proposa una versió nova en esborrany; no toca les existents", () => {
    const rl1 = nufriItems(G, { fileName: "gas.pdf", existing: [] }).find((i) => i.group === "gas_fix" && i.offer.accessTariff === "RL.1")!.offer;
    const old: OfferVersion & { usedAt: string } = { ...rl1, id: "11111111-1111-1111-1111-111111111111", productId: "p-gas", version: 3, status: "activa", gasFixedEurDay: null, units: { gasFixed: { value: 5.17, unit: "no indicada al document" }, formulas: [] }, usedAt: "2026-11-05T10:00:00Z" };
    const ok = { ...normalizeOffer({ ...old, id: "22222222-2222-2222-2222-222222222222", productId: "p-ok" }).offer, status: "activa" as const };
    const archived = { ...old, id: "33333333-3333-3333-3333-333333333333", productId: "p-arx", status: "arxivada" as const };
    const plan = planReprocess([old, ok, archived]);
    expect(plan.map((r) => [r.productId, r.action])).toEqual([["p-gas", "nova_versio"], ["p-ok", "sense_canvis"]]);
    const r = plan[0];
    expect(r.usedInProposals).toBe(true);
    expect([r.next?.id, r.next?.status, r.next?.gasFixedEurDay]).toEqual(["", "esborrany", ok.gasFixedEurDay]);
    expect(old.gasFixedEurDay).toBeNull(); // l'original no es modifica
    expect(validateOffer(r.next!).filter((i) => i.level === "error" || i.level === "falta")).toEqual([]);
  });
});
