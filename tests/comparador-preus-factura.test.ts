/**
 * CORRECCIÓ DEL COMPARADOR IA · lectura de factures amb l'energia separada (ATR + energia lliure), arrodoniments,
 * potència a part, confirmació de preus, «Veure càlcul» i aprenentatge de denominacions.
 * Factura FICTÍCIA amb el format de Nufri (helpers/nufri-atr-invoice.ts): cap titular, NIF ni CUPS reals.
 * Els preus finals P3–P6 són els del cas de prova (0,210297 · 0,197793 · 0,246635 · 0,224240 €/kWh).
 * Tot és «provat amb simulació»: no s'ha fet servir la factura real ni el Supabase real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyLine, conceptOf, lineKey, parseEnergyComponents, reconstructEnergyPrices, roundingCompatible, type EnergyComponent } from "@/comparator/energy-breakdown";
import { classifyComponents, extractFromText, recomputeBreakdown } from "@/comparator/invoice";
import { computeCost } from "@/comparator/engine";
import { runComparison } from "@/comparator/ranking";
import { confirmPrices, markPriceManual, priceRows, priceSummary } from "@/comparator/price-review";
import { emptySheet, type OfferVersion, type PriceSheet, type SupplyInput } from "@/comparator/types";
import { fakeSupabase } from "./helpers/fake-supabase";
import { NUFRI_ATR_CASE as C, nufriAtrPages, nufriAtrPdf } from "./helpers/nufri-atr-invoice";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => null };
});

const P = [3, 4, 5, 6];
const data = () => extractFromText(nufriAtrPages());

/** Estat de l'assistent com el deixa «applyInvoice» (contracte actual = preus llegits). */
function fromInvoice(d = data()): { supply: SupplyInput; current: PriceSheet } {
  return {
    supply: { energyType: "luz", accessTariff: d.accessTariff.value!, territory: "peninsula", segment: null, days: d.days.value ?? 30, basis: "periode_facturat", kwh: d.kwh.map((f) => f.value), kwhTotal: null, kw: d.kw.map((f) => f.value), meterRentEurMonth: null, residentialLowPower: false },
    current: { ...emptySheet(), contractType: "periodes", energy: d.energyPrice.map((f) => f.value), power: d.powerPrice.map((f) => f.value), powerUnit: "eur_kw_dia" },
  };
}

describe("1 · els quatre preus finals d'energia (Preu Px = ATR Px + Energia Lliure Px)", () => {
  it("P3 0,210297 · P4 0,197793 · P5 0,246635 · P6 0,224240, sumant preus unitaris (no imports)", () => {
    const d = data();
    for (const p of P) expect(d.energyPrice[p - 1].value).toBe(C.final[p]);
    expect(d.energyBreakdown!.every((b) => b.status === "reconstruit" && b.verified)).toBe(true);
    // verificats: no demanen confirmació
    expect(P.every((p) => d.energyPrice[p - 1].confirm === false)).toBe(true);
  });
  it("també des del PDF (lector complet, sense IA)", async () => {
    const { readInvoiceBytes } = await import("@/server/invoices");
    const r = await readInvoiceBytes(await nufriAtrPdf(), "application/pdf", { allowAi: false, rules: [] });
    expect(P.map((p) => r.data.energyPrice[p - 1].value)).toEqual(P.map((p) => C.final[p]));
    expect(r.data.accessTariff.value).toBe("3.0TD");
  });
  it("reconeix les denominacions equivalents pel significat", () => {
    expect(["Terme Energia ATR", "Energia ATR", "Peatges i càrrecs d'energia", "Peajes y cargos de energía"].map(conceptOf)).toEqual(["atr", "atr", "atr", "atr"]);
    expect(["Terme Energia Lliure", "Energia comercialitzadora", "Energía libre", "Energía comercializadora"].map(conceptOf)).toEqual(["lliure", "lliure", "lliure", "lliure"]);
  });
});

describe("2 · la potència es llegeix a part i mai es barreja amb l'energia", () => {
  it("P1–P6 en €/kW·dia; cap línia de potència, SAS, impostos ni lloguer entra a l'energia", () => {
    const d = data();
    expect(d.powerPrice.map((f) => f.value)).toEqual(C.powerDay);
    expect(d.kw.map((f) => f.value)).toEqual(C.kw);
    expect(d.energyComponents!.every((c) => c.concept === "atr" || c.concept === "lliure")).toBe(true);
    expect(d.energyComponents!.some((c) => /pot[eè]ncia|SAS|impost|lloguer|IVA/i.test(c.label))).toBe(false);
  });
  it("en €/kW·any es converteix a €/kW·dia (÷ 365) i es conserva l'original", () => {
    const d = extractFromText(nufriAtrPages({ powerUnit: "any" }));
    expect(d.powerPrice.map((f) => f.value)).toEqual(C.powerDay);
    expect(d.powerPriceOriginal![0]).toMatchObject({ unit: expect.stringMatching(/kW a[ñn]o/) });
    expect(d.powerPriceOriginal![0]!.formula).toMatch(/÷ 365/);
    for (const p of P) expect(d.energyPrice[p - 1].value).toBe(C.final[p]); // l'energia no canvia
  });
});

describe("3 · arrodoniments de la factura", () => {
  it("1223,843/1224 · 884,004/884 · 52,5/52 · 2503,911/2504 són el mateix consum arrodonit", () => {
    expect([[1223.843, 1224], [884.004, 884], [52.5, 52], [2503.911, 2504]].every(([a, b]) => roundingCompatible(a, b))).toBe(true);
    expect(roundingCompatible(1224, 1300)).toBe(false);
    expect(roundingCompatible(52.5, 54)).toBe(false);
  });
  it("s'accepten sense perdre els valors originals; el consum del període és el més precís", () => {
    const d = data();
    expect(P.map((p) => d.kwh[p - 1].value)).toEqual(P.map((p) => C.kwhPrecise[p]));
    expect(P.every((p) => d.kwh[p - 1].confirm === false)).toBe(true);
    const p3 = d.energyBreakdown!.find((b) => b.period === 3)!;
    expect(p3.checks!.join(" ")).toMatch(/arrodoniment/);
    const lliure3 = d.energyComponents!.find((c) => c.period === 3 && c.concept === "lliure")!;
    expect(lliure3.original).toEqual({ kwh: 1224, unitPrice: 0.191018, amount: 233.81 });
  });
  it("una discrepància material continua demanant revisió (consum o import)", () => {
    const kwhBad = nufriAtrPages().map((t) => t.replace("P3 1.224 kWh", "P3 1.300 kWh"));
    const b1 = extractFromText(kwhBad).energyBreakdown!.find((b) => b.period === 3)!;
    expect([b1.status, b1.total]).toEqual(["pendent", null]);
    expect(b1.note).toMatch(/Discrepància real de consum/);
    const amountBad = nufriAtrPages().map((t) => t.replace("= 233,81 €", "= 245,00 €"));
    const d2 = extractFromText(amountBad);
    expect(d2.energyBreakdown!.find((b) => b.period === 3)!.note).toMatch(/Discrepància real a P3/);
    expect(d2.energyPrice[2].value).toBeNull();
    expect(d2.energyPrice[3].value).toBe(C.final[4]); // la resta de períodes no es toquen
  });
});

describe("4 · P1 i P2 no facturats: ni s'inventen ni es posa zero al preu", () => {
  it("preus P1/P2 buits; consum 0 per confirmar; l'estat és «no facturat (no cal)»", () => {
    const d = data();
    expect([d.energyPrice[0].value, d.energyPrice[1].value]).toEqual([null, null]);
    expect([d.kwh[0].value, d.kwh[1].value]).toEqual([0, 0]);
    const rows = priceRows({ ...fromInvoice(d), invoice: d });
    expect(rows.find((r) => r.key === "e1")!.state).toBe("no_necessari");
    expect(rows.find((r) => r.key === "e1")!.value).toBeNull();
  });
  it("si després hi ha consum a P1 (p. ex. del SIPS), el preu passa a «falta» i no es pot confirmar sense introduir-lo", () => {
    const d = data();
    const st = fromInvoice(d);
    st.supply.kwh[0] = 800;
    const rows = priceRows({ ...st, invoice: d });
    expect(rows.find((r) => r.key === "e1")!.state).toBe("completar");
    const sum = priceSummary(rows);
    expect([sum.needsAction, sum.canConfirm]).toEqual([true, false]);
    expect(() => confirmPrices(rows, null, "Prova")).toThrow(/Energia P1/);
  });
});

describe("5 · confirmació de preus", () => {
  it("tot calculat i verificat: cap confirmació obligatòria", () => {
    const d = data();
    const rows = priceRows({ ...fromInvoice(d), invoice: d });
    expect(rows.filter((r) => r.key.startsWith("e") && r.value != null).every((r) => r.state === "verificat")).toBe(true);
    expect(rows.filter((r) => r.kind === "potencia").every((r) => r.state === "verificat")).toBe(true);
    expect(priceSummary(rows)).toMatchObject({ needsAction: false, allAuto: true });
  });
  it("una dada ambigua demana revisió; el botó desa els valors i l'estat passa a «confirmat»", () => {
    // dos preus diferents per a P1 de potència → ambigu
    const pages = nufriAtrPages();
    pages[1] = pages[1].replace("Terme Potència", "Terme Potència\nP1 Potència alternativa 0,080000 €/kW dia");
    const d = extractFromText(pages);
    const st = fromInvoice(d);
    const rows = priceRows({ ...st, invoice: d });
    expect(rows.find((r) => r.key === "p1")!.state).toBe("revisar");
    expect(priceSummary(rows)).toMatchObject({ needsAction: true, canConfirm: true });
    const review = confirmPrices(rows, null, "Usuària de prova", "2026-11-09T10:00:00Z");
    expect(review.values.p1).toBe(rows.find((r) => r.key === "p1")!.value);
    const after = priceRows({ ...st, invoice: d, review });
    expect(after.find((r) => r.key === "p1")!.state).toBe("manual");
    expect(priceSummary(after, review)).toMatchObject({ needsAction: false, confirmed: true });
    // si es canvia el valor després de confirmar, deixa de valer la confirmació d'aquell preu… però queda com a manual
    const edited = markPriceManual(review, "p1", st.current.power[0]);
    const st2 = { ...st, current: { ...st.current, power: st.current.power.map((x, i) => (i === 0 ? 0.07 : x)) } };
    expect(priceRows({ ...st2, invoice: d, review: edited }).find((r) => r.key === "p1")!).toMatchObject({ state: "manual", origin: expect.stringMatching(/Modificat a mà/) });
  });
});

describe("6 · els preus passen tal qual a la comparativa de les tres ofertes", () => {
  const offer = (n: number, e: number[]): OfferVersion => ({
    ...emptySheet(), id: `00000000-0000-4000-8000-00000000010${n}`, supplierId: "s", supplierName: `Comercialitzadora ${n}`, productId: `p${n}`, productName: `Oferta ${n}`, version: 1,
    energyType: "luz", accessTariff: "3.0TD", segments: ["pyme"], contractType: "periodes", energy: e, power: [0.07, 0.035, 0.015, 0.013, 0.008, 0.005],
    permanenceMonths: 12, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
    validFrom: "2026-01-01", validTo: "2099-12-31", source: "Prova", publishedAt: null, status: "activa", conditions: null, origin: "manual",
  });
  it("cost d'energia actual = Σ consum × preu final (P3–P6); P1/P2 sense consum no bloquegen; l'ATR no es torna a sumar", () => {
    const st = fromInvoice();
    const cur = computeCost(st.current, st.supply, undefined, { current: true });
    expect(cur.ok).toBe(true);
    const expected = Math.round(P.reduce((a, p) => a + C.kwhPrecise[p] * C.final[p], 0) * 100) / 100;
    expect(cur.lines.find((l) => l.key === "energia")!.amount).toBe(expected);
    // si s'hagués sumat l'ATR dues vegades el cost seria més alt
    const doubled = Math.round(P.reduce((a, p) => a + C.kwhPrecise[p] * (C.final[p] + C.atr[p]), 0) * 100) / 100;
    expect(expected).toBeLessThan(doubled);
    const run = runComparison({ supply: st.supply, current: st.current, offers: [offer(1, [0.2, 0.18, 0.16, 0.15, 0.13, 0.12]), offer(2, [0.21, 0.19, 0.2, 0.19, 0.24, 0.22]), offer(3, [0.19, 0.17, 0.18, 0.17, 0.2, 0.19])], today: "2026-11-09" });
    expect(run.current?.total).toBe(cur.total);
    expect(run.evaluations).toHaveLength(3);
    expect(run.evaluations.every((e) => e.cost.ok && e.saving != null)).toBe(true);
  });
});

describe("7 · no es dupliquen els costos ATR", () => {
  it("el mateix ATR repetit en una pàgina de resum es compta una sola vegada", () => {
    const d = extractFromText(nufriAtrPages({ repeatSummary: true }));
    for (const p of P) expect(d.energyPrice[p - 1].value).toBe(C.final[p]);
    expect(d.energyBreakdown!.find((b) => b.period === 3)!.parts.filter((x) => x.duplicate)).toHaveLength(1);
    expect(d.energyBreakdown!.find((b) => b.period === 3)!.checks!.join(" ")).toMatch(/una sola vegada/);
  });
  it("una línia marcada «ja inclòs» no se suma, i un terme total només s'accepta si quadra", () => {
    const comps = parseEnergyComponents(nufriAtrPages());
    const extra: EnergyComponent = { period: 3, concept: "inclos", label: "Peatges inclosos en l'energia", kwh: 1224, unitPrice: 0.019279, amount: null, page: 2, method: "manual" };
    expect(reconstructEnergyPrices([...comps, extra]).find((b) => b.period === 3)!.total).toBe(C.final[3]);
    const total: EnergyComponent = { period: 3, concept: "energia", label: "Terme d'energia P3", kwh: 1224, unitPrice: 0.210297, amount: null, page: 1, method: "text" };
    expect(reconstructEnergyPrices([...comps, total]).find((b) => b.period === 3)!.total).toBe(C.final[3]);
  });
});

describe("8 · els imports es conserven després de desar i recarregar (esborrany)", () => {
  it("la factura, el contracte actual i la confirmació sobreviuen a un cicle JSON com el del desament", async () => {
    const { draftPayload, useWizard } = await import("@/ui/views/comparatives/state");
    const d = extractFromText(nufriAtrPages());
    const st = fromInvoice(d);
    const rows = priceRows({ ...st, invoice: d });
    const review = confirmPrices(rows, null, "Prova", "2026-11-09T10:00:00Z");
    useWizard.getState().reset({ step: 2, mode: "factura", supply: st.supply, current: st.current, invoice: { data: d, warnings: [], method: "text", pages: 2 }, priceReview: review });
    const saved = JSON.parse(JSON.stringify(draftPayload(useWizard.getState())));
    expect(saved.priceReview.confirmedAt).toBe("2026-11-09T10:00:00Z");
    useWizard.getState().reset();
    useWizard.getState().reset(saved); // el que fa restoreDraft amb l'estat desat
    const w = useWizard.getState();
    expect(P.map((p) => w.current!.energy[p - 1])).toEqual(P.map((p) => C.final[p]));
    expect(w.current!.power).toEqual(C.powerDay);
    expect(priceSummary(priceRows({ supply: w.supply, current: w.current!, invoice: w.invoice!.data, review: w.priceReview }), w.priceReview).needsAction).toBe(false);
  });
});

describe("«Veure càlcul»: detall per període i recàlcul immediat", () => {
  it("P3: ATR 0,019279 + Lliure 0,191018 = 0,210297, amb la pàgina i el concepte detectat", () => {
    const d = data();
    const b = d.energyBreakdown!.find((x) => x.period === 3)!;
    const atr = b.parts.find((x) => x.concept === "atr")!, lli = b.parts.find((x) => x.concept === "lliure")!;
    expect([atr.unitPrice, lli.unitPrice, b.total]).toEqual([0.019279, 0.191018, 0.210297]);
    expect([atr.page, atr.label]).toEqual([2, expect.stringMatching(/^Terme Energia ATR · P3/)]);
    expect(lli.label).toMatch(/^Terme Energia Lliure · P3/);
    const row = priceRows({ ...fromInvoice(d), invoice: d }).find((r) => r.key === "e3")!;
    expect(row.breakdown!.total).toBe(row.value); // el que es mostra és el que es calcula
  });
  it("corregir un component recalcula el total del període i conserva l'original", () => {
    const d = data();
    const comps = d.energyComponents!.map((c) => (c.period === 3 && c.concept === "lliure" ? { ...c, unitPrice: 0.2, method: "manual" as const } : c));
    const r = recomputeBreakdown(d, comps);
    expect(r.prices[2]).toBe(0.219279);
    expect(r.prices[3]).toBe(C.final[4]);
    expect(comps.find((c) => c.period === 3 && c.concept === "lliure")!.original!.unitPrice).toBe(0.191018);
  });
});

describe("aprenentatge: denominacions noves amb regles aprovades", () => {
  const pages = () => nufriAtrPages().map((t) => t.replace("Terme Energia Lliure", "Cost d'aprovisionament"));
  it("sense regla, una denominació desconeguda no s'endevina: el període queda pendent", () => {
    expect(conceptOf("Cost d'aprovisionament")).toBeNull();
    const d = extractFromText(pages());
    expect(d.energyBreakdown!.every((b) => b.status === "pendent")).toBe(true);
    expect(d.energyPrice[2].value).toBeNull();
  });
  it("amb la regla aprovada de Nufri es llegeix com a energia lliure; a una altra comercialitzadora no s'aplica", () => {
    const rules = [{ id: "r1", retailer: "Nufri", pattern: "Cost d'aprovisionament", concept: "lliure" as const }];
    const d = extractFromText(pages(), { rules });
    for (const p of P) expect(d.energyPrice[p - 1].value).toBe(C.final[p]);
    expect(d.energyComponents!.find((c) => c.concept === "lliure")!.ruleId).toBe("r1");
    expect(classifyLine("Cost d'aprovisionament P3 1.224 kWh", { rules, retailer: "Naturgy" }).concept).toBeNull();
    expect(lineKey("Cost d'aprovisionament P3 1.224 kWh x 0,191018 €/kWh = 233,81 €")).toBe("cost d'aprovisionament");
  });
  it("les regles també reclassifiquen la lectura IA, però mai una correcció manual", () => {
    const comps: EnergyComponent[] = [
      { period: 3, concept: "altres", label: "Cost d'aprovisionament", kwh: 1224, unitPrice: 0.191018, amount: null, page: 2, method: "ia" },
      { period: 3, concept: "altres", label: "Cost d'aprovisionament", kwh: 1224, unitPrice: 0.191018, amount: null, page: 2, method: "manual" },
    ];
    const out = classifyComponents(comps, [{ id: "r1", retailer: "Nufri", pattern: "cost d'aprovisionament", concept: "lliure" }], "Energia Nufri");
    expect(out.map((c) => c.concept)).toEqual(["lliure", "altres"]);
    expect(out[0].originalConcept).toBe("altres");
  });
});

describe("aprenentatge al servidor: una correcció puntual no es converteix en regla general sense autorització", () => {
  const u = (role: string, id = `00000000-0000-4000-8000-0000000000${role.length}f`) => ({ sb: state.sb, user: { id }, profile: { id, name: `Usuari ${role}`, role, email: `${role}@exemple.test`, code: null } }) as never;
  beforeEach(() => { state.sb = fakeSupabase({ invoice_line_rules: [] } as never); });
  it("un comercial la proposa: no s'aplica fins que l'aprova la cap d'administració", async () => {
    const { learnInvoiceRule, loadInvoiceRules, decideInvoiceRule } = await import("@/server/invoice-rules");
    const r = await learnInvoiceRule(u("comercial"), { retailer: "Nufri", label: "Cost d'aprovisionament", concept: "lliure", previousConcept: null });
    expect([r.applied, r.rule.status]).toEqual([false, "proposada"]);
    expect(r.message).toMatch(/NO s'aplica/);
    expect(await loadInvoiceRules()).toEqual([]);
    await expect(decideInvoiceRule(u("comercial"), r.rule.id, true)).rejects.toThrow(/aprovar/);
    await decideInvoiceRule(u("cap_administrativa"), r.rule.id, true);
    expect(await loadInvoiceRules()).toEqual([{ id: r.rule.id, retailer: "Nufri", pattern: "cost d'aprovisionament", concept: "lliure" }]);
  });
  it("una regla per a totes les comercialitzadores només la crea Direcció", async () => {
    const { learnInvoiceRule } = await import("@/server/invoice-rules");
    await expect(learnInvoiceRule(u("cap_administrativa"), { retailer: null, label: "Energia comercialitzadora", concept: "lliure" })).rejects.toThrow(/Direcció/);
    const r = await learnInvoiceRule(u("admin"), { retailer: null, label: "Energia comercialitzadora", concept: "lliure" });
    expect([r.applied, r.rule.status, r.rule.retailer]).toEqual([true, "aprovada", null]);
  });
  it("una línia sense text reconeixible no es pot convertir en regla", async () => {
    const { learnInvoiceRule } = await import("@/server/invoice-rules");
    await expect(learnInvoiceRule(u("admin"), { retailer: "Nufri", label: "P3 1.224 kWh x 0,19 €/kWh", concept: "lliure" })).rejects.toThrow(/text reconeixible/);
  });
});
