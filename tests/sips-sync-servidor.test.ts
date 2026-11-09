/**
 * Migració 034 · Sincronització SIPS al servidor amb un PROVEÏDOR SIMULAT (no hi ha accés autoritzat al SIPS real).
 * Supabase en memòria; el bloqueig i la reserva atòmica es proven sobre PostgreSQL a tests/db/sips-sync-rls.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";
import type { CacheLike } from "@/core/sips-sync";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => null };
});
vi.mock("@/server/permissions", () => ({ secLog: async () => undefined, finStaff: async () => true, hasPerm: async () => true }));
vi.mock("@/server/sips", () => ({
  refreshSips: async () => { throw new Error("no s'ha de cridar el SIPS real als tests"); },
  sipsMissing: () => [],
  visibleCupsSet: async () => new Set<string>(),
}));

const ADMIN = "00000000-0000-4000-8000-0000000000ad", COM = "00000000-0000-4000-8000-0000000000c1";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = (uid: string, role: string, sb: unknown = state.sb) => ({ sb, user: { id: uid }, profile: { id: uid, name: role, email: `${role}@exemple.test`, role, code: null } }) as never;
// CUPS fictícies; la primera és la de proves del projecte (amb 0F)
const CUPS_0F = "ES0031405844323001PD0F", C1 = "ES0031405844323001PD";
const C2 = "ES0021000000000002CD", C3 = "ES0021000000000003EF", GAS = "ES0217000000000004GH";
const NOW = new Date("2026-11-09T01:10:00Z"); // 02:10 a Espanya

function seed(enabled = true) {
  const db: Record<string, Record<string, unknown>[]> = {
    profiles: [{ id: ADMIN, name: "Direcció", role: "admin" }, { id: COM, name: "Comercial", role: "comercial" }],
    sips_sync_settings: [{ id: 1, settings: { perMinute: 120, concurrency: 1 }, enabled, paused: false, authorization_ref: enabled ? "Autorització de prova del proveïdor (simulada)" : null, authorized_at: enabled ? "2026-11-01T00:00:00Z" : null, blocked_reason: null }],
    crm_clients: [{ id: id(1), name: "CLIENT FICTICI 1", tax_id: "B00000001", owner_id: COM }, { id: id(2), name: "CLIENT FICTICI 2", tax_id: "B00000002", owner_id: ADMIN }],
    crm_supplies: [
      { id: id(11), client_id: id(1), cups: CUPS_0F, energy_type: "luz", access_tariff: "2.0TD", current_retailer: "Comercialitzadora X", status: "actiu", archived_at: null },
      { id: id(12), client_id: id(2), cups: C2, energy_type: "luz", access_tariff: "3.0TD", current_retailer: "Comercialitzadora Y", status: "actiu", archived_at: null },
      { id: id(13), client_id: id(2), cups: GAS, energy_type: "gas", access_tariff: "3.2", current_retailer: "Gas Z", status: "actiu", archived_at: null },
    ],
    crm_contracts: [{ id: id(21), client_id: id(1), supply_id: id(11), retailer: "Comercialitzadora X", access_tariff: "2.0TD", status: "actiu", end_date: "2026-12-01", owner_id: COM }],
    crm_opportunities: [], crm_leads: [],
    // cartera: el mateix CUPS (sense 0F) i un altre CUPS amb un client diferent
    contracts: [{ id: "k1", cups: C1, comercial: "Comercial", data: { cliente: "CLIENT FICTICI 1", cif: "B00000001", tipo: "luz" }, removed_from_source: false },
      { id: "k2", cups: C3, comercial: "Altre", data: { cliente: "CLIENT FICTICI 3", cif: "B00000003", tipo: "luz", vencimiento: "2027-10-01" }, removed_from_source: false }],
    crm_state: [], sips_sync_jobs: [], sips_sync_runs: [], sips_sync_errors: [], sips_snapshots: [], sips_change_events: [], sips_opportunities: [], crm_notifications: [], crm_tasks: [],
  };
  const rpcs = {
    sips_start_run: (a: unknown) => {
      const p = a as { p_trigger: string; p_user: string | null };
      if (state.sb.db.sips_sync_runs.some((r) => r.status === "en_curs")) return null;
      const rid = id(900 + state.sb.db.sips_sync_runs.length);
      state.sb.db.sips_sync_runs.push({ id: rid, trigger: p.p_trigger, status: "en_curs", started_at: NOW.toISOString(), heartbeat_at: NOW.toISOString() });
      return rid;
    },
    sips_claim_jobs: (a: unknown) => {
      const p = a as { p_run: string; p_limit: number; p_cups: string[] | null };
      const due = state.sb.db.sips_sync_jobs.filter((j) => j.in_inventory !== false && (!p.p_cups || p.p_cups.includes(j.cups20 as string)) && ["pendent", "actualitzat", "sense_dades", "error_temporal"].includes(j.status as string) && String(j.next_attempt_at) <= new Date(NOW.getTime() + 1000).toISOString())
        .sort((x, y) => Number(x.priority) - Number(y.priority) || String(x.next_attempt_at).localeCompare(String(y.next_attempt_at))).slice(0, p.p_limit);
      for (const j of due) Object.assign(j, { status: "en_proces", locked_by: p.p_run });
      return due.map((j) => ({ ...j }));
    },
  };
  state.sb = fakeSupabase(db as never, rpcs);
}
const mod = () => import("@/server/sips-sync");

// proveïdor simulat: dades segons el CUPS
const found = (cups: string, p: Partial<CacheLike> = {}): CacheLike => ({ cups: cups.slice(0, 20), status: "found", consulted_at: NOW.toISOString(), energy_type: "luz", tariff: "2.0TD", annual_kwh: 3000, contracted_power_kw: [4.6, 4.6, null, null, null, null], monthly_kwh: Array(12).fill(250), monthly_max_kw: Array(12).fill(null), ...p });
type Fx = (cups: string, onError: (e: unknown) => void) => Promise<CacheLike & { error?: string | null }>;
const err = (status: number, code: string, retryAfterSec: number | null = null) => Object.assign(new Error(`Error simulat ${status}`), { status, code, retryAfterSec });

describe("servidor · inventari", () => {
  beforeEach(() => seed());
  it("CUPS únics (amb i sense 0F junts), motiu i incidència de diversos clients", async () => {
    const { syncInventory } = await mod();
    const r = await syncInventory(state.sb as never, NOW);
    expect(r.total).toBe(4);
    const jobs = state.sb.db.sips_sync_jobs;
    const j1 = jobs.find((j) => j.cups20 === C1)!;
    expect(j1.variants).toEqual([CUPS_0F, C1]);
    expect(j1.base_reason).toBe("renovacio"); // contracte que acaba el 2026-12-01
    expect(j1.multi_client).toBe(false); // mateix NIF al CRM i a la cartera
    expect(jobs.find((j) => j.cups20 === GAS)!.tariff).toBe("3.2");
    // reexecutar no duplica
    await syncInventory(state.sb as never, NOW);
    expect(state.sb.db.sips_sync_jobs).toHaveLength(4);
  });
});

describe("servidor · execució", () => {
  beforeEach(() => seed());

  it("desactivada (sense autorització): no consulta res", async () => {
    seed(false);
    const { runSync } = await mod();
    const fx = vi.fn<Fx>();
    const r = await runSync({ trigger: "cron", fetcher: fx, now: () => NOW, db: state.sb as never, wait: async () => undefined });
    expect(r.skipped).toBe(true);
    expect(fx).not.toHaveBeenCalled();
  });

  it("un i diversos CUPS: desa instantànies, estat i estadístiques; 2.0TD, 3.0TD i gas", async () => {
    const { runSync } = await mod();
    const fx = vi.fn<Fx>(async (c) => c.startsWith("ES0217") ? found(c, { energy_type: "gas", tariff: "3.2", contracted_power_kw: [], annual_kwh: 12000 }) : c.startsWith("ES0021000000000002") ? found(c, { tariff: "3.0TD", contracted_power_kw: [20, 20, 20, 20, 20, 30], annual_kwh: 40000 }) : found(c));
    const r = await runSync({ trigger: "cron", fetcher: fx, now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    expect(r.skipped).toBe(false);
    if (r.skipped) return;
    expect([r.processed, r.ok, r.errors]).toEqual([4, 4, 0]);
    expect(fx).toHaveBeenCalledTimes(4); // un sol cop per CUPS (0F inclòs)
    expect(state.sb.db.sips_sync_jobs.every((j) => j.status === "actualitzat")).toBe(true);
    const gas = state.sb.db.sips_snapshots.find((s) => s.cups20 === GAS)!.data as { tariff: string; tariffOriginal: string };
    expect([gas.tariff, gas.tariffOriginal]).toEqual(["RL2", "3.2"]);
    expect(state.sb.db.sips_sync_runs[0]).toMatchObject({ status: "completada", ok: 4 });
    // renovació pròxima → alerta «renovació» per al CUPS del contracte, sense duplicats en tornar-hi
    expect(state.sb.db.sips_opportunities.filter((o) => o.kind === "renovacio")).toHaveLength(1);
  });

  it("sense dades amb la base: prova la variant completa (0F) i no inventa dades si tampoc", async () => {
    const { runSync } = await mod();
    const calls: string[] = [];
    await runSync({ trigger: "cron", now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000, fetcher: async (c) => { calls.push(c); return c === CUPS_0F ? found(c) : c.startsWith(C1) || c === C3 ? { cups: c.slice(0, 20), status: "not_found", consulted_at: NOW.toISOString() } : found(c); } });
    expect(calls.filter((c) => c.startsWith(C1))).toEqual([C1, CUPS_0F]);
    expect(state.sb.db.sips_sync_jobs.find((j) => j.cups20 === C1)!.status).toBe("actualitzat");
    const j3 = state.sb.db.sips_sync_jobs.find((j) => j.cups20 === C3)!;
    expect(j3.status).toBe("sense_dades");
    expect(state.sb.db.sips_snapshots.some((s) => s.cups20 === C3)).toBe(false);
  });

  it("429: atura l'execució, respecta Retry-After i la resta queda a la cua", async () => {
    const { runSync } = await mod();
    const fx = vi.fn<Fx>(async (_c, onError) => { const e = err(429, "limit", 900); onError(e); throw e; });
    const r = await runSync({ trigger: "cron", fetcher: fx, now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    if (r.skipped) throw new Error("no s'esperava");
    expect(r.stop).toMatch(/429/);
    expect(fx).toHaveBeenCalledTimes(1);
    const limited = state.sb.db.sips_sync_jobs.find((j) => j.status === "error_temporal")!;
    expect(Date.parse(String(limited.next_attempt_at)) - NOW.getTime()).toBe(900_000);
    expect(state.sb.db.sips_sync_jobs.filter((j) => j.status === "pendent")).toHaveLength(3); // tornen a la cua
    expect(state.sb.db.sips_sync_runs[0].status).toBe("aturada");
  });

  it("credencials rebutjades: bloqueja, no repeteix i avisa l'administració una sola vegada", async () => {
    const { runSync } = await mod();
    const fx = vi.fn<Fx>(async (_c, onError) => { const e = err(502, "credencials"); onError(e); throw e; });
    await runSync({ trigger: "cron", fetcher: fx, now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    expect(fx).toHaveBeenCalledTimes(1);
    expect(state.sb.db.sips_sync_settings[0].blocked_reason).toMatch(/credencials/);
    const r2 = await runSync({ trigger: "cron", fetcher: fx, now: () => NOW, db: state.sb as never, wait: async () => undefined });
    expect(r2.skipped).toBe(true); // bloquejada fins que es revisi
    expect(fx).toHaveBeenCalledTimes(1);
    expect(state.sb.db.crm_notifications.filter((n) => n.rule_key === "sips:credencials:2026-11-09")).toHaveLength(1);
    expect(JSON.stringify(state.sb.db.sips_sync_errors)).not.toMatch(/password|SIPS_PASSWORD=/i);
  });

  it("errors temporals: reintent amb retard i conservant les dades anteriors", async () => {
    const { runSync } = await mod();
    await runSync({ trigger: "cron", fetcher: async (c) => found(c), now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    const snaps = state.sb.db.sips_snapshots.length;
    const later = new Date(NOW.getTime() + 40 * 86_400_000);
    for (const j of state.sb.db.sips_sync_jobs) j.next_attempt_at = NOW.toISOString();
    await runSync({ trigger: "manual", fetcher: async (_c, onError) => { const e = err(503, "no_disponible"); onError(e); throw e; }, now: () => later, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    const j = state.sb.db.sips_sync_jobs[0];
    expect([j.status, j.attempts]).toEqual(["error_temporal", 1]);
    expect(Date.parse(String(j.next_attempt_at)) - later.getTime()).toBe(60 * 60_000);
    expect(state.sb.db.sips_snapshots).toHaveLength(snaps); // res esborrat
  });

  it("procés interromput per temps: les no processades tornen a la cua i la següent execució continua", async () => {
    const { runSync } = await mod();
    const r = await runSync({ trigger: "cron", fetcher: async (c) => found(c), now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 1_000 });
    if (r.skipped) throw new Error("no s'esperava");
    expect(r.processed).toBe(0);
    expect(state.sb.db.sips_sync_runs[0].status).toBe("parcial");
    expect(state.sb.db.sips_sync_jobs.every((j) => j.status === "pendent" && j.locked_by === null)).toBe(true);
    const r2 = await runSync({ trigger: "cron", fetcher: async (c) => found(c), now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    if (r2.skipped) throw new Error("no s'esperava");
    expect(r2.ok).toBe(4);
  });

  it("execucions simultànies: la segona no s'executa", async () => {
    const { runSync } = await mod();
    state.sb.db.sips_sync_runs.push({ id: id(999), status: "en_curs" });
    const r = await runSync({ trigger: "cron", fetcher: async (c) => found(c), now: () => NOW, db: state.sb as never, wait: async () => undefined });
    expect(r).toMatchObject({ skipped: true, reason: /en curs/ });
  });

  it("detecció de canvis i alertes sense duplicats en reexecutar", async () => {
    const { runSync } = await mod();
    await runSync({ trigger: "cron", fetcher: async (c) => found(c, c.startsWith("ES0021000000000002") ? { tariff: "3.0TD", contracted_power_kw: [30, 30, 30, 30, 30, 30], monthly_max_kw: Array(12).fill(10) } : {}), now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    const opp = () => state.sb.db.sips_opportunities.filter((o) => o.kind === "optimitzacio_potencia");
    expect(opp()).toHaveLength(1);
    for (const j of state.sb.db.sips_sync_jobs) j.next_attempt_at = NOW.toISOString();
    await runSync({ trigger: "manual", fetcher: async (c) => found(c, c.startsWith("ES0021000000000002") ? { tariff: "3.0TD", contracted_power_kw: [30, 30, 30, 30, 30, 30], monthly_max_kw: Array(12).fill(10), annual_kwh: 3001 } : {}), now: () => NOW, db: state.sb as never, wait: async () => undefined, budgetMs: 120_000 });
    expect(opp()).toHaveLength(1);
    expect(state.sb.db.sips_snapshots.filter((s) => s.cups20 === C1)).toHaveLength(1); // mateixes dades: cap entrada nova
  });
});

describe("servidor · permisos per rol", () => {
  beforeEach(() => seed());
  it("un comercial no pot encuar CUPS que no veu ni configurar res", async () => {
    const { enqueue, saveSettings, setAuthorization, runNow } = await mod();
    // la sessió del comercial només veu (RLS) el subministrament del seu client
    const own = fakeSupabase({ crm_supplies: [{ id: id(11), cups20: C1, archived_at: null }], crm_leads: [] } as never);
    await expect(enqueue(user(COM, "comercial", own), { mode: "seleccionats", cups: [C2] })).rejects.toThrow(/No tens accés/);
    await expect(enqueue(user(COM, "comercial", own), { mode: "seleccionats", cups: [CUPS_0F], dryRun: true })).resolves.toMatchObject({ cups: 1 });
    await expect(enqueue(user(COM, "comercial"), { mode: "pendents" })).rejects.toThrow(/Només Direcció/);
    await expect(saveSettings(user(COM, "comercial"), { perMinute: 100 })).rejects.toThrow(/Només Direcció/);
    await expect(setAuthorization(user(COM, "comercial"), { enable: true })).rejects.toThrow(/Només Direcció/);
    await expect(runNow(user(COM, "comercial"))).rejects.toThrow(/Només Direcció/);
  });
  it("activar la sincronització massiva exigeix autorització, base jurídica i confirmació", async () => {
    seed(false);
    const { setAuthorization } = await mod();
    await expect(setAuthorization(user(ADMIN, "admin"), { enable: true, ref: "Correu del proveïdor amb l'abast" })).rejects.toThrow(/base jurídica/);
    await setAuthorization(user(ADMIN, "admin"), { enable: true, ref: "Correu del proveïdor amb l'abast", legalBasis: "Interès legítim (prova)", confirm: true });
    expect(state.sb.db.sips_sync_settings[0]).toMatchObject({ enabled: true, authorized_by: ADMIN });
  });
  it("estimació abans d'una sincronització massiva", async () => {
    const { enqueue, syncInventory } = await mod();
    await syncInventory(state.sb as never, NOW);
    const r = await enqueue(user(ADMIN, "admin"), { mode: "pendents", dryRun: true });
    expect(r).toMatchObject({ cups: 4, requests: 12 });
    expect(state.sb.db.sips_sync_jobs.every((j) => j.reason === "nou")).toBe(true); // dryRun no canvia res
  });
});
