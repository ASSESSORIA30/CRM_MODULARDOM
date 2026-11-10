/**
 * Fase 15 · circuits de SERVIDOR (Supabase simulat en memòria): permisos reals al servidor, preu final recalculat,
 * FEE de la comparativa validat, portal del client sense dades internes, regles de remuneració i aprenentatge.
 * Totes les dades són sintètiques. «Provat amb simulació»: no s'ha executat contra el Supabase real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";
import { productKey } from "@/comparator/catalog";
import { buildSnapshot } from "@/comparator/snapshot";
import { emptyPricing, normalizePricing } from "@/comparator/pricing-model";
import { emptySheet, type OfferVersion } from "@/comparator/types";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => null };
});

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = (uid: string, role: string) => ({ sb: state.sb, user: { id: uid }, profile: { id: uid, name: role, role, email: `${role}@exemple.test`, code: null } }) as never;
const NEXT = `${new Date().getFullYear() + 1}-12-31`;

function feeOffer(n: number, p: Partial<OfferVersion> = {}): OfferVersion {
  const baseEnergy = [0.15, 0.14, 0.13, 0.12, 0.11, 0.1];
  return normalizePricing({
    ...emptySheet(), id: id(n), supplierId: "sup:sintetica", supplierName: "Comercialitzadora Sintètica", productId: id(100 + n), productName: `Base Fee ${n}`, version: 1,
    energyType: "luz", accessTariff: "3.0TD", segments: ["pyme"], contractType: "periodes", energy: [...baseEnergy], power: [0.08, 0.07, 0.04, 0.03, 0.02, 0.01], powerUnit: "eur_kw_dia",
    permanenceMonths: 12, permanence: { status: "amb", months: 12, startNote: null, cancellation: null, penalty: null, source: "sintètic", exception: null }, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12,
    eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: NEXT, source: "sintètic", publishedAt: null, status: "esborrany", conditions: null, origin: "manual",
    pricing: { ...emptyPricing("FIXED_BASE_FEE"), baseEnergy, recommendedFee: 0.012, contractMaxFee: 0.02 }, ...p,
  }).offer;
}
const gasOffer = (n: number, product: string, p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: id(n), supplierId: "sup:iberdrola", supplierName: "Iberdrola", productId: id(100 + n), productName: product, version: 1, energyType: "gas", accessTariff: "RL.1", segments: ["residencial"], contractType: "fix24h", energy24h: 0.06,
  gasFixedEurDay: null, units: { gasFixed: { value: 12, unit: "no indicada al document" }, formulas: [] }, permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12,
  eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: NEXT, source: "Plantilla «Hoja» v1", publishedAt: null, status: "esborrany", conditions: null, origin: "excel", ...p,
});

function seed(offers: OfferVersion[] = []) {
  state.sb = fakeSupabase({
    profiles: [{ id: ADMIN, name: "Direcció", role: "admin" }], tariff_suppliers: [], tariff_templates: [], tariff_rule_runs: [], tariff_unit_rules: [], sec_settings: [], retailers: [], fin_rules: [], tariff_rule_library: [], comparison_pricing_snapshots: [],
    tariff_products: offers.map((o) => ({ id: o.productId, supplier_id: o.supplierId, name: o.productName, energy_type: o.energyType, access_tariff: o.accessTariff, product_key: productKey(o) })),
    tariff_versions: offers.map((o) => ({ id: o.id, product_id: o.productId, version: 1, status: o.status, origin: o.origin === "manual" ? "manual" : "excel", data: o, used_at: null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Importació" })),
  } as never);
}
const row = (vid: string) => state.sb.db.tariff_versions.find((v) => v.id === vid)!;

describe("catàleg al servidor: permisos del FEE i preu final recalculat", () => {
  beforeEach(() => seed([feeOffer(1)]));
  it("al catàleg es desa NOMÉS el preu base: un FEE enviat pel navegador s'ignora i la tarifa s'activa sense FEE", async () => {
    const { saveVersion } = await import("@/server/tariffs");
    const o = feeOffer(1);
    const sent = { ...o, energy: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9], status: "activa" as const, pricing: { ...o.pricing!, fee: { mode: "unic" as const, single: 0.015, periods: Array(6).fill(null) }, feeEnabled: true } };
    const r = await saveVersion(user(ADMIN, "admin"), sent, { origin: "manual" });
    const data = row(r.id).data as OfferVersion;
    expect(data.energy).toEqual([0.15, 0.14, 0.13, 0.12, 0.11, 0.1]);
    expect(data.pricing!.fee.single).toBeNull();
    expect(r.status).toBe("activa");
    expect(row(r.id)).toMatchObject({ pricing_model: "FIXED_BASE_FEE", recommended_fee: 0.012 });
  });
  it("l'Administració NO pot canviar el FEE per defecte, el recomanat ni el model (403 al servidor)", async () => {
    const { saveVersion } = await import("@/server/tariffs");
    const o = feeOffer(1);
    await expect(saveVersion(user(id(50), "administrativa"), { ...o, pricing: { ...o.pricing!, recommendedFee: 0.03 } }, { origin: "manual" })).rejects.toThrow(/Només Direcció/);
    await expect(saveVersion(user(id(50), "cap_administrativa"), { ...o, pricing: { ...o.pricing!, model: "FIXED_FINAL" as const } }, { origin: "manual" })).rejects.toThrow(/Només Direcció/);
    // sí que pot editar altres camps sense tocar el FEE
    await expect(saveVersion(user(id(50), "administrativa"), { ...o, conditions: "Nota" }, { origin: "manual" })).resolves.toBeTruthy();
  });
  it("una importació de l'Administració actualitza els preus base i conserva el marge recomanat de Direcció", async () => {
    const { saveVersion } = await import("@/server/tariffs");
    const o = feeOffer(1);
    const reread = { ...o, id: "", energy: [0.16, 0.15, 0.14, 0.13, 0.12, 0.11], pricing: { ...o.pricing!, baseEnergy: [0.16, 0.15, 0.14, 0.13, 0.12, 0.11], recommendedFee: null } };
    const r = await saveVersion(user(id(50), "administrativa"), reread, { origin: "excel" });
    const data = row(r.id).data as OfferVersion;
    expect(data.pricing!.recommendedFee).toBe(0.012);
    expect(data.energy[0]).toBe(0.16); // preu base nou, sense FEE
    expect(data.status).toBe("esborrany");
  });
});

describe("comparador al servidor: FEE de la comparativa validat i portal del client sense dades internes", () => {
  it("permisos i polítiques: comercial sí; col·laborador no; ni negatiu, ni per sobre del màxim, ni en tarifes sense FEE", async () => {
    const { checkFeeAdjustments } = await import("@/server/comparisons");
    const o = feeOffer(1);
    const fixed = { ...feeOffer(2), pricing: null };
    const adj = (single: number, oid = o.id) => ({ offers: [o, fixed] as never, adjustments: { [oid]: { fee: { mode: "unic" as const, single, periods: [], inputUnit: "eur_kwh" as const } } } });
    expect(() => checkFeeAdjustments({ profile: { role: "comercial" } } as never, adj(0.018))).not.toThrow(); // supera el recomanat: només avís
    expect(() => checkFeeAdjustments({ profile: { role: "cap_equip" } } as never, adj(0.0))).not.toThrow(); // FEE zero
    expect(() => checkFeeAdjustments({ profile: { role: "colaborador" } } as never, adj(0.01))).toThrow(/permís/);
    expect(() => checkFeeAdjustments({ profile: { role: "comercial" } } as never, adj(-0.001))).toThrow(/negatiu/);
    expect(() => checkFeeAdjustments({ profile: { role: "comercial" } } as never, adj(0.025))).toThrow(/màxim contractual/);
    expect(() => checkFeeAdjustments({ profile: { role: "admin" } } as never, adj(0.01, fixed.id))).toThrow(/no és una tarifa BASE \+ FEE/);
  });
  it("el portal públic del client no rep el preu base, el FEE, el marge del proveïdor ni l'ajust", async () => {
    const { clientSafeSnapshot } = await import("@/server/comparisons");
    const o = feeOffer(1);
    const s = buildSnapshot({ mode: "manual", supply: { energyType: "luz", accessTariff: "3.0TD", territory: "peninsula", segment: "pyme", days: 365, basis: "anual", kwh: [1, 1, 1, 1, 1, 1], kwhTotal: 6, kw: [1, 1, 1, 1, 1, 1], meterRentEurMonth: 0 }, current: null, offers: [o], adjustments: { [o.id]: { fee: { mode: "unic", single: 0.015, periods: [], inputUnit: "eur_kwh" } } } });
    const safe = JSON.stringify(clientSafeSnapshot(s));
    expect(safe).not.toMatch(/"baseEnergy":\[0\.15/);
    expect(safe).not.toMatch(/"single":0\.01[25]/);
    expect(safe).not.toMatch(/"appliedFee":\[0/);
    expect(clientSafeSnapshot(s).offers[0].energy[0]).toBe(0.165); // el preu final (base + FEE de la comparativa) sí
  });
});

describe("comissions al servidor: regles de remuneració per comercialitzadora (fin_rules, capa proveïdor)", () => {
  beforeEach(() => seed());
  it("es llegeixen les regles amb model de remuneració i s'estima la comissió (mai el 100 % per defecte)", async () => {
    state.sb.db.fin_rules.push(
      { id: id(201), name: "Sintètica · 50 % del FEE", layer: "proveidor", retailer: "Comercialitzadora Sintètica", product: null, tariff_product_id: null, remuneration_model: "pct_fee", kind: "pct_marge", value: "50", conditions: {}, base_formula: "Σ consum × FEE", valid_from: "2020-01-01", valid_to: null, status: "aprovada" },
      { id: id(202), name: "Regla comercial (no és del proveïdor)", layer: "comercial", retailer: "Comercialitzadora Sintètica", product: null, remuneration_model: null, kind: "fix_contracte", value: "15", conditions: {}, valid_from: "2020-01-01", valid_to: null, status: "aprovada" },
    );
    const { remunerationRules } = await import("@/server/comparisons");
    const rules = await remunerationRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ model: "pct_fee", pct: 50, supplier: "Comercialitzadora Sintètica" });
  });
  it("el model de remuneració només s'admet a la capa proveïdor i amb el tipus coherent", async () => {
    const { saveRule } = await import("@/server/finance");
    const u = user(ADMIN, "admin");
    const base = { name: "x", retailer: "Sintètica", kind: "pct_marge", value: "50", conditions: {}, base_formula: "Σ consum × FEE", base_validated: true, valid_from: "2026-01-01" };
    await expect(saveRule(u as never, { ...base, layer: "comercial", remuneration_model: "pct_fee" })).rejects.toThrow(/capa/);
    await expect(saveRule(u as never, { ...base, layer: "proveidor", kind: "fix_contracte", remuneration_model: "pct_fee" })).rejects.toThrow(/tipus/);
  });
});

describe("aprenentatge al servidor: abast, versions i recuperació segura", () => {
  it("aprovar una regla de PRODUCTE no revoca la regla GENERAL de la comercialitzadora", async () => {
    seed([gasOffer(1, "RL.1 Especial 15%TF/TV"), gasOffer(2, "RL.2 Exclusivo 10%TF/TV", { accessTariff: "RL.2" })]);
    const { learnUnitRule, approveUnitRule } = await import("@/server/unit-rules");
    await learnUnitRule(user(ADMIN, "admin"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes" });
    const p = await learnUnitRule(user(id(60), "cap_administrativa"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes", product: "RL.9 Producte nou" });
    await approveUnitRule(user(ADMIN, "admin"), p.ruleId);
    const rules = state.sb.db.tariff_unit_rules as { product: string | null; status: string }[];
    expect(rules.find((r) => !r.product)!.status).toBe("aprovada");
    expect(rules.find((r) => r.product)!.status).toBe("aprovada");
  });
  it("Iberdrola gas: una sola instrucció → totes les tarifes afectades recalculades i validades amb informe real", async () => {
    seed([gasOffer(1, "RL.1 Especial 15%TF/TV"), gasOffer(2, "RL.2 Exclusivo 10%TF/TV", { accessTariff: "RL.2" }), gasOffer(3, "RL.3 Especial 15%TF/TV", { accessTariff: "RL.3", energy24h: null })]);
    const { learnUnitRule } = await import("@/server/unit-rules");
    const r = await learnUnitRule(user(ADMIN, "admin"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes", instruction: "Totes les tarifes de gas d'Iberdrola tenen el terme fix expressat en €/mes" });
    expect(r.report).toMatchObject({ affected: 3, reprocessed: 3, validated: 2, completed: true });
    expect(r.report.pending).toHaveLength(1);
    expect(r.report.pending[0].reasons.join()).toMatch(/Terme variable: falta el preu/);
    expect((row(id(1)).data as OfferVersion).gasFixedEurDay).toBeCloseTo(0.394521, 6);
    expect(row(id(1)).status).toBe("activa");
  });
  it("recuperació segura: si una tarifa falla en reprocessar, la resta continua i el xat diu que NO s'ha aplicat del tot", async () => {
    seed([gasOffer(1, "RL.1 Especial 15%TF/TV"), gasOffer(4, "RL.4 Malmesa", { segments: [] as never })]);
    const { learnUnitRule } = await import("@/server/unit-rules");
    const r = await learnUnitRule(user(ADMIN, "admin"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes" });
    expect(r.report.failed).toHaveLength(1);
    expect(r.report.completed).toBe(false);
    expect(r.text).toMatch(/NO aplicada del tot/);
    expect(row(id(1)).status).toBe("activa");
    expect(state.sb.db.tariff_rule_runs[0]).toMatchObject({ status: "amb_errors", failed: 1 });
  });
  it("regles del model de preu: versions (la nova aprovada substitueix l'anterior) i proposades per a l'Administració", async () => {
    seed();
    const { learnPricingRule, listPricingRules } = await import("@/server/tariff-templates");
    const d = { supplier: "Comercialitzadora Sintètica", product: null, title: "preu base + FEE", model: "FIXED_BASE_FEE", feeAllowed: "si", feeUnit: "eur_mwh" };
    const a = await learnPricingRule(user(ADMIN, "admin"), d);
    const b = await learnPricingRule(user(ADMIN, "admin"), { ...d, title: "preu final", model: "FIXED_FINAL" });
    const c = await learnPricingRule(user(id(70), "administrativa"), { ...d, title: "proposta" });
    expect([a.version, b.version, c.version]).toEqual([1, 2, 3]);
    expect(c.status).toBe("proposada");
    const lib = state.sb.db.tariff_rule_library as { status: string; rule: { version: number } }[];
    expect(lib.map((x) => `${x.rule.version}:${x.status}`)).toEqual(["1:substituida", "2:aprovada", "3:proposada"]);
    const { rules } = await listPricingRules(user(ADMIN, "admin"), {});
    expect(rules.filter((r) => r.status === "aprovada").map((r) => r.model)).toEqual(["FIXED_FINAL"]);
    await expect(learnPricingRule(user(id(71), "comercial"), d)).rejects.toThrow(/administració/);
  });
});
