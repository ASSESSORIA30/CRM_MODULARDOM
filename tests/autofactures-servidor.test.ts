/**
 * Migració 033 · «Registrar cobrament / autofactura» al servidor (Supabase en memòria; la RLS i els disparadors es
 * proven sobre PostgreSQL a tests/db/autofactures-rls.test.ts). Dades fictícies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("server-only", () => ({}));
const state: { sb: ReturnType<typeof fakeSupabase> } = { sb: fakeSupabase() };
vi.mock("@/server/supabase", async () => {
  class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
  return { adminClient: () => state.sb, HttpError, handler: () => () => null, requireUser: async () => null };
});

const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const admin = () => ({ sb: state.sb, user: { id: ADMIN }, profile: { id: ADMIN, name: "Direcció", role: "admin", email: "d@exemple.test", code: null } }) as never;
const comercial = () => ({ sb: state.sb, user: { id: id(77) }, profile: { id: id(77), name: "Com", role: "comercial", email: "c@exemple.test", code: null } }) as never;

function setup() {
  const db = {
    profiles: [{ id: ADMIN, name: "Direcció", role: "admin" }],
    fin_provider_statements: [
      { id: id(1), retailer: "Energia Fictícia", reference: "LIQ-1", received_at: "2026-11-02", period_from: "2026-10-01", period_to: "2026-10-31", declared_total: null, billing_mode: null },
      { id: id(2), retailer: "Energia Fictícia", reference: "LIQ-2", received_at: "2026-10-02", period_from: null, period_to: "2026-09-30", declared_total: null, billing_mode: null },
    ],
    fin_statement_lines: [
      { id: id(11), statement_id: id(1), amount: "600.00", match_status: "conciliat", expected_amount: null },
      { id: id(12), statement_id: id(1), amount: "400.00", match_status: "conciliat", expected_amount: null },
      { id: id(21), statement_id: id(2), amount: "300.00", match_status: "conciliat", expected_amount: null },
    ],
    fin_self_invoices: [], fin_self_invoice_statements: [], fin_provider_receipts: [], fin_ledger: [], bill_invoice_statements: [],
  };
  // cobrament net simulat: assigna per ordre a les línies conciliades (com fin_register_receipt_net)
  let n = 100;
  const rpcs = {
    fin_statement_billing_mode: () => "autofactura",
    fin_register_receipt_net: (a: unknown) => {
      const p = a as { p_statement: string; p_amount: string; p_date: string; p_ref: string };
      const rid = id(++n);
      let cash = Number(p.p_amount);
      for (const l of state.sb.db.fin_statement_lines.filter((x) => x.statement_id === p.p_statement)) {
        const paid = state.sb.db.fin_ledger.filter((g) => g.statement_line_id === l.id).reduce((s, g) => s + Number(g.amount), 0);
        const part = Math.min(Number(l.amount) - paid, cash);
        if (part > 0) { state.sb.db.fin_ledger.push({ id: id(++n), kind: "cobrament", amount: part.toFixed(2), statement_line_id: l.id, receipt_id: rid }); cash -= part; }
      }
      state.sb.db.fin_provider_receipts.push({ id: rid, statement_id: p.p_statement, amount: p.p_amount, received_at: p.p_date, bank_reference: p.p_ref, allocated: (Number(p.p_amount) - cash).toFixed(2), doc_type: "transferencia", self_invoice_id: null });
      return rid;
    },
  };
  state.sb = fakeSupabase(db as never, rpcs);
}
const sb = () => import("@/server/self-billing");
const base = { retailer: "Energia Fictícia", docType: "autofactura", docNumber: "AF-1", selfInvoice: { issueDate: "2026-11-05", base: "1000.00", vatRate: "21", vat: "210.00", withholding: "0", total: "1210.00" } };

describe("servidor · registrar cobrament / autofactura", () => {
  beforeEach(setup);

  it("registrar només l'autofactura no marca res com a cobrat", async () => {
    const { registerCollection } = await sb();
    const r = await registerCollection(admin(), { ...base, statements: [{ id: id(1), amount: "1000.00" }], confirm: true });
    expect(r.needsConfirmation).toBe(false);
    expect(state.sb.db.fin_self_invoices).toHaveLength(1);
    expect(state.sb.db.fin_self_invoice_statements).toEqual([expect.objectContaining({ statement_id: id(1), amount: "1000.00" })]);
    expect(state.sb.db.fin_provider_receipts).toHaveLength(0);
    expect(state.sb.db.fin_ledger).toHaveLength(0);
    if (!r.needsConfirmation) expect(r.states[0]).toMatchObject({ settlementState: "liquidada", collectionState: "pendent", pendingCollection: "1000.00" });
  });

  it("mostra les discrepàncies abans de desar (base ≠ suma vinculada) i no desa res fins a confirmar", async () => {
    const { registerCollection } = await sb();
    const r = await registerCollection(admin(), { ...base, statements: [{ id: id(1), amount: "900.00" }] });
    expect(r.needsConfirmation).toBe(true);
    if (r.needsConfirmation) expect(r.warnings.join(" ")).toMatch(/no coincideix amb la base/);
    expect(state.sb.db.fin_self_invoices).toHaveLength(0);
  });

  it("cobrament parcial i després total, amb el document vinculat al cobrament", async () => {
    const { registerCollection } = await sb();
    const r1 = await registerCollection(admin(), { ...base, statements: [{ id: id(1), amount: "1000.00" }], collected: "600", collectedAt: "2026-11-06", confirm: true });
    if (r1.needsConfirmation) throw new Error("no s'esperava confirmació");
    expect(r1.states[0].collectionState).toBe("parcial");
    expect(state.sb.db.fin_provider_receipts[0]).toMatchObject({ doc_type: "autofactura", self_invoice_id: r1.selfInvoiceId, bank_reference: "AF AF-1" });
    // segon cobrament de la mateixa autofactura (ja registrada): es reutilitza, no es duplica
    const r2 = await registerCollection(admin(), { ...base, selfInvoice: { existingId: r1.selfInvoiceId }, statements: [{ id: id(1), amount: "1000.00" }], collected: "400", collectedAt: "2026-11-07", confirm: true });
    if (r2.needsConfirmation) throw new Error("no s'esperava confirmació");
    expect(r2.states[0].collectionState).toBe("total");
    expect(state.sb.db.fin_self_invoices).toHaveLength(1);
    expect(state.sb.db.fin_self_invoice_statements).toHaveLength(1);
  });

  it("una autofactura per a diverses liquidacions reparteix el cobrament per ordre", async () => {
    const { registerCollection } = await sb();
    const r = await registerCollection(admin(), { ...base, selfInvoice: { ...base.selfInvoice, base: "1300.00", vat: "273.00", total: "1573.00" }, statements: [{ id: id(1), amount: "1000.00" }, { id: id(2), amount: "300.00" }], collected: "1300", collectedAt: "2026-11-06", confirm: true });
    if (r.needsConfirmation) throw new Error("no s'esperava confirmació");
    expect(r.receipts.map((x) => [x.statementId, x.allocated])).toEqual([[id(1), "1000.00"], [id(2), "300.00"]]);
    expect(r.states.every((s) => s.collectionState === "total")).toBe(true);
  });

  it("no vincula una liquidació ja facturada per Assessoria 3.0 ni accepta un total que no quadra", async () => {
    const { registerCollection } = await sb();
    state.sb.db.bill_invoices = [{ id: id(50), status: "emesa", kind: "ordinaria" }];
    state.sb.db.bill_invoice_statements.push({ invoice_id: id(50), statement_id: id(2), amount: "300" });
    await expect(registerCollection(admin(), { ...base, statements: [{ id: id(2), amount: "300.00" }], confirm: true })).rejects.toThrow(/doble facturació/);
    await expect(registerCollection(admin(), { ...base, selfInvoice: { ...base.selfInvoice, total: "1500" }, statements: [{ id: id(1), amount: "1000.00" }], confirm: true })).rejects.toThrow(/no quadra/);
  });

  it("un comercial no hi té accés", async () => {
    const { registerCollection, statementBilling } = await sb();
    await expect(registerCollection(comercial(), { ...base, statements: [{ id: id(1), amount: "1000.00" }] })).rejects.toThrow(/autorització/);
    await expect(statementBilling(comercial(), id(1))).rejects.toThrow(/restringides/);
  });
});
