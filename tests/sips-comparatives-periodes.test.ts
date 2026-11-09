/**
 * SIPS → COMPARATIVES IA: consums P1–P6, potències i procedència de cada dada. Dades fictícies (no són clients reals).
 * Reprodueix el cas de la fitxa 360: el total anual del CRM no coincideix amb la finestra del resum SIPS i abans es
 * perdien tots els períodes.
 */
import { describe, expect, it } from "vitest";
import { proposalAutofill } from "@/energy/lib/proposal-autofill";
import { annualFromEasSummary, comparatorConsumption, type AnnualConsumption } from "@/energy/lib/sips-consumption";
import type { SipsSummary } from "@/energy/lib/sips-record";
import { checkTotal, fromAggregate, kwhKey, kwKey, markManual, originOf, stamp, type Provenance } from "@/comparator/provenance";
import { period20, periodsFromHourly } from "@/comparator/hourly-periods";
import { buildSnapshot } from "@/comparator/snapshot";
import { emptySheet, type OfferVersion, type SupplyInput } from "@/comparator/types";

const supply = (p: Partial<SupplyInput> = {}): SupplyInput => ({ energyType: "luz", accessTariff: "2.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: Array(6).fill(null), kwhTotal: null, kw: Array(6).fill(null), meterRentEurMonth: null, residentialLowPower: false, ...p });
const reading = (periods: number[], from = "2025-07-01", to = "2026-06-30"): AnnualConsumption => ({ status: "complete", from, to, lastAvailable: null, periods, total: Math.round(periods.reduce((a, b) => a + b, 0) * 1000) / 1000, annualListTotal: null, difference: null, warning: null, source: "EAS · ResumenConsumosU12M", basis: "provider_summary" });
const entry = (tariff: string, periods: number[] | null, kw: (number | null)[], p: Partial<SipsSummary> = {}): SipsSummary => ({
  cups: "ES0000000000000000AA", returned_cups: "ES0000000000000000AA0F", annual_kwh: periods ? periods.reduce((a, b) => a + b, 0) + 37 : 5000, tariff, address: "Adreça de prova", status: "found",
  consulted_at: "2026-11-05T09:30:00.000Z", energy_type: "luz", contracted_power_kw: kw, annual_consumption: periods ? reading(periods) : null, ...p,
});

describe("1 · traspàs SIPS → comparativa (totes les tarifes)", () => {
  it("2.0TD des de la fitxa 360: el total del CRM no coincideix i, tot i així, arriben P1, P2, P3 i les potències P1–P2", () => {
    // fitxa 360: total anual i potències desats al CRM (abans arribaven marcats «manual» i bloquejaven els períodes)
    const cur = supply({ kwhTotal: 3400, kw: [4.6, 4.6, null, null, null, null] });
    const r = proposalAutofill(entry("2.0TD", [850, 920, 1503.09], [4.6, 4.6]), cur, { kwhTotal: "crm", kw: "crm", tariff: "crm" });
    expect(r.supply.kwh).toEqual([850, 920, 1503.09, null, null, null]);
    expect(r.supply.kwhTotal).toBe(3273.09);
    expect(r.supply.kw.slice(0, 2)).toEqual([4.6, 4.6]);
    expect([r.supply.periodFrom, r.supply.periodTo]).toEqual(["2025-07-01", "2026-06-30"]);
    for (const k of [kwhKey(0), kwhKey(1), kwhKey(2), "kwhTotal", kwKey(0), kwKey(1)] as const) expect(r.provenance[k]?.origin).toBe("sips");
    expect(r.provenance[kwhKey(0)].at).toBe("2026-11-05T09:30:00.000Z");
    // el total del CRM queda com a valor original (traçabilitat)
    expect(r.provenance.kwhTotal.original).toBeNull(); // el CRM no tenia procedència per camp en aquest cas
  });
  it("3.0TD i 6.1TD: P1–P6 i potències P1–P6", () => {
    const p6 = [1629, 1958.168, 1377.043, 1324, 750, 5842.789];
    for (const t of ["3.0TD", "6.1TD"]) {
      const r = proposalAutofill(entry(t, p6, [40, 40, 40, 40, 40, 50]), supply({ accessTariff: t }), {});
      expect(r.supply.kwh).toEqual(p6);
      expect(r.supply.kwhTotal).toBe(12881);
      expect(r.supply.kw).toEqual([40, 40, 40, 40, 40, 50]);
      expect(Array.from({ length: 6 }, (_, i) => r.provenance[kwhKey(i)].origin)).toEqual(Array(6).fill("sips"));
      expect(checkTotal(r.supply, 6, r.provenance).status).toBe("ok");
    }
  });
  it("un total editat a mà no es trepitja: arriben els períodes i la validació avisa de la diferència", () => {
    const r = proposalAutofill(entry("2.0TD", [850, 920, 1503.09], [4.6, 4.6]), supply({ kwhTotal: 4000 }), { kwhTotal: "manual" }, stamp({}, { kwhTotal: 4000 }, { origin: "manual" }));
    expect(r.supply.kwh.slice(0, 3)).toEqual([850, 920, 1503.09]);
    expect(r.supply.kwhTotal).toBe(4000);
    expect(r.provenance.kwhTotal.origin).toBe("manual");
    expect(r.notes.join(" ")).toMatch(/no coincideix/);
    const c = checkTotal(r.supply, 3, r.provenance);
    expect(c.status).toBe("difereix");
    expect(c.message).toMatch(/Manual.*SIPS.*finestres/);
  });
  it("uns períodes editats a mà o d'una factura no se substitueixen en segon pla", () => {
    for (const src of ["manual", "factura"] as const) {
      const cur = supply({ kwh: [100, 200, 300, null, null, null] });
      const r = proposalAutofill(entry("2.0TD", [850, 920, 1503.09], [4.6, 4.6]), cur, { kwh: src });
      expect(r.supply.kwh.slice(0, 3)).toEqual([100, 200, 300]);
    }
  });
  it("només el total (sense desglossament SIPS): no s'inventa cap repartiment ni cap procedència als períodes", () => {
    const r = proposalAutofill(entry("3.0TD", null, [30, 30, 30, 30, 30, 30], { annual_kwh: 25000 }), supply({ accessTariff: "3.0TD" }), {});
    expect(r.supply.kwh).toEqual(Array(6).fill(null));
    expect(r.supply.kwhTotal).toBe(25000);
    expect(Object.keys(r.provenance).filter((k) => k.startsWith("kwh") && k !== "kwhTotal")).toEqual([]);
    expect(checkTotal(r.supply, 6).status).toBe("nomes_total");
    expect(r.notes.join(" ")).toMatch(/no s'inventa/);
  });
  it("gas: un únic consum, sense potències", () => {
    const r = proposalAutofill(entry("RL.2", null, [null], { energy_type: "gas", annual_kwh: 9000 }), supply({ energyType: "gas", accessTariff: "RL.2" }), {});
    expect(r.supply.kwh[0]).toBe(9000);
    expect(r.provenance.kwh1.origin).toBe("sips");
  });
});

describe("2 · resum EAS: un total mensual absent ja no descarta períodes reals", () => {
  it("P1–P3 i finestra complets sense EActivaMes → desglossament vàlid amb avís", () => {
    const m = (v: number) => Array(12).fill(v / 12);
    const raw = { EActivaMesP1: m(1200), EActivaMesP2: m(1200), EActivaMesP3: m(2400), "Año1": 2025, Mes1: 7, "Año12": 2026, Mes12: 6 };
    const a = annualFromEasSummary(raw, 3, null);
    expect(a.status).toBe("complete");
    expect(a.periods).toEqual([1200, 1200, 2400]);
    expect(a.warning).toMatch(/total mensual/);
    expect(comparatorConsumption(a, "2.0TD")?.kwh.slice(0, 3)).toEqual([1200, 1200, 2400]);
  });
  it("una discrepància interna continua bloquejant (no es traspassa com a dada validada)", () => {
    const m = (v: number) => Array(12).fill(v / 12);
    const a = annualFromEasSummary({ EActivaMesP1: m(1000), EActivaMesP2: m(1000), EActivaMesP3: m(1000), EActivaMes: m(5000), "Año1": 2025, Mes1: 7, "Año12": 2026, Mes12: 6 }, 3, null);
    expect(a.status).toBe("incomplete");
    expect(comparatorConsumption(a, "2.0TD")).toBeNull();
  });
});

describe("3 · procedència per camp", () => {
  it("SIPS → l'usuari el modifica → «Manual», amb el valor i la font originals conservats", () => {
    let p: Provenance = stamp({}, { kwh1: 850 }, { origin: "sips", at: "2026-11-05T09:30:00.000Z", source: "SIPS" });
    p = markManual(p, kwhKey(0), 900, "2026-11-06T10:00:00.000Z");
    expect(p.kwh1).toMatchObject({ origin: "manual", value: 900, original: { origin: "sips", value: 850, at: "2026-11-05T09:30:00.000Z" } });
    // una segona edició manté l'original del SIPS (no el valor manual intermedi)
    p = markManual(p, kwhKey(0), 910);
    expect(p.kwh1.original).toMatchObject({ origin: "sips", value: 850 });
    // un camp buit no mostra procedència
    expect(originOf(p, kwhKey(1), null)).toBeNull();
    expect(originOf(p, kwhKey(0), null)).toBeNull();
  });
  it("cada camp té la seva procedència: P1 manual, P2 SIPS", () => {
    let p = stamp({}, { kwh1: 850, kwh2: 920 }, { origin: "sips" });
    p = markManual(p, kwhKey(0), 1000);
    expect([p.kwh1.origin, p.kwh2.origin]).toEqual(["manual", "sips"]);
  });
  it("esborranys antics (procedència agregada) → per camp, sense inventar dates", () => {
    const p = fromAggregate(supply({ kwh: [1, 2, 3, null, null, null], kw: [4.6, 4.6, null, null, null, null], kwhTotal: 6 }), { kwh: "sips", kw: "factura", kwhTotal: "calculat" });
    expect([p.kwh1.origin, p.kwh3.origin, p.kw1.origin, p.kwhTotal]).toEqual(["sips", "sips", "factura", undefined]);
    expect(p.kwh1.at).toBeNull();
    expect(p.kwh4).toBeUndefined();
  });
  it("la procedència es conserva al snapshot de la comparativa (PDF i reobertura) i no altera el càlcul", () => {
    const s = supply({ kwh: [850, 920, 1503.09, null, null, null], kwhTotal: 3273.09, kw: [4.6, 4.6, null, null, null, null] });
    const prov = stamp({}, { kwh1: 850, kwh2: 920, kwh3: 1503.09 }, { origin: "sips" });
    const offer: OfferVersion = { ...emptySheet(), contractType: "periodes", energy: [0.2, 0.15, 0.1, null, null, null], power: [0.1, 0.02, null, null, null, null], id: "o1", supplierId: "s", supplierName: "Prova", productId: "p", productName: "Prova 3 preus", version: 1, energyType: "luz", accessTariff: "2.0TD", segments: ["residencial"], permanenceMonths: null, penalty: null, durationMonths: null, priceGuaranteeMonths: null, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: null, validTo: null, source: null, publishedAt: null, status: "activa", conditions: null, origin: "manual" };
    const a = buildSnapshot({ mode: "cups", supply: s, current: null, offers: [offer], provenance: prov }, "2026-11-06");
    const b = buildSnapshot({ mode: "cups", supply: s, current: null, offers: [offer] }, "2026-11-06");
    expect(a.provenance?.kwh1.origin).toBe("sips");
    expect(a.supply.kwh).toEqual(s.kwh);
    expect(a.result.evaluations[0].cost?.total).toBe(b.result.evaluations[0].cost?.total);
  });
});

describe("4 · validació del total", () => {
  it("2.0TD: total = P1 + P2 + P3, amb tolerància d'arrodoniment", () => {
    expect(checkTotal({ kwh: [850, 920, 1503.09, null, null, null], kwhTotal: 3273.09 }, 3).status).toBe("ok");
    expect(checkTotal({ kwh: [850, 920, 1503.09, null, null, null], kwhTotal: 3273.6 }, 3).status).toBe("ok");
    expect(checkTotal({ kwh: [850, 920, 1503.09, null, null, null], kwhTotal: 3300 }, 3).status).toBe("difereix");
  });
  it("3.0TD/6.1TD: total = P1 + … + P6; períodes incomplets → no es pot comprovar", () => {
    expect(checkTotal({ kwh: [1, 2, 3, 4, 5, 6], kwhTotal: 21 }, 6).status).toBe("ok");
    expect(checkTotal({ kwh: [1, 2, 3, null, null, null], kwhTotal: 21 }, 6).status).toBe("incomplet");
  });
});

describe("5 · corba horària → consums per períodes (calendari tarifari)", () => {
  it("2.0TD: laborable 10–14 h P1, 8–10 h P2, 0–8 h P3; cap de setmana i festius P3", () => {
    const hol = new Set(["2026-12-08"]);
    expect([period20("2026-11-04", 11, hol), period20("2026-11-04", 9, hol), period20("2026-11-04", 3, hol), period20("2026-11-07", 11, hol), period20("2026-12-08", 11, hol)]).toEqual([1, 2, 3, 3, 3]);
  });
  it("2.0TD: un dia laborable sencer d'1 kWh/h → P1 8, P2 8, P3 8 kWh; total = suma", () => {
    const rows = Array.from({ length: 24 }, (_, h) => ({ date: "2026-11-04", hour: h, kwh: 1 }));
    const r = periodsFromHourly(rows, "2.0TD")!;
    expect([r.kwh, r.total, r.periods]).toEqual([[8, 8, 8], 24, 3]);
    expect(r.warnings.join(" ")).toMatch(/1 dies/);
  });
  it("3.0TD: gener laborable → P1 (punta) i P2 (pla), P6 la resta; diumenge tot P6", () => {
    const day = (date: string) => Array.from({ length: 24 }, (_, h) => ({ date, hour: h, kwh: 1 }));
    const r = periodsFromHourly([...day("2026-01-14"), ...day("2026-01-18")], "3.0TD")!;
    expect(r.kwh).toEqual([9, 7, 0, 0, 0, 32]);
    expect(r.total).toBe(48);
  });
  it("una tarifa sense calendari conegut no es reparteix", () => {
    expect(periodsFromHourly([{ date: "2026-01-14", hour: 1, kwh: 1 }], "RL.1")).toBeNull();
  });
});
