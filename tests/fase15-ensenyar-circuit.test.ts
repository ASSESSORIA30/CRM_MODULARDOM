/**
 * Fase 15 · LECTOR IA D'IBERDROLA amb el document REAL «261109_Hoja_de_precios.xlsx» (pestanya «Energía»).
 * Regressió del cas real: «la regla ja existia», «sempre 32 pendents», «la plantilla no es pot verificar», 504 en
 * importar i duplicats. Supabase SIMULAT en memòria (no és el Supabase real). Només preus de tarifes.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { fakeSupabase } from "./helpers/fake-supabase";
import { applyTemplate, gridFromXlsx, productsToOffers, type TemplateDef } from "@/comparator/xlsx-template";
import { proposeTable, tableChecks, type ReadingRule } from "@/comparator/tariff-table";
import { IBERDROLA, detectSupplier } from "@/comparator/reading-knowledge";
import { inferFromExample, parseRuleChat, upsertRule, withScope } from "@/comparator/reading-rules";
import { productKey, selectableForNew } from "@/comparator/catalog";
import { tariffReview } from "@/comparator/review-state";
import { learnSummary, verifySummary } from "@/ui/views/retailers/templates-api";
import type { OfferVersion } from "@/comparator/types";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: (fn: (req: Request) => unknown) => fn, requireUser: async () => null };
});
const current: { user: unknown } = { user: null };
vi.mock("@/server/permissions", async () => ({ requireInternal: async () => current.user, finStaff: async () => true }));

const FILE = "261109_Hoja_de_precios.xlsx";
const wb = gridFromXlsx(XLSX as never, readFileSync(`tests/fixtures/iberdrola/${FILE}`), FILE);
const def0 = proposeTable(wb, { supplier: "Iberdrola", name: "261109_Hoja_de_precios", knowledge: detectSupplier(wb)?.pack.id }).def!;
const base = applyTemplate(wb, def0, {});
const row = (r: number, res = base) => res.products.find((p) => p.row === r)!;
const pendingRows = (res = base) => res.products.filter((p) => p.interp!.status !== "interpretada").map((p) => p.row);
/** El missatge real de l'usuari per a la fila 11 (barreja períodes i descompte). */
const MSG11 = "Fila 11: preu 0,215 amb el 20% de descompte base: 0,215 × 0,80 = 0,172. P1 = P2 = P3 = 0,172. El 5% si ACP no s'aplica i el 5% del 2n any no s'acumula al primer any.";
const SEGON_ANY = [11, 12, 13, 25, 35, 36, 37, 50, 61, 62, 63];
const HORES = [21, 26, 28, 33, 46, 51, 53, 58];
const approveKnowledge = (id: string): ReadingRule => { const kr = IBERDROLA.rules.find((x) => x.id === id)!; const p = base.products.find((x) => x.interp!.rules.some((y) => y.id === id))!; return { ...withScope({ ...kr, set: { ...kr.set, review: "" }, source: "direccio" }, "plantilla", p), approved: true }; };

describe("auditoria del document real: les pendents, agrupades per causa", () => {
  it("100 identificades; 73 interpretades amb certesa sense cap correcció; 27 pendents amb el motiu exacte", () => {
    expect(base.sheet).toBe("Energía");
    expect(base.table!.counts).toEqual({ identified: 100, interpreted: 73, review: 24, pending: 3, failed: 0 });
    const by = (concept: string, needle?: RegExp) => base.products.filter((p) => p.interp!.checks!.some((c) => !c.ok && c.concept === concept && (!needle || needle.test(c.detail)))).map((p) => p.row);
    expect(by("descompte", /2n any/)).toEqual(SEGON_ANY);                      // 11 · descompte del 2n any
    expect(by("descompte", /creixent/)).toEqual([20, 45]);                     // 2 · Plan Más Ahorro 10/15/20/25/30 %
    expect(by("regles", /hores promocionades/)).toEqual(HORES);                // 8 · horari promocionat 2.0TD sense confirmar
    expect(by("regles", /Indexada/)).toEqual([117, 118, 119]);                 // 3 · gas «Indexada» per analogia
    expect(by("energia")).toEqual([72, 85, 99]);                               // 3 · dos preus per a 6 períodes, sense regla
    expect(pendingRows().length).toBe(27);
  });
  it("fila 11: 0,215 × 0,80 = 0,172 a P1 = P2 = P3; el 5 % ACP no s'aplica; el 2n any es conserva separat (no s'acumula)", () => {
    const it = row(11).interp!;
    expect(it.source.map((s) => s.v)).toEqual([0.215]);
    expect(it.energyFinal.slice(0, 3)).toEqual([0.172, 0.172, 0.172]);
    expect(it.energyFinalYear2!.slice(0, 3)).toEqual([0.20425, 0.20425, 0.20425]); // 2n any: 5 % (visible, no acumulat)
    expect(it.discount.conditional.map((c) => c.condition?.id)).toContain("acp");
  });
  it("bonificació en euros: «100€ en Mi Iberdrola» no es resta del €/kWh i no bloqueja (es mostra)", () => {
    for (const r of [23, 48]) {
      const it = row(r).interp!;
      expect(it.status).toBe("interpretada");
      expect(it.energyPct).toBe(0);
      expect(it.checks!.find((c) => c.concept === "descompte")!.detail).toMatch(/Bonificació fixa.*100/);
    }
  });
  it("gas RL.1–RL.3: terme fix en €/mes convertit a €/dia, conservant l'original (mai €/kW any)", () => {
    const o = productsToOffers(base, def0, { templateId: null, version: 1, fileName: FILE }).find((x) => x.product.row === 111)!.offer;
    expect(o.units!.gasFixed!.unit).toBe("€/cliente/mes");
    expect(o.gasFixedEurDay).toBeCloseTo((o.units!.gasFixed!.value! * 12) / 365, 9);
  });
});

describe("ensenyar: el missatge real crea la regla correcta (descompte, no períodes) i un sol cop", () => {
  it("el missatge de la fila 11 NO genera una correspondència P1–P3 repetida: confirma el CONCEPTE del 2n any", () => {
    const c = parseRuleChat(MSG11, { product: row(11), products: base.products, last: null, supplier: "Iberdrola" });
    expect(c.rule!.set).toEqual({ discountConfirmedKinds: ["segon_any"] });
    expect(c.rule!.set.mapping).toBeUndefined();
    expect(c.reply).toMatch(/ja estaven bé.*0\.172.*NO s'elimina/s);
  });
  it("una sola confirmació resol les 11 tarifes equivalents i no toca cap preu del 1r any", () => {
    const c = parseRuleChat(MSG11, { product: row(11), products: base.products, last: null });
    const r = applyTemplate(wb, def0, { extraRules: [{ ...withScope(c.rule!, "plantilla", row(11)), approved: true }] });
    for (const x of SEGON_ANY) { expect(row(x, r).interp!.status).toBe("interpretada"); expect(row(x, r).interp!.energyFinal).toEqual(row(x).interp!.energyFinal); }
    expect(row(20, r).interp!.status).toBe("revisar"); // un altre concepte (anys creixents) continua pendent
    expect(r.table!.counts.interpreted).toBe(84);
  });
  it("ensenyar amb l'exemple 0,172 · 0,172 · 0,172 diu que els períodes ja hi són i proposa resoldre el descompte", () => {
    const ex = inferFromExample(row(11), { expected: [0.172, 0.172, 0.172], explanation: MSG11, discountApplied: null });
    expect(ex.unchanged).toBe(true);
    expect(ex.blocker!.rule!.set).toEqual({ discountConfirmedKinds: ["segon_any"] });
  });
  it("amb les correccions mínimes de Direcció (1 concepte + 2 regles) queden 95 de 100; les 5 restants necessiten informació comercial", () => {
    const c = parseRuleChat(MSG11, { product: row(11), products: base.products, last: null });
    const r = applyTemplate(wb, def0, { extraRules: [{ ...withScope(c.rule!, "plantilla", row(11)), approved: true }, approveKnowledge("iberdrola:20td-hores-promocionades"), approveKnowledge("iberdrola:gas-indexada")] });
    expect(r.table!.counts).toEqual({ identified: 100, interpreted: 95, review: 2, pending: 3, failed: 0 });
    expect(pendingRows(r)).toEqual([20, 45, 72, 85, 99]);
    // la LECTURA es pot verificar; les 5 surten com a validació comercial pendent (no s'activen)
    const checks = tableChecks(def0, r);
    expect(checks.filter((x) => !x.ok)).toEqual([]);
    expect(checks.find((x) => x.id === "comercial")!.blockers!.map((b) => b.row)).toEqual([20, 45, 72, 85, 99]);
    // abans d'aprovar les regles, la verificació diu exactament quines tarifes ho impedeixen
    const before = tableChecks(def0, base).find((x) => x.id === "regles")!;
    expect(before.ok).toBe(false);
    expect(before.blockers!.map((b) => b.row)).toEqual([...HORES, 117, 118, 119].sort((a, b) => a - b));
  });
  it("regles: sense duplicats, una de contrària substitueix l'anterior i mai es rebaixa una aprovada a proposada", () => {
    const p = row(72);
    const wrong = { ...withScope(parseRuleChat("P1 a P6 són el primer preu", { product: p, products: base.products, last: null }).rule!, "producte", p), approved: true };
    const right = { ...withScope(parseRuleChat("P1–P5 corresponen al segon preu. P6 correspon al primer preu.", { product: p, products: base.products, last: null }).rule!, "producte", p), approved: true };
    expect(wrong.set.mapping).toEqual(["A", "A", "A", "A", "A", "A"]);
    const up = upsertRule([wrong], right);
    expect(up.rules.map((x) => x.set.mapping)).toEqual([["B", "B", "B", "B", "B", "A"]]);
    expect(up.replaced).toEqual([wrong]);
    expect(upsertRule([right], { ...right, id: "x" }).duplicate).toBe(right);
    expect(upsertRule([right], { ...right, id: "y", approved: false }).duplicate).toBe(right); // l'aprovada no es rebaixa
    const a = { ...withScope(parseRuleChat(MSG11, { product: row(11), products: base.products, last: null }).rule!, "plantilla", row(11)), approved: true };
    const b = { ...a, id: "creixents", set: { discountConfirmedKinds: ["anys_creixents" as const] } };
    expect(upsertRule([a], b).rules).toHaveLength(2); // dos conceptes diferents conviuen
  });
  it("les indexades sense fórmula completa (Plan OMIE, gas «Indexada») no es validen per activar", () => {
    const offers = productsToOffers(base, def0, { templateId: null, version: 1, fileName: FILE }).map((x) => x.offer);
    const idx = offers.filter((o) => o.contractType === "indexat");
    expect(idx.length).toBeGreaterThan(0);
    for (const o of idx) expect(tariffReview(o).state).not.toBe("validada");
  });
});

/* ======================================================================= servidor (Supabase simulat) */

const ADMIN = "00000000-0000-4000-8000-0000000000ad", ADM = "00000000-0000-4000-8000-0000000000a2";
const TPL = "11111111-0000-4000-8000-000000000010";
const user = (uid: string, role: string) => ({ sb: state.sb, user: { id: uid }, profile: { id: uid, name: role === "admin" ? "Direcció" : "Administració", role, email: `${role}@exemple.test`, code: null } }) as never;
const uuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Esborranys importats amb la v9 (abans de les correccions): els 11 del 2n any, 2 creixents i 2 indexades. */
const imported = productsToOffers(base, def0, { templateId: TPL, version: 9, fileName: FILE }).filter((o) => SEGON_ANY.includes(o.product.row) || [20, 85, 79, 80].includes(o.product.row))
  .map((o, i): OfferVersion => ({ ...o.offer, id: uuid(i + 1), productId: uuid(100 + i), supplierId: "sup:iberdrola" }));

function seed() {
  state.sb = fakeSupabase({
    profiles: [{ id: ADMIN, name: "Direcció", role: "admin" }], sec_settings: [], retailers: [], tariff_suppliers: [], tariff_unit_rules: [], tariff_rule_runs: [], tariff_import_runs: [],
    tariff_templates: [{ id: TPL, retailer_id: null, supplier: "Iberdrola", name: "261109_Hoja_de_precios", doc_type: "xlsx", status: "pendent", active: true, current_version: 10, verified_version: 3, created_at: "2026-11-09T00:00:00Z" }],
    tariff_template_versions: [3, 10].map((v) => ({ template_id: TPL, version: v, definition: { ...def0, rules: [] }, sample_name: FILE, sample_grid: wb, created_at: "2026-11-09T00:00:00Z" })),
    tariff_template_corrections: [], tariff_template_examples: [], tariff_template_reads: [], tariff_rule_library: [],
    tariff_products: imported.map((o) => ({ id: o.productId, supplier_id: o.supplierId, name: o.productName, energy_type: o.energyType, access_tariff: o.accessTariff, product_key: productKey(o) })),
    tariff_versions: imported.map((o) => ({ id: o.id, product_id: o.productId, version: 1, status: "esborrany", origin: "excel", data: o, used_at: null, created_at: "2026-11-09T00:00:00Z", created_by_name: "Importació" })),
  } as never);
}
const concept = () => withScope(parseRuleChat(MSG11, { product: row(11), products: base.products, last: null }).rule!, "plantilla", row(11));
const mod = () => import("@/server/tariff-templates");
const latestOf = (pid: string) => state.sb.db.tariff_versions.filter((v) => v.product_id === pid).sort((a, b) => Number(b.version) - Number(a.version))[0];

describe("servidor: GUARDAR → Supabase → motor → catàleg (plantilla 261109_Hoja_de_precios v10)", () => {
  beforeEach(seed);

  it("guardar una regla nova: persistència comprovada, 11 afectades i resoltes, esborranys reprocessats i activats", async () => {
    const { learnRule } = await mod();
    const r = await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: concept(), scope: "plantilla", instruction: MSG11 });
    expect(r).toMatchObject({ persisted: true, approved: true, duplicate: false, version: 11 });
    expect(r.effect).toMatchObject({ executed: true, affected: 11, resolved: 11 });
    const c = r.catalog as { affected: number; validated: number; failed: unknown[]; pending: { product: string; reasons: string[] }[] };
    expect(c.failed).toEqual([]);
    expect(c.validated).toBe(11);
    for (const o of imported.filter((x) => /Comunidad|Comunidades/.test(x.productName))) expect(latestOf(o.productId).status).toBe("activa");
    // els altres conceptes continuen pendents amb el motiu (mai validats d'amagat)
    expect(c.pending.map((p) => p.product).join()).toMatch(/Plan Más Ahorro/);
    expect(c.pending.find((p) => /Más Ahorro/.test(p.product))!.reasons.join()).toMatch(/creixent/);
    expect(latestOf(imported.find((x) => /Plan Más Ahorro/.test(x.productName))!.productId).status).toBe("esborrany");
    const text = learnSummary(r as never, "Aquesta plantilla");
    expect(text).toMatch(/^REGLA APLICADA CORRECTAMENT\n• Tarifes afectades: 11 · resoltes: 11 · continuen pendents: 0/);
  });

  it("guardar una regla que JA EXISTEIX no és un «no fer res»: es torna a executar i diu què fa i si està aprovada", async () => {
    const { learnRule } = await mod();
    await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: concept(), scope: "plantilla" });
    const again = await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: { ...concept(), id: "xat:repetida" }, scope: "plantilla" });
    expect(again).toMatchObject({ duplicate: true, status: "duplicada", approved: true, existing: { approved: true } });
    expect(again.effect).toMatchObject({ affected: 11, resolved: 11 }); // la regla EXISTENT s'aplica i resol
    expect(state.sb.db.tariff_template_versions.map((v) => v.version)).toEqual([3, 10, 11]); // cap versió nova
    expect(state.sb.db.tariff_rule_library).toHaveLength(1); // cap duplicat
    expect(learnSummary(again as never, "Aquesta plantilla")).toMatch(/ja existia.*aprovada.*tornat a executar/);
  });

  it("una regla proposada per l'Administració la confirma Direcció tornant-la a guardar (no queda «ja existia» sense fer res)", async () => {
    const { learnRule } = await mod();
    const p = await learnRule(user(ADM, "cap_administrativa"), { templateId: TPL, rule: concept(), scope: "plantilla" });
    expect(p).toMatchObject({ approved: false, status: "proposada" });
    expect(p.effect!.resolved).toBe(0);
    const d = await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: { ...concept(), id: "xat:direccio" }, scope: "plantilla" });
    expect(d).toMatchObject({ duplicate: false, approved: true, version: 12 });
    expect(d.effect).toMatchObject({ affected: 11, resolved: 11 });
  });

  it("reobrir la plantilla: la regla persisteix i s'aplica (versió vigent i també als documents nous)", async () => {
    const { learnRule, getTemplate } = await mod();
    await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: concept(), scope: "plantilla" });
    const reopened = await getTemplate(user(ADMIN, "admin"), { id: TPL });
    expect(row(11, applyTemplate(wb, reopened.version!.definition as TemplateDef, {})).interp!.status).toBe("interpretada");
    const eff = await getTemplate(user(ADMIN, "admin"), { id: TPL, effective: "1" });
    expect(row(11, applyTemplate(wb, eff.version!.definition as TemplateDef, {})).interp!.status).toBe("interpretada");
  });

  it("VERIFICAR: diu quines tarifes ho impedeixen; després d'aprovar les regles, la plantilla es verifica i la validació comercial queda a part", async () => {
    const { learnRule, verifyTemplate } = await mod();
    const v1 = await verifyTemplate(user(ADMIN, "admin"), { id: TPL, version: 10 });
    expect(v1.verified).toBe(false);
    expect(v1.message).toMatch(/Regles aplicades aprovades.*fila 21 «2\.0TD_2 Plan Ahorro Inteligente 8 horas»/);
    expect(verifySummary(v1 as never)).toMatch(/fila 117 «RL\.4 Indexada»/);
    await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: concept(), scope: "plantilla" });
    await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: approveKnowledge("iberdrola:20td-hores-promocionades"), scope: "plantilla" });
    const last = await learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: approveKnowledge("iberdrola:gas-indexada"), scope: "plantilla" });
    expect(last.verification).toEqual({ verified: true, failing: [] });
    expect(state.sb.db.tariff_templates[0]).toMatchObject({ status: "verificada", verified_version: 13 });
    const v2 = await verifyTemplate(user(ADMIN, "admin"), { id: TPL, version: 13 });
    expect(v2.counts).toMatchObject({ identified: 100, interpreted: 95 });
    expect(verifySummary(v2 as never)).toMatch(/Validació COMERCIAL pendent.*: 5/);
  });

  it("si el desament a Supabase falla, error i cap missatge d'èxit; el catàleg no es toca", async () => {
    const { learnRule } = await mod();
    const orig = state.sb.from.bind(state.sb);
    (state.sb as { from: unknown }).from = (t: string) => {
      const q = orig(t);
      if (t !== "tariff_template_versions") return q;
      return { ...q, insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "XX000", message: "error simulat" } }) }) }) };
    };
    await expect(learnRule(user(ADMIN, "admin"), { templateId: TPL, rule: concept(), scope: "plantilla" })).rejects.toThrow();
    (state.sb as { from: unknown }).from = orig;
    expect(state.sb.db.tariff_rule_library).toHaveLength(0);
    expect(state.sb.db.tariff_versions.every((v) => v.status === "esborrany")).toBe(true);
  });
});

describe("servidor: IMPORTACIÓ per lots, sense duplicats, i activació només de les validades", () => {
  beforeEach(() => { seed(); state.sb.db.tariff_versions.length = 0; state.sb.db.tariff_products.length = 0; current.user = user(ADMIN, "admin"); });
  const post = async (body: unknown) => {
    const { POST } = await import("../app/api/tariffs/import/route");
    return (await (POST as unknown as (r: Request) => Promise<unknown>)(new Request("http://x/api/tariffs/import", { method: "POST", body: JSON.stringify(body) }))) as { runId: string; saved: number; activated: number; duplicates: number; rejected: number; progress: Record<string, number> };
  };
  it("lots de 3 amb un sol registre; tornar a enviar un lot (reintent) no duplica res; només s'activen les validades", async () => {
    const c = parseRuleChat(MSG11, { product: row(11), products: base.products, last: null });
    const read = applyTemplate(wb, def0, { extraRules: [{ ...withScope(c.rule!, "plantilla", row(11)), approved: true }] });
    const offers = productsToOffers(read, def0, { templateId: TPL, version: 11, fileName: FILE }).filter((o) => [11, 12, 13, 20, 79, 110].includes(o.product.row)).map((o) => o.offer);
    const meta = { fileName: FILE, supplierName: "Iberdrola", mapping: {}, counts: { tarifes: offers.length }, report: [], activateComplete: true, keepIncompleteAsDraft: true };
    const b1 = await post({ ...meta, offers: offers.slice(0, 3), batch: { index: 0, total: 2 } });
    const b2 = await post({ ...meta, offers: offers.slice(3), runId: b1.runId, batch: { index: 1, total: 2 } });
    const retry = await post({ ...meta, offers: offers.slice(3), runId: b1.runId, batch: { index: 1, total: 2 } }); // el lot 2 «es va tallar» i es reenvia
    expect(b1.saved + b2.saved).toBe(6);
    expect(retry).toMatchObject({ saved: 0, duplicates: 3 });
    expect(state.sb.db.tariff_import_runs).toHaveLength(1);
    expect(retry.progress).toMatchObject({ lots_fets: 3, desades: 6, repetides: 3 });
    expect(state.sb.db.tariff_versions).toHaveLength(6); // cap duplicat
    const st = (name: RegExp) => (state.sb.db.tariff_versions.find((v) => name.test((v.data as OfferVersion).productName))!.status);
    expect(st(/Comunidad Exclusivo/)).toBe("activa");     // validada
    expect(st(/RL\.1 Exclusivo/)).toBe("activa");         // gas €/mes confirmat
    expect(st(/Plan Más Ahorro/)).toBe("esborrany");      // descompte creixent pendent
    expect(st(/Plan OMIE 0/)).toBe("esborrany");          // indexada sense fórmula completa
    // les actives apareixen al comparador; l'indexada no
    const active = state.sb.db.tariff_versions.filter((v) => v.status === "activa").map((v) => ({ ...(v.data as OfferVersion), id: v.id as string, status: "activa" as const }));
    for (const o of active) expect(selectableForNew(o, "2026-11-10").ok).toBe(true);
  });
});
