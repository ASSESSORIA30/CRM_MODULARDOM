/**
 * Fase 15 · PREU BASE + FEE i INDEXADA + MARGE (motor central, lector, catàleg, comparador, comissions i PDF).
 * Totes les dades són SINTÈTIQUES (preus inventats per provar el càlcul; cap client real).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  PENDING_COMMISSION, applyPricing, detectPricingModel, iberdrolaOmieLevel, emptyPricing, energyMargin, estimateRemuneration, feeCommissionReconciliation, feeFromEurKwh, feeToEurKwh,
  normalizePricing, parseFee, parseNumber, pickRemunerationRule, validateFee, type PricingConfig, type RemunerationRule,
} from "@/comparator/pricing-model";
import { parsePricingCorrection, pickPricingRule, type PricingReadingRule } from "@/comparator/pricing-rules";
import { aiTariffsToVersions } from "@/comparator/tariff-ai";
import { applyAdjustment, checkVersion } from "@/comparator/catalog";
import { buildSnapshot } from "@/comparator/snapshot";
import { indexedPrices, emptyFormula } from "@/comparator/market";
import { internalFeeRows, renderComparisonPdf } from "@/comparator/pdf";
import { tariffReview } from "@/comparator/review-state";
import { applyTemplate, gridFromXlsx, productsToOffers } from "@/comparator/xlsx-template";
import { proposeTable } from "@/comparator/tariff-table";
import { detectSupplier } from "@/comparator/reading-knowledge";
import { blankOfferForTest } from "./helpers/offer";
import type { OfferVersion, SupplyInput } from "@/comparator/types";

const NEXT = `${new Date().getFullYear() + 1}-12-31`;
const supply = (tariff: string, kwh: (number | null)[], kw: (number | null)[]): SupplyInput => ({
  energyType: "luz", accessTariff: tariff, territory: "peninsula", segment: "pyme", days: 365, basis: "anual", kwh, kwhTotal: kwh.reduce<number>((a, x) => a + (x ?? 0), 0), kw, meterRentEurMonth: 0,
});
const S20 = supply("2.0TD", [3000, 4000, 5000, null, null, null], [4.6, 4.6, null, null, null, null]);
const S30 = supply("3.0TD", [10000, 15000, 20000, 15000, 10000, 30000], [30, 30, 30, 30, 30, 50]);
const pricing = (p: Partial<PricingConfig>): PricingConfig => ({ ...emptyPricing("FIXED_BASE_FEE"), ...p });

/** Tarifa sintètica 3.0TD amb preu base (BASE + FEE). Al catàleg NO porta cap FEE. */
function base30(extra: Partial<PricingConfig> = {}): OfferVersion {
  const baseEnergy = [0.15, 0.14, 0.13, 0.12, 0.11, 0.1];
  const o = blankOfferForTest({
    id: "aaaaaaaa-0000-4000-8000-000000000030", productId: "bbbbbbbb-0000-4000-8000-000000000030", supplierName: "Comercialitzadora Sintètica", productName: "Base Fee 3.0 (sintètica)",
    accessTariff: "3.0TD", segments: ["pyme"], contractType: "periodes", energy: [...baseEnergy], power: [0.08, 0.07, 0.04, 0.03, 0.02, 0.01], powerUnit: "eur_kw_dia",
    validTo: NEXT, permanenceMonths: 12, permanence: { status: "amb", months: 12, startNote: null, cancellation: null, penalty: null, source: "Condicions sintètiques", exception: null },
    surplus: { mode: "sense", mechanism: null, eurKwh: null, periodEurKwh: Array(6).fill(null), formula: null, validFrom: null, validTo: null, battery: null, limits: null, notes: null, source: "manual" },
    pricing: pricing({ baseEnergy, recommendedFee: 0.012, ...extra }),
  });
  return normalizePricing(o).offer;
}
/** FEE d'una comparativa (instantània: mai al catàleg). */
const unic = (single: number, inputUnit: "eur_kwh" | "eur_mwh" = "eur_kwh") => ({ mode: "unic" as const, single, periods: [], inputUnit });
const perPeriod = (periods: number[]) => ({ mode: "periodes" as const, single: null, periods, inputUnit: "eur_kwh" as const });
const withFee = (o: OfferVersion, fee: ReturnType<typeof unic> | ReturnType<typeof perPeriod>) => applyAdjustment(o, { fee });

describe("unitats: €/MWh ↔ €/kWh exactes i sense confusions de comes i punts", () => {
  it("10, 15 i 2 €/MWh → 0,010 · 0,015 · 0,002 €/kWh (sense errors de coma flotant)", () => {
    expect(feeToEurKwh(10, "eur_mwh")).toBe(0.01);
    expect(feeToEurKwh(15, "eur_mwh")).toBe(0.015);
    expect(feeToEurKwh(2, "eur_mwh")).toBe(0.002);
    expect(feeToEurKwh(0.3, "eur_mwh")).toBe(0.0003);
    expect(feeFromEurKwh(0.012, "eur_mwh")).toBe(12);
    expect(0.1 + 0.2).not.toBe(0.3); // (el motivo de la aritmètica decimal)
    expect(feeToEurKwh(feeFromEurKwh(0.0123, "eur_mwh"), "eur_mwh")).toBe(0.0123);
  });
  it("comes, punts i separadors de milers", () => {
    expect(parseNumber("0,012")).toBe(0.012);
    expect(parseNumber("0.012")).toBe(0.012);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("12 €")).toBe(12);
    expect(parseNumber("abc")).toBeNull();
  });
  it("FEE amb unitat: «10 €/MWh» → 0,010; sense unitat → cal confirmar-la (no s'interpreta)", () => {
    expect(parseFee("10 €/MWh")).toMatchObject({ value: 10, unit: "eur_mwh", eurKwh: 0.01, needsConfirmation: false });
    expect(parseFee("0,015 €/kWh")).toMatchObject({ unit: "eur_kwh", eurKwh: 0.015 });
    expect(parseFee("15")).toMatchObject({ value: 15, unit: null, eurKwh: null, needsConfirmation: true });
  });
});

describe("lector: importar tarifes PREU BASE + FEE (2.0TD, 3.0TD i 6.1TD) → només preus base, cap FEE", () => {
  const ai = (offers: Record<string, unknown>[]) => aiTariffsToVersions({ supplierName: "Comercialitzadora Sintètica", offers }, { fileName: "tarifes-sintetiques.pdf", existing: [] });
  it("2.0TD «Precio base + fee»: FIXED_BASE_FEE; es desen ÚNICAMENT els preus base (el FEE del document no s'aplica)", () => {
    const r = ai([{ productName: "Plan Base 2.0", energyType: "luz", accessTariff: "2.0TD", contractType: "periodes", energy: [0.13, 0.11, 0.08, null, null, null], power: [0.09, 0.03, null, null, null, null], powerUnit: "eur_kw_dia", sas: "inclos",
      conditions: "Precio base + fee. El comercializador puede añadir un fee configurable.", feeValue: 10, feeUnit: "€/MWh", pricingModel: "FIXED_BASE_FEE", confidence: "alta" }]);
    const o = r.items[0].offer;
    expect(o.pricing?.model).toBe("FIXED_BASE_FEE");
    expect(o.pricing?.baseEnergy.slice(0, 3)).toEqual([0.13, 0.11, 0.08]);
    expect(o.energy.slice(0, 3)).toEqual([0.13, 0.11, 0.08]); // preu del catàleg = preu base
    expect(o.pricing?.fee.single).toBeNull();
    expect(o.pricing?.feeEnabled).toBe(false);
    expect(o.pricing?.originalFeeText).toMatch(/10/); // només com a referència del document
    expect(r.items[0].warnings.join()).toMatch(/només els PREUS BASE/);
    expect(r.items[0].warnings.join()).not.toMatch(/unitat clara|confirma .*FEE/);
    expect(checkVersion(o).errors).toEqual([]); // es pot validar i activar sense cap FEE
  });
  it("2.0TD amb un únic preu de 24 hores", () => {
    const r = ai([{ productName: "Base 24h", energyType: "luz", accessTariff: "2.0TD", contractType: "fix24h", energy24h: 0.12, power: [0.09, 0.03, null, null, null, null], powerUnit: "eur_kw_dia", conditions: "Precio sin margen: margen de comercialización configurable", feeValue: 0.008, feeUnit: "€/kWh" }]);
    const o = r.items[0].offer;
    expect(o.pricing).toMatchObject({ model: "FIXED_BASE_FEE", baseEnergy24h: 0.12 });
    expect(o.energy24h).toBe(0.12);
  });
  it("3.0TD i 6.1TD amb sis períodes d'energia i sis de potència", () => {
    for (const t of ["3.0TD", "6.1TD"]) {
      const r = ai([{ productName: `Base ${t}`, energyType: "luz", accessTariff: t, contractType: "periodes", energy: [0.15, 0.14, 0.13, 0.12, 0.11, 0.1], power: [0.08, 0.07, 0.04, 0.03, 0.02, 0.01], powerUnit: "eur_kw_dia", conditions: "Coste + margen comercial" }]);
      const o = r.items[0].offer;
      expect(o.pricing?.model).toBe("FIXED_BASE_FEE");
      expect(o.energy).toEqual([0.15, 0.14, 0.13, 0.12, 0.11, 0.1]);
      expect(o.power).toEqual([0.08, 0.07, 0.04, 0.03, 0.02, 0.01]);
      expect(checkVersion(o).errors).toEqual([]);
    }
  });
  it("si la IA diu BASE + FEE però el text no ho justifica, no es converteix i es demana confirmació", () => {
    const r = ai([{ productName: "Fix Normal", energyType: "luz", accessTariff: "2.0TD", contractType: "periodes", energy: [0.13, 0.11, 0.08, null, null, null], power: [0.09, 0.03, null, null, null, null], powerUnit: "eur_kw_dia", conditions: "Precio fijo 12 meses", pricingModel: "FIXED_BASE_FEE" }]);
    expect(r.items[0].offer.pricing ?? null).toBeNull();
    expect(r.items[0].warnings.join(" ")).toMatch(/cal confirmar/);
  });
});

describe("catàleg: mai cap FEE; la tarifa es valida i s'activa amb els preus base", () => {
  it("un FEE que arribi al catàleg (versió antiga, navegador) es descarta: preu desat = preu base", () => {
    const o = base30({ fee: { mode: "unic", single: 0.012, periods: Array(6).fill(null) }, feeEnabled: true });
    expect(o.energy).toEqual([0.15, 0.14, 0.13, 0.12, 0.11, 0.1]);
    expect(o.pricing!.fee.single).toBeNull();
    expect(checkVersion(o).errors).toEqual([]);
    expect(checkVersion({ ...o, energy: [0.162, 0.152, 0.142, 0.132, 0.122, 0.112] }).errors.join()).toMatch(/BASE \+ FEE/); // el catàleg no pot portar FEE amagat
  });
  it("les tarifes antigues (sense model de preu) no canvien", () => {
    const old = blankOfferForTest({ energy: [0.13, 0.11, 0.08, null, null, null], power: [0.09, 0.03, null, null, null, null], powerUnit: "eur_kw_dia", validTo: NEXT });
    expect(normalizePricing(old).offer).toBe(old);
    expect(applyPricing(old)).toBe(old);
    expect(applyAdjustment(old, {})).toBe(old);
  });
});

describe("comparativa: FEE comercial (únic o per període, €/kWh o €/MWh, zero) i recàlcul", () => {
  it("FEE únic: P1–P6 = base + FEE i la potència no canvia", () => {
    const o = withFee(base30(), unic(0.012));
    expect(o.energy).toEqual([0.162, 0.152, 0.142, 0.132, 0.122, 0.112]);
    expect(o.power).toEqual([0.08, 0.07, 0.04, 0.03, 0.02, 0.01]);
    expect(o.pricing!.baseEnergy).toEqual([0.15, 0.14, 0.13, 0.12, 0.11, 0.1]);
  });
  it("€/MWh ÷ 1.000: 12 €/MWh és el mateix que 0,012 €/kWh", () => {
    expect(withFee(base30(), { mode: "unic", single: feeToEurKwh(12, "eur_mwh")!, periods: [], inputUnit: "eur_mwh" }).energy).toEqual(withFee(base30(), unic(0.012)).energy);
  });
  it("FEE diferent per període; un període buit és FEE zero", () => {
    expect(withFee(base30(), perPeriod([0.02, 0.015, 0.01])).energy).toEqual([0.17, 0.155, 0.14, 0.12, 0.11, 0.1]);
  });
  it("FEE zero o sense FEE: preu final = preu base", () => {
    expect(withFee(base30(), unic(0)).energy).toEqual(base30().pricing!.baseEnergy);
    expect(applyAdjustment(base30(), {}).energy).toEqual(base30().pricing!.baseEnergy);
  });
  it("qualsevol FEE no negatiu: el marge recomanat només avisa (no bloqueja); negatiu rebutjat", () => {
    const cfg = base30().pricing!;
    expect(validateFee(cfg, { mode: "unic", single: 0.05, periods: [] }, 6, { enabled: true })).toEqual({ errors: [], warnings: ["ATENCIÓ: el FEE introduït supera el marge recomanat."] });
    expect(validateFee(cfg, { mode: "unic", single: -0.002, periods: [] }, 6, { enabled: true }).errors.join()).toMatch(/negatiu/);
    expect(validateFee({ ...cfg, recommendedFee: null }, { mode: "unic", single: 0.2, periods: [] }, 6, { enabled: true })).toEqual({ errors: [], warnings: [] });
  });
  it("FEE després de descomptes: el descompte percentual no el redueix ni s'aplica dues vegades", () => {
    const d = [{ concept: "Descompte", pct: 10, eurYear: null, base: "energia" as const }];
    const run = (feeBasis: PricingConfig["feeBasis"]) => { const o = normalizePricing({ ...base30({ feeBasis }), discounts: d }).offer; return buildSnapshot({ mode: "manual", supply: S30, current: null, offers: [o], adjustments: { [o.id]: { fee: unic(0.012) } } }).result.evaluations[0].cost; };
    const energy = (c: ReturnType<typeof run>) => (c.lines.find((l) => l.key === "energia")?.amount ?? 0) + (c.lines.find((l) => l.key === "descomptes")?.amount ?? 0);
    const baseCost = 10000 * 0.15 + 15000 * 0.14 + 20000 * 0.13 + 15000 * 0.12 + 10000 * 0.11 + 30000 * 0.1;
    expect(energy(run("abans_descomptes"))).toBeCloseTo((baseCost + 100000 * 0.012) * 0.9, 1);
    expect(energy(run("despres_descomptes"))).toBeCloseTo(baseCost * 0.9 + 100000 * 0.012, 1);
  });
  it("aplicar-ho dues vegades dona el mateix (mai doble FEE)", () => {
    const o = withFee(base30(), unic(0.01));
    expect(applyPricing(o, { ...unic(0.01) })).toEqual(applyPricing(base30(), unic(0.01)));
  });
});

describe("comissions: FEE comercial ≠ comissió remunerada", () => {
  const rule = (p: Partial<RemunerationRule>): RemunerationRule => ({ id: "r", supplier: "Comercialitzadora Sintètica", product: null, tariffProductId: null, model: "pct_fee", status: "aprovada", pct: 50, eur: null, eurPerUnit: null, formula: null, validFrom: "2020-01-01", validTo: null, settlement: null, name: "Regla sintètica", ...p });
  it("Exemple A: 100.000 kWh × 0,010 €/kWh = 1.000 € de marge; si es remunera el 100 %, 1.000 €", () => {
    const o = withFee(base30(), unic(0.01));
    const m = energyMargin(o, S30.kwh, S30.kwhTotal)!;
    expect(m.total).toBe(1000);
    expect(estimateRemuneration(rule({ model: "fee_integre", pct: 100 }), { margin: m.total, kwhTotal: 100000, kwSum: 200 }).amount).toBe(1000);
  });
  it("Exemple B: remuneració del 50 % → 500 € (el FEE i la comissió no són iguals)", () => {
    const r = estimateRemuneration(rule({}), { margin: 1000, kwhTotal: 100000, kwSum: 200 });
    expect(r).toMatchObject({ status: "estimada", amount: 500 });
    expect(r.note).toMatch(/teòrica/);
  });
  it("sense regla confirmada: COMISSIÓ PENDENT DE CONFIGURAR (mai el 100 % per defecte)", () => {
    const r = estimateRemuneration(null, { margin: 1000, kwhTotal: 100000, kwSum: 200 });
    expect(r).toMatchObject({ status: "pendent_configurar", amount: null, formula: PENDING_COMMISSION });
  });
  it("altres modalitats: fix per contracte, per MWh, per kW, mixta i personalitzada", () => {
    const c = { margin: 1000, kwhTotal: 100000, kwSum: 200 };
    expect(estimateRemuneration(rule({ model: "fix_contracte", eur: 150 }), c).amount).toBe(150);
    expect(estimateRemuneration(rule({ model: "per_mwh", eurPerUnit: 2 }), c).amount).toBe(200);
    expect(estimateRemuneration(rule({ model: "per_kw", eurPerUnit: 1.5 }), c).amount).toBe(300);
    expect(estimateRemuneration(rule({ model: "mixta", pct: 40, eur: 50 }), c).amount).toBe(450);
    expect(estimateRemuneration(rule({ model: "personalitzada", formula: "segons annex" }), c).status).toBe("pendent_configurar");
    expect(estimateRemuneration(rule({ status: "pendent_aprovacio" }), c).status).toBe("simulacio");
  });
  it("regla per comercialitzadora, producte i vigència", () => {
    const o = base30();
    const rules = [rule({ id: "gen" }), rule({ id: "prod", product: "Base Fee 3.0" }), rule({ id: "altra", supplier: "Una Altra SA" }), rule({ id: "caducada", product: "Base Fee 3.0", validTo: "2021-01-01" })];
    expect(pickRemunerationRule(rules, o, "2026-11-10")!.id).toBe("prod");
    expect(pickRemunerationRule([rule({ supplier: "Una Altra SA" })], o, "2026-11-10")).toBeNull();
  });
  it("conciliació: estimada, liquidada, cobrada, retrocomissions i regularitzacions; l'estimació mai és «cobrada»", () => {
    expect(feeCommissionReconciliation({ estimated: 500, settled: null, collected: null }).status).toBe("pendent_liquidacio");
    const r = feeCommissionReconciliation({ estimated: 500, settled: 480, collected: 300, clawbacks: 20, regularizations: 10 });
    expect(r).toMatchObject({ netSettled: 470, pending: 170, differenceVsEstimate: -30, status: "cobrada_parcial" });
    expect(feeCommissionReconciliation({ estimated: 500, settled: 500, collected: 500 }).status).toBe("cobrada");
  });
});

describe("tres opcions: cada una amb el seu FEE, sense tocar el catàleg ni altres comparatives", () => {
  const A = base30();
  const B = normalizePricing({ ...base30(), id: "aaaaaaaa-0000-4000-8000-0000000000b0", productId: "bbbbbbbb-0000-4000-8000-0000000000b0", productName: "Base Fee B", pricing: pricing({ baseEnergy: [0.16, 0.15, 0.14, 0.13, 0.12, 0.11] }), energy: [0.16, 0.15, 0.14, 0.13, 0.12, 0.11] }).offer;
  const C = normalizePricing({ ...base30(), id: "aaaaaaaa-0000-4000-8000-0000000000c0", productId: "bbbbbbbb-0000-4000-8000-0000000000c0", productName: "Base Fee C", pricing: pricing({ baseEnergy: [0.14, 0.13, 0.12, 0.11, 0.1, 0.09] }), energy: [0.14, 0.13, 0.12, 0.11, 0.1, 0.09] }).offer;
  const current = { ...A, pricing: null, energy: [0.2, 0.19, 0.18, 0.17, 0.16, 0.15] };
  it("cada opció té el seu FEE; base, FEE, final, consum, cost i estalvi es calculen per separat", () => {
    const frozen = structuredClone([A, B, C]);
    const s = buildSnapshot({ mode: "manual", supply: S30, current, offers: [A, B, C], adjustments: { [A.id]: { fee: unic(0.01) }, [B.id]: { fee: { ...unic(feeToEurKwh(15, "eur_mwh")!), inputUnit: "eur_mwh" as const } }, [C.id]: { fee: perPeriod([0.02, 0.02, 0.01, 0.01, 0, 0]) } } });
    expect([A, B, C]).toEqual(frozen); // el catàleg no canvia
    const off = (id: string) => s.offers.find((o) => o.id === id)!;
    expect(off(A.id).energy[0]).toBe(0.16);
    expect(off(B.id).energy[0]).toBe(0.175);
    expect(off(C.id).energy).toEqual([0.16, 0.15, 0.13, 0.12, 0.1, 0.09]);
    for (const o of [A, B, C]) {
      const ev = s.result.evaluations.find((e) => e.offer.id === o.id)!;
      expect(ev.cost.detail!.energy.map((d) => d.kwh)).toEqual([10000, 15000, 20000, 15000, 10000, 30000]); // consum anual per període
      expect(ev.saving).toBeCloseTo(buildSnapshot({ mode: "manual", supply: S30, current, offers: [] }).result.current!.total - ev.cost.total, 2);
    }
  });
  it("canviar el FEE recalcula a l'instant l'energia (Σ consum × ΔFEE), el total i l'estalvi, amb els mateixos consums", () => {
    const a = buildSnapshot({ mode: "manual", supply: S30, current, offers: [A], adjustments: { [A.id]: { fee: unic(0.012) } } }).result.evaluations[0];
    const b = buildSnapshot({ mode: "manual", supply: S30, current, offers: [A], adjustments: { [A.id]: { fee: unic(0.022) } } }).result.evaluations[0];
    expect(b.cost.lines.find((l) => l.key === "energia")!.amount - a.cost.lines.find((l) => l.key === "energia")!.amount).toBeCloseTo(100000 * 0.01, 2);
    expect(b.saving!).toBeLessThan(a.saving!);
  });
  it("la mateixa tarifa base amb FEE diferents en dues comparatives (dos clients): independents i el catàleg intacte", () => {
    const frozen = structuredClone(A);
    const c1 = buildSnapshot({ mode: "manual", supply: S30, current, offers: [A], adjustments: { [A.id]: { fee: unic(0.005) } } });
    const c2 = buildSnapshot({ mode: "manual", supply: S30, current, offers: [A], adjustments: { [A.id]: { fee: unic(0.03) } } });
    expect(c1.offers[0].energy[0]).toBe(0.155);
    expect(c2.offers[0].energy[0]).toBe(0.18);
    expect(A).toEqual(frozen);
    expect(c1.baseOffers![0].energy[0]).toBe(0.15); // la comparativa desada guarda la base i el seu FEE (no s'aplica dues vegades en reobrir)
    expect(c1.adjustments![A.id].fee!.single).toBe(0.005);
  });
  it("2.0TD: només P1–P3", () => {
    const o = normalizePricing({ ...A, accessTariff: "2.0TD", energy: [0.13, 0.11, 0.08, null, null, null], power: [0.09, 0.03, null, null, null, null], pricing: pricing({ baseEnergy: [0.13, 0.11, 0.08, null, null, null] }) }).offer;
    const f = withFee(o, unic(0.01));
    expect(f.energy).toEqual([0.14, 0.12, 0.09, null, null, null]);
    expect(energyMargin(f, S20.kwh, S20.kwhTotal)!.total).toBe(120);
  });
});

describe("FIXED_BASE_FEE ≠ INDEXED_BASE_FEE (motor central, no una etiqueta)", () => {
  it("una tarifa fixa + FEE no es classifica com a indexada i una OMIE + marge no es classifica com a fixa", () => {
    expect(detectPricingModel({ text: "Precio base + fee. Precio fijo para 12 meses." }).model).toBe("FIXED_BASE_FEE");
    expect(detectPricingModel({ text: "Precio indexado al mercado diario OMIE + margen 8 €/MWh" }).model).toBe("INDEXED");
    expect(detectPricingModel({ text: "Tarifa con precio fijo final" }).model).toBeNull(); // sense evidències: no es converteix
  });
  it("indexada amb el marge ja incorporat: no rep un segon FEE automàtic", () => {
    const d = detectPricingModel({ text: "Precio indexado OMIE. Margen ya incluido en el precio." });
    expect(d).toMatchObject({ model: "INDEXED", fee: null });
    expect(d.warnings.join()).toMatch(/segon FEE/);
  });
  it("no confon el marge del proveïdor amb el FEE d'Assessoria 3.0", () => {
    const d = detectPricingModel({ text: "Precio indexado OMIE + pérdidas + margen 6 €/MWh" });
    expect(d.supplierMarginEurMWh).toBe(6);
    expect(d.fee).toBeNull();
    const auth = detectPricingModel({ text: "Precio indexado OMIE + margen 6 €/MWh. Fee adicional configurable por el comercializador." });
    expect(auth.model).toBe("INDEXED_BASE_FEE");
    expect(auth.feeAllowed).toBe("si");
  });
  it("INDEXED_BASE_FEE: el FEE és un component separat de la fórmula; la fórmula original es conserva", () => {
    const f = { ...emptyFormula(), marginEurMWh: 6, lossesPct: [10, 10, 10, 10, 10, 10], regulatedIncluded: true };
    const o = blankOfferForTest({ id: "idx", accessTariff: "3.0TD", contractType: "indexat", formula: f, pricing: { ...emptyPricing("INDEXED_BASE_FEE"), supplierMarginEurMWh: 6 } });
    const p = applyPricing(o, unic(0.004));
    expect(p.formula!.marginEurMWh).toBe(6); // el marge del proveïdor no es toca
    expect(p.formula!.feeEurMWh!.slice(0, 6)).toEqual([4, 4, 4, 4, 4, 4]);
    const market = [60, 60, 60, 60, 60, 60];
    const before = indexedPrices(f, market, 6), after = indexedPrices(p.formula!, market, 6);
    expect(after.map((x, i) => Math.round((x! - before[i]!) * 1e6) / 1e6)).toEqual([0.004, 0.004, 0.004, 0.004, 0.004, 0.004]);
    expect(p.contractType).toBe("indexat"); // continua sent variable
  });
  it("INDEXED (sense FEE autoritzat): no s'hi aplica res i el FEE queda pendent", () => {
    const o = blankOfferForTest({ contractType: "indexat", formula: { ...emptyFormula(), marginEurMWh: 34 }, pricing: { ...emptyPricing("INDEXED"), feeAllowed: "pendent", supplierMarginEurMWh: 34 } });
    expect(applyPricing(o)).toBe(o);
    expect(validateFee(o.pricing!, { mode: "unic", single: 0.002, periods: [] }, 6).errors.join()).toMatch(/no admet cap FEE/);
    const rv = tariffReview(o);
    expect(rv.checks.find((c) => c.concept === "fee")).toMatchObject({ ok: false, blocking: null }); // no bloqueja la tarifa
  });
});

describe("Iberdrola · Pla OMIE: marge fixat per Iberdrola per nivell (0, 1, 2, 3…), sense FEE", () => {
  it("Pla OMIE: INDEXED, el marge és d'Iberdrola i NO s'hi pot afegir cap FEE (ni tan sols si un text ho insinua)", () => {
    const d = detectPricingModel({ text: "Plan OMIE 2. Precio indexado. Margen 0,020 €/kWh sobre mercado OMIE.", productName: "3.0TD Plan OMIE 2", supplier: "Iberdrola" });
    expect(d).toMatchObject({ model: "INDEXED", feeAllowed: "no", supplierMarginEurMWh: 20, needsConfirmation: false });
    expect(d.evidence.join()).toMatch(/nivell «2».*fixa Iberdrola/);
    expect(detectPricingModel({ text: "Plan OMIE. Fee adicional configurable por el comercializador.", supplier: "Iberdrola" })).toMatchObject({ model: "INDEXED", feeAllowed: "no" });
  });
  it("nivells: «Plan OMIE 0/1/2/3», «Obras» i «Comunidades»", () => {
    expect(["3.0TD Plan OMIE 0", "3.0TD Plan OMIE 3", "2.0TD_2 Plan OMIE Obras", "2.0TD_2 Plan OMIE Comunidades", "Plan Estable"].map(iberdrolaOmieLevel)).toEqual(["0", "3", "Obras", "Comunidades", null]);
  });
  it("un Pla OMIE configurat amb FEE no es pot activar (error al catàleg i al servidor)", () => {
    const o = blankOfferForTest({ supplierName: "Iberdrola", productName: "3.0TD Plan OMIE 1", accessTariff: "3.0TD", contractType: "indexat", formula: { ...emptyFormula(), marginEurMWh: 27 }, pricing: { ...emptyPricing("INDEXED_BASE_FEE"), fee: { mode: "unic", single: 0.003, periods: [] } } });
    expect(checkVersion(o).errors.join()).toMatch(/marge el fixa Iberdrola per nivell/);
  });
  it("Excel real d'Iberdrola: cada nivell del Pla OMIE és un producte amb el SEU marge, sense FEE; la resta de lectures no canvien", () => {
    const wb = gridFromXlsx(XLSX as never, readFileSync("tests/fixtures/iberdrola/IBERDROLA_HASTA_15.11.xlsx"), "IBERDROLA_HASTA_15.11.xlsx");
    const def = proposeTable(wb, { supplier: "Iberdrola", name: "Hoja de Precios", knowledge: detectSupplier(wb)?.pack.id }).def!;
    const read = applyTemplate(wb, def, { reference: { from: "2027-01-01", to: "2028-01-01" } });
    const offers = productsToOffers(read, def, { templateId: null, version: 1, fileName: "i.xlsx" });
    const omie = offers.filter((x) => /plan omie/i.test(x.offer.productName));
    expect(omie.length).toBeGreaterThan(0);
    for (const x of omie) {
      expect(x.offer.pricing).toMatchObject({ model: "INDEXED", feeAllowed: "no", feeEnabled: false });
      expect(x.offer.pricing!.supplierMarginEurMWh).toBe(x.offer.formula!.marginEurMWh);
      expect(applyPricing(x.offer)).toBe(x.offer);
      expect(tariffReview(x.offer).checks.some((c) => c.concept === "fee")).toBe(false); // no és cap pendent
    }
    // 3.0TD: quatre nivells, quatre productes, quatre marges fixats per Iberdrola
    const n30 = omie.filter((x) => x.offer.accessTariff === "3.0TD" && /OMIE \d/.test(x.offer.productName)).map((x) => [x.offer.productName, x.offer.pricing!.supplierMarginEurMWh]);
    expect(n30).toEqual([["3.0TD Plan OMIE 0", 34], ["3.0TD Plan OMIE 1", 27], ["3.0TD Plan OMIE 2", 20], ["3.0TD Plan OMIE 3", 10]]);
    // cap tarifa fixa d'Iberdrola es converteix a BASE + FEE sense evidències
    expect(offers.filter((x) => x.offer.pricing && x.offer.pricing.model !== "INDEXED")).toEqual([]);
    // Impulsa Negocios: P1–P5 promocionat i P6 no promocionat (regla existent intacta)
    const neg = read.products.find((p) => p.row === 68)!.interp!;
    expect(neg.energyFinal.slice(0, 6)).toEqual([0.1504, 0.1504, 0.1504, 0.1504, 0.1504, 0.3096]);
  });
  it("lector IA: ni la IA ni una regla apresa poden posar FEE a un Pla OMIE d'Iberdrola", () => {
    const rules: PricingReadingRule[] = [{ id: "r", kind: "pricing", title: "x", supplier: "Iberdrola", product: null, model: "INDEXED_BASE_FEE", feeAllowed: "si", version: 1, status: "aprovada" }];
    const r = aiTariffsToVersions({ offers: [{ supplierName: "Iberdrola", productName: "3.0TD Plan OMIE 3", energyType: "luz", accessTariff: "3.0TD", contractType: "indexat", power: [0.08, 0.07, 0.04, 0.03, 0.02, 0.01], powerUnit: "eur_kw_dia", pricingModel: "INDEXED_BASE_FEE", feeValue: 5, feeUnit: "€/MWh", supplierMarginValue: 0.01, supplierMarginUnit: "€/kWh" }] }, { fileName: "omie.pdf", existing: [], pricingRules: rules });
    expect(r.items[0].offer.pricing).toMatchObject({ model: "INDEXED", feeAllowed: "no", supplierMarginEurMWh: 10 });
  });
});

describe("lector: confirmació i aprenentatge del model de preu (amb versions)", () => {
  it("«Corregir amb IA» genera una regla estructurada de la comercialitzadora", () => {
    const r = parsePricingCorrection("Totes són preu base + FEE en €/MWh", { supplier: "Comercialitzadora Sintètica", productName: "Base X" });
    expect(r.rule).toMatchObject({ model: "FIXED_BASE_FEE", product: null, feeUnit: "eur_mwh", feeAllowed: "si" });
    expect(parsePricingCorrection("és indexada", { supplier: "S", productName: "Plan OMIE 3" }).rule).toMatchObject({ model: "INDEXED", product: "Plan OMIE 3" });
    expect(parsePricingCorrection("hola", { supplier: "S", productName: null }).rule).toBeNull();
  });
  it("la regla aprovada més específica i més recent mana; les proposades no s'apliquen", () => {
    const R = (p: Partial<PricingReadingRule>): PricingReadingRule => ({ id: "x", kind: "pricing", title: "t", supplier: "Comercialitzadora Sintètica", product: null, model: "FIXED_BASE_FEE", version: 1, status: "aprovada", ...p });
    const rules = [R({ id: "v1" }), R({ id: "v2", version: 2, model: "FIXED_FINAL" }), R({ id: "prod", product: "Especial", model: "INDEXED" }), R({ id: "prop", version: 9, status: "proposada" })];
    expect(pickPricingRule(rules, "Comercialitzadora Sintètica SL", "Plan Normal")!.id).toBe("v2");
    expect(pickPricingRule(rules, "Comercialitzadora Sintètica", "Plan Especial")!.id).toBe("prod");
    expect(pickPricingRule(rules, "Una Altra", "Plan Normal")).toBeNull();
  });
  it("una regla apresa aprovada s'aplica a la lectura següent (sense modificar res de retroactiu)", () => {
    const rules: PricingReadingRule[] = [{ id: "r1", kind: "pricing", title: "Sintètica: preu base + FEE (FEE en €/MWh)", supplier: "Comercialitzadora Sintètica", product: null, model: "FIXED_BASE_FEE", feeAllowed: "si", feeUnit: "eur_mwh", version: 1, status: "aprovada" }];
    const r = aiTariffsToVersions({ offers: [{ supplierName: "Comercialitzadora Sintètica", productName: "Plan Nou", energyType: "luz", accessTariff: "2.0TD", contractType: "periodes", energy: [0.13, 0.11, 0.08, null, null, null], power: [0.09, 0.03, null, null, null, null], powerUnit: "eur_kw_dia", feeValue: 10 }] }, { fileName: "nou.pdf", existing: [], pricingRules: rules });
    expect(r.items[0].offer.pricing).toMatchObject({ model: "FIXED_BASE_FEE" });
    expect(r.items[0].offer.pricing!.fee.single).toBeNull(); // el FEE no es desa mai al catàleg
    expect(r.items[0].offer.pricing!.detection!.evidence[0]).toMatch(/Regla de lectura apresa/);
  });
});

describe("propostes PDF i historial", () => {
  const company = { nombre: "Assessoria 3.0", telefono: "", email: "", web: "", direccion: "" };
  it("la proposta del client fa servir el preu final amb el FEE de la comparativa (sense desglossar base ni FEE)", () => {
    const cat = base30();
    const s = buildSnapshot({ mode: "manual", clientName: "Client Sintètic", supply: S30, current: null, offers: [cat], adjustments: { [cat.id]: { fee: unic(0.012) } } });
    const text = new TextDecoder("latin1").decode(new Uint8Array(renderComparisonPdf(s, { kind: "detallada", lang: "ca", recommendation: null, company, salesperson: null }).bytes));
    expect(text).toMatch(/0,162/);
    expect(text).not.toMatch(/Vista interna|Preu base|COMISSI/);
  });
  it("vista interna opcional: base, FEE, final, marge i comissió", () => {
    const cat = base30();
    const s = buildSnapshot({ mode: "manual", supply: S30, current: null, offers: [cat], adjustments: { [cat.id]: { fee: unic(0.012) } } });
    const rows = internalFeeRows(s, { [cat.id]: { amount: 600, formula: "50 % × 1.200 €" } });
    expect(rows[0]).toMatchObject({ model: "Preu fix base + FEE", base: "0,15 · 0,14 · 0,13 · 0,12 · 0,11 · 0,1", fee: "0,012 · 0,012 · 0,012 · 0,012 · 0,012 · 0,012", margin: 1200 });
  });
  it("les comparatives desades conserven la base, el FEE i els imports encara que el catàleg canviï", () => {
    const cat = base30();
    const saved = JSON.parse(JSON.stringify(buildSnapshot({ mode: "manual", supply: S30, current: null, offers: [cat], adjustments: { [cat.id]: { fee: unic(0.012) } } })));
    const newVersion = normalizePricing({ ...cat, version: 2, energy: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2], pricing: { ...cat.pricing!, baseEnergy: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2] } }).offer;
    expect(newVersion.energy[0]).toBe(0.2);
    expect(saved.offers[0].pricing.baseEnergy[0]).toBe(0.15);
    expect(saved.offers[0].energy[0]).toBe(0.162);
  });
});
