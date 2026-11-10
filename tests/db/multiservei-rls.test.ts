/**
 * 039 · Contractació multiservei sobre PostgreSQL real (PGlite, migracions 001–039). Dades fictícies.
 *  · els contractes existents conserven les dades i reben el servei (llum/gas) sense duplicar-se
 *  · un servei que no és d'energia no es pot enllaçar a un CUPS
 *  · línies de mòbil: RLS per client, números únics vius, baixa en lloc d'esborrar
 *  · historial d'estats automàtic i no modificable
 *  · comissió: mai «cobrada» sense data; regles de serveis invisibles per a comercials i col·laboradors
 *  · reversió i reaplicació
 */
import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { U, dir, setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;
let client = "", other = "", supply = "", legacyLuz = "", legacyGas = "", gasSupply = "";

beforeAll(async () => {
  h = await setup(upTo("038"));
  // dades que ja existien ABANS de la 039
  client = (await sys<{ id: string }>(`insert into crm_clients (kind, name, owner_id) values ('particular', 'Client Fictici', '${U.C1}') returning id`))[0].id;
  other = (await sys<{ id: string }>(`insert into crm_clients (kind, name, owner_id) values ('empresa', 'Empresa Fictícia SL', '${U.C2}') returning id`))[0].id;
  supply = (await sys<{ id: string }>(`insert into crm_supplies (client_id, cups, energy_type) values ('${client}', 'ES0000000000000000AA0F', 'luz') returning id`))[0].id;
  gasSupply = (await sys<{ id: string }>(`insert into crm_supplies (client_id, cups, energy_type) values ('${client}', 'ES0000000000000001BB0F', 'gas') returning id`))[0].id;
  legacyLuz = (await sys<{ id: string }>(`insert into crm_contracts (client_id, supply_id, retailer, status, end_date) values ('${client}', '${supply}', 'Comercialitzadora X', 'actiu', '2027-01-01') returning id`))[0].id;
  legacyGas = (await sys<{ id: string }>(`insert into crm_contracts (client_id, supply_id, retailer, status) values ('${client}', '${gasSupply}', 'Comercialitzadora Y', 'esborrany') returning id`))[0].id;
  await h.db.exec(fs.readFileSync(`${dir}/039_contractacio_multiservei.sql`, "utf8"));
  await h.db.exec("grant all on all tables in schema public to authenticated;");
}, 240_000);

describe("039 · contractes multiservei", () => {
  it("els contractes antics es conserven, reben el servei correcte i no es dupliquen", async () => {
    const r = await sys<{ id: string; service: string; retailer: string; status: string }>(`select id, service, retailer, status from crm_contracts order by retailer`);
    expect(r).toHaveLength(2);
    expect(r.find((x) => x.id === legacyLuz)).toMatchObject({ service: "llum_residencial", retailer: "Comercialitzadora X", status: "actiu" });
    expect(r.find((x) => x.id === legacyGas)?.service).toBe("gas");
  });
  it("un contracte de fibra no es pot enllaçar a un CUPS; sense CUPS sí", async () => {
    expect(await h.fails("C1", `insert into crm_contracts (client_id, supply_id, service, retailer, status) values ('${client}', '${supply}', 'fibra', 'O2', 'esborrany')`)).toMatch(/subministrament d'energia/);
    const k = await h.as("C1", `insert into crm_contracts (client_id, service, retailer, status, details) values ('${client}', 'fibra', 'O2', 'esborrany', '{"operator":"O2","speed_mbps":600}') returning id`);
    expect(k.rows[0].id).toBeTruthy();
    // estats nous admesos; estats inventats no
    await h.as("C1", `update crm_contracts set status = 'pendent_installacio' where id = '${k.rows[0].id}'`);
    expect(await h.fails("C1", `update crm_contracts set status = 'inventat' where id = '${k.rows[0].id}'`)).toMatch(/check constraint/);
    expect(await h.fails("C1", `update crm_contracts set monthly_eur = -1 where id = '${k.rows[0].id}'`)).toMatch(/check constraint/);
  });
  it("línies de mòbil: les gestiona qui pot editar el client; un altre comercial ni les veu", async () => {
    const k = (await h.as("C1", `insert into crm_contracts (client_id, service, retailer, status) values ('${client}', 'mobil', 'DIGI', 'esborrany') returning id`)).rows[0].id;
    await h.as("C1", `insert into crm_contract_lines (contract_id, position, phone_number, line_type, donor_operator, tariff, price_monthly_eur) values ('${k}', 1, '600000001', 'portabilitat', 'Orange', 'Il·limitada 50 GB', 10), ('${k}', 2, null, 'nova', null, 'Bàsica 5 GB', 5)`);
    expect(await h.count("C1", `select * from crm_contract_lines where contract_id = '${k}'`)).toBe(2);
    expect(await h.count("C2", `select * from crm_contract_lines where contract_id = '${k}'`)).toBe(0);
    expect(await h.fails("C2", `insert into crm_contract_lines (contract_id, tariff) values ('${k}', 'x')`)).toMatch(/row-level security/);
    // número repetit viu al mateix contracte: no
    expect(await h.fails("C1", `insert into crm_contract_lines (contract_id, position, phone_number, tariff) values ('${k}', 3, '600000001', 'Bàsica')`)).toMatch(/duplicate|unique/);
    // portabilitat sense número: no
    expect(await h.fails("C1", `insert into crm_contract_lines (contract_id, position, line_type, tariff) values ('${k}', 4, 'portabilitat', 'Bàsica')`)).toMatch(/check constraint/);
    // les línies no s'esborren des del navegador (no hi ha política de delete): es donen de baixa
    await h.as("C1", `delete from crm_contract_lines where contract_id = '${k}'`);
    expect(await h.count("C1", `select * from crm_contract_lines where contract_id = '${k}'`)).toBe(2);
    await h.as("C1", `update crm_contract_lines set status = 'baixa', removed_at = now() where contract_id = '${k}' and position = 2`);
    const ev = await sys<{ kind: string; to_status: string }>(`select kind, to_status from crm_contract_events where contract_id = '${k}' order by at`);
    expect(ev.map((e) => e.kind)).toEqual(["creacio", "linia"]);
  });
  it("historial d'estats: es registra sol i ningú no el pot modificar ni esborrar", async () => {
    await h.as("A", `update crm_contracts set status = 'renovacio_pendent' where id = '${legacyLuz}'`);
    const ev = await h.as("C1", `select from_status, to_status from crm_contract_events where contract_id = '${legacyLuz}'`);
    expect(ev.rows).toEqual([{ from_status: "actiu", to_status: "renovacio_pendent" }]);
    expect(await h.count("C2", `select * from crm_contract_events where contract_id = '${legacyLuz}'`)).toBe(0);
    await h.as("A", `delete from crm_contract_events where contract_id = '${legacyLuz}'`);
    await h.as("A", `update crm_contract_events set to_status = 'x' where contract_id = '${legacyLuz}'`);
    expect((await sys<{ to_status: string }>(`select to_status from crm_contract_events where contract_id = '${legacyLuz}'`))[0].to_status).toBe("renovacio_pendent");
    expect(await h.fails("A", `insert into crm_contract_events (contract_id, to_status) values ('${legacyLuz}', 'actiu')`)).toMatch(/row-level security/);
  });
  it("comissió: mai «cobrada» sense data de cobrament ni «liquidada» sense referència", async () => {
    await h.as("A", `insert into crm_contract_finance (contract_id, commission_expected_eur, commission_status) values ('${legacyLuz}', 120, 'prevista')`);
    expect(await h.fails("A", `update crm_contract_finance set commission_status = 'cobrada' where contract_id = '${legacyLuz}'`)).toMatch(/check constraint/);
    expect(await h.fails("A", `update crm_contract_finance set commission_status = 'liquidada' where contract_id = '${legacyLuz}'`)).toMatch(/check constraint/);
    await h.as("A", `update crm_contract_finance set commission_status = 'cobrada', commission_paid_at = '2026-11-01' where contract_id = '${legacyLuz}'`);
    // el col·laborador no veu dades econòmiques
    expect(await h.count("K", `select * from crm_contract_finance`)).toBe(0);
  });
  it("regles de comissió dels serveis: només Direcció les escriu; comercials i col·laboradors no les veuen", async () => {
    await h.as("A", `insert into fin_service_rules (provider, service, modality, amount_eur, status, approved_by) values ('O2', 'fibra', 'fix_alta', 60, 'aprovada', auth.uid())`);
    expect(await h.count("B", `select * from fin_service_rules`)).toBe(1);
    expect(await h.count("C1", `select * from fin_service_rules`)).toBe(0);
    expect(await h.count("K", `select * from fin_service_rules`)).toBe(0);
    expect(await h.fails("B", `insert into fin_service_rules (provider, service, modality, amount_eur) values ('DIGI', 'mobil', 'per_linia', 10)`)).toMatch(/row-level security/);
    expect(await h.fails("A", `insert into fin_service_rules (provider, service, modality) values ('DIGI', 'mobil', 'pct_quota')`)).toMatch(/check constraint/);
    expect(await h.fails("A", `insert into fin_service_rules (provider, service, modality, amount_eur, status) values ('DIGI', 'mobil', 'per_linia', 10, 'aprovada')`)).toMatch(/check constraint/);
  });
  it("categories de document i serveis d'expedient ampliats sense perdre els antics", async () => {
    const sql = `select pg_get_constraintdef(oid) d from pg_constraint where conname = 'crm_documents_category_v2'`;
    const def = (await sys<{ d: string }>(sql))[0].d;
    for (const c of ["dni_nie", "proteccio_dades", "polissa", "pressupost", "portabilitat"]) expect(def).toContain(c);
    const exp = (await sys<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'crm_expedients_service_v2'`))[0].d;
    for (const s of ["fibra_telefonia", "plaques_solars", "fibra_mobil"]) expect(exp).toContain(s);
  });
  it("reversió i reaplicació: la 039 és idempotent i el _down conserva els contractes", async () => {
    await h.db.exec(fs.readFileSync(`${dir}/039_contractacio_multiservei.sql`, "utf8"));
    const before = (await sys<{ n: number }>(`select count(*)::int n from crm_contracts`))[0].n;
    await h.db.exec(fs.readFileSync(`${dir}/039_contractacio_multiservei_down.sql`, "utf8"));
    expect((await sys<{ n: number }>(`select count(*)::int n from crm_contracts`))[0].n).toBe(before);
    expect(await sys(`select 1 from information_schema.columns where table_name = 'crm_contracts' and column_name = 'service'`)).toHaveLength(0);
    await h.db.exec(fs.readFileSync(`${dir}/039_contractacio_multiservei.sql`, "utf8"));
    const svc = await sys<{ service: string }>(`select service from crm_contracts where id = '${legacyLuz}'`);
    expect(svc[0].service).toBe("llum_residencial");
  });
});
