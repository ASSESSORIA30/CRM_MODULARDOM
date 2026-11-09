/**
 * AUTOFACTURES I COBRAMENTS DE COMISSIONS (lògica pura, sense base de dades).
 *  - Sistema de facturació de cada comercialitzadora: factura pròpia, autofactura o mixt.
 *  - Lector local d'autofactures (text del PDF): número, data, base, IVA, retenció, total i període. No envia res a cap IA.
 *  - Proposta de correspondències amb les liquidacions (comercialitzadora, imports, dates i referències).
 *  - Estats independents de liquidació i de cobrament, i diferències entre esperat, liquidat, autofacturat i cobrat.
 * Regla: carregar una autofactura MAI marca res com a cobrat; el cobrament es registra a part (pot ser parcial).
 */
import { D, money, parseAmount } from "./commissions";
import { parseDate } from "./settlement-reader";

export const BILLING_SYSTEMS = ["factura_propia", "autofactura", "mixt"] as const;
export type BillingSystem = (typeof BILLING_SYSTEMS)[number];
export const BILLING_SYSTEM_LABEL: Record<BillingSystem, string> = {
  factura_propia: "Factura emesa per Assessoria 3.0",
  autofactura: "Autofactura emesa per la comercialitzadora",
  mixt: "Sistema mixt (depèn de la liquidació)",
};

export const RECEIPT_DOC_TYPES = ["transferencia", "autofactura", "compensacio", "altres"] as const;
export type ReceiptDocType = (typeof RECEIPT_DOC_TYPES)[number];
export const RECEIPT_DOC_LABEL: Record<ReceiptDocType, string> = { transferencia: "Transferència bancària", autofactura: "Autofactura", compensacio: "Compensació", altres: "Altres" };

export type SettlementState = "pendent" | "liquidada" | "discrepancies";
export const SETTLEMENT_STATE_LABEL: Record<SettlementState, string> = { pendent: "Pendent", liquidada: "Liquidada", discrepancies: "Amb discrepàncies" };
export type CollectionState = "pendent" | "parcial" | "total";
export const COLLECTION_STATE_LABEL: Record<CollectionState, string> = { pendent: "Pendent de cobrament", parcial: "Cobrat parcialment", total: "Cobrat totalment" };

const TOL = D("0.01");

/* ======================================================================= lector d'autofactures */

export interface ReadField<T> { value: T | null; evidence: string | null }
export interface SelfInvoiceRead {
  isSelfInvoice: boolean;
  /** Frases que indiquen que és una autofactura (facturació pel destinatari) */
  signals: string[];
  number: ReadField<string>;
  issueDate: ReadField<string>;
  base: ReadField<string>;
  vatRate: ReadField<string>;
  vat: ReadField<string>;
  withholding: ReadField<string>;
  total: ReadField<string>;
  periodFrom: ReadField<string>;
  periodTo: ReadField<string>;
  /** Referències que poden ser d'una liquidació (codis alfanumèrics llargs) */
  references: string[];
  warnings: string[];
}

const SIGNALS: [RegExp, string][] = [
  [/auto[\s-]?factura(ci[oó]n)?/i, "autofactura"],
  [/facturaci[oó]n\s+(realizada\s+)?por\s+(el\s+)?destinatario/i, "facturació pel destinatari"],
  [/(expedida|emitida)\s+por\s+(el\s+)?destinatario/i, "expedida pel destinatari"],
  [/factura\s+emesa\s+pel\s+destinatari/i, "emesa pel destinatari"],
  [/art(\.|[ií]culo)?\s*5\s*(del\s+)?(r\.?\s*d\.?|real\s+decreto)\s*1619\/2012/i, "art. 5 RD 1619/2012"],
];

const AMOUNT = String.raw`(-?\(?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})|-?\(?\d+(?:[.,]\d{1,2})?)\)?\s*€?`;
const DATE = String.raw`(\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}-\d{2}-\d{2})`;

function first(text: string, patterns: RegExp[]): { m: RegExpMatchArray; line: string } | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const idx = m.index ?? 0;
      const start = text.lastIndexOf("\n", idx) + 1;
      const end = text.indexOf("\n", idx + m[0].length);
      return { m, line: text.slice(start, end < 0 ? undefined : end).trim().slice(0, 160) };
    }
  }
  return null;
}
const field = <T,>(v: T | null, evidence: string | null): ReadField<T> => ({ value: v, evidence: v == null ? null : evidence });

/** Llegeix el text d'una autofactura (PDF ja convertit a text). Mai inventa valors: el que no troba queda buit. */
export function readSelfInvoiceText(pages: string[] | string): SelfInvoiceRead {
  const text = (Array.isArray(pages) ? pages.join("\n") : pages).replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const signals = SIGNALS.filter(([re]) => re.test(text)).map(([, l]) => l);
  const warnings: string[] = [];

  const num = first(text, [
    /(?:n[º°o]\.?\s*(?:de\s+)?(?:auto)?factura|n[uú]mero\s+(?:de\s+)?(?:auto)?factura|(?:auto)?factura\s+n[º°o]\.?|factura\s+n[uú]m\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,40})/i,
    /\b(?:invoice\s+(?:no|number))\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_.]{2,40})/i,
  ]);
  const date = first(text, [
    new RegExp(String.raw`fecha\s+(?:de\s+)?(?:emisi[oó]n|expedici[oó]n|factura)\s*[:\-]?\s*${DATE}`, "i"),
    new RegExp(String.raw`data\s+(?:d'|de\s+)?(?:emissi[oó]|expedici[oó]|factura)\s*[:\-]?\s*${DATE}`, "i"),
    new RegExp(String.raw`\bfecha\s*[:\-]?\s*${DATE}`, "i"),
  ]);
  const base = first(text, [new RegExp(String.raw`base\s+imponible[^\d\n-]{0,30}${AMOUNT}`, "i"), new RegExp(String.raw`base\s+imposable[^\d\n-]{0,30}${AMOUNT}`, "i")]);
  const vat = first(text, [
    new RegExp(String.raw`(?:cuota\s+)?i\.?v\.?a\.?\s*\(?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*\)?[^\d\n-]{0,20}${AMOUNT}`, "i"),
    new RegExp(String.raw`(\d{1,2}(?:[.,]\d{1,2})?)\s*%\s*i\.?v\.?a\.?[^\d\n-]{0,20}${AMOUNT}`, "i"),
  ]);
  const vatOnly = vat ? null : first(text, [new RegExp(String.raw`(?:cuota\s+(?:de\s+)?)?i\.?v\.?a\.?[^\d\n%-]{0,20}${AMOUNT}`, "i")]);
  const wh = first(text, [new RegExp(String.raw`(?:retenci[oó]n|i\.?r\.?p\.?f\.?)[^\d\n-]{0,30}(?:\d{1,2}(?:[.,]\d{1,2})?\s*%[^\d\n-]{0,10})?${AMOUNT}`, "i")]);
  const total = first(text, [
    new RegExp(String.raw`total\s+(?:a\s+(?:pagar|percibir|cobrar)|(?:de\s+la\s+)?(?:auto)?factura|importe)[^\d\n-]{0,20}${AMOUNT}`, "i"),
    new RegExp(String.raw`\btotal\b[^\d\n-]{0,20}${AMOUNT}`, "i"),
  ]);
  const period = first(text, [
    new RegExp(String.raw`(?:periodo|per[ií]ode)[^\d\n]{0,25}${DATE}\s*(?:-|a|al|hasta|fins)\s*(?:el\s+)?${DATE}`, "i"),
    new RegExp(String.raw`\bdel\s+${DATE}\s+al\s+${DATE}`, "i"),
  ]);

  const amt = (s: string | undefined) => (s ? parseAmount(s.replace(/\s/g, "")) : null);
  const out: SelfInvoiceRead = {
    isSelfInvoice: signals.length > 0,
    signals,
    number: field(num?.m[1]?.replace(/[.,;:]+$/, "") ?? null, num?.line ?? null),
    issueDate: field(date ? parseDate(date.m[1]) : null, date?.line ?? null),
    base: field(amt(base?.m[1]), base?.line ?? null),
    vatRate: field(vat ? D(vat.m[1].replace(",", ".")).toString() : null, vat?.line ?? null),
    vat: field(amt(vat?.m[2] ?? vatOnly?.m[1]), (vat ?? vatOnly)?.line ?? null),
    withholding: field(wh ? amt(wh.m[1])?.replace("-", "") ?? null : null, wh?.line ?? null),
    total: field(amt(total?.m[1]), total?.line ?? null),
    periodFrom: field(period ? parseDate(period.m[1]) : null, period?.line ?? null),
    periodTo: field(period ? parseDate(period.m[2]) : null, period?.line ?? null),
    references: [...new Set([...text.matchAll(/\b(?:ref(?:erencia|erència)?|liquidaci[oó]n?)(?:\s+(?:de\s+(?:la\s+)?)?liquidaci[oó]n?)?\.?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_.]{3,40})/gi)].map((m) => m[1].replace(/[.,;:]+$/, "")).filter((x) => /\d/.test(x)))].slice(0, 10),
    warnings,
  };
  if (!out.isSelfInvoice) warnings.push("El document no diu que sigui una autofactura (facturació pel destinatari): revisa'l abans de registrar-lo.");
  // coherència: base + IVA − retenció = total (no s'omple cap valor que falti)
  if (out.base.value && out.total.value) {
    const calc = D(out.base.value).plus(out.vat.value ?? 0).minus(out.withholding.value ?? 0);
    if (calc.minus(out.total.value).abs().gt("0.02")) warnings.push(`La suma no quadra: base ${money(out.base.value)} + IVA ${money(out.vat.value ?? 0)} − retenció ${money(out.withholding.value ?? 0)} = ${money(calc)} ≠ total ${money(out.total.value)}.`);
  }
  for (const [k, l] of [["number", "número"], ["issueDate", "data"], ["base", "base imposable"], ["total", "total"]] as const) if (out[k].value == null) warnings.push(`No s'ha trobat ${l === "data" ? "la data" : l === "total" ? "el total" : l === "número" ? "el número" : "la base imposable"}: omple-ho a mà.`);
  return out;
}

/* ======================================================================= correspondències amb liquidacions */

export interface StatementForMatch {
  id: string;
  retailer: string;
  reference: string;
  received_at: string;
  period_from: string | null;
  period_to: string | null;
  declared_total: string | null;
  /** Net de les línies conciliades (comissions − retrocomissions) */
  conciliated: string;
  /** Net de totes les línies vàlides (sense duplicats ni descartades) */
  total: string;
  /** Base ja coberta per altres autofactures */
  selfInvoiced: string;
  billingMode: BillingSystem | null;
  hasOwnInvoice: boolean;
}
export interface MatchProposal {
  statementId: string;
  label: string;
  score: number;
  reasons: string[];
  /** Base proposada per a aquesta liquidació (el que encara no cobreix cap autofactura) */
  amount: string;
  discrepancies: string[];
  blocked: string | null;
}

const normName = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(s\.?l\.?u?|s\.?a\.?u?|energia|energy|comercializadora|comercialitzadora)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
export function sameRetailer(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `) || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
}
const days = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;

/**
 * Proposa a quines liquidacions correspon una autofactura (no en tria cap sola: l'administrador confirma).
 * Criteris: comercialitzadora, import (base vs net conciliat o total), període/dates i referències del document.
 */
export function proposeMatches(inv: { retailer: string | null; base: string | null; issueDate: string | null; periodFrom?: string | null; periodTo?: string | null; references?: string[] }, statements: StatementForMatch[]): MatchProposal[] {
  const out: MatchProposal[] = [];
  for (const s of statements) {
    if (inv.retailer && !sameRetailer(inv.retailer, s.retailer)) continue;
    const reasons: string[] = [];
    let score = inv.retailer ? 30 : 0;
    if (inv.retailer) reasons.push("Mateixa comercialitzadora");
    const open = D(s.conciliated).gt(0) ? D(s.conciliated) : D(s.total);
    const remaining = D(open).minus(s.selfInvoiced);
    if (inv.base) {
      const b = D(inv.base);
      if (b.minus(remaining).abs().lte(TOL)) { score += 40; reasons.push("La base coincideix amb l'import pendent d'autofacturar"); }
      else if (b.minus(s.total).abs().lte(TOL)) { score += 30; reasons.push("La base coincideix amb el total de la liquidació"); }
      else if (s.declared_total && b.minus(s.declared_total).abs().lte(TOL)) { score += 30; reasons.push("La base coincideix amb el total declarat"); }
      else if (remaining.gt(0) && b.lt(remaining)) { score += 5; reasons.push("La base és inferior al pendent (pot cobrir-ne una part)"); }
    }
    if (inv.periodTo && s.period_to && inv.periodTo === s.period_to) { score += 20; reasons.push("Mateix període"); }
    else if (inv.issueDate) {
      const ref = s.period_to ?? s.received_at;
      const dd = days(inv.issueDate, ref);
      if (dd <= 45) { score += Math.round(15 - dd / 3); reasons.push(`Data propera (${Math.round(dd)} dies)`); }
    }
    if (inv.references?.some((r) => r && s.reference && (s.reference.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(s.reference.toLowerCase())))) { score += 25; reasons.push("La referència apareix al document"); }
    const discrepancies: string[] = [];
    if (inv.base && remaining.gt(0) && D(inv.base).minus(remaining).abs().gt(TOL) && D(inv.base).gt(remaining)) discrepancies.push(`La base (${money(inv.base)} €) supera el pendent d'autofacturar d'aquesta liquidació (${money(remaining)} €).`);
    if (D(s.selfInvoiced).gt(0)) discrepancies.push(`Aquesta liquidació ja té ${money(s.selfInvoiced)} € coberts per altres autofactures.`);
    if (s.billingMode === "factura_propia") discrepancies.push("La comercialitzadora està configurada amb factura pròpia d'Assessoria 3.0: confirma que aquesta liquidació va amb autofactura.");
    const blocked = s.hasOwnInvoice ? "Ja té una factura emesa per Assessoria 3.0" : null;
    const amount = inv.base ? money(remaining.gt(0) && D(inv.base).gt(remaining) ? remaining : inv.base) : money(remaining.gt(0) ? remaining : 0);
    out.push({ statementId: s.id, label: `${s.retailer} · ${s.reference}${s.period_to ? ` · fins al ${s.period_to}` : ""}`, score, reasons, amount, discrepancies, blocked });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

/* ======================================================================= estats i diferències */

export interface LineForState { amount: string; match_status: string; expected_amount: string | null; collected: string }

/** Estat de liquidació: pendent (falten línies per conciliar), liquidada o amb discrepàncies. */
export function settlementState(lines: LineForState[], selfInvoiceDiff = false): SettlementState {
  const live = lines.filter((l) => !["descartat", "duplicat"].includes(l.match_status));
  if (!live.length) return "pendent";
  if (selfInvoiceDiff || live.some((l) => ["diferencia", "no_identificat"].includes(l.match_status)) || lines.some((l) => l.match_status === "duplicat")) return "discrepancies";
  return live.every((l) => l.match_status === "conciliat") ? "liquidada" : "pendent";
}

/** Estat de cobrament: es compara el cobrat amb les comissions conciliades (mai amb el que diu l'autofactura). */
export function collectionState(lines: LineForState[]): CollectionState {
  const due = lines.filter((l) => l.match_status === "conciliat" && D(l.amount).gt(0)).reduce((a, l) => a.plus(l.amount), D(0));
  const got = lines.reduce((a, l) => a.plus(l.collected || 0), D(0));
  if (got.lte(0)) return "pendent";
  return got.plus(TOL).gte(due) && due.gt(0) ? "total" : "parcial";
}

export interface Reconcile {
  expected: string | null;
  liquidated: string;
  conciliated: string;
  selfInvoiced: string;
  collected: string;
  pendingCollection: string;
  discrepancies: string[];
}
/**
 * Comissions esperades (càlcul del CRM), liquidades (comunicades per la comercialitzadora), autofacturades i cobrades.
 * Cada diferència es diu amb l'import; no es corregeix res automàticament.
 */
export function reconcile(lines: LineForState[], selfInvoicedBase: string | number = 0, receiptsTotal?: string | number | null): Reconcile {
  const live = lines.filter((l) => !["descartat", "duplicat"].includes(l.match_status));
  const liquidated = live.reduce((a, l) => a.plus(l.amount), D(0));
  const conciliated = live.filter((l) => l.match_status === "conciliat").reduce((a, l) => a.plus(l.amount), D(0));
  const withExpected = live.filter((l) => l.expected_amount != null);
  const expected = withExpected.length ? withExpected.reduce((a, l) => a.plus(l.expected_amount!), D(0)) : null;
  const collected = live.reduce((a, l) => a.plus(l.collected || 0), D(0));
  const dueGross = live.filter((l) => l.match_status === "conciliat" && D(l.amount).gt(0)).reduce((a, l) => a.plus(l.amount), D(0));
  const d: string[] = [];
  if (expected && withExpected.length) {
    const liqWithExp = withExpected.reduce((a, l) => a.plus(l.amount), D(0));
    if (expected.minus(liqWithExp).abs().gt(TOL)) d.push(`Esperat ${money(expected)} € ≠ liquidat ${money(liqWithExp)} € (diferència ${money(liqWithExp.minus(expected))} €).`);
  }
  const si = D(selfInvoicedBase || 0);
  if (si.gt(0) && si.minus(liquidated).abs().gt(TOL)) d.push(`Autofacturat ${money(si)} € ≠ liquidat ${money(liquidated)} € (diferència ${money(si.minus(liquidated))} €).`);
  if (receiptsTotal != null && D(receiptsTotal).gt(0) && D(receiptsTotal).minus(collected).abs().gt(TOL)) d.push(`Cobrat ${money(receiptsTotal)} € però només ${money(collected)} € assignats a comissions conciliades (la resta queda sense assignar).`);
  const unident = live.filter((l) => ["no_identificat", "diferencia", "pendent", "identificat"].includes(l.match_status)).length;
  if (unident) d.push(`${unident} línies encara no conciliades: no es poden marcar com a cobrades.`);
  return { expected: expected ? money(expected) : null, liquidated: money(liquidated), conciliated: money(conciliated), selfInvoiced: money(si), collected: money(collected), pendingCollection: money(dueGross.minus(collected).gt(0) ? dueGross.minus(collected) : 0), discrepancies: d };
}

/** Mode efectiu d'una liquidació: el seu propi o el de la comercialitzadora (mixt = cal decidir). */
export function effectiveMode(statementMode: string | null | undefined, retailerSystem: string | null | undefined): BillingSystem {
  if (statementMode === "autofactura" || statementMode === "factura_propia") return statementMode;
  if (retailerSystem === "autofactura" || retailerSystem === "mixt") return retailerSystem;
  return "factura_propia";
}
