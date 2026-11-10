/**
 * CONTRACTACIÓ MULTISERVEI · proves obligatòries (dades fictícies, sense DNI ni comptes reals).
 * M1–M15: lògica pura (core/multiservice.ts i core/service-commissions.ts).
 * M16–M17: servidor (contractAction) amb un Supabase en memòria. M18: RLS real a tests/db/multiservei-rls.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";
import {
  SERVICE_CARDS, STATUS_FLOW, addMonths, canTransition, contractAlerts, fillFromClient, parseAmount, serviceForFamily, serviceOf,
  serviceTotals, summaryColumns, validateServiceContract,
} from "@/core/multiservice";
import { checkCommissionStatus, expectedServiceCommission, type ServiceCommissionRule } from "@/core/service-commissions";
import { contractInput } from "@/core/crm";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => { throw new HttpError(401, "no"); } };
});
vi.mock("@/server/permissions", async () => ({ finStaff: async (u: { profile: { role: string } }) => u.profile.role === "admin", hasPerm: async () => false, STAFF: ["admin", "cap_administrativa", "administrativa"] }));

const today = "2026-11-10";
const fibra = { holder: { name: "Client Fictici" }, operator: "O2", product: "Fibra 600 Mb", operation: "portabilitat", speed_mbps: "600", technology: "FTTH", fixed_line: { enabled: false, portability: false }, economics: { monthly_eur: "30,00", permanence_months: 12, penalty_eur: "100" } };
const line = (n: string | null, p: number | string, extra: Record<string, unknown> = {}) => ({ phone_number: n, line_type: "nova", tariff: "Il·limitada", price_monthly_eur: p, status: "pendent", ...extra });
const rule = (r: Partial<ServiceCommissionRule>): ServiceCommissionRule => ({ id: r.id ?? "r1", provider: "O2", service: "fibra", product: null, modality: "fix_alta", amount_eur: 60, pct: null, months: null, requires_activation: true, clawback_months: null, clawback_pct: null, collaborator_pct: null, valid_from: null, valid_to: null, status: "aprovada", ...r });

describe("Contractació multiservei · lògica", () => {
  it("M1 · «Nou contracte» ofereix les nou targetes i l'electricitat depèn del tipus de client", () => {
    expect(SERVICE_CARDS.map((c) => c.family)).toEqual(["electricitat", "gas", "fibra", "mobil", "fibra_mobil", "assegurances", "alarmes", "plaques_solars", "altres"]);
    expect(serviceForFamily("electricitat", "particular")).toBe("llum_residencial");
    expect(serviceForFamily("electricitat", "empresa")).toBe("llum_empresa");
    // contractes antics sense servei: es dedueix del subministrament
    expect(serviceOf({}, "gas", "particular")).toBe("gas");
  });

  it("M2 · una fibra no exigeix CUPS ni camps d'energia i no es pot enllaçar a un subministrament", () => {
    const ok = validateServiceContract({ service: "fibra", status: "pendent_documentacio", details: fibra });
    expect(ok.issues).toEqual([]);
    expect(ok.details).not.toHaveProperty("cups");
    const bad = validateServiceContract({ service: "fibra", status: "pendent_documentacio", details: fibra, supply_id: "00000000-0000-0000-0000-000000000001" });
    expect(bad.issues.map((i) => i.message).join()).toMatch(/no té CUPS/);
  });

  it("M3 · l'energia continua exigint la data de renovació; la fibra, l'alarma o les plaques actives no", () => {
    expect(contractInput.safeParse({ retailer: "Comercialitzadora X", status: "actiu" }).success).toBe(false);
    expect(contractInput.safeParse({ retailer: "O2", status: "actiu", service: "fibra" }).success).toBe(true);
    expect(contractInput.safeParse({ retailer: "Instal·lador", status: "actiu", service: "plaques_solars" }).success).toBe(true);
  });

  it("M4 · fibra: portabilitat del fix amb número i operador donant; imports en format català i mai negatius", () => {
    const r = validateServiceContract({ service: "fibra", status: "pendent_signatura", details: { ...fibra, fixed_line: { enabled: true, portability: true } } });
    expect(r.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Per portar el fix cal el número actual", "Indica l'operador donant de la portabilitat"]));
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("12.5")).toBe(12.5);
    const neg = validateServiceContract({ service: "fibra", status: "pendent_signatura", details: { ...fibra, economics: { monthly_eur: "-5" } } });
    expect(neg.issues.map((i) => i.message).join()).toMatch(/no pot ser negatiu/);
  });

  it("M5 · mòbil: diverses línies amb la seva tarifa, total = suma de línies vives i sense números repetits", () => {
    const lines = [line("600000001", "10", { line_type: "portabilitat", donor_operator: "Orange" }), line(null, "5,50"), line("600000003", 8, { status: "baixa" })];
    const r = validateServiceContract({ service: "mobil", status: "en_tramitacio", details: { operator: "DIGI" }, lines });
    expect(r.ok).toBe(true);
    expect(serviceTotals("mobil", r.details, r.lines)).toMatchObject({ monthly_eur: 15.5, active_lines: 2 });
    const dup = validateServiceContract({ service: "mobil", status: "en_tramitacio", details: { operator: "DIGI" }, lines: [line("600000001", 5), line("600000001", 5)] });
    expect(dup.issues.map((i) => i.message).join()).toMatch(/repetit/);
    const sinTarifa = validateServiceContract({ service: "mobil", status: "en_tramitacio", details: { operator: "DIGI" }, lines: [{ line_type: "portabilitat", phone_number: "600000009" }] });
    expect(sinTarifa.issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Indica l'operador donant", "Cada línia necessita la seva tarifa"]));
  });

  it("M6 · paquet fibra + mòbil: preu del paquet sense doble comptatge, només se sumen les línies extra", () => {
    const details = { ...fibra, package: { package_monthly_eur: "45" } };
    const lines = [line("600000001", 10, { included_in_package: true }), line("600000002", 10, { included_in_package: true }), line("600000003", 7)];
    const r = validateServiceContract({ service: "fibra_mobil", status: "en_tramitacio", details, lines });
    expect(r.ok).toBe(true);
    const t = serviceTotals("fibra_mobil", r.details, r.lines);
    expect(t.monthly_eur).toBe(52); // 45 del paquet + 7 de la línia extra (no 45 + 30 + 27)
    expect(t.individual_sum_eur).toBe(57); // 30 fibra + 27 línies
    expect(t.package_saving_eur).toBe(5);
    expect(validateServiceContract({ service: "fibra_mobil", status: "en_tramitacio", details: fibra, lines }).issues.map((i) => i.message)).toContain("Indica el preu mensual del paquet");
  });

  it("M7 · assegurança: el proper rebut no és el venciment; avisos i preavís surten del venciment", () => {
    const details = { insurer: "Asseguradora Fictícia", insurance_type: "llar", premium_eur: "240", periodicity: "trimestral", effect_date: "2025-12-15", expiry_date: "2026-12-15", next_payment_date: "2026-11-20", auto_renewal: true, notice_days: 30 };
    const r = validateServiceContract({ service: "assegurances", status: "actiu", details });
    expect(r.ok).toBe(true);
    const cols = summaryColumns("assegurances", r.details, [], "2025-12-15");
    expect(cols.end_date).toBe("2026-12-15");
    expect(serviceTotals("assegurances", r.details).monthly_eur).toBe(20);
    const alerts = contractAlerts({ service: "assegurances", status: "actiu", details: r.details }, today);
    expect(alerts.map((a) => a.kind)).toEqual(["preavis_polissa", "venciment_polissa"]);
    expect(alerts[0].date).toBe("2026-11-15");
    expect(alerts.some((a) => a.date === "2026-11-20")).toBe(false);
    expect(validateServiceContract({ service: "assegurances", status: "actiu", details: { ...details, expiry_date: "2025-01-01" } }).issues.map((i) => i.message)).toContain("El venciment ha de ser posterior a la data d'efecte");
  });

  it("M8 · alarma: permanència calculada des de l'inici i avís abans que acabi", () => {
    const r = validateServiceContract({ service: "alarmes", status: "actiu", details: { company: "SEGURMA", equipment: [{ name: "Detector", qty: "3" }], central_receptora: true, economics: { monthly_eur: "39,90", permanence_months: 24, penalty_eur: "200" } } });
    expect(r.ok).toBe(true);
    const cols = summaryColumns("alarmes", r.details, [], "2024-12-01");
    expect(cols.permanence_end).toBe("2026-12-01");
    expect(cols.end_date).toBeNull();
    const a = contractAlerts({ service: "alarmes", status: "actiu", permanence_end: cols.permanence_end, details: r.details }, today);
    expect(a[0]).toMatchObject({ kind: "permanencia", days: 21 });
    expect(a[0].message).toMatch(/200 €/);
  });

  it("M9 · plaques solars: sense renovació anual; el calendari de pagaments ha de quadrar amb el pressupost", () => {
    expect(STATUS_FLOW.plaques_solars).not.toContain("renovacio_pendent");
    const base = { installer: "Instal·lador Fictici", power_kwp: "6,6", budget_eur: "9000", financing: { kind: "comptat" }, phase: "installacio" };
    const bad = validateServiceContract({ service: "plaques_solars", status: "en_execucio", details: { ...base, payment_schedule: [{ concept: "Senyal", amount_eur: "3000" }] } });
    expect(bad.issues.map((i) => i.message).join()).toMatch(/suma 3000.00 €/);
    const ok = validateServiceContract({ service: "plaques_solars", status: "en_execucio", details: { ...base, payment_schedule: [{ concept: "Senyal", amount_eur: "3000", due_date: "2026-11-01", paid: true }, { concept: "Final d'obra", amount_eur: "6000", due_date: "2026-12-01" }] } });
    expect(ok.ok).toBe(true);
    expect(summaryColumns("plaques_solars", ok.details, [], "2026-10-01")).toMatchObject({ end_date: null, permanence_end: null });
    const a = contractAlerts({ service: "plaques_solars", status: "en_execucio", details: ok.details }, today);
    expect(a.map((x) => x.kind)).toEqual(["pagament_obra"]);
    expect(canTransition("plaques_solars", "actiu", "renovacio_pendent").ok).toBe(false);
  });

  it("M10 · estats per servei: cada servei té el seu flux i un contracte tancat no es reobre", () => {
    expect(canTransition("fibra", "en_tramitacio", "pendent_installacio").ok).toBe(true);
    expect(canTransition("assegurances", "en_tramitacio", "pendent_installacio").ok).toBe(false);
    const r = canTransition("mobil", "baixa", "actiu");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/historial/);
  });

  it("M11 · esborrany: es pot desar incomplet, però mai amb números negatius o formats incorrectes", () => {
    expect(validateServiceContract({ service: "fibra", status: "esborrany", details: {} }).ok).toBe(true);
    expect(validateServiceContract({ service: "mobil", status: "esborrany", details: {}, lines: [{}] }).ok).toBe(true);
    const r = validateServiceContract({ service: "fibra", status: "esborrany", details: { economics: { monthly_eur: "-1" } } });
    expect(r.ok).toBe(false);
  });

  it("M12 · autocompletar amb les dades del client no trepitja el que l'usuari ha escrit o tocat", () => {
    const client = { name: "Client Fictici SL", tax_id: "B00000000", phone: "600000000", email: "client@example.com" };
    const r = fillFromClient({ name: "Nom escrit a mà", tax_id: "", phone: "", email: "" }, client, new Set(["phone"]));
    expect(r.form).toEqual({ name: "Nom escrit a mà", tax_id: "B00000000", phone: "", email: "client@example.com" });
    expect(r.filled).toEqual(["tax_id", "email"]);
  });
});

describe("Comissions dels serveis", () => {
  const k = { service: "fibra" as const, retailer: "o2", product: "Fibra 600 Mb", status: "actiu" as const, start_date: "2026-10-01", monthly_eur: 30 };
  it("M13 · modalitats: fix per alta, % de quota, recurrent, per línia, per paquet, per kWp; el producte concret mana", () => {
    expect(expectedServiceCommission([rule({})], k).total_eur).toBe(60);
    expect(expectedServiceCommission([rule({ modality: "pct_quota", amount_eur: null, pct: 10, months: 12 })], k).total_eur).toBe(36);
    expect(expectedServiceCommission([rule({ modality: "recurrent", amount_eur: 2, months: 24 })], k).total_eur).toBe(48);
    const mob = { ...k, service: "mobil" as const, lines: [{ status: "activa" }, { status: "activa" }, { status: "baixa" }] };
    expect(expectedServiceCommission([rule({ service: "mobil", modality: "per_linia", amount_eur: 15 })], mob).total_eur).toBe(30);
    expect(expectedServiceCommission([rule({ service: "fibra_mobil", modality: "per_paquet", amount_eur: 90 })], { ...k, service: "fibra_mobil" }).total_eur).toBe(90);
    expect(expectedServiceCommission([rule({ provider: "Instal·lador", service: "plaques_solars", modality: "per_kwp", amount_eur: 50 })], { ...k, retailer: "Instal·lador", service: "plaques_solars", details: { power_kwp: 6.6 } }).total_eur).toBe(330);
    // regla de producte concret substitueix la genèrica de la mateixa modalitat
    const both = expectedServiceCommission([rule({ id: "gen" }), rule({ id: "esp", product: "Fibra 600 Mb", amount_eur: 80 })], k);
    expect(both.items.map((i) => i.rule_id)).toEqual(["esp"]);
    // una regla en esborrany o fora de vigència no compta
    expect(expectedServiceCommission([rule({ status: "esborrany" }), rule({ valid_to: "2026-01-01" })], k).status).toBe("sense_regla");
  });

  it("M14 · condicionada a activació i mai «cobrada» només perquè el contracte és actiu", () => {
    expect(expectedServiceCommission([rule({})], { ...k, status: "pendent_installacio" }).status).toBe("pendent_activacio");
    const act = expectedServiceCommission([rule({})], k);
    expect(act.status).toBe("prevista");
    expect(checkCommissionStatus("cobrada", {}, { status: "actiu" }, true)).toMatch(/data de cobrament/);
    expect(checkCommissionStatus("liquidada", {}, { status: "actiu" }, true)).toMatch(/referència/);
    expect(checkCommissionStatus("meritada", {}, { status: "pendent_installacio" }, true)).toMatch(/activació/);
    expect(checkCommissionStatus("cobrada", { commission_paid_at: "2026-11-01" }, { status: "actiu" }, true)).toBeNull();
  });

  it("M15 · retrocessió dins de termini i repartiment amb el col·laborador", () => {
    const r = [rule({ clawback_months: 6, clawback_pct: 100, collaborator_pct: 25 })];
    const split = expectedServiceCommission(r, { ...k, has_collaborator: true });
    expect(split).toMatchObject({ total_eur: 60, collaborator_eur: 15, company_eur: 45, clawback_until: addMonths("2026-10-01", 6) });
    expect(expectedServiceCommission(r, { ...k, has_collaborator: false }).collaborator_eur).toBe(0);
    const baixa = expectedServiceCommission(r, { ...k, status: "baixa", ended_at: "2026-12-01" });
    expect(baixa).toMatchObject({ status: "retrocedida", clawback_eur: 60 });
    expect(expectedServiceCommission(r, { ...k, status: "baixa", ended_at: "2027-06-01" }).status).toBe("prevista");
  });
});

/* ------------------------------------------------------------------ servidor */
const ADM = "00000000-0000-0000-0000-0000000000ad", COM = "00000000-0000-0000-0000-0000000000c1", CLIENT = "00000000-0000-0000-0000-0000000000e1";
const u = (id: string, role: string) => ({ sb: state.sb, user: { id }, profile: { id, name: role, email: "x@example.com", role, code: null } }) as never;

describe("Contractació multiservei · servidor", () => {
  beforeEach(() => {
    state.sb = fakeSupabase();
    const db = state.sb.db as Record<string, Record<string, unknown>[]>;
    db.crm_clients = [{ id: CLIENT, kind: "particular", name: "Client Fictici", owner_id: COM, status: "potencial", collaborator_id: null }];
    db.fin_service_rules = [{ ...rule({ provider: "DIGI", service: "mobil", modality: "per_linia", amount_eur: 15 }) }];
    db.crm_contracts = []; db.crm_contract_lines = []; db.crm_contract_finance = []; db.crm_activities = []; db.contracts = [];
  });

  it("M16 · crear una fibra des del CRM: mateix sistema de contractes, sense CUPS, sense Renovacions i amb historial", async () => {
    const { contractAction } = await import("@/server/crm");
    const r = await contractAction(u(COM, "comercial"), { action: "create", clientId: CLIENT, data: { service: "fibra", status: "pendent_installacio", retailer: "Pendent", details: fibra, start_date: "2026-11-01" } });
    const db = state.sb.db as Record<string, Record<string, unknown>[]>;
    const k = db.crm_contracts.find((x) => x.id === (r as { id: string }).id)!;
    expect(k).toMatchObject({ service: "fibra", retailer: "O2", product: "Fibra 600 Mb", supply_id: null, monthly_eur: 30, permanence_end: "2027-11-01", owner_id: COM });
    expect((k.details as { operator: string }).operator).toBe("O2");
    expect(db.crm_contracts).toHaveLength(1);
    expect(db.contracts).toHaveLength(0); // no es publica a Renovacions (és d'energia)
    expect(db.crm_activities.at(-1)?.title).toMatch(/Nou contracte: Fibra · O2/);
    // sense regla aprovada per a O2: queda registrat així, sense inventar cap import
    expect(db.crm_contract_finance[0]).toMatchObject({ contract_id: k.id, commission_status: "sense_regla", commission_expected_eur: 0 });
    // validació del servidor: un servei sense dades obligatòries no es crea
    await expect(contractAction(u(COM, "comercial"), { action: "create", clientId: CLIENT, data: { service: "assegurances", status: "actiu", retailer: "x", details: {} } })).rejects.toThrow(/companyia asseguradora/);
  });

  it("M17 · mòbil: les línies es desen per separat, una línia treta es dona de baixa (no s'esborra) i la comissió per línia es recalcula", async () => {
    const { contractAction } = await import("@/server/crm");
    const com = u(COM, "comercial");
    const r = await contractAction(com, { action: "create", clientId: CLIENT, data: { service: "mobil", status: "en_tramitacio", retailer: "x", details: { operator: "DIGI" }, lines: [line("600000001", 10), line("600000002", 12)] } });
    const id = (r as { id: string }).id;
    const db = state.sb.db as Record<string, Record<string, unknown>[]>;
    expect(db.crm_contract_lines.map((l) => l.phone_number)).toEqual(["600000001", "600000002"]);
    expect(db.crm_contract_finance[0]).toMatchObject({ commission_status: "pendent_activacio", commission_expected_eur: 30 });
    const keep = db.crm_contract_lines[0];
    await contractAction(com, { action: "update", clientId: CLIENT, id, data: { service: "mobil", status: "actiu", retailer: "DIGI", details: { operator: "DIGI" }, lines: [{ ...line("600000001", 10), id: keep.id, status: "activa", activated_at: "2026-11-05" }] } });
    expect(db.crm_contract_lines).toHaveLength(2);
    expect(db.crm_contract_lines.find((l) => l.phone_number === "600000002")).toMatchObject({ status: "baixa" });
    expect(db.crm_contract_finance[0]).toMatchObject({ commission_status: "prevista", commission_expected_eur: 15 });
    // un comercial no pot marcar la comissió com a cobrada; Direcció tampoc sense data real
    await expect(contractAction(com, { action: "commission", clientId: CLIENT, id, data: { commission_status: "cobrada" } })).rejects.toThrow(/Direcció/);
    await expect(contractAction(u(ADM, "admin"), { action: "commission", clientId: CLIENT, id, data: { commission_status: "cobrada" } })).rejects.toThrow(/data de cobrament/);
    await contractAction(u(ADM, "admin"), { action: "commission", clientId: CLIENT, id, data: { commission_status: "cobrada", commission_paid_at: "2026-11-30" } });
    expect(db.crm_contract_finance[0]).toMatchObject({ commission_status: "cobrada", commission_paid_at: "2026-11-30" });
    // una vegada cobrada, un recàlcul automàtic no la reescriu
    await contractAction(com, { action: "update", clientId: CLIENT, id, data: { service: "mobil", status: "actiu", retailer: "DIGI", details: { operator: "DIGI" }, lines: [{ ...line("600000001", 10), id: keep.id, status: "activa", activated_at: "2026-11-05" }] } });
    expect(db.crm_contract_finance[0].commission_status).toBe("cobrada");
  });
});
