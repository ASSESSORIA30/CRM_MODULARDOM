/**
 * 038 · Tarifes PREU BASE + FEE sobre PostgreSQL real (PGlite, migracions 001–038). Dades fictícies.
 *  · les tarifes existents no es converteixen (pricing_model buit) i els valors no vàlids es rebutgen
 *  · el model de remuneració només a la capa proveïdor
 *  · instantànies de preus de les comparatives: només Direcció / Administració amb economia; immutables si s'han emès
 *  · la reversió (_down) i la reaplicació (idempotent) funcionen
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
let tv = "", cmp = "";

beforeAll(async () => {
  h = await setup(upTo("037"));
  // una tarifa i una comparativa que ja existien ABANS de la 038
  await sys(`insert into tariff_suppliers (id, name) values ('sup:sintetica', 'Sintètica')`);
  const p = (await sys<{ id: string }>(`insert into tariff_products (supplier_id, name, energy_type, access_tariff, product_key) values ('sup:sintetica', 'Fixa antiga', 'luz', '2.0TD', 'sintetica|fixa|2.0td|luz') returning id`))[0].id;
  tv = (await sys<{ id: string }>(`insert into tariff_versions (product_id, version, status, origin, data) values ('${p}', 1, 'activa', 'manual', '{"energy":[0.1,0.1,0.1],"power":[0.1,0.1]}') returning id`))[0].id;
  cmp = (await sys<{ id: string }>(`insert into comparisons (mode, engine_version, snapshot, status, created_by_name) values ('manual', '1.1.0', '{"offers":[]}', 'esborrany', 'Prova') returning id`))[0].id;
  await h.db.exec(fs.readFileSync(`${dir}/038_tarifes_preu_base_fee.sql`, "utf8"));
  // a Supabase els privilegis per defecte de l'esquema public ja ho fan; aquí la taula nova es crea després del setup
  await h.db.exec("grant all on all tables in schema public to authenticated;");
}, 240_000);

describe("038 · model de preu, remuneració i instantànies", () => {
  it("les tarifes existents NO es converteixen i es conserven intactes", async () => {
    const r = (await sys<{ pricing_model: string | null; data: { energy: number[] } }>(`select pricing_model, data from tariff_versions where id = '${tv}'`))[0];
    expect(r.pricing_model).toBeNull();
    expect(r.data.energy).toEqual([0.1, 0.1, 0.1]);
  });
  it("només s'admeten els quatre models, FEE recomanat/màxim no negatius i unitats conegudes", async () => {
    await sys(`update tariff_versions set pricing_model = 'FIXED_BASE_FEE', recommended_fee = 0.012, contract_max_fee = 0.02, fee_input_unit = 'eur_mwh', fee_allowed = 'si', default_fee_mode = 'unic', fee_configuration_version = 1 where id = '${tv}'`);
    await expect(sys(`update tariff_versions set pricing_model = 'BASE_FEE' where id = '${tv}'`)).rejects.toThrow(/check constraint/);
    await expect(sys(`update tariff_versions set recommended_fee = -0.001 where id = '${tv}'`)).rejects.toThrow(/check constraint/);
    await expect(sys(`update tariff_versions set fee_input_unit = 'c€/kWh' where id = '${tv}'`)).rejects.toThrow(/check constraint/);
    // decimal exacte (numeric), sense errors de coma flotant
    expect((await sys<{ v: string }>(`select (recommended_fee + 0.003)::text v from tariff_versions where id = '${tv}'`))[0].v).toBe("0.015000000");
  });
  it("el model de remuneració del FEE només a la capa «proveidor»", async () => {
    await h.as("A", `insert into fin_rules (rule_key, name, layer, retailer, kind, value, unit, base_formula, base_validated, status, remuneration_model, created_by) values ('sint_fee', 'Sintètica 50 % FEE', 'proveidor', 'Sintètica', 'pct_marge', 50, 'pct', 'Σ consum × FEE', true, 'pendent_aprovacio', 'pct_fee', auth.uid())`);
    expect(await h.fails("A", `insert into fin_rules (rule_key, name, layer, kind, value, unit, status, remuneration_model, created_by) values ('mal_fee', 'Mal', 'comercial', 'fix_contracte', 10, 'eur', 'esborrany', 'fix_contracte', auth.uid())`)).toMatch(/check constraint/);
  });
  it("instantànies de preus: les veu Direcció; ni comercials ni col·laboradors; ningú no les escriu des del navegador", async () => {
    await sys(`insert into comparison_pricing_snapshots (comparison_id, tariff_version_id, pricing_model, original_base_prices_snapshot, applied_fee_snapshot, final_prices_snapshot, annual_consumption_by_period, energy_margin, estimated_remuneration, remuneration_status, calculation_version)
      values ('${cmp}', '${tv}', 'FIXED_BASE_FEE', '{"energy":[0.1,0.1,0.1]}', '{"applied":[0.012,0.012,0.012]}', '{"energy":[0.112,0.112,0.112]}', '{"byPeriod":[1000,1000,1000]}', 36.00, 18.00, 'estimada', '1.1.0')`);
    expect(await h.count("A", "select * from comparison_pricing_snapshots")).toBe(1);
    expect(await h.count("C1", "select * from comparison_pricing_snapshots")).toBe(0);
    expect(await h.count("K", "select * from comparison_pricing_snapshots")).toBe(0);
    expect(await h.fails("A", `insert into comparison_pricing_snapshots (comparison_id, pricing_model, final_prices_snapshot, annual_consumption_by_period, calculation_version) values ('${cmp}', 'FIXED_FINAL', '{}', '{}', 'x')`)).toMatch(/row-level security/);
  });
  it("una instantània d'una comparativa emesa és immutable (no es modifica ni s'esborra)", async () => {
    await sys(`update comparison_pricing_snapshots set locked = true`);
    await expect(sys(`update comparison_pricing_snapshots set estimated_remuneration = 999`)).rejects.toThrow(/immutable/);
    await expect(sys(`delete from comparison_pricing_snapshots`)).rejects.toThrow(/no es pot esborrar/);
    expect((await sys<{ n: number }>(`select count(*)::int n from comparison_pricing_snapshots`))[0].n).toBe(1);
  });
  it("reversió i reaplicació: el _down treu només el que afegeix la 038 i la 038 és idempotent", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/038_tarifes_preu_base_fee_down.sql`, "utf8"));
    expect((await sys<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = 'tariff_versions' and column_name = 'pricing_model'`))[0].n).toBe(0);
    expect((await sys<{ n: number }>(`select count(*)::int n from tariff_versions where id = '${tv}'`))[0].n).toBe(1);
    expect((await sys<{ n: number }>(`select count(*)::int n from comparisons where id = '${cmp}'`))[0].n).toBe(1);
    await h.db.exec(fs.readFileSync(`${dir}/038_tarifes_preu_base_fee.sql`, "utf8"));
    await h.db.exec(fs.readFileSync(`${dir}/038_tarifes_preu_base_fee.sql`, "utf8"));
    expect((await sys<{ n: number }>(`select count(*)::int n from information_schema.columns where table_name = 'tariff_versions' and column_name in ('pricing_model','default_fee_values','fee_terms_source')`))[0].n).toBe(3);
  });
});
