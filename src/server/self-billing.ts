import "server-only";
/**
 * AUTOFACTURES I COBRAMENTS DE COMISSIONS (migració 033).
 *  - «Registrar cobrament / autofactura»: registra l'autofactura rebuda (document fiscal de la comercialitzadora, amb el
 *    PDF original), la vincula a una o diverses liquidacions i, si s'indica, el cobrament real (total o parcial).
 *  - Registrar una autofactura NO marca res com a cobrat: el cobrament passa sempre per fin_register_receipt(_net),
 *    que només assigna a comissions conciliades.
 *  - Una autofactura mai és una factura emesa per Assessoria 3.0: no crea res a «Facturació» i la base de dades impedeix
 *    facturar una liquidació que en té (i vincular-ne a una ja facturada).
 *  - El lector és local (text del PDF): no s'envia cap document a un proveïdor d'IA.
 */
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { D, money } from "@/core/commissions";
import { sniffDoc } from "@/core/crm";
import {
  collectionState, effectiveMode, proposeMatches, readSelfInvoiceText, reconcile, sameRetailer, settlementState,
  RECEIPT_DOC_TYPES, type BillingSystem, type LineForState, type StatementForMatch,
} from "@/core/self-billing";
import { adminClient, HttpError } from "./supabase";
import { parse, type U } from "./crm";
import { finStaff } from "./permissions";
import { registerReceipt } from "./finance";

const BUCKET = "fin-self-invoices";
const MIGRATION = "Falta aplicar la migració supabase/migrations/033_autofactures.sql a Supabase";
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no vàlida");
const amount = z.string().trim().transform((s) => s.replace(",", ".")).pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, "Import no vàlid"));
const optAmount = z.union([amount, z.literal("").transform(() => null), z.null()]).optional();
const today = () => new Date().toISOString().slice(0, 10);
type PgError = { code?: string; message?: string } | null;

function fail(e: PgError, fallback = "No s'ha pogut desar"): never {
  const m = e?.message ?? "";
  if (e?.code === "42P01" || e?.code === "42703" || e?.code === "PGRST205" || e?.code === "PGRST204" || e?.code === "PGRST202" || /fin_self_invoice|billing_mode|commission_billing|does not exist|schema cache/i.test(m)) throw new HttpError(409, MIGRATION);
  if (e?.code === "23505") throw new HttpError(409, /number_uq/.test(m) ? "Aquesta autofactura ja està registrada (mateixa comercialitzadora i número)." : /file_uq/.test(m) ? "Aquest PDF ja s'ha registrat com a autofactura." : "Aquest registre ja existeix (s'ha evitat un duplicat)");
  if (e?.code === "23514" && !/violates check constraint/i.test(m)) throw new HttpError(409, m);
  if (e?.code === "23514") throw new HttpError(400, /total/.test(m) ? "El total no quadra amb base + IVA − retenció" : "Hi ha dades amb un format no vàlid");
  if (e?.code === "42501" || /row-level security|permission denied/i.test(m)) throw new HttpError(403, /^(Només|Una |Les |L'autofactura)/.test(m) ? m : "No tens permís per fer aquesta acció");
  console.error("[autofactures]", e?.code, m.slice(0, 200));
  throw new HttpError(500, fallback);
}
const staff = async (u: U, action: "read" | "edit" = "read") => {
  if (!(await finStaff(u, action))) throw new HttpError(403, action === "edit" ? "No tens autorització per registrar cobraments ni autofactures (la concedeix Direcció)" : "Les dades econòmiques són restringides: cal autorització de Direcció");
};

/* ======================================================================= dades per liquidació */

type StRow = { id: string; retailer: string; reference: string; received_at: string; period_from: string | null; period_to: string | null; declared_total: string | null; billing_mode: string | null };
type LineRow = { id: string; statement_id: string; amount: string; match_status: string; expected_amount: string | null };

/** Imports i estats de les liquidacions indicades (o de totes les recents). */
async function statementFacts(u: U, ids?: string[], retailer?: string | null) {
  let q = u.sb.from("fin_provider_statements").select("id,retailer,reference,received_at,period_from,period_to,declared_total,billing_mode").order("received_at", { ascending: false });
  q = ids?.length ? q.in("id", ids) : q.limit(200);
  const st = await q;
  if (st.error) fail(st.error);
  const rows = ((st.data ?? []) as StRow[]).filter((s) => !retailer || sameRetailer(retailer, s.retailer));
  const sids = rows.map((s) => s.id);
  if (!sids.length) return [];
  const [lines, links, own] = await Promise.all([
    u.sb.from("fin_statement_lines").select("id,statement_id,amount,match_status,expected_amount").in("statement_id", sids),
    u.sb.from("fin_self_invoice_statements").select("statement_id,amount,self_invoice_id,fin_self_invoices(status)").in("statement_id", sids),
    u.sb.from("bill_invoice_statements").select("statement_id,bill_invoices(status,kind)").in("statement_id", sids),
  ]);
  if (lines.error) fail(lines.error);
  if (links.error) fail(links.error);
  const L = (lines.data ?? []) as LineRow[];
  const lineIds = L.map((l) => l.id);
  const cob = lineIds.length ? (((await u.sb.from("fin_ledger").select("statement_line_id,amount").eq("kind", "cobrament").in("statement_line_id", lineIds.slice(0, 1000))).data ?? []) as { statement_line_id: string; amount: string }[]) : [];
  const recs = (((await u.sb.from("fin_provider_receipts").select("statement_id,amount").in("statement_id", sids)).data ?? []) as { statement_id: string; amount: string }[]);
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  const modes = new Map<string, string | null>();
  await Promise.all(sids.map(async (id) => { const r = await u.sb.rpc("fin_statement_billing_mode", { p_statement: id }); if (r.error) fail(r.error); modes.set(id, (r.data as string | null) ?? null); }));
  return rows.map((s) => {
    const ls: LineForState[] = L.filter((l) => l.statement_id === s.id).map((l) => ({ amount: l.amount, match_status: l.match_status, expected_amount: l.expected_amount, collected: money(cob.filter((c) => c.statement_line_id === l.id).reduce((a, c) => a.plus(c.amount), D(0))) }));
    const si = ((links.data ?? []) as { statement_id: string; amount: string; fin_self_invoices: { status: string } | { status: string }[] | null }[])
      .filter((x) => x.statement_id === s.id && one(x.fin_self_invoices)?.status !== "anullada").reduce((a, x) => a.plus(x.amount), D(0));
    const hasOwn = ((own.data ?? []) as { statement_id: string; bill_invoices: { status: string; kind: string } | { status: string; kind: string }[] | null }[])
      .some((x) => { const i = one(x.bill_invoices); return x.statement_id === s.id && !!i && i.kind === "ordinaria" && ["emesa", "parcialment_cobrada", "cobrada"].includes(i.status); });
    const receipts = recs.filter((r) => r.statement_id === s.id).reduce((a, r) => a.plus(r.amount), D(0));
    const rec = reconcile(ls, si.toString(), receipts.toString());
    return {
      statement: s,
      mode: (modes.get(s.id) ?? effectiveMode(s.billing_mode, null)) as BillingSystem,
      hasOwnInvoice: hasOwn,
      lines: ls,
      reconcile: rec,
      settlementState: settlementState(ls, si.gt(0) && si.minus(rec.liquidated).abs().gt("0.01")),
      collectionState: collectionState(ls),
      forMatch: { id: s.id, retailer: s.retailer, reference: s.reference, received_at: s.received_at, period_from: s.period_from, period_to: s.period_to, declared_total: s.declared_total, conciliated: rec.conciliated, total: rec.liquidated, selfInvoiced: rec.selfInvoiced, billingMode: (modes.get(s.id) ?? null) as BillingSystem | null, hasOwnInvoice: hasOwn } satisfies StatementForMatch,
    };
  });
}

/** Estats i autofactures d'una liquidació (fitxa de la liquidació). */
export async function statementBilling(u: U, id: string) {
  await staff(u);
  const [f] = await statementFacts(u, [uuid.parse(id)]);
  if (!f) throw new HttpError(404, "Liquidació no trobada");
  const links = await u.sb.from("fin_self_invoice_statements").select("amount,self_invoice_id,fin_self_invoices(*)").eq("statement_id", id);
  if (links.error) fail(links.error);
  const recs = await u.sb.from("fin_provider_receipts").select("id,amount,received_at,bank_reference,allocated,doc_type,self_invoice_id").eq("statement_id", id).order("received_at");
  if (recs.error) fail(recs.error);
  type SI = { id: string; number: string; issue_date: string; base: string; vat: string; withholding: string; total: string; status: string; file_name: string | null; storage_path: string | null; source: string; doc_type: string; annulled_reason: string | null; notes: string | null };
  const one = <T,>(x: T | T[] | null | undefined) => (Array.isArray(x) ? x[0] : x) ?? null;
  return {
    mode: f.mode,
    hasOwnInvoice: f.hasOwnInvoice,
    settlementState: f.settlementState,
    collectionState: f.collectionState,
    reconcile: f.reconcile,
    selfInvoices: ((links.data ?? []) as { amount: string; fin_self_invoices: SI | SI[] | null }[]).map((x) => ({ ...one(x.fin_self_invoices)!, linked: x.amount, hasFile: !!one(x.fin_self_invoices)?.storage_path })).filter((x) => x.id).map((x) => { const { storage_path, ...rest } = x; void storage_path; return rest; }),
    receipts: recs.data ?? [],
  };
}

/** Estats de liquidació i de cobrament de totes les liquidacions recents (llistat). */
export async function statementStates(u: U) {
  await staff(u);
  const facts = await statementFacts(u);
  return { rows: facts.map((f) => ({ id: f.statement.id, mode: f.mode, settlementState: f.settlementState, collectionState: f.collectionState, selfInvoiced: f.reconcile.selfInvoiced, pendingCollection: f.reconcile.pendingCollection })) };
}

/* ======================================================================= lector */

type FileIn = { name: string; base64: string };
function decodePdf(file: FileIn) {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (ext !== "pdf") throw new HttpError(415, "L'autofactura s'ha d'adjuntar en PDF");
  const bytes = new Uint8Array(Buffer.from(file.base64, "base64"));
  if (!bytes.byteLength || bytes.byteLength > 5 * 1024 * 1024) throw new HttpError(413, "El PDF ha de tenir entre 1 byte i 5 MB");
  const s = sniffDoc(bytes, "pdf");
  if (!s.ok) throw new HttpError(415, s.reason ?? "El fitxer no és un PDF vàlid");
  return { bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * Llegeix una autofactura (PDF) amb el lector local i proposa les liquidacions que hi corresponen.
 * No desa res: l'administrador revisa els camps, les correspondències i les discrepàncies abans de confirmar.
 */
export async function previewSelfInvoice(u: U, raw: unknown, file?: FileIn) {
  await staff(u, "edit");
  const b = parse(z.object({ retailer: z.string().trim().max(120).nullish() }), raw ?? {});
  if (!file) throw new HttpError(400, "Adjunta el PDF de l'autofactura");
  const { bytes, sha } = decodePdf(file);
  const { pdfText } = await import("./doc-text");
  const doc = await pdfText(bytes);
  const read = readSelfInvoiceText(doc.pages);
  if (doc.scanned) read.warnings.unshift("El PDF sembla escanejat (sense text): omple els camps a mà a partir del document.");
  // comercialitzadora: la indicada, o la de les liquidacions que apareix al text
  const facts = await statementFacts(u);
  const text = doc.pages.join("\n");
  const retailer = b.retailer || [...new Set(facts.map((f) => f.statement.retailer))].find((r) => r.length >= 3 && new RegExp(`\\b${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) || null;
  const dupFile = (await u.sb.from("fin_self_invoices").select("id,number,retailer").eq("file_sha256", sha).neq("status", "anullada").limit(1)).data?.[0] ?? null;
  const dupNumber = retailer && read.number.value ? ((await u.sb.from("fin_self_invoices").select("id,number,retailer").ilike("number", read.number.value).neq("status", "anullada")).data ?? []).find((x) => sameRetailer(x.retailer as string, retailer)) ?? null : null;
  const proposals = proposeMatches({ retailer, base: read.base.value, issueDate: read.issueDate.value, periodFrom: read.periodFrom.value, periodTo: read.periodTo.value, references: read.references }, facts.map((f) => f.forMatch));
  return { read, retailer, proposals, duplicate: dupFile ?? dupNumber ?? null, fileSha: sha };
}

/** Correspondències per a dades introduïdes a mà (sense PDF). */
export async function proposeForSelfInvoice(u: U, raw: unknown) {
  await staff(u);
  const b = parse(z.object({ retailer: z.string().trim().max(120).nullish(), base: optAmount, issueDate: day.nullish(), number: z.string().trim().max(60).nullish() }), raw ?? {});
  const facts = await statementFacts(u, undefined, b.retailer ?? null);
  return { proposals: proposeMatches({ retailer: b.retailer ?? null, base: b.base ?? null, issueDate: b.issueDate ?? null, references: b.number ? [b.number] : [] }, facts.map((f) => f.forMatch)) };
}

/* ======================================================================= registrar cobrament / autofactura */

const registerInput = z.object({
  retailer: z.string().trim().min(1, "Indica la comercialitzadora").max(120),
  statements: z.array(z.object({ id: uuid, amount: amount })).min(1, "Tria almenys una liquidació").max(20),
  docType: z.enum(RECEIPT_DOC_TYPES),
  docNumber: z.string().trim().min(1, "Indica el número del document").max(60),
  /** Autofactura: dades fiscals (obligatòries si no se'n reutilitza una de ja registrada) */
  selfInvoice: z.object({
    existingId: uuid.nullish(),
    issueDate: day.nullish(), base: optAmount, vatRate: optAmount, vat: optAmount, withholding: optAmount, total: optAmount,
    periodFrom: day.nullish(), periodTo: day.nullish(), source: z.enum(["manual", "lector"]).default("manual"), readSummary: z.unknown().optional(),
  }).nullish(),
  /** Import liquidat que l'administrador ha comprovat (informatiu: es compara amb la liquidació) */
  liquidated: optAmount,
  /** Cobrament real. Buit = només es registra l'autofactura (res queda cobrat). */
  collected: optAmount,
  collectedAt: day.nullish(),
  net: z.boolean().default(true),
  notes: z.string().trim().max(1000).nullish(),
  /** L'administrador ha vist les discrepàncies i vol continuar */
  confirm: z.boolean().default(false),
});

export async function registerCollection(u: U, raw: unknown, file?: FileIn) {
  await staff(u, "edit");
  const b = parse(registerInput, raw);
  const ids = b.statements.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "Hi ha una liquidació repetida");
  const facts = await statementFacts(u, ids);
  if (facts.length !== ids.length) throw new HttpError(404, "Alguna de les liquidacions no existeix");
  for (const f of facts) if (!sameRetailer(b.retailer, f.statement.retailer)) throw new HttpError(400, `La liquidació ${f.statement.reference} és de ${f.statement.retailer}, no de ${b.retailer}`);
  const isSelf = b.docType === "autofactura";
  const si = b.selfInvoice ?? null;
  const collected = b.collected && D(b.collected).gt(0) ? D(b.collected) : null;
  if (collected && !b.collectedAt) throw new HttpError(400, "Indica la data del cobrament");
  if (b.collectedAt && b.collectedAt > today()) throw new HttpError(400, "La data del cobrament no pot ser futura");
  if (!isSelf && !collected) throw new HttpError(400, "Indica l'import cobrat (o tria «Autofactura» per registrar només el document)");
  if (b.statements.some((s) => D(s.amount).lte(0) && isSelf)) throw new HttpError(400, "L'import vinculat a cada liquidació ha de ser positiu");

  /* ---- discrepàncies: es mostren abans de desar res */
  const warnings: string[] = [];
  type Existing = { id: string; base: string; status: string; retailer: string; number: string };
  let existing: Existing | null = null;
  if (isSelf) {
    if (si?.existingId) {
      const r = await u.sb.from("fin_self_invoices").select("id,base,status,retailer,number").eq("id", si.existingId).maybeSingle();
      if (r.error) fail(r.error);
      if (!r.data) throw new HttpError(404, "Autofactura no trobada");
      existing = r.data as Existing;
      if (existing.status === "anullada") throw new HttpError(409, "L'autofactura està anul·lada");
    } else {
      if (!si?.issueDate || si.base == null || si.total == null) throw new HttpError(400, "Per registrar l'autofactura cal la data, la base imposable i el total");
      const calc = D(si.base).plus(si.vat ?? 0).minus(si.withholding ?? 0);
      if (calc.minus(si.total).abs().gt("0.02")) throw new HttpError(400, `El total (${money(si.total)} €) no quadra amb base + IVA − retenció (${money(calc)} €)`);
      if (si.issueDate > today()) throw new HttpError(400, "La data de l'autofactura no pot ser futura");
      if (!file) warnings.push("No s'ha adjuntat el PDF de l'autofactura: cal conservar el document original per complir les obligacions fiscals.");
    }
    const linked = b.statements.reduce((a, s) => a.plus(s.amount), D(0));
    const base = existing ? D(existing.base) : D(si!.base!);
    if (linked.minus(base).abs().gt("0.01")) warnings.push(`La suma vinculada a les liquidacions (${money(linked)} €) no coincideix amb la base de l'autofactura (${money(base)} €).`);
  }
  for (const f of facts) {
    if (isSelf && f.hasOwnInvoice) throw new HttpError(409, `La liquidació ${f.statement.reference} ja té una factura emesa per Assessoria 3.0: no s'hi pot vincular una autofactura (seria una doble facturació).`);
    if (!isSelf && f.mode === "autofactura" && !collected) warnings.push(`${f.statement.reference}: es factura amb autofactura.`);
    const link = b.statements.find((s) => s.id === f.statement.id)!;
    const remaining = D(f.reconcile.conciliated).gt(0) ? D(f.reconcile.conciliated) : D(f.reconcile.liquidated);
    if (isSelf && D(link.amount).plus(f.reconcile.selfInvoiced).minus(remaining).gt("0.01")) warnings.push(`${f.statement.reference}: amb aquesta autofactura s'autofacturarien ${money(D(link.amount).plus(f.reconcile.selfInvoiced))} € i la liquidació en té ${money(remaining)} €.`);
    if (f.mode === "factura_propia" && isSelf) warnings.push(`${f.statement.reference}: la comercialitzadora està configurada amb factura pròpia. Si continues, aquesta liquidació passarà a «autofactura».`);
    for (const d of f.reconcile.discrepancies) warnings.push(`${f.statement.reference}: ${d}`);
  }
  if (b.liquidated) {
    const liq = facts.reduce((a, f) => a.plus(f.reconcile.liquidated), D(0));
    if (D(b.liquidated).minus(liq).abs().gt("0.01")) warnings.push(`Import liquidat indicat (${money(b.liquidated)} €) ≠ liquidat a la conciliació (${money(liq)} €).`);
  }
  if (collected) {
    const pend = facts.reduce((a, f) => a.plus(f.reconcile.pendingCollection), D(0));
    if (collected.gt(pend.plus("0.01"))) warnings.push(`El cobrament (${money(collected)} €) supera el pendent de cobrar de les comissions conciliades (${money(pend)} €): la diferència quedarà sense assignar.`);
    else if (collected.plus("0.01").lt(pend)) warnings.push(`Cobrament parcial: quedaran ${money(pend.minus(collected))} € pendents de cobrar.`);
  }
  const blocking = warnings.filter((w) => !/^Cobrament parcial/.test(w));
  if (blocking.length && !b.confirm) return { needsConfirmation: true as const, warnings };

  /* ---- 1. autofactura (document fiscal) */
  let selfInvoiceId: string | null = existing?.id ?? null;
  if (isSelf && !existing) {
    let path: string | null = null, sha: string | null = null, fileName: string | null = null;
    if (file) {
      const d = decodePdf(file);
      sha = d.sha; fileName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 200);
      path = `${new Date().getUTCFullYear()}/${randomUUID()}.pdf`;
      const up = await adminClient().storage.from(BUCKET).upload(path, Buffer.from(d.bytes), { contentType: "application/pdf", upsert: false });
      if (up.error) throw new HttpError(/not found/i.test(up.error.message) ? 409 : 502, /not found/i.test(up.error.message) ? `Falta el bucket ${BUCKET}: aplica la migració 033` : "No s'ha pogut desar el PDF de l'autofactura");
    }
    const ins = await u.sb.from("fin_self_invoices").insert({
      retailer: b.retailer, doc_type: "autofactura", number: b.docNumber, issue_date: si!.issueDate, base: si!.base, vat_rate: si!.vatRate ?? null, vat: si!.vat ?? "0", withholding: si!.withholding ?? "0", total: si!.total,
      period_from: si!.periodFrom ?? null, period_to: si!.periodTo ?? null, file_name: fileName, storage_path: path, file_sha256: sha, source: si!.source, read_summary: si!.readSummary ?? null, notes: b.notes ?? null, created_by: u.user.id,
    }).select("id").single();
    if (ins.error) { if (path) await adminClient().storage.from(BUCKET).remove([path]).then(() => undefined, () => undefined); fail(ins.error); }
    selfInvoiceId = ins.data!.id as string;
  }
  if (isSelf && selfInvoiceId) {
    const prev = ((await u.sb.from("fin_self_invoice_statements").select("statement_id").eq("self_invoice_id", selfInvoiceId)).data ?? []).map((x) => x.statement_id as string);
    const add = b.statements.filter((s) => !prev.includes(s.id)).map((s) => ({ self_invoice_id: selfInvoiceId, statement_id: s.id, amount: money(s.amount), created_by: u.user.id }));
    if (add.length) { const l = await u.sb.from("fin_self_invoice_statements").insert(add); if (l.error) fail(l.error); }
  }

  /* ---- 2. cobrament real (opcional; parcial permès). Es reparteix per ordre entre les liquidacions */
  const receipts: { statementId: string; id: string; allocated: string; unallocated: string }[] = [];
  if (collected) {
    let left = collected;
    for (let i = 0; i < facts.length && left.gt(0); i++) {
      const f = facts[i];
      const last = i === facts.length - 1;
      const part = last ? left : (D(f.reconcile.pendingCollection).lt(left) ? D(f.reconcile.pendingCollection) : left);
      if (part.lte(0)) continue;
      const ref = `${b.docType === "transferencia" ? "" : b.docType === "autofactura" ? "AF " : `${b.docType} `}${b.docNumber}${facts.length > 1 ? ` · ${f.statement.reference}` : ""}`.slice(0, 120);
      const r = await registerReceipt(u, f.statement.id, { amount: money(part), received_at: b.collectedAt!, bank_reference: ref, notes: b.notes ?? null, net: b.net });
      const up = await u.sb.from("fin_provider_receipts").update({ doc_type: b.docType, self_invoice_id: selfInvoiceId }).eq("id", r.id as string);
      if (up.error) fail(up.error);
      receipts.push({ statementId: f.statement.id, id: r.id as string, allocated: String(r.allocated), unallocated: r.unallocated });
      left = left.minus(part);
    }
  }
  const after = await statementFacts(u, ids);
  return {
    needsConfirmation: false as const,
    selfInvoiceId,
    receipts,
    warnings,
    states: after.map((f) => ({ id: f.statement.id, reference: f.statement.reference, settlementState: f.settlementState, collectionState: f.collectionState, pendingCollection: f.reconcile.pendingCollection })),
  };
}

/* ======================================================================= altres accions */

export async function listSelfInvoices(u: U, raw: Record<string, string> = {}) {
  await staff(u);
  let q = u.sb.from("fin_self_invoices").select("id,retailer,number,issue_date,base,vat,withholding,total,status,file_name,source,annulled_reason,created_at,fin_self_invoice_statements(statement_id,amount)").order("issue_date", { ascending: false }).limit(300);
  if (raw.retailer) q = q.ilike("retailer", raw.retailer);
  const r = await q;
  if (r.error) fail(r.error);
  return { rows: r.data ?? [] };
}

export async function annulSelfInvoice(u: U, id: string, raw: unknown) {
  await staff(u, "edit");
  const b = parse(z.object({ reason: z.string().trim().min(3, "Indica el motiu de l'anul·lació").max(500) }), raw);
  const used = await u.sb.from("fin_provider_receipts").select("id").eq("self_invoice_id", uuid.parse(id)).limit(1);
  if (used.error) fail(used.error);
  if (used.data?.length) throw new HttpError(409, "Aquesta autofactura ja té cobraments registrats: no s'anul·la (registra una rectificativa o un ajustament).");
  const r = await u.sb.from("fin_self_invoices").update({ status: "anullada", annulled_reason: b.reason }).eq("id", id).neq("status", "anullada").select("id").maybeSingle();
  if (r.error) fail(r.error);
  if (!r.data) throw new HttpError(404, "Autofactura no trobada o ja anul·lada");
  return { ok: true };
}

export async function selfInvoiceFileUrl(u: U, id: string) {
  await staff(u);
  const r = await u.sb.from("fin_self_invoices").select("storage_path,file_name").eq("id", uuid.parse(id)).maybeSingle();
  if (r.error) fail(r.error);
  if (!r.data?.storage_path) throw new HttpError(404, "Aquesta autofactura no té PDF adjunt");
  const s = await adminClient().storage.from(BUCKET).createSignedUrl(r.data.storage_path as string, 60, { download: (r.data.file_name as string) ?? true });
  if (s.error || !s.data) throw new HttpError(404, "El PDF ja no és a l'emmagatzematge");
  return { url: s.data.signedUrl };
}

/** Sistema mixt: decidir si una liquidació concreta es cobra amb autofactura o amb factura pròpia. */
export async function setStatementBillingMode(u: U, id: string, raw: unknown) {
  await staff(u, "edit");
  const b = parse(z.object({ mode: z.enum(["factura_propia", "autofactura"]).nullable() }), raw);
  const [f] = await statementFacts(u, [uuid.parse(id)]);
  if (!f) throw new HttpError(404, "Liquidació no trobada");
  if (b.mode !== "autofactura" && D(f.reconcile.selfInvoiced).gt(0)) throw new HttpError(409, "Aquesta liquidació té autofactures vinculades: no pot passar a factura pròpia");
  if (b.mode === "autofactura" && f.hasOwnInvoice) throw new HttpError(409, "Aquesta liquidació ja té una factura emesa per Assessoria 3.0");
  const r = await u.sb.from("fin_provider_statements").update({ billing_mode: b.mode }).eq("id", id);
  if (r.error) fail(r.error);
  return { ok: true };
}
