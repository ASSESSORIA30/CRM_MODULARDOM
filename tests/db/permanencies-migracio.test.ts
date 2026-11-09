/**
 * Migració 035 sobre PostgreSQL real (PGlite): corregeix NOMÉS la permanència de les tarifes fixes 3.0TD/6.1TD sense
 * dades, i res més. Tarifes fictícies (els noms de producte imiten els reals però els preus són inventats).
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const ids: Record<string, string> = {};
const offer = (p: Record<string, unknown>) => JSON.stringify({ energyType: "luz", accessTariff: "3.0TD", contractType: "periodes", energy: [0.15, 0.13, 0.11, 0.1, 0.09, 0.08], power: [20, 10, 5, 4, 3, 2], permanenceMonths: null, penalty: null, marginEurKwh: 0.012, ...p }).replace(/'/g, "''");

beforeAll(async () => {
  h = await setup(upTo("034"));
  await sys(`insert into tariff_suppliers (id, name) values ('sup:iberdrola', 'Iberdrola'), ('sup:altra', 'Altra')`);
  const add = async (key: string, name: string, data: string, status = "activa", used = false) => {
    const pid = (await sys<{ id: string }>(`insert into tariff_products (supplier_id, name, energy_type, access_tariff, product_key) values ('sup:iberdrola', '${name}', 'luz', '3.0TD', '${key}') returning id`))[0].id;
    ids[key] = (await sys<{ id: string }>(`insert into tariff_versions (product_id, version, status, origin, data, used_at) values ('${pid}', 1, '${status}', 'excel', '${data}', ${used ? "now()" : "null"}) returning id`))[0].id;
  };
  await add("flex30", "Plan Flex 3.0TD", offer({}));
  await add("flex30sp", "Plan Flex 3.0 TD (espais)", offer({ accessTariff: "3.0 TD" }));
  await add("fix61", "Tarifa fixa 6.1TD", offer({ accessTariff: "6.1TD", contractType: "fix24h" }), "esborrany");
  await add("t20", "Tarifa 2.0TD", offer({ accessTariff: "2.0TD", energy: [0.2, 0.15, 0.1, null, null, null] }));
  await add("idx30", "Indexada 3.0TD", offer({ contractType: "indexat" }));
  await add("sense", "Fixa 3.0TD amb «sin permanencia»", offer({ permanence: { status: "sense", months: null, startNote: null, cancellation: null, penalty: null, source: "Condicions generals", exception: null } }));
  await add("mesos", "Fixa 3.0TD 12 mesos", offer({ permanenceMonths: 12 }));
  await add("usada", "Fixa 3.0TD usada", offer({}), "activa", true);
  await add("gas", "Gas RL2", offer({ energyType: "gas", accessTariff: "RL.2", contractType: "fix24h" }));
  await h.db.exec(fs.readFileSync("supabase/migrations/035_permanencies_fixes.sql", "utf8"));
}, 300_000);

const data = async (k: string) => (await sys<{ data: Record<string, unknown> }>(`select data from tariff_versions where id = '${ids[k]}'`))[0].data;

describe("035 · correcció de permanències", () => {
  it("Flex 3.0TD i 6.1TD fixes: amb permanència per la regla interna, sense inventar durada", async () => {
    for (const k of ["flex30", "flex30sp", "fix61"]) {
      const d = await data(k);
      expect(d.permanence).toMatchObject({ status: "amb", months: null, exception: null });
      expect(String((d.permanence as { source: string }).source)).toMatch(/Regla comercial interna/);
      expect(d.permanenceMonths).toBeNull();
    }
  });
  it("no toca preus, potències, marges ni altres condicions", async () => {
    const d = await data("flex30");
    expect(d.energy).toEqual([0.15, 0.13, 0.11, 0.1, 0.09, 0.08]);
    expect(d.power).toEqual([20, 10, 5, 4, 3, 2]);
    expect(d.marginEurKwh).toBe(0.012);
    expect(d.contractType).toBe("periodes");
  });
  it("2.0TD, indexades, gas, «sense» explícit, amb mesos i usades: sense canvis", async () => {
    for (const k of ["t20", "idx30", "gas", "usada"]) expect((await data(k)).permanence ?? null).toBeNull();
    expect(((await data("sense")).permanence as { status: string }).status).toBe("sense");
    expect((await data("mesos")).permanence ?? null).toBeNull();
    expect((await data("mesos")).permanenceMonths).toBe(12);
  });
  it("idempotent i reversible", async () => {
    const before = await data("flex30");
    await h.db.exec(fs.readFileSync("supabase/migrations/035_permanencies_fixes.sql", "utf8"));
    expect(await data("flex30")).toEqual(before);
    expect((await sys<{ n: string }>(`select count(*)::text n from tariff_permanence_fix_log`))[0].n).toBe("3");
    await h.db.exec(fs.readFileSync("supabase/migrations/035_permanencies_fixes_down.sql", "utf8"));
    expect((await data("flex30")).permanence ?? null).toBeNull();
  });
});
