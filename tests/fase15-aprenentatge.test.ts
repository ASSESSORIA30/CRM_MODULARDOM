/**
 * Fase 15 · «ENSENYAR A LA IA» persistent i efectiu: correcció del cas real «Iberdrola · gas · terme fix en €/mes».
 * Fan servir l'Excel real d'Iberdrola de les proves (només preus de tarifes, sense dades personals) i, per al cas
 * «RL.1 Especial 15%TF/TV» amb 12 €/mes, un CAS SINTÈTIC identificat com a tal (no és un valor comercial real).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyTemplate, gridFromXlsx, productsToOffers, type TemplateDef } from "@/comparator/xlsx-template";
import { proposeTable, type ReadingRule } from "@/comparator/tariff-table";
import { detectSupplier } from "@/comparator/reading-knowledge";
import { parseRuleChat, withApprovedRules, withScope } from "@/comparator/reading-rules";
import { applyUnitRules, ruleMatches, unitRulesAsReadingRules, type UnitRule } from "@/comparator/unit-rules";
import { normalizeOffer } from "@/comparator/tariff-engine";
import { tariffReview } from "@/comparator/review-state";
import { emptySheet, type OfferVersion } from "@/comparator/types";

const wb = gridFromXlsx(XLSX as never, readFileSync("tests/fixtures/iberdrola/IBERDROLA_HASTA_15.11.xlsx"), "IBERDROLA_HASTA_15.11.xlsx");
const def = proposeTable(wb, { supplier: "Iberdrola", name: "Hoja de Precios", knowledge: detectSupplier(wb)?.pack.id }).def!;
const REF = { reference: { from: "2027-01-01", to: "2028-01-01" } };
const base = applyTemplate(wb, def, REF);
const GAS_ROWS = [110, 111, 112, 113, 114, 115]; // RL.1–RL.3 Exclusivo / Especial (no indexades)
const status = (r: ReturnType<typeof applyTemplate>, row: number) => r.products.find((p) => p.row === row)!.interp!;
const INSTRUCCIO = "Totes les tarifes de gas d'Iberdrola tenen el terme fix expressat en €/mes";
const chat = parseRuleChat(INSTRUCCIO, { product: null, products: base.products, last: null, supplier: "Iberdrola" });
const general: ReadingRule = { ...withScope(chat.rule!, "general", null), approved: true, approvedBy: "Direcció" };

describe("diagnòstic i correcció: la regla general no la torna a tapar la regla de coneixement", () => {
  it("ara: la unitat €/mes del gas d'Iberdrola és coneixement aprovat per Direcció (no cal tornar-la a ensenyar)", () => {
    for (const r of GAS_ROWS) {
      const it = status(base, r);
      expect(it.status).toBe("interpretada");
      expect(it.checks!.find((c) => c.concept === "terme_fix")!.detail).toBe("validat (€/mes)");
    }
    // sense aquesta regla (definició sense coneixement d'Iberdrola), la unitat continua pendent: no s'inventa
    const bare = applyTemplate(wb, { ...def, knowledge: null }, REF);
    expect(status(bare, 110).checks!.find((c) => c.concept === "terme_fix")!.ok).toBe(false);
  });
  it("el xat entén la instrucció com a regla GENERAL de la comercialitzadora (no només d'una plantilla)", () => {
    expect(chat.understood).toBe(true);
    expect(chat.rule).toMatchObject({ scope: "general", set: { gasFixedUnit: "eur_mes" }, match: { energyType: "gas" } });
    expect(chat.reply).toMatch(/€\/mes.*regla general/);
  });
  it("després: una regla GENERAL aprovada (abast «general», que s'aplica abans) treu l'estat pendent de totes", () => {
    // causa real: la regla general s'aplicava ABANS que la de coneixement «gas-terme-fix» (abast plantilla), que
    // tornava a posar l'avís «cal confirmar la unitat». Ara l'avís es resol per concepte (reviewConcern).
    const after = applyTemplate(wb, def, { ...REF, extraRules: [general] });
    for (const r of GAS_ROWS) {
      expect(status(after, r).status).toBe("interpretada");
      expect(status(after, r).checks!.every((c) => c.ok)).toBe(true);
    }
  });
  it("una regla PROPOSADA (sense aprovar) no amaga res: la tarifa queda «pendent d'aprovació» amb el motiu", () => {
    const after = applyTemplate(wb, def, { ...REF, extraRules: [{ ...general, approved: false }] });
    const it = status(after, 111);
    expect(it.status).toBe("revisar");
    expect(it.checks!.find((c) => c.concept === "regles")!.detail).toMatch(/pendents d'aprovar/);
  });
  it("les indexades de gas continuen pendents pels seus motius reals (no es validen per la regla d'unitat)", () => {
    const after = applyTemplate(wb, def, { ...REF, extraRules: [general] });
    const idx = status(after, 116);
    expect(idx.status).toBe("revisar");
    expect(idx.reasons.join(" ")).toMatch(/pendent d'aprovar|MARGE/);
    expect(idx.reasons.join(" ")).not.toMatch(/unitat del terme fix/);
  });
  it("convivència amb l'electricitat: cap tarifa de llum canvia d'estat ni de preus", () => {
    const after = applyTemplate(wb, def, { ...REF, extraRules: [general] });
    for (const p of base.products.filter((x) => x.energyType === "luz")) {
      const q = after.products.find((x) => x.key === p.key)!;
      expect([q.interp!.status, q.interp!.energyFinal, q.interp!.powerFinal]).toEqual([p.interp!.status, p.interp!.energyFinal, p.interp!.powerFinal]);
    }
  });
});

describe("cas de regressió «Iberdrola — RL.1 Especial 15%TF/TV»", () => {
  const after = applyTemplate(wb, def, { ...REF, extraRules: [general] });
  const offer = productsToOffers(after, def, { templateId: null, version: 2, fileName: "IBERDROLA_HASTA_15.11.xlsx" }).find((o) => o.product.row === 111)!.offer;
  it("motius per concepte: terme fix validat (€/mes), terme variable validat, descompte interpretat", () => {
    const it = status(after, 111);
    expect(after.products.find((p) => p.row === 111)!.name).toBe("RL.1 Especial 15%TF/TV");
    expect(it.checks!.map((c) => `${c.label}: ${c.detail}`)).toEqual(expect.arrayContaining(["Terme fix: validat (€/mes)", "Terme variable: validat", "Descompte: interpretat (15 % TV · 15 % TF)"]));
  });
  it("€/mes → €/dia (× 12 ÷ 365), conservant l'original i aplicant el 15 % només un cop i només on toca", () => {
    const fixedOrig = after.products.find((p) => p.row === 111)!.fixedTerm!.v!;
    const it = status(after, 111);
    expect(it.powerFinal[0]).toBeCloseTo(fixedOrig * 0.85, 6); // 15 % sobre el terme fix (TF)
    expect(offer.units?.gasFixed).toEqual({ value: it.powerFinal[0], unit: "€/cliente/mes" });
    expect(offer.gasFixedEurDay).toBeCloseTo((it.powerFinal[0]! * 12) / 365, 6);
    expect(offer.energy24h).toBeCloseTo(it.source[0].v * 0.85, 6); // 15 % sobre el terme variable (TV), €/kWh sense conversions
    // no es dupliquen ni conversions ni descomptes en tornar a passar pel motor (o en aplicar-hi també la regla d'unitat)
    const rule: UnitRule = { id: "u1", supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes", status: "aprovada" };
    const twice = normalizeOffer(normalizeOffer(offer, { unitRules: [rule] }).offer, { unitRules: [rule] }).offer;
    expect(twice.gasFixedEurDay).toBe(offer.gasFixedEurDay);
    expect(twice.energy24h).toBe(offer.energy24h);
    expect(offer.conditions).toMatch(/unitat confirmada per regla/);
  });
  it("estat de revisió de la tarifa: validada (sense cap altre bloqueig)", () => {
    expect(tariffReview(offer).state).toBe("validada");
  });
  it("CAS SINTÈTIC: 12 €/mes = 0,394521 €/dia (no 12 €/dia ni 12 €/any)", () => {
    const synth: OfferVersion = { ...emptySheet(), id: "s", supplierId: "s", supplierName: "Iberdrola", productId: "p", productName: "RL.1 Especial 15%TF/TV (CAS SINTÈTIC)", version: 1, energyType: "gas", accessTariff: "RL.1", segments: ["residencial"], contractType: "fix24h", energy24h: 0.06,
      units: { gasFixed: { value: 12, unit: "no indicada al document" }, formulas: [] }, permanenceMonths: null, penalty: null, durationMonths: null, priceGuaranteeMonths: null, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
      validFrom: null, validTo: null, source: "cas sintètic", publishedAt: null, status: "esborrany", conditions: null, origin: "manual" };
    const before = tariffReview(synth);
    expect(before.state).toBe("pendent_interpretacio");
    expect(before.reasons.join()).toMatch(/Terme fix: unitat pendent de confirmar/);
    const r = applyUnitRules(synth, [{ id: "u", supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes", status: "aprovada" }]);
    expect(r.offer.gasFixedEurDay).toBeCloseTo(0.394521, 6); // es desa amb tota la precisió (12 × 12 ÷ 365); 0,394521 arrodonit a 6 decimals
    expect(r.offer.units!.gasFixed).toEqual({ value: 12, unit: "€/cliente/mes" });
    expect(tariffReview(r.offer).state).toBe("validada");
    expect(tariffReview(r.offer).checks.find((c) => c.concept === "terme_fix")!.detail).toBe("validat (€/mes)");
  });
});

describe("un sol aprenentatge per al lector i el catàleg", () => {
  const rules: UnitRule[] = [
    { id: "ib", supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes", status: "aprovada", approvedBy: "Direcció" },
    { id: "nat", supplier: "Naturgy", energyType: "gas", concept: "terme_fix_gas", unit: "eur_dia", status: "aprovada" },
    { id: "prop", supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_any", status: "proposada", product: "RL.3" },
  ];
  it("les regles d'unitat aprovades de la mateixa comercialitzadora s'apliquen al lector (sense plantilla nova)", () => {
    const rr = unitRulesAsReadingRules(rules, "Iberdrola Clientes S.A.U.");
    expect(rr.map((r) => r.id)).toEqual(["unitat:ib"]); // ni Naturgy ni la proposada
    const after = applyTemplate(wb, def, { ...REF, extraRules: rr });
    for (const r of GAS_ROWS) expect(status(after, r).status).toBe("interpretada");
  });
  it("no afecta les altres comercialitzadores", () => {
    expect(unitRulesAsReadingRules(rules, "Endesa")).toEqual([]);
  });
  it("una regla de plantilla es reconeix per l'IDENTIFICADOR de la plantilla, no només pel nom del fitxer", () => {
    const o = { supplierName: "Iberdrola", productName: "RL.1 X", energyType: "gas" as const, accessTariff: "RL.1", source: "Plantilla «Full de preus» v1 · x.xlsx", gasFixedEurDay: null, units: null, template: { templateId: "tpl-1", name: "Full de preus", version: 1, classification: "fixa" as const, variant: null, code: null } };
    expect(ruleMatches({ ...rules[0], templateId: "tpl-1", templateName: "Hoja de Precios" }, o)).toBe(true);
    expect(ruleMatches({ ...rules[0], templateId: "tpl-2", templateName: "Hoja de Precios" }, o)).toBe(false);
  });
  it("persistència: la regla desada amb la plantilla (JSON) es recupera en una sessió nova i s'aplica al document del mes següent", () => {
    const saved = JSON.stringify({ ...def, rules: [{ ...withScope(chat.rule!, "plantilla", null), approved: true }] });
    const restored = JSON.parse(saved) as TemplateDef;
    const next = gridFromXlsx(XLSX as never, readFileSync("tests/fixtures/iberdrola/IBERDROLA_HASTA_30.11.xlsx"), "IBERDROLA_HASTA_30.11.xlsx");
    const r2 = applyTemplate(next, restored, REF);
    for (const r of GAS_ROWS) expect(status(r2, r).status).toBe("interpretada");
  });
  it("versions de plantilla: les regles APROVADES posteriors a la versió verificada s'apliquen; les proposades no", () => {
    const approved = { ...withScope(chat.rule!, "plantilla", null), id: "a", approved: true };
    const proposed = { ...approved, id: "p", approved: false, title: "proposada" };
    const merged = withApprovedRules({ ...def, rules: [] }, { ...def, rules: [approved, proposed] });
    expect(merged.rules!.map((r) => r.id)).toEqual(["a"]);
    expect(withApprovedRules(def, { ...def, rules: [proposed] })).toBe(def);
  });
});

describe("estats de revisió: diferenciats i amb el motiu exacte", () => {
  const g = (p: Partial<OfferVersion>): OfferVersion => ({ ...emptySheet(), id: "x", supplierId: "s", supplierName: "Iberdrola", productId: "p", productName: "RL.2 Prova", version: 1, energyType: "gas", accessTariff: "RL.2", segments: ["residencial"], contractType: "fix24h", energy24h: 0.06, gasFixedEurDay: 0.3,
    permanenceMonths: null, penalty: null, durationMonths: null, priceGuaranteeMonths: null, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: null, validTo: null, source: "x", publishedAt: null, status: "esborrany", conditions: null, origin: "excel", ...p });
  const tpl = (checks: { concept: string; label: string; ok: boolean; detail: string }[], interpStatus: "interpretada" | "fallida" = "interpretada") => ({ template: { templateId: null, name: "t", version: 1, classification: "fixa" as const, variant: null, code: null, interpStatus, checks } });
  it("validada · pendent d'interpretació · pendent d'aprovació · revisió necessària · pendent de verificació · error de lectura", () => {
    expect(tariffReview(g({})).state).toBe("validada");
    expect(tariffReview(g({ gasFixedEurDay: null, units: { gasFixed: { value: 5, unit: "no indicada al document" }, formulas: [] } })).state).toBe("pendent_interpretacio");
    expect(tariffReview(g(tpl([{ concept: "regles", label: "Regles", ok: false, detail: "pendents d'aprovar: «x»" }]))).state).toBe("pendent_aprovacio");
    const disc = tariffReview(g(tpl([{ concept: "descompte", label: "Descompte", ok: false, detail: "pendent de confirmar" }])));
    expect(disc.state).toBe("revisio_necessaria");
    expect(disc.reasons).toEqual(["Descompte: pendent de confirmar"]);
    expect(tariffReview(g({}), { templateVerified: false }).state).toBe("pendent_verificacio");
    expect(tariffReview(g(tpl([], "fallida"))).state).toBe("error_lectura");
  });
  it("mai es marca validada una tarifa amb un altre error pendent", () => {
    const r = tariffReview(g({ energy24h: null, ...tpl([{ concept: "descompte", label: "Descompte", ok: false, detail: "pendent de confirmar" }]) }));
    expect(r.state).toBe("pendent_interpretacio");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
