/**
 * Regles d'unitat apreses (036): Iberdrola Gas · terme fix en €/mes → €/dia (× 12 ÷ 365) aplicat pel motor únic.
 * Abast per comercialitzadora, producte, peatge i plantilla; conflictes; el document mana; el terme variable no es toca.
 * Preus fictícis.
 */
import { describe, expect, it } from "vitest";
import { applyUnitRules, isUnitBlocker, pickRule, reportText, sameSupplier, unknownUnit, type UnitRule } from "@/comparator/unit-rules";
import { normalizeOffer, validateOffer } from "@/comparator/tariff-engine";
import { parseRuleChat } from "@/comparator/reading-rules";
import { emptySheet, type OfferVersion } from "@/comparator/types";

const NEXT = `${new Date().getFullYear() + 1}-12-31`;
const gas = (n: number, supplier: string, product: string, p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, supplierId: "s", supplierName: supplier, productId: `p${n}`, productName: product, version: 1,
  energyType: "gas", accessTariff: "RL.2", segments: ["residencial"], contractType: "fix24h", energy24h: 0.065, energy: Array(6).fill(null), power: Array(6).fill(null),
  gasFixedEurDay: null, units: { gasFixed: { value: 7.3, unit: "no indicada al document" }, formulas: [] },
  permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
  validFrom: "2026-01-01", validTo: NEXT, source: "Plantilla «Iberdrola Gas Hogar» v1 · preus.xlsx · Gas fila 5", publishedAt: null, status: "esborrany", conditions: null, origin: "excel", ...p,
});
const rule = (p: Partial<UnitRule> = {}): UnitRule => ({ id: "r1", supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes", status: "aprovada", approvedBy: "Direcció", ...p });
const IB = gas(1, "Iberdrola Clientes S.A.U.", "Plan Estable Gas");

describe("regla d'unitat: Iberdrola Gas · terme fix en €/mes", () => {
  it("abans: pendent només per la unitat del terme fix", () => {
    expect(unknownUnit(IB, "terme_fix_gas")).toEqual({ value: 7.3, unit: "no indicada al document" });
    const blocking = validateOffer(IB).filter((i) => i.level === "error" || i.level === "falta");
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.every((i) => isUnitBlocker(i.text))).toBe(true);
  });
  it("després: €/dia = €/mes × 12 ÷ 365, conservant l'original, i ja no bloqueja", () => {
    const n = normalizeOffer(IB, { unitRules: [rule()] });
    expect(n.offer.gasFixedEurDay).toBeCloseTo((7.3 * 12) / 365, 12);
    expect(n.offer.gasFixedEurDay).toBe(0.24);
    expect(normalizeOffer(gas(2, "Iberdrola", "X", { units: { gasFixed: { value: 9.99, unit: "" }, formulas: [] } }), { unitRules: [rule()] }).offer.gasFixedEurDay).toBeCloseTo((9.99 * 12) / 365, 12);
    expect(n.offer.units?.gasFixed).toEqual({ value: 7.3, unit: "€/cliente/mes" });
    expect(n.offer.units?.formulas.join(" ")).toMatch(/7\.3 €\/cliente\/mes × 12 ÷ 365 .*regla apresa «Iberdrola — Gas — Terme fix»/);
    expect(n.offer.energy24h).toBe(0.065); // el terme variable €/kWh no es toca
    expect(n.autoVerified.join(" ")).toMatch(/regla apresa/);
    expect(validateOffer(n.offer).filter((i) => i.level === "error" || i.level === "falta")).toEqual([]);
    // idempotent
    expect(normalizeOffer(n.offer, { unitRules: [rule()] }).offer.gasFixedEurDay).toBe(n.offer.gasFixedEurDay);
  });
  it("el document mana: si indica la unitat, la regla no la canvia", () => {
    const doc = gas(3, "Iberdrola", "Y", { gasFixedEurDay: 0.3, units: { gasFixed: { value: 0.3, unit: "€/cliente/día" }, formulas: [] } });
    expect(normalizeOffer(doc, { unitRules: [rule()] }).offer.gasFixedEurDay).toBe(0.3);
  });
});

describe("abast: mai a una altra comercialitzadora ni fora de l'abast", () => {
  it("altres comercialitzadores (Naturgy, Endesa, Repsol, NIBA, Gana, Nufri) no es toquen", () => {
    for (const s of ["Naturgy", "Endesa Energía", "Repsol", "NIBA", "Gana Energía"]) expect(normalizeOffer(gas(10, s, "Gas"), { unitRules: [rule()] }).offer.gasFixedEurDay).toBeNull();
    // Nufri té la seva pròpia regla (confirmada per Direcció al codi): s'aplica la seva, no la d'Iberdrola
    const nf = normalizeOffer(gas(13, "Nufri", "Gas"), { unitRules: [rule()] });
    expect(nf.offer.units?.formulas.join(" ")).not.toMatch(/Iberdrola/);
    expect(nf.autoVerified.join(" ")).toMatch(/Nufri/);
  });
  it("cada comercialitzadora pot tenir la seva regla (també futures)", () => {
    const rules = [rule(), rule({ id: "r2", supplier: "Naturgy", unit: "eur_any" }), rule({ id: "r3", supplier: "Comercialitzadora Futura", unit: "eur_dia" })];
    expect(normalizeOffer(gas(11, "Naturgy Iberia", "Gas"), { unitRules: rules }).offer.gasFixedEurDay).toBeCloseTo(7.3 / 365, 12);
    expect(normalizeOffer(gas(12, "Comercialitzadora Futura SL", "Gas"), { unitRules: rules }).offer.gasFixedEurDay).toBe(7.3);
  });
  it("electricitat, regles proposades/revocades i abast de producte, peatge i plantilla", () => {
    expect(normalizeOffer({ ...IB, energyType: "luz" }, { unitRules: [rule()] }).offer.gasFixedEurDay).toBeNull();
    expect(normalizeOffer(IB, { unitRules: [rule({ status: "proposada" })] }).offer.gasFixedEurDay).toBeNull();
    expect(normalizeOffer(IB, { unitRules: [rule({ status: "revocada" })] }).offer.gasFixedEurDay).toBeNull();
    expect(normalizeOffer(IB, { unitRules: [rule({ product: "Plan Fijo" })] }).offer.gasFixedEurDay).toBeNull();
    expect(normalizeOffer(IB, { unitRules: [rule({ accessTariff: "RL.3" })] }).offer.gasFixedEurDay).toBeNull();
    expect(normalizeOffer(IB, { unitRules: [rule({ templateName: "Una altra plantilla" })] }).offer.gasFixedEurDay).toBeNull();
    expect(normalizeOffer(IB, { unitRules: [rule({ templateName: "Iberdrola Gas Hogar", accessTariff: "RL2" })] }).offer.gasFixedEurDay).toBe(0.24);
  });
  it("la més específica guanya; dues igual d'específiques i diferents = conflicte (no s'aplica)", () => {
    expect(pickRule([rule(), rule({ id: "p", product: "Plan Estable", unit: "eur_any" })], IB, "terme_fix_gas").rule?.id).toBe("p");
    const c = applyUnitRules(IB, [rule(), rule({ id: "x", unit: "eur_any" })]);
    expect(c.offer.gasFixedEurDay).toBeNull();
    expect(c.problems[0]).toMatch(/conflicte/);
  });
  it("noms de comercialitzadora: tolerant amb formes jurídiques, estricte amb noms diferents", () => {
    expect(sameSupplier("IBERDROLA CLIENTES, S.A.U.", "Iberdrola")).toBe(true);
    expect(sameSupplier("Iberdrola", "Ibercaja Energia")).toBe(false);
    expect(sameSupplier("Gana Energía", "Gana")).toBe(true);
  });
});

describe("xat d'aprenentatge i informe verificable", () => {
  it("el xat entén la norma del terme fix en €/mes", () => {
    const r = parseRuleChat("Tots els imports del terme fix de gas d'Iberdrola són €/mes", { product: null, products: [], last: null });
    expect(r.rule?.set.gasFixedUnit).toBe("eur_mes");
  });
  it("només diu «Norma aplicada» si el reprocessament ha acabat bé", () => {
    const base = { rule: "Iberdrola — Gas — Terme fix", originalUnit: "€/mes", targetUnit: "€/dia", persisted: true, approved: true, affected: 3, reprocessed: 3, validated: 2, pending: [{ product: "Iberdrola · Gas X", reasons: ["Falta el preu de l'energia"] }], failed: [], completed: true };
    const t = reportText(base);
    expect(t).toMatch(/^Norma aplicada: Iberdrola — Gas — Terme fix/);
    for (const l of ["Unitat original: €/mes", "Unitat de destí: €/dia", "Regla persistent: guardada", "Tarifes afectades: 3", "Tarifes reprocessades correctament: 3", "Tarifes validades: 2", "Tarifes encara pendents: 1", "Iberdrola · Gas X: Falta el preu de l'energia"]) expect(t).toContain(l);
    expect(reportText({ ...base, completed: false, failed: [{ product: "Y", error: "Error de BD" }] })).toMatch(/^Norma guardada però NO aplicada del tot/);
    expect(reportText({ ...base, approved: false, reprocessed: 0, validated: 0, completed: false })).toMatch(/pendent d'aprovació de Direcció/);
  });
});
