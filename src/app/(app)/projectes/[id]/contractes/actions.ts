"use server";

// Contractes (només direcció): lectura amb IA, correccions, discrepàncies i validació.
// La base de dades bloqueja qualsevol canvi un cop validat.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { structuredCall, type Block } from "@/lib/ai/provider";
import { requireRole } from "@/lib/auth";
import { docxText, pdfPageTexts } from "@/lib/contracts/extract-text";
import { flattenMilestones, PROMPT_VERSION, READING_SYSTEM, readingJsonSchema, readingSchema, verifyReading } from "@/lib/contracts/reading";
import { isValidDateKey } from "@/lib/dates";
import { extensionOf } from "@/lib/files";
import { optText, reqText, reqUuid } from "@/lib/forms";
import { parseEurosToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 100;

async function contractProject(supabase: Awaited<ReturnType<typeof createClient>>, contractId: string) {
  const { data } = await supabase.from("contracts").select("project_id").eq("id", contractId).maybeSingle();
  return data?.project_id ?? null;
}
const refresh = (projectId: string, contractId: string) => revalidatePath(`/projectes/${projectId}/contractes/${contractId}`);

export async function createContractAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ projectId: reqUuid, documentId: reqUuid, title: reqText(200), quoteVersionId: z.string().uuid().or(z.literal("")) })
    .safeParse({ projectId: formData.get("projectId"), documentId: formData.get("documentId"), title: formData.get("title"), quoteVersionId: formData.get("quoteVersionId") ?? "" });
  if (!p.success) return { ok: false, error: "required" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_contract", {
    p_project_id: p.data.projectId, p_document_id: p.data.documentId, p_title: p.data.title, p_quote_version_id: p.data.quoteVersionId || null,
  });
  if (error) return fromPgError(error);
  redirect(`/projectes/${p.data.projectId}/contractes/${data}`);
}

// --- Lectura amb IA ----------------------------------------------------------------------
export async function readContractAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("contractId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contracts")
    .select("id, project_id, status, quote_version_id, documents(bucket_id, storage_path, mime_type, size_bytes)").eq("id", id.data).maybeSingle();
  if (!c) return { ok: false, error: "forbidden" };
  if (c.status === "validat" || c.status === "substituit") return { ok: false, error: "contractLocked" };
  const doc = (Array.isArray(c.documents) ? c.documents[0] : c.documents) as { bucket_id: string; storage_path: string; mime_type: string | null; size_bytes: number | null } | null;
  if (!doc) return { ok: false, error: "invalidDocument" };
  if ((doc.size_bytes ?? 0) > MAX_PDF_BYTES) return { ok: false, error: "fileTooLarge" };
  const dl = await supabase.storage.from(doc.bucket_id).download(doc.storage_path);
  if (dl.error || !dl.data) return { ok: false, error: "genericError" };
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const ext = extensionOf(doc.storage_path);

  let content: Block[];
  let pageTexts: string[] | null = null;
  let numPages: number | null = null;
  if (ext === "pdf") {
    const t = await pdfPageTexts(bytes);
    if (!t) return { ok: false, error: "invalidDocument" };
    if (t.numPages > MAX_PDF_PAGES) return { ok: false, error: "tooManyPages" };
    numPages = t.numPages;
    pageTexts = t.pages.length ? t.pages : null; // PDF escanejat: sense capa de text
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
      { type: "text", text: `Contracte en PDF de ${t.numPages} pàgines. Extreu-ne les dades amb l'eina.` },
    ];
  } else if (ext === "docx") {
    const t = docxText(bytes);
    if (!t) return { ok: false, error: "invalidDocument" };
    content = [{ type: "text", text: `Contracte en format DOCX (no té pàgines: posa page = null).\n\n${t.slice(0, 400_000)}` }];
  } else if (ext === "jpg" || ext === "jpeg" || ext === "png") {
    numPages = 1;
    content = [
      { type: "image", source: { type: "base64", media_type: ext === "png" ? "image/png" : "image/jpeg", data: Buffer.from(bytes).toString("base64") } },
      { type: "text", text: "Contracte escanejat (una pàgina). Extreu-ne les dades amb l'eina." },
    ];
  } else {
    return { ok: false, error: "fileTypeNotAllowed" };
  }

  const ai = await structuredCall({
    system: READING_SYSTEM, content, toolName: "registrar_contracte",
    toolDescription: "Registra les dades del contracte tal com hi són escrites, amb pàgina i text original.",
    inputSchema: readingJsonSchema, maxTokens: 32000, timeoutMs: 280_000,
  });
  if (!ai.ok) return { ok: false, error: ai.error === "not_configured" ? "aiNotConfigured" : "aiUnavailable" };
  const parsed = readingSchema.safeParse(ai.data);
  if (!parsed.success) return { ok: false, error: "aiInvalid" };
  const reading = parsed.data;
  // Pàgines fora del document: no se n'accepta la referència
  const fixPage = (p: number | null) => (p != null && numPages != null && p > numPages ? null : p);
  for (const ph of reading.phases) { ph.page = fixPage(ph.page); for (const m of ph.milestones) m.page = fixPage(m.page); }
  if (ext === "docx") for (const ph of reading.phases) { ph.page = null; for (const m of ph.milestones) m.page = null; }

  let quoteRef = null;
  if (c.quote_version_id) {
    const { data: t } = await supabase.from("quote_version_totals").select("taxable_cents, extras_initial_cents").eq("version_id", c.quote_version_id).maybeSingle();
    if (t) quoteRef = { taxableCents: Number(t.taxable_cents), extrasCents: Number(t.extras_initial_cents) };
  }
  const discrepancies = verifyReading(reading, quoteRef, ext === "docx" ? null : pageTexts);
  // DOCX sense pàgines: no és un defecte de la lectura
  const disc = ext === "docx" ? discrepancies.filter((d) => d.kind !== "sense_referencia") : discrepancies;
  const milestones = flattenMilestones(reading);
  const fields = {
    holders: reading.holders, contractor: reading.contractor, site_address: reading.site_address, cadastral_ref: reading.cadastral_ref,
    total_cents: reading.total_cents, total_text: reading.total_text, total_page: reading.total_page,
    document_date: reading.document_date && isValidDateKey(reading.document_date) ? reading.document_date : null,
    signed_date: reading.signed_date && isValidDateKey(reading.signed_date) ? reading.signed_date : null,
    vat_clause: reading.vat_clause, chapters: reading.chapters, payment_terms: reading.payment_terms, later_extras_rule: reading.later_extras_rule,
    deadlines: reading.deadlines, special_conditions: reading.special_conditions, linked_documents: reading.linked_documents,
    modifications: reading.modifications, phases: reading.phases.map((p) => ({ code: p.code, name: p.name, is_extra: p.is_extra, declared_amount_cents: p.declared_amount_cents, page: p.page, milestones: p.milestones.length })),
    text_layer: pageTexts != null, format: ext,
  };
  const checks = { milestones: milestones.length, discrepancies: disc.length, verified_against_text: pageTexts != null };
  const { error } = await supabase.rpc("record_contract_extraction", {
    p_contract_id: c.id, p_provider: "anthropic", p_model: ai.model, p_prompt_version: PROMPT_VERSION, p_pages: numPages,
    p_output: reading, p_checks: checks, p_fields: fields, p_milestones: milestones, p_discrepancies: disc,
  });
  if (error) return fromPgError(error);
  refresh(c.project_id, c.id);
  return { ok: true };
}

// Revisió sense IA: direcció introdueix les fites a mà
export async function startManualAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("contractId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { data: c } = await supabase.from("contracts").select("project_id, status").eq("id", id.data).maybeSingle();
  if (!c) return { ok: false, error: "forbidden" };
  if (c.status !== "pendent_lectura") return { ok: false, error: "invalidState" };
  const { error } = await supabase.rpc("record_contract_extraction", {
    p_contract_id: id.data, p_provider: "manual", p_model: "-", p_prompt_version: "manual", p_pages: null,
    p_output: {}, p_checks: {}, p_fields: { manual: true }, p_milestones: [], p_discrepancies: [],
  });
  if (error) return fromPgError(error);
  refresh(c.project_id, id.data);
  return { ok: true };
}

export async function updateContractAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("contractId"));
  if (!id.success) return { ok: false, error: "genericError" };
  let total: number | null;
  try { total = parseEurosToCents(String(formData.get("total") ?? "")); } catch { return { ok: false, error: "invalidAmount" }; }
  const date = (k: string) => { const v = String(formData.get(k) ?? ""); return v === "" ? null : isValidDateKey(v) ? v : undefined; };
  const documentDate = date("documentDate"), signedDate = date("signedDate");
  if (documentDate === undefined || signedDate === undefined) return { ok: false, error: "invalidDate" };
  if (total != null && total < 0) return { ok: false, error: "invalidAmount" };
  const supabase = await createClient();
  const { error } = await supabase.from("contracts").update({ total_cents: total, document_date: documentDate, signed_date: signedDate }).eq("id", id.data);
  if (error) return fromPgError(error);
  const pid = await contractProject(supabase, id.data);
  if (pid) refresh(pid, id.data);
  return { ok: true };
}

// --- Fites -------------------------------------------------------------------------------
const milestoneInput = z.object({
  id: reqUuid, code: optText(30), phase: optText(300), concept: reqText(500), amount: z.string().max(40),
  vatRateBp: z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().int().min(0).max(10000).nullable()),
  conceptType: optText(40), triggerCondition: optText(1000), confirmed: z.boolean(),
});

export async function saveMilestoneAction(input: z.input<typeof milestoneInput>): Promise<ActionResult> {
  await requireRole("direccio");
  const p = milestoneInput.safeParse(input);
  if (!p.success) return { ok: false, error: "required" };
  let amount: number | null;
  try { amount = parseEurosToCents(p.data.amount); } catch { return { ok: false, error: "invalidAmount" }; }
  if (amount == null || amount < 0) return { ok: false, error: "invalidAmount" };
  if (p.data.confirmed && p.data.vatRateBp == null) return { ok: false, error: "vatRequired" };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_milestones").update({
    code: p.data.code ?? null, phase: p.data.phase ?? null, concept: p.data.concept, amount_cents: amount,
    vat_rate_bp: p.data.vatRateBp, concept_type: p.data.conceptType ?? null, trigger_condition: p.data.triggerCondition ?? null,
    confirmed: p.data.confirmed,
  }).eq("id", p.data.id);
  return error ? fromPgError(error) : { ok: true };
}

export async function addMilestoneAction(input: { contractId: string; afterPosition: number | null; isExtra: boolean; phase: string | null }): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(input.contractId);
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { data: last } = await supabase.from("contract_milestones").select("position").eq("contract_id", id.data).order("position", { ascending: false }).limit(1);
  const position = (last?.[0]?.position ?? 0) + 1;
  const { error } = await supabase.from("contract_milestones").insert({
    contract_id: id.data, position, concept: "Nova fita", amount_cents: 0, origin: "manual", is_extra: input.isExtra,
    phase: input.phase, extra_label: input.isExtra ? input.phase : null, concept_type: input.isExtra ? "extra_constructiu" : null,
  });
  return error ? fromPgError(error) : { ok: true };
}

export async function deleteMilestoneAction(id: string): Promise<ActionResult> {
  await requireRole("direccio");
  if (!reqUuid.safeParse(id).success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_milestones").delete().eq("id", id);
  return error ? fromPgError(error) : { ok: true };
}

export async function moveMilestoneAction(id: string, dir: -1 | 1): Promise<ActionResult> {
  await requireRole("direccio");
  if (!reqUuid.safeParse(id).success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_contract_milestone", { p_id: id, p_dir: dir });
  return error ? fromPgError(error) : { ok: true };
}

export async function mergeMilestonesAction(ids: string[]): Promise<ActionResult> {
  await requireRole("direccio");
  if (!z.array(reqUuid).min(2).max(50).safeParse(ids).success) return { ok: false, error: "selectTwo" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_contract_milestones", { p_ids: ids });
  return error ? fromPgError(error) : { ok: true };
}

export async function splitMilestoneAction(id: string, amounts: string[]): Promise<ActionResult> {
  await requireRole("direccio");
  if (!reqUuid.safeParse(id).success || amounts.length < 2 || amounts.length > 20) return { ok: false, error: "splitSum" };
  const cents: number[] = [];
  for (const a of amounts) {
    let c: number | null = null;
    try { c = parseEurosToCents(a); } catch { /* invàlid */ }
    if (c == null || c <= 0) return { ok: false, error: "invalidAmount" };
    cents.push(c);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("split_contract_milestone", { p_id: id, p_amounts: cents });
  return error ? fromPgError(error) : { ok: true };
}

/** Proposa l'IVA per defecte del tipus de concepte a les fites que no en tenen (no les confirma). */
export async function applyDefaultVatAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("contractId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const [{ data: ms }, { data: types }] = await Promise.all([
    supabase.from("contract_milestones").select("id, concept_type").eq("contract_id", id.data).is("vat_rate_bp", null),
    supabase.from("concept_types").select("code, default_vat_bp"),
  ]);
  const def = new Map((types ?? []).map((t) => [t.code, t.default_vat_bp]));
  for (const m of ms ?? []) {
    const vat = m.concept_type ? def.get(m.concept_type) : null;
    if (vat == null) continue;
    const { error } = await supabase.from("contract_milestones").update({ vat_rate_bp: vat }).eq("id", m.id);
    if (error) return fromPgError(error);
  }
  const pid = await contractProject(supabase, id.data);
  if (pid) refresh(pid, id.data);
  return { ok: true };
}

// --- Discrepàncies i validació -------------------------------------------------------------
export async function resolveDiscrepancyAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const me = await requireRole("direccio");
  const p = z.object({ id: reqUuid, status: z.enum(["acceptada", "ignorada", "resolta"]), resolution: reqText(1000) })
    .safeParse({ id: formData.get("id"), status: formData.get("status"), resolution: formData.get("resolution") });
  if (!p.success) return { ok: false, error: "resolutionRequired" };
  const supabase = await createClient();
  const { data, error } = await supabase.from("contract_discrepancies")
    .update({ status: p.data.status, resolution: p.data.resolution, resolved_by: me.id, resolved_at: new Date().toISOString() })
    .eq("id", p.data.id).select("contract_id").maybeSingle();
  if (error) return fromPgError(error);
  if (data) { const pid = await contractProject(supabase, data.contract_id); if (pid) refresh(pid, data.contract_id); }
  return { ok: true };
}

export async function validateContractAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("contractId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("validate_contract", { p_contract_id: id.data });
  if (error) return fromPgError(error);
  const pid = await contractProject(supabase, id.data);
  if (pid) refresh(pid, id.data);
  return { ok: true };
}

export async function confirmAllAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("contractId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("contract_milestones").update({ confirmed: true })
    .eq("contract_id", id.data).not("vat_rate_bp", "is", null).gt("amount_cents", 0);
  if (error) return fromPgError(error);
  const pid = await contractProject(supabase, id.data);
  if (pid) refresh(pid, id.data);
  return { ok: true };
}
