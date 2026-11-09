/**
 * Migració 034 · Sincronització SIPS: lògica pura (inventari, cua, errors, instantànies, canvis i oportunitats).
 * CUPS i dades fictícies (format vàlid, cap punt real; el de proves del projecte: ES0031405844323001PD0F).
 */
import { describe, expect, it } from "vitest";
import {
  buildInventory, classifyError, cupsKey, detectChanges, detectOpportunities, inWindow, madridHour, nextDue, normalizeTariff,
  progressPct, resolveSettings, snapshotFromCache, snapshotHash, DEFAULT_SETTINGS, type CacheLike, type InventoryRecord,
} from "@/core/sips-sync";

const S = DEFAULT_SETTINGS;
const TODAY = "2026-11-09";
const C1 = "ES0031405844323001PD";
const C2 = "ES0021000000000001AB", C3 = "ES0021000000000002CD", C4 = "ES0021000000000003EF", C5 = "ES0217000000000004GH";
const rec = (p: Partial<InventoryRecord>): InventoryRecord => ({ source: "subministrament", id: "x", cups: C1, clientKey: null, clientName: null, ...p });

describe("CUPS i inventari", () => {
  it("amb i sense 0F, majúscules i espais: un sol CUPS (es conserva l'original)", () => {
    expect(cupsKey(" es0031405844323001pd0f ")).toEqual({ key: C1, full: `${C1}0F` });
    expect(cupsKey(C1)).toEqual({ key: C1, full: C1 });
    expect(cupsKey("ES00314058443230")).toBeNull();
    const inv = buildInventory([rec({ id: "s1", cups: `${C1}0F`, clientKey: "B00000000" }), rec({ source: "cartera", id: "k1", cups: C1.toLowerCase(), clientKey: "B00000000" })], S, TODAY);
    expect(inv).toHaveLength(1);
    expect(inv[0].variants).toEqual([`${C1}0F`, C1]);
    expect(inv[0].multiClient).toBe(false);
  });
  it("no confon CUPS diferents que comparteixen part del codi", () => {
    const inv = buildInventory([rec({ cups: "ES0031405844323001PD" }), rec({ cups: "ES0031405844323001PE" })], S, TODAY);
    expect(inv.map((x) => x.cups20).sort()).toEqual(["ES0031405844323001PD", "ES0031405844323001PE"]);
  });
  it("el mateix CUPS a dos clients és una incidència (no es fusiona)", () => {
    const inv = buildInventory([rec({ id: "a", clientKey: "B11111111", clientName: "CLIENT A" }), rec({ source: "cartera", id: "b", clientKey: "B22222222", clientName: "CLIENT B" })], S, TODAY);
    expect(inv[0].multiClient).toBe(true);
    expect(inv[0].clientNames).toEqual(["CLIENT A", "CLIENT B"]);
  });
  it("motiu i prioritat: renovació > oportunitat > actiu > històric", () => {
    const inv = buildInventory([
      rec({ source: "contracte", id: "r", cups: C2, status: "actiu", endDate: "2026-12-01" }),
      rec({ source: "oportunitat", id: "o", cups: C3, active: true }),
      rec({ source: "contracte", id: "a", cups: C4, status: "actiu", endDate: "2027-09-01" }),
      rec({ source: "contracte", id: "h", cups: C5, status: "finalitzat", endDate: "2024-01-01" }),
    ], S, TODAY);
    expect(inv.map((x) => [x.cups20, x.reason])).toEqual([[C2, "renovacio"], [C3, "oportunitat"], [C4, "actiu"], [C5, "historic"]]);
    expect(inv[0].renewalDate).toBe("2026-12-01");
    expect(buildInventory([rec({ source: "contracte", cups: C5, status: "finalitzat" })], { ...S, includeHistoric: false }, TODAY)).toHaveLength(0);
  });
  it("freqüències: nou ara, renovació 3 dies, actiu 7, històric 30", () => {
    const t = new Date("2026-11-09T02:00:00Z");
    expect(nextDue("nou", S, t).toISOString()).toBe(t.toISOString());
    expect(nextDue("renovacio", S, t).toISOString()).toBe("2026-11-12T02:00:00.000Z");
    expect(nextDue("actiu", S, t).toISOString()).toBe("2026-11-16T02:00:00.000Z");
    expect(nextDue("historic", S, t).toISOString()).toBe("2026-12-09T02:00:00.000Z");
  });
  it("configuració: valors fora de rang es limiten", () => {
    const r = resolveSettings({ perMinute: 10_000, concurrency: 50, frequencies: { renovacio: 0 } as never });
    expect([r.perMinute, r.concurrency, r.frequencies.renovacio, r.enabled]).toEqual([120, 4, 1, false]);
  });
});

describe("errors del proveïdor", () => {
  const now = new Date("2026-11-09T02:00:00Z");
  it("timeout i 500/503: reintent amb retard exponencial fins al màxim d'intents", () => {
    const a = classifyError({ status: 504, code: "no_disponible" }, 1, S, now);
    const b = classifyError({ status: 503, code: "no_disponible" }, 3, S, now);
    expect([a.state, a.code, a.stopRun]).toEqual(["error_temporal", "timeout", false]);
    expect(a.retryAt!.getTime() - now.getTime()).toBe(60 * 60_000);
    expect(b.retryAt!.getTime() - now.getTime()).toBe(4 * 60 * 60_000);
    expect(classifyError({ status: 503, code: "no_disponible" }, S.maxAttempts, S, now).state).toBe("error_permanent");
  });
  it("429: respecta Retry-After i atura l'execució", () => {
    const r = classifyError({ status: 429, code: "limit", retryAfterSec: 600 }, 1, S, now);
    expect([r.state, r.stopRun, r.retryAt!.getTime() - now.getTime()]).toEqual(["error_temporal", true, 600_000]);
  });
  it("401/credencials i 403: bloqueja i atura (no es repeteixen les credencials)", () => {
    expect(classifyError({ status: 502, code: "credencials" }, 1, S, now)).toMatchObject({ state: "bloquejat_permisos", stopRun: true, retryAt: null });
    expect(classifyError({ status: 403 }, 1, S, now)).toMatchObject({ state: "bloquejat_permisos", code: "sense_permisos", stopRun: true });
  });
  it("CUPS invàlid: error permanent per revisar; format: incidència de transformació", () => {
    expect(classifyError({ status: 400 }, 1, S, now)).toMatchObject({ state: "error_permanent", code: "cups_invalid" });
    expect(classifyError({ status: 502, code: "transformacio" }, 1, S, now)).toMatchObject({ state: "error_temporal", code: "transformacio" });
  });
});

describe("finestra horària (Europe/Madrid, horari d'estiu)", () => {
  it("02:00 d'Espanya a l'hivern (01:00 UTC) i a l'estiu (00:00 UTC)", () => {
    expect(madridHour(new Date("2026-01-15T01:00:00Z"))).toBe(2);
    expect(madridHour(new Date("2026-07-15T00:00:00Z"))).toBe(2);
    expect(inWindow(new Date("2026-01-15T01:05:00Z"), S)).toBe(true);
    expect(inWindow(new Date("2026-07-15T01:05:00Z"), S)).toBe(true); // 03:05, el cron de Vercel en UTC
    expect(inWindow(new Date("2026-07-15T10:00:00Z"), S)).toBe(false);
  });
});

const ac = (periods: number[], from = "2025-10-01", to = "2026-09-30") => ({ status: "complete" as const, revision: 3, from, to, lastAvailable: to, periods, total: periods.reduce((a, b) => a + b, 0), annualListTotal: null, difference: null, warning: null, source: "EAS", basis: "history" as const });
const cache = (p: Partial<CacheLike>): CacheLike => ({ cups: C1, status: "found", consulted_at: "2026-11-09T02:00:00Z", energy_type: "luz", tariff: "2.0TD", annual_kwh: 3000, contracted_power_kw: [4.6, 4.6, null, null, null, null], monthly_kwh: Array(12).fill(250), monthly_max_kw: Array(12).fill(null), ...p });

describe("instantànies normalitzades", () => {
  it("2.0TD: P1–P3 de consum i només 2 potències; total = suma", () => {
    const s = snapshotFromCache(cache({ annual_consumption: ac([900, 800, 1300]) }));
    expect([s.tariff, s.powerKw, s.periodKwh, s.annualKwh, s.totalMatches, s.consumptionStatus]).toEqual(["2.0TD", [4.6, 4.6], [900, 800, 1300], 3000, true, "completa"]);
    expect(s.surplusKwh).toBeNull();
  });
  it("3.0TD i 6.1TD: P1–P6", () => {
    const p = [1000, 2000, 3000, 4000, 5000, 6000];
    for (const t of ["3.0TD", "6.1TD"]) {
      const s = snapshotFromCache(cache({ tariff: t, contracted_power_kw: [20, 20, 20, 20, 20, 30], annual_kwh: 21000, annual_consumption: ac(p) }));
      expect([s.powerKw.length, s.periodKwh, s.annualKwh]).toEqual([6, p, 21000]);
    }
  });
  it("dades parcials: s'indiquen i no s'anualitzen", () => {
    const s = snapshotFromCache(cache({ monthly_kwh: [...Array(8).fill(250), null, null, null, null], annual_kwh: 2000, annual_consumption: { ...ac([0, 0, 0]), status: "incomplete", total: null, periods: [null, null, null] as never, warning: "Històric incomplet" } }));
    expect([s.consumptionStatus, s.monthsAvailable, s.annualKwh, s.periodKwh]).toEqual(["parcial", 8, 2000, null]);
    expect(s.warnings.join(" ")).toMatch(/8 mesos/);
  });
  it("gas: 3.1→RL1 … 3.4→RL4 conservant l'original; l'electricitat no es toca", () => {
    expect(normalizeTariff("3.2", "gas")).toEqual({ tariff: "RL2", original: "3.2" });
    expect(normalizeTariff("RL.4", "gas")).toEqual({ tariff: "RL4", original: "RL.4" });
    expect(normalizeTariff("3.0TD", "luz")).toEqual({ tariff: "3.0TD", original: "3.0TD" });
    expect(normalizeTariff("6.1TD", null).tariff).toBe("6.1TD");
    const g = snapshotFromCache(cache({ energy_type: "gas", tariff: "3.3", contracted_power_kw: [], annual_kwh: 12000 }));
    expect([g.tariff, g.tariffOriginal, g.powerKw, g.periodKwh]).toEqual(["RL3", "3.3", [], null]);
  });
  it("mateixes dades → mateixa empremta (no duplica l'històric)", () => {
    const a = snapshotFromCache(cache({}));
    const b = snapshotFromCache(cache({ consulted_at: "2026-11-10T02:00:00Z" }));
    expect(snapshotHash(a)).toBe(snapshotHash(b));
    expect(snapshotHash(a)).not.toBe(snapshotHash(snapshotFromCache(cache({ annual_kwh: 3500 }))));
  });
});

describe("detecció de canvis i oportunitats", () => {
  const base = snapshotFromCache(cache({ annual_consumption: ac([900, 800, 1300]) }));
  it("cap canvi fals per arrodoniment", () => {
    const n = snapshotFromCache(cache({ contracted_power_kw: [4.6001, 4.6, null, null, null, null], annual_consumption: ac([900.2, 800, 1300]) }));
    expect(detectChanges(base, n, S)).toEqual([]);
  });
  it("potència, tarifa i consum (augment informatiu, no anomalia)", () => {
    const n = snapshotFromCache(cache({ tariff: "3.0TD", contracted_power_kw: [20, 20, 20, 20, 20, 25], annual_kwh: 6000, annual_consumption: ac([1000, 1000, 1000, 1000, 1000, 1000], "2025-11-01", "2026-10-31") }));
    const ev = detectChanges(base, n, S);
    expect(ev.map((e) => e.kind).sort()).toEqual(["consum_augment", "potencia", "tarifa"]);
    expect(ev.find((e) => e.kind === "consum_augment")!.note).toMatch(/estacionalitat/);
  });
  it("incoherències i dades noves", () => {
    const prev = snapshotFromCache(cache({ annual_kwh: null, monthly_kwh: Array(12).fill(null) }));
    const n = snapshotFromCache(cache({ contracted_power_kw: [20, 20, null, null, null, null], annual_consumption: ac([900, 800, 1300]) }));
    const kinds = detectChanges(prev, n, S).map((e) => e.kind);
    expect(kinds).toContain("dades_noves");
    expect(kinds).toContain("incoherent");
  });
  it("sobredimensionament: indici amb prou mesos, mai amb un sol màxim", () => {
    const n = snapshotFromCache(cache({ tariff: "3.0TD", contracted_power_kw: [30, 30, 30, 30, 30, 30], monthly_max_kw: Array(12).fill(12) }));
    const o = detectOpportunities(n, [], { renewalDate: null }, S);
    expect(o[0]).toMatchObject({ kind: "optimitzacio_potencia", quality: "alta" });
    expect(String(o[0].details.note)).toMatch(/No és una recomanació/);
    const few = snapshotFromCache(cache({ tariff: "3.0TD", contracted_power_kw: [30, 30, 30, 30, 30, 30], monthly_max_kw: [12, ...Array(11).fill(null)] }));
    expect(detectOpportunities(few, [], { renewalDate: null }, S)).toEqual([]);
    // mateixa situació → mateixa clau (sense duplicats)
    expect(detectOpportunities(n, [], { renewalDate: null }, S)[0].dedupeKey).toBe(o[0].dedupeKey);
  });
  it("renovació pròxima i progrés", () => {
    expect(detectOpportunities(base, [], { renewalDate: "2026-12-01" }, S)[0].kind).toBe("renovacio");
    expect(progressPct({ actualitzat: 6, sense_dades: 1, pendent: 2, error_temporal: 1 })).toBe(70);
  });
});
