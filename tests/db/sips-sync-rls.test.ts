/**
 * Migració 034 sobre PostgreSQL real (PGlite, migracions 001-034). CUPS fictícies.
 * Bloqueig d'execucions simultànies, recuperació d'execucions interrompudes, reserva de tasques per prioritat sense
 * duplicats, unicitat de l'històric i de les oportunitats, i RLS: cap rol hi accedeix directament.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const C = (n: number) => `ES00210000000000${String(n).padStart(2, "0")}AB`;

beforeAll(async () => {
  h = await setup(upTo("034"));
  await sys(`insert into sips_sync_jobs (cups20, priority, status, next_attempt_at) values
    ('${C(1)}', 5, 'pendent', now() - interval '1 hour'),
    ('${C(2)}', 2, 'pendent', now() - interval '1 hour'),
    ('${C(3)}', 3, 'actualitzat', now() - interval '1 minute'),
    ('${C(4)}', 1, 'pendent', now() + interval '1 day'),
    ('${C(5)}', 1, 'error_permanent', now() - interval '1 hour'),
    ('${C(6)}', 1, 'bloquejat_permisos', now() - interval '1 hour')`);
}, 300_000);

describe("034 · execucions i cua", () => {
  it("només una execució alhora", async () => {
    const a = (await sys<{ id: string | null }>(`select sips_start_run('cron', null, 15) id`))[0].id;
    const b = (await sys<{ id: string | null }>(`select sips_start_run('manual', null, 15) id`))[0].id;
    expect(a).toBeTruthy();
    expect(b).toBeNull();
    ids.run = a!;
  });
  it("reserva les degudes per prioritat; no agafa futures, permanents ni bloquejades; no es reserven dues vegades", async () => {
    const got = await sys<{ cups20: string }>(`select cups20 from sips_claim_jobs('${ids.run}', 10, null)`);
    expect(got.map((x) => x.cups20)).toEqual([C(2), C(3), C(1)]);
    expect(await sys(`select cups20 from sips_claim_jobs('${ids.run}', 10, null)`)).toEqual([]);
    expect((await sys<{ n: string }>(`select count(*)::text n from sips_sync_jobs where status = 'en_proces' and locked_by = '${ids.run}'`))[0].n).toBe("3");
  });
  it("una execució interrompuda (sense batec) es tanca i les seves tasques tornen a pendent", async () => {
    await sys(`update sips_sync_runs set heartbeat_at = now() - interval '30 minutes' where id = '${ids.run}'`);
    await sys(`update sips_sync_jobs set locked_at = now() - interval '30 minutes' where locked_by = '${ids.run}'`);
    const next = (await sys<{ id: string | null }>(`select sips_start_run('cron', null, 15) id`))[0].id;
    expect(next).toBeTruthy();
    expect((await sys<{ s: string }>(`select status s from sips_sync_runs where id = '${ids.run}'`))[0].s).toBe("interrompuda");
    expect((await sys<{ n: string }>(`select count(*)::text n from sips_sync_jobs where status = 'en_proces'`))[0].n).toBe("0");
    // reprèn des del punt correcte
    expect((await sys<{ cups20: string }>(`select cups20 from sips_claim_jobs('${next}', 1, null)`)).map((x) => x.cups20)).toEqual([C(2)]);
  });
});

const ids: Record<string, string> = {};

describe("034 · històric i oportunitats sense duplicats", () => {
  it("una instantània per empremta i una oportunitat per clau", async () => {
    const s1 = (await sys<{ id: string }>(`insert into sips_snapshots (cups20, hash, consulted_at, data) values ('${C(1)}', 'h1', now(), '{}') returning id`))[0].id;
    await expect(sys(`insert into sips_snapshots (cups20, hash, consulted_at, data) values ('${C(1)}', 'h1', now(), '{}')`)).rejects.toThrow(/duplicate|unique/i);
    await sys(`insert into sips_change_events (cups20, snapshot_id, kind, note) values ('${C(1)}', '${s1}', 'potencia', 'x')`);
    await expect(sys(`insert into sips_change_events (cups20, snapshot_id, kind, note) values ('${C(1)}', '${s1}', 'potencia', 'y')`)).rejects.toThrow(/duplicate|unique/i);
    await sys(`insert into sips_opportunities (cups20, kind, dedupe_key, title) values ('${C(1)}', 'optimitzacio_potencia', 'k1', 't')`);
    await expect(sys(`insert into sips_opportunities (cups20, kind, dedupe_key, title) values ('${C(1)}', 'optimitzacio_potencia', 'k1', 't')`)).rejects.toThrow(/duplicate|unique/i);
  });
  it("la configuració neix desactivada", async () => {
    expect((await sys<{ enabled: boolean; paused: boolean }>(`select enabled, paused from sips_sync_settings where id = 1`))[0]).toEqual({ enabled: false, paused: false });
  });
});

describe("034 · RLS: cap rol hi accedeix directament (només el servidor)", () => {
  for (const w of ["A", "B", "K", "L"] as const) {
    it(`usuari ${w}`, async () => {
      for (const t of ["sips_sync_settings", "sips_sync_jobs", "sips_sync_runs", "sips_sync_errors", "sips_snapshots", "sips_opportunities"]) expect(await h.count(w, `select * from ${t}`)).toBe(0);
      expect(await h.fails(w, `update sips_sync_settings set enabled = true`)).toBeNull(); // 0 files, cap error
      expect((await sys<{ e: boolean }>(`select enabled e from sips_sync_settings`))[0].e).toBe(false);
      expect(await h.fails(w, `select sips_start_run('cron', null, 15)`)).toMatch(/permission denied/);
    });
  }
});
