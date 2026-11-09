/**
 * Migració 033 sobre PostgreSQL real (PGlite, migracions 001-033). Dades fictícies.
 * Sistema de facturació (només Direcció), autofactures immutables i sense duplicats, vincle amb liquidacions,
 * cap factura pròpia d'una liquidació amb autofactura (ni a l'inrevés), cobraments parcials i permisos per rol.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setup, upTo } from "./harness";

let h: Awaited<ReturnType<typeof setup>>;
const ids: Record<string, string> = {};
const sys = async <T = Record<string, unknown>,>(sql: string) => (await h.db.query<T>(sql)).rows;

beforeAll(async () => {
  h = await setup(upTo("033"));
  // B (Administració) amb permís d'economia, tal com el donaria Direcció
  await sys(`insert into user_permissions (user_id, module, can_read, can_edit) values ('00000000-0000-0000-0000-00000000000b', 'economia', true, true) on conflict do nothing`);
  ids.r = (await sys<{ id: string }>(`insert into retailers (trade_name, aliases) values ('Energia Fictícia', array['Energia Ficticia SL']) returning id`))[0].id;
  ids.s1 = (await sys<{ id: string }>(`insert into fin_provider_statements (retailer, reference, period_to) values ('Energia Fictícia', 'LIQ-1', '2026-10-31') returning id`))[0].id;
  ids.s2 = (await sys<{ id: string }>(`insert into fin_provider_statements (retailer, reference, period_to) values ('Energia Ficticia SL', 'LIQ-2', '2026-09-30') returning id`))[0].id;
  ids.s3 = (await sys<{ id: string }>(`insert into fin_provider_statements (retailer, reference) values ('Una Altra', 'LIQ-3') returning id`))[0].id;
  await sys(`insert into fin_statement_lines (statement_id, line_no, amount, line_hash, match_status) values ('${ids.s1}', 1, 600, 'h1', 'conciliat'), ('${ids.s1}', 2, 400, 'h2', 'conciliat')`);
}, 300_000);

describe("033 · sistema de facturació de la comercialitzadora", () => {
  it("per defecte factura pròpia; només Direcció el canvia", async () => {
    expect((await h.as<{ m: string }>("A", `select fin_statement_billing_mode('${ids.s1}') m`)).rows[0].m).toBe("factura_propia");
    // Administració sense permís de comercialitzadores: la RLS no li deixa tocar la fitxa (cap fila canviada)
    await h.fails("B", `update retailers set commission_billing = 'autofactura' where id = '${ids.r}'`);
    expect((await sys<{ c: string }>(`select commission_billing c from retailers where id='${ids.r}'`))[0].c).toBe("factura_propia");
    // i encara que tingués accés a la fitxa, el disparador ho impedeix a qui no és Direcció
    await sys(`insert into user_permissions (user_id, module, can_read, can_edit) values ('00000000-0000-0000-0000-00000000000b', 'comercialitzadores', true, true) on conflict (user_id, module) do update set can_read = true, can_edit = true`);
    const msg = await h.fails("B", `update retailers set commission_billing = 'autofactura' where id = '${ids.r}'`);
    expect((await sys<{ c: string }>(`select commission_billing c from retailers where id='${ids.r}'`))[0].c).toBe("factura_propia");
    if (msg) expect(msg).toMatch(/Només Direcció/);
    await h.as("A", `update retailers set commission_billing = 'autofactura' where id = '${ids.r}'`);
    expect((await sys<{ c: string }>(`select commission_billing c from retailers where id='${ids.r}'`))[0].c).toBe("autofactura");
    // per nom i per àlies
    expect((await h.as<{ m: string }>("A", `select fin_statement_billing_mode('${ids.s1}') m`)).rows[0].m).toBe("autofactura");
    expect((await h.as<{ m: string }>("A", `select fin_statement_billing_mode('${ids.s2}') m`)).rows[0].m).toBe("autofactura");
    expect((await h.as<{ m: string }>("A", `select fin_statement_billing_mode('${ids.s3}') m`)).rows[0].m).toBe("factura_propia");
    expect(await h.fails("A", `update retailers set commission_billing = 'altre' where id = '${ids.r}'`)).toMatch(/check/);
  });
});

describe("033 · autofactures", () => {
  it("Administració registra l'autofactura i la vincula; comercials i col·laboradors no hi tenen accés", async () => {
    ids.af = (await h.as<{ id: string }>("B", `insert into fin_self_invoices (retailer, number, issue_date, base, vat_rate, vat, total, file_sha256) values ('Energia Fictícia', 'AF-1', '2026-11-05', 1000, 21, 210, 1210, 'sha-af-1') returning id`)).rows[0].id;
    await h.as("B", `insert into fin_self_invoice_statements (self_invoice_id, statement_id, amount) values ('${ids.af}', '${ids.s1}', 1000)`);
    for (const w of ["C1", "K", "L"] as const) {
      expect(await h.count(w, `select * from fin_self_invoices`)).toBe(0);
      expect(await h.fails(w, `insert into fin_self_invoices (retailer, number, issue_date, base, total) values ('X', 'Y', '2026-01-01', 1, 1)`)).toMatch(/row-level security/);
    }
  });
  it("no es registra dues vegades (mateix número o mateix PDF) i el total ha de quadrar", async () => {
    expect(await h.fails("B", `insert into fin_self_invoices (retailer, number, issue_date, base, total) values ('energia fictícia ', 'af-1', '2026-11-05', 1000, 1000)`)).toMatch(/duplicate|unique/i);
    expect(await h.fails("B", `insert into fin_self_invoices (retailer, number, issue_date, base, total, file_sha256) values ('Energia Fictícia', 'AF-2', '2026-11-05', 1, 1, 'sha-af-1')`)).toMatch(/duplicate|unique/i);
    expect(await h.fails("B", `insert into fin_self_invoices (retailer, number, issue_date, base, vat, total) values ('Energia Fictícia', 'AF-3', '2026-11-05', 100, 21, 150)`)).toMatch(/check/);
  });
  it("document fiscal immutable: no s'esborra ni es canvien imports; s'anul·la amb motiu", async () => {
    await h.fails("A", `delete from fin_self_invoices where id='${ids.af}'`); // sense política DELETE
    expect(await sys(`delete from fin_self_invoices where id='${ids.af}'`).catch((e: Error) => e.message)).toMatch(/no s'esborra/); // ni tan sols el servidor
    expect(await h.count("A", `select * from fin_self_invoices where id='${ids.af}'`)).toBe(1);
    expect(await h.fails("B", `update fin_self_invoices set base = 1 where id='${ids.af}'`)).toMatch(/no es modifiquen/);
    await h.as("B", `update fin_self_invoices set notes = 'revisada' where id='${ids.af}'`);
    expect(await h.fails("B", `delete from fin_self_invoice_statements where self_invoice_id='${ids.af}'`)).toBeNull(); // sense política: no esborra res
    expect(await h.count("B", `select * from fin_self_invoice_statements where self_invoice_id='${ids.af}'`)).toBe(1);
  });
  it("vincular una autofactura fixa la liquidació en mode autofactura", async () => {
    expect((await sys<{ b: string }>(`select billing_mode b from fin_provider_statements where id='${ids.s1}'`))[0].b).toBe("autofactura");
  });
});

describe("033 · factura pròpia vs autofactura (cap doble facturació)", () => {
  beforeAll(async () => {
    ids.c = (await sys<{ id: string }>(`insert into bill_clients (legal_name, nif, address, postal_code, city) values ('CLIENT FICTICI SA', 'A58818501', 'C/ Inventada 2', '08001', 'Barcelona') returning id`))[0].id;
  });
  it("una liquidació amb autofactura no es pot vincular a una factura d'Assessoria 3.0", async () => {
    const inv = (await h.as<{ id: string }>("A", `insert into bill_invoices (client_id, concept) values ('${ids.c}', 'Prova') returning id`)).rows[0].id;
    expect(await h.fails("A", `insert into bill_invoice_statements (invoice_id, statement_id, amount) values ('${inv}', '${ids.s1}', 100)`)).toMatch(/autofactura/);
    // la d'una comercialitzadora amb factura pròpia sí
    expect(await h.fails("A", `insert into bill_invoice_statements (invoice_id, statement_id, amount) values ('${inv}', '${ids.s3}', 100)`)).toBeNull();
  });
  it("i una liquidació ja facturada (emesa) no admet autofactura", async () => {
    await sys(`insert into bill_settings (id, issuer_name, issuer_nif, issuer_address, issuer_postal_code, issuer_city, iban) values (1, 'EMISSOR DE PROVA SL', 'B12345674', 'C/ Prova 1', '25001', 'Lleida', 'ES00') on conflict (id) do nothing`);
    await sys(`insert into bill_series (code, year, last_number) values ('ORD', 2026, 0) on conflict do nothing`);
    await sys(`insert into fin_statement_lines (statement_id, line_no, amount, line_hash, match_status) values ('${ids.s3}', 1, 100, 'h3', 'conciliat')`);
    const inv = (await sys<{ invoice_id: string }>(`select invoice_id from bill_invoice_statements where statement_id='${ids.s3}'`))[0].invoice_id;
    await h.as("A", `insert into bill_invoice_lines (invoice_id, line_no, description, unit_price, vat_rate) values ('${inv}', 1, 'Comissions', 100, 21)`);
    await h.as("A", `select bill_issue_invoice('${inv}', '2026-11-06')`);
    const af = (await h.as<{ id: string }>("B", `insert into fin_self_invoices (retailer, number, issue_date, base, total) values ('Una Altra', 'AF-9', '2026-11-06', 100, 100) returning id`)).rows[0].id;
    expect(await h.fails("B", `insert into fin_self_invoice_statements (self_invoice_id, statement_id, amount) values ('${af}', '${ids.s3}', 100)`)).toMatch(/ja té una factura emesa/);
  });
});

describe("033 · cobraments", () => {
  it("l'autofactura no marca res com a cobrat; el cobrament parcial sí, i un duplicat es rebutja", async () => {
    expect((await sys<{ n: string }>(`select count(*)::text n from fin_ledger where kind='cobrament'`))[0].n).toBe("0");
    const rid = (await h.as<{ r: string }>("B", `select fin_register_receipt_net('${ids.s1}', 600, '2026-11-07', 'AF AF-1', null) r`)).rows[0].r;
    await h.as("B", `update fin_provider_receipts set doc_type='autofactura', self_invoice_id='${ids.af}' where id='${rid}'`);
    expect((await sys<{ s: string }>(`select sum(amount)::text s from fin_ledger where kind='cobrament'`))[0].s).toBe("600.00");
    expect(await h.fails("B", `select fin_register_receipt_net('${ids.s1}', 600, '2026-11-07', 'AF AF-1', null)`)).toMatch(/duplicate|unique/i);
    await h.as("B", `select fin_register_receipt_net('${ids.s1}', 400, '2026-11-08', 'AF AF-1', null)`);
    expect((await sys<{ s: string }>(`select sum(amount)::text s from fin_ledger where kind='cobrament'`))[0].s).toBe("1000.00");
    expect(await h.fails("B", `update fin_provider_receipts set doc_type='inventat' where id='${rid}'`)).toMatch(/check/);
  });
});
