/**
 * 032 · Regla de comissió «per_kw» (€/kW) sobre PostgreSQL real (PGlite). Idempotent i reversible. Dades fictícies.
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
const run = (f: string) => h.db.exec(fs.readFileSync(`${dir}/${f}`, "utf8"));

beforeAll(async () => {
  h = await setup(upTo("032"));
}, 240_000);

describe("032 · comissió per potència (€/kW)", () => {
  it("Direcció pot crear una regla per_kw en €/kW; una altra unitat es rebutja; els tipus anteriors continuen", async () => {
    await h.as("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, conditions, status, created_by) values ('pot_suma', 'Potència suma períodes', 'proveidor', 'per_kw', 2, 'eur_kw', '{"power_basis":"suma_kw_periodes"}', 'pendent_aprovacio', '${U.A}')`);
    expect(await h.fails("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, status, created_by) values ('pot_mal', 'Mal', 'proveidor', 'per_kw', 2, 'eur', 'esborrany', '${U.A}')`)).toMatch(/check constraint/);
    await h.as("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, status, created_by) values ('gala', 'GALA', 'proveidor', 'energia_potencia', 10, 'eur_mwh', 'esborrany', '${U.A}')`);
    expect((await sys<{ n: number }>(`select count(*)::int n from fin_rules where rule_key in ('pot_suma', 'gala')`))[0].n).toBe(2);
  });
  it("es pot tornar a executar; el _down s'atura si hi ha regles per_kw i, sense elles, restaura la v3", async () => {
    await run("032_motor_normalitzacio.sql");
    await expect(run("032_motor_normalitzacio_down.sql")).rejects.toThrow(/per_kw/);
    await sys(`delete from fin_rules where kind = 'per_kw'`);
    await run("032_motor_normalitzacio_down.sql");
    expect((await sys<{ conname: string }>(`select conname from pg_constraint where conname ~ '^fin_rules_(kind|unit)_v[0-9]$' order by 1`)).map((r) => r.conname)).toEqual(["fin_rules_kind_v3", "fin_rules_unit_v3"]);
    await run("032_motor_normalitzacio.sql");
    expect((await sys<{ conname: string }>(`select conname from pg_constraint where conname ~ '^fin_rules_(kind|unit)_v[0-9]$' order by 1`)).map((r) => r.conname)).toEqual(["fin_rules_kind_v4", "fin_rules_unit_v4"]);
  });
});
