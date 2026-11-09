/**
 * Millores 3.0 · Excedents solars a les comparatives: preu manual prioritari, límits, bateria virtual,
 * costos homogenis i mateix resultat a la pantalla (surplusView) i al PDF (comparisonSheet).
 * Totes les dades són fictícies.
 */
import { describe, expect, it, vi } from "vitest";
import { computeCost } from "@/comparator/engine";
import { buildSnapshot, presentationOrder } from "@/comparator/snapshot";
import { surplusView, surplusWarnings, compensatedKwhOf, monthlyOf } from "@/comparator/surplus-view";
import { comparisonSheet } from "@/comparator/sheet-view";
import { applyAdjustment, manualSurplus } from "@/comparator/catalog";
import { emptySheet, emptySurplus, type OfferVersion, type PriceSheet, type SupplyInput, type SurplusConfig } from "@/comparator/types";

vi.mock("server-only", () => ({}));

const TODAY = new Date().toISOString().slice(0, 10);
const NEXT = `${Number(TODAY.slice(0, 4)) + 1}-12-31`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = (n: number, p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: uuid(n), supplierId: "s", supplierName: `Comercialitzadora ${n}`, productId: `prod-${n}`, productName: `Tarifa ${n}`, version: 1,
  energyType: "luz", accessTariff: "2.0TD", segments: ["residencial", "pyme"], contractType: "periodes",
  energy: [0.2, 0.15, 0.1, null, null, null], power: [0.1, 0.05, null, null, null, null], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12,
  eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: NEXT, source: "Prova", publishedAt: null, status: "activa", conditions: null, origin: "manual", ...p,
});
const supply = (p: Partial<SupplyInput> = {}): SupplyInput => ({ energyType: "luz", accessTariff: "2.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [1000, 800, 1200, null, null, null], kwhTotal: 3000, kw: [4.6, 4.6, null, null, null, null], meterRentEurMonth: null, residentialLowPower: false, ...p });
const withSurplus = (kwh: number | null, p: Partial<NonNullable<SupplyInput["surplus"]>> = {}) => supply({ surplus: { kwhTotal: kwh, monthly: null, byPeriod: null, currentCompensationEur: null, currentMode: null, battery: false, batteryBalanceEur: null, estimated: false, ...p } });
const sur = (mode: SurplusConfig["mode"], p: Partial<SurplusConfig> = {}): SurplusConfig => ({ ...emptySurplus(mode), ...p });
const current = (p: Partial<PriceSheet> = {}): PriceSheet => ({ ...emptySheet(), energy: [0.22, 0.17, 0.12, null, null, null], power: [0.11, 0.06, null, null, null, null], ...p });

describe("preu manual d'excedents d'una comparativa", () => {
  it("té prioritat sobre el catàleg i no modifica la tarifa original", () => {
    const o = offer(1, { surplus: sur("fix", { eurKwh: 0.03 }) });
    const adj = applyAdjustment(o, { surplus: { eurKwh: 0.06 } });
    expect(adj.surplus).toMatchObject({ mode: "fix", eurKwh: 0.06, source: "ajust" });
    expect(o.surplus!.eurKwh).toBe(0.03); // el catàleg no canvia
    const c = computeCost(adj, withSurplus(1000));
    expect(c.surplus!.compensationEur).toBe(60);
    expect(c.surplus!.manual).toBe(true);
    expect(c.surplus!.note).toMatch(/preu manual/);
  });

  it("canviar el preu manual canvia el cost total i el rànquing de les tres ofertes", () => {
    const s = withSurplus(2000);
    const offers = [offer(11, { surplus: sur("fix", { eurKwh: 0.05 }) }), offer(12, { energy: [0.195, 0.145, 0.095, null, null, null], surplus: sur("fix", { eurKwh: 0.02 }) }), offer(13, { surplus: sur("sense") })];
    const base = buildSnapshot({ mode: "manual", supply: s, current: current({ surplus: sur("fix", { eurKwh: 0.04 }) }), offers }, TODAY);
    const cheapest = (snap: typeof base) => [...snap.result.evaluations].sort((a, b) => a.cost.total - b.cost.total)[0].offer.id;
    expect(cheapest(base)).toBe(uuid(11));
    // preu manual alt a l'oferta 12 → passa a ser la més econòmica
    const manual = buildSnapshot({ mode: "manual", supply: s, current: current({ surplus: sur("fix", { eurKwh: 0.04 }) }), offers, adjustments: { [uuid(12)]: { surplus: { eurKwh: 0.09 } } } }, TODAY);
    expect(cheapest(manual)).toBe(uuid(12));
    const e12 = (snap: typeof base) => snap.result.evaluations.find((e) => e.offer.id === uuid(12))!;
    expect(e12(manual).cost.surplus!.compensationEur).toBe(180);
    expect(e12(manual).cost.total).toBeLessThan(e12(base).cost.total);
    expect(e12(manual).saving!).toBeGreaterThan(e12(base).saving!);
    // la versió del catàleg es conserva per reobrir sense aplicar dues vegades l'ajust
    expect(manual.baseOffers!.find((o) => o.id === uuid(12))!.surplus!.eurKwh).toBe(0.02);
    expect(manual.adjustments![uuid(12)].surplus!.eurKwh).toBe(0.09);
  });

  it("«no compensa» aplica 0 €/kWh", () => {
    const c = computeCost(applyAdjustment(offer(2, { surplus: sur("fix", { eurKwh: 0.05 }) }), { surplus: { eurKwh: null, noCompensation: true } }), withSurplus(1000));
    expect([c.surplus!.status, c.surplus!.priceEurKwh, c.surplus!.compensationEur, compensatedKwhOf(c.surplus)]).toEqual(["no_compensa", 0, 0, 0]);
  });

  it("un ajust buit no altera res (es torna al catàleg)", () => {
    const o = offer(3, { surplus: sur("fix", { eurKwh: 0.05 }) });
    expect(applyAdjustment(o, { surplus: { eurKwh: null } })).toBe(o);
    expect(applyAdjustment(o, { surplus: null })).toBe(o);
  });

  it("es manté la bateria virtual del catàleg: el sobrant va al saldo, no a la factura", () => {
    const o = offer(4, { surplus: sur("bateria", { eurKwh: 0.05, battery: { enabled: true, feeEurMonth: 1.5, accumulation: null, usage: null, expiry: null } }) });
    const cfg = manualSurplus(o.surplus!, { eurKwh: 0.2 });
    expect(cfg.mode).toBe("bateria");
    const c = computeCost(applyAdjustment(o, { surplus: { eurKwh: 0.2 } }), withSurplus(10_000));
    expect(c.surplus!.limited).toBe(true);
    expect(c.surplus!.compensationEur).toBeLessThanOrEqual(c.energy);
    expect(c.surplus!.toBatteryEur).toBeGreaterThan(0);
    expect(c.surplus!.lostEur).toBe(0);
    expect(c.surplus!.batteryFeeEur).toBe(18);
    expect(c.surplus!.compensationEur + c.surplus!.toBatteryEur).toBeCloseTo(2000, 2);
  });
});

describe("límits i kWh compensats", () => {
  it("sense bateria, la compensació no supera el terme d'energia i els kWh compensats són menys que els injectats", () => {
    const c = computeCost(offer(20, { surplus: sur("fix", { eurKwh: 0.1 }) }), withSurplus(10_000));
    expect(c.surplus!.compensationEur).toBe(c.energy);
    expect(c.surplus!.compensatedKwh!).toBeLessThan(10_000);
    expect(c.surplus!.compensatedKwh).toBe(Math.floor((10_000 * c.energy) / 1000));
    expect(c.surplus!.lostEur).toBeGreaterThan(0);
    expect(c.surplus!.note).toMatch(/Límit aplicat sobre el total del període/);
  });
  it("l'energia de xarxa no es barreja amb l'excedentària", () => {
    const a = computeCost(offer(21, { surplus: sur("fix", { eurKwh: 0.05 }) }), withSurplus(500));
    const b = computeCost(offer(21), supply());
    expect(a.energy).toBe(b.energy); // el terme d'energia (consum de xarxa) no canvia
    expect(a.surplus!.kwh).toBe(500);
  });
  it("estalvi mensual equivalent", () => {
    expect(monthlyOf(120, 365)).toBe(10);
    expect(monthlyOf(30, 30)).toBeCloseTo(30.42, 2);
    expect(monthlyOf(null, 365)).toBeNull();
  });
});

describe("costos homogenis i dades pendents", () => {
  it("preu manual del contracte actual: també es descompta i l'estalvi no compta dues vegades la compensació", () => {
    const s = withSurplus(1000);
    const offers = [offer(30, { energy: [0.22, 0.17, 0.12, null, null, null], power: [0.11, 0.06, null, null, null, null], surplus: sur("fix", { eurKwh: 0.05 }) })];
    // mateixos preus i mateixa compensació → estalvi zero
    const snap = buildSnapshot({ mode: "manual", supply: s, current: current({ surplus: { ...sur("fix", { eurKwh: 0.05 }), source: "ajust" } }), offers }, TODAY);
    expect(snap.result.current!.surplus!.compensationEur).toBe(50);
    expect(snap.result.evaluations[0].saving).toBe(0);
    expect(surplusWarnings(snap)).toEqual([]);
  });
  it("si el contracte actual no té la compensació quantificada, s'avisa que l'estalvi no és homogeni (pantalla i PDF)", () => {
    const snap = buildSnapshot({ mode: "manual", supply: withSurplus(1000), current: current(), offers: [offer(31, { surplus: sur("fix", { eurKwh: 0.05 }) })] }, TODAY);
    const w = surplusWarnings(snap);
    expect(w[0]).toMatch(/no està quantificada/);
    expect(surplusView(snap)!.notes).toContain(w[0]);
    expect(comparisonSheet(snap).notes).toContain(w[0]);
  });
  it("té excedents però falten els kWh: càlcul pendent, cap compensació inventada", () => {
    const snap = buildSnapshot({ mode: "manual", supply: withSurplus(null), current: current(), offers: [offer(32, { surplus: sur("fix", { eurKwh: 0.05 }) })] }, TODAY);
    expect(snap.result.evaluations[0].cost.surplus ?? null).toBeNull();
    expect(surplusWarnings(snap)[0]).toMatch(/falten els kWh/);
    expect(comparisonSheet(snap).notes.join(" ")).toMatch(/falten els kWh/);
  });
});

describe("mateix resultat a la pantalla, al PDF i a la comparativa desada", () => {
  const s = withSurplus(1500);
  const offers = [offer(40, { surplus: sur("fix", { eurKwh: 0.04 }) }), offer(41, { surplus: sur("sense") }), offer(42, { surplus: sur("bateria", { eurKwh: 0.05, battery: { enabled: true, feeEurMonth: 1, accumulation: null, usage: null, expiry: null } }) })];
  const input = { mode: "manual" as const, supply: s, current: current({ surplus: sur("fix", { eurKwh: 0.03 }) }), offers, adjustments: { [uuid(40)]: { surplus: { eurKwh: 0.07 } } } };
  const snap = buildSnapshot(input, TODAY);

  it("la taula de pantalla té les files demanades i coincideix amb el PDF", () => {
    const v = surplusView(snap)!;
    const labels = v.rows.map((r) => r.label);
    for (const l of ["Preu excedents €/kWh", "Excedents compensats kWh", "Compensació aplicada €", "Cost final anual", "Estalvi anual", "Estalvi mensual"]) expect(labels).toContain(l);
    const sheet = comparisonSheet(snap);
    const block = sheet.blocks.find((b) => b.id === "excedents")!;
    expect(block.kind).toBe("values");
    const rows = (block as { rows: { label: string; values: string[] }[] }).rows;
    const scr = v.rows.find((r) => r.label === "Compensació aplicada €")!.cells;
    const pdf = rows.find((r) => r.label === "Import compensat")!.values;
    const alts = presentationOrder(snap);
    // mateix import a cada columna (format diferent: «−X €» a pantalla, «−X» al PDF)
    [snap.result.current, ...alts.map((e) => e.cost)].forEach((c, i) => {
      const amount = c!.surplus!.compensationEur;
      expect(scr[i].replace(/[^\d,]/g, "")).toBe(pdf[i] === "0,00" ? "0,00" : pdf[i].replace(/[^\d,]/g, ""));
      expect(amount).toBeGreaterThanOrEqual(0);
    });
    // totals: mateix número a la pantalla (snapshot) i al PDF
    expect(sheet.totals.values).toEqual([snap.result.current!.total, ...alts.map((e) => e.cost.total)]);
    expect(sheet.savings.values.slice(1)).toEqual(alts.map((e) => e.saving));
  });

  it("la comparativa desada (JSON) dona el mateix resultat en reobrir-la", () => {
    const reopened = JSON.parse(JSON.stringify(snap));
    const again = buildSnapshot({ ...input, offers: reopened.baseOffers, adjustments: reopened.adjustments }, TODAY);
    expect(again.result.evaluations.map((e) => [e.offer.id, e.cost.total, e.saving])).toEqual(snap.result.evaluations.map((e) => [e.offer.id, e.cost.total, e.saving]));
    expect(again.result.evaluations.find((e) => e.offer.id === uuid(40))!.cost.surplus!.priceEurKwh).toBe(0.07);
  });
});
