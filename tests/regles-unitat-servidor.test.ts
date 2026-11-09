/**
 * Circuit complet d'aprenentatge al servidor (Supabase en memòria): Direcció ensenya «Iberdrola · Gas · terme fix
 * = €/mes» → la regla es desa → s'aplica al catàleg → es revalida → la tarifa que només tenia aquest bloqueig passa
 * a ACTIVA (validada) sense tornar a importar el document. La resta queda pendent amb el motiu exacte.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";
import { productKey } from "@/comparator/catalog";
import { emptySheet, type OfferVersion } from "@/comparator/types";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => null };
});

const ADMIN = "00000000-0000-4000-8000-0000000000ad", ADM = "00000000-0000-4000-8000-0000000000a2";
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = (uid: string, role: string) => ({ sb: state.sb, user: { id: uid }, profile: { id: uid, name: role === "admin" ? "Direcció" : "Administració", role, email: `${role}@exemple.test`, code: null } }) as never;
const NEXT = `${new Date().getFullYear() + 1}-12-31`;
const gas = (n: number, supplier: string, product: string, p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: id(n), supplierId: `sup:${supplier.toLowerCase()}`, supplierName: supplier, productId: id(100 + n), productName: product, version: 1,
  energyType: "gas", accessTariff: "RL.2", segments: ["residencial"], contractType: "fix24h", energy24h: 0.065, energy: Array(6).fill(null), power: Array(6).fill(null),
  gasFixedEurDay: null, units: { gasFixed: { value: 7.3, unit: "no indicada al document" }, formulas: [] },
  permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12, eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null },
  validFrom: "2026-01-01", validTo: NEXT, source: "Plantilla «Iberdrola Gas» v1 · preus.xlsx · Gas", publishedAt: null, status: "esborrany", conditions: null, origin: "excel", ...p,
});

const OK = gas(1, "Iberdrola", "Plan Estable Gas");                         // només li falta la unitat → validada
const OTHER = gas(2, "Iberdrola", "Plan Gas Sense Preu", { energy24h: null }); // també li falta el preu → pendent
const USED = gas(3, "Iberdrola", "Plan Gas Usat", { accessTariff: "RL.1" });  // usada en propostes → versió nova
const NAT = gas(4, "Naturgy", "Gas Naturgy");                               // una altra comercialitzadora → intacta
const ELEC = { ...gas(5, "Iberdrola", "Plan Llum"), energyType: "luz" as const, accessTariff: "2.0TD", units: null, energy: [0.15, 0.12, 0.1, null, null, null], power: [0.1, 0.05, null, null, null, null], energy24h: null, status: "activa" as const };

function seed() {
  const all = [OK, OTHER, USED, NAT, ELEC];
  const db = {
    profiles: [{ id: ADMIN, name: "Direcció", role: "admin" }],
    tariff_suppliers: [], tariff_templates: [], tariff_rule_runs: [], tariff_unit_rules: [], sec_settings: [], retailers: [],
    tariff_products: all.map((o) => ({ id: o.productId, supplier_id: o.supplierId, name: o.productName, energy_type: o.energyType, access_tariff: o.accessTariff, product_key: productKey(o) })),
    tariff_versions: all.map((o) => ({ id: o.id, product_id: o.productId, version: 1, status: o.status, origin: "excel", data: o, used_at: o === USED ? "2026-10-01T00:00:00Z" : null, created_at: "2026-11-01T00:00:00Z", created_by_name: "Importació" })),
  };
  state.sb = fakeSupabase(db as never);
}
const mod = () => import("@/server/unit-rules");
const row = (vid: string) => state.sb.db.tariff_versions.find((v) => v.id === vid)!;
const latest = (pid: string) => state.sb.db.tariff_versions.filter((v) => v.product_id === pid).sort((a, b) => Number(b.version) - Number(a.version))[0];

describe("aprenentatge d'unitats: guardar → aplicar → revalidar → estat", () => {
  beforeEach(seed);

  it("Iberdrola Gas passa de «pendent» a «validada» quan l'únic problema era la unitat del terme fix", async () => {
    const { learnUnitRule } = await mod();
    const r = await learnUnitRule(user(ADMIN, "admin"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes", instruction: "Tots els imports del terme fix de gas d'Iberdrola són €/mes" });
    // regla persistent
    expect(state.sb.db.tariff_unit_rules).toHaveLength(1);
    expect(state.sb.db.tariff_unit_rules[0]).toMatchObject({ supplier: "Iberdrola", status: "aprovada", unit: "eur_mes" });
    // informe verificable
    expect(r.report).toMatchObject({ persisted: true, approved: true, affected: 3, reprocessed: 3, validated: 2, completed: true });
    expect(r.text).toMatch(/^Norma aplicada: Iberdrola — Gas — Terme fix/);
    expect(r.text).toContain("Tarifes validades: 2");
    // la tarifa sense altres problemes: activa (validada), amb el valor convertit i l'original conservat
    const ok = row(OK.id);
    expect(ok.status).toBe("activa");
    expect((ok.data as OfferVersion).gasFixedEurDay).toBe(0.24); // 7,3 €/mes × 12 ÷ 365
    expect((ok.data as OfferVersion).units?.gasFixed).toEqual({ value: 7.3, unit: "€/cliente/mes" });
    // la que té altres errors: continua pendent, convertida, i amb el motiu exacte (no s'activa)
    const other = row(OTHER.id);
    expect(other.status).toBe("esborrany");
    expect((other.data as OfferVersion).gasFixedEurDay).toBe(0.24);
    expect(r.report.pending.find((p) => p.product.includes("Sense Preu"))!.reasons.join(" ")).toMatch(/energia|Falta/i);
    expect(r.report.pending.flatMap((p) => p.reasons).some((x) => /unitat/.test(x))).toBe(false); // el bloqueig d'unitat ja no hi és
    // la usada en propostes no es modifica: se'n crea una versió nova
    expect(row(USED.id).data).toEqual(USED);
    const nv = latest(USED.productId);
    expect(nv.id).not.toBe(USED.id);
    expect((nv.data as OfferVersion).gasFixedEurDay).toBe(0.24);
    expect(nv.status).toBe("activa"); // només li faltava la unitat → la versió nova queda validada
    expect(row(USED.id).status).toBe("esborrany");
    // altres comercialitzadores i electricitat: intactes
    expect(row(NAT.id).data).toEqual(NAT);
    expect(row(ELEC.id).data).toEqual(ELEC);
    // registre de l'aplicació
    expect(state.sb.db.tariff_rule_runs[0]).toMatchObject({ status: "completada", affected: 3, reprocessed: 3, validated: 2, pending: 1, failed: 0 });
  });

  it("tornar-la a aplicar no torna a convertir res (idempotent)", async () => {
    const { learnUnitRule, applyUnitRule } = await mod();
    const r = await learnUnitRule(user(ADMIN, "admin"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes" });
    const again = await applyUnitRule(user(ADMIN, "admin"), r.ruleId);
    expect(again.report).toMatchObject({ affected: 0, reprocessed: 0, validated: 0 });
    expect((row(OK.id).data as OfferVersion).gasFixedEurDay).toBe(0.24);
  });

  it("si no la desa Direcció: queda proposada, NO s'aplica i el xat no diu «aplicada»; en aprovar-la, s'aplica", async () => {
    const { learnUnitRule, approveUnitRule } = await mod();
    const r = await learnUnitRule(user(ADM, "cap_administrativa"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes" });
    expect(r.report).toMatchObject({ approved: false, affected: 3, reprocessed: 0, validated: 0 });
    expect(r.text).toMatch(/pendent d'aprovació de Direcció/);
    expect(r.text).not.toMatch(/^Norma aplicada/);
    expect(row(OK.id).status).toBe("esborrany");
    const a = await approveUnitRule(user(ADMIN, "admin"), r.ruleId);
    expect(a.report.validated).toBe(2);
    expect(row(OK.id).status).toBe("activa");
  });

  it("les lectures i importacions noves ja apliquen la regla en desar", async () => {
    const { learnUnitRule } = await mod();
    const { saveVersion } = await import("@/server/tariffs");
    await learnUnitRule(user(ADMIN, "admin"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes" });
    const s = await saveVersion(user(ADMIN, "admin"), { ...gas(9, "Iberdrola", "Plan Gas Nou", { accessTariff: "RL.3" }), id: "" }, { origin: "excel" });
    expect((row(s.id).data as OfferVersion).gasFixedEurDay).toBe(0.24);
  });

  it("permisos: un comercial no pot ensenyar regles i només Direcció les aplica", async () => {
    const { learnUnitRule, applyUnitRule } = await mod();
    await expect(learnUnitRule(user(id(77), "comercial"), { supplier: "Iberdrola", energyType: "gas", concept: "terme_fix_gas", unit: "eur_mes" })).rejects.toThrow(/administració/);
    await expect(applyUnitRule(user(ADM, "cap_administrativa"), id(1))).rejects.toThrow(/Direcció/);
  });
});
