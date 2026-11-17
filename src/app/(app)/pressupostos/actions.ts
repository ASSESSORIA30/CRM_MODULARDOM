"use server";

// Server Actions de pressupostos (només direcció). Els estats i la immutabilitat els garanteix la base de dades.
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { isValidDateKey } from "@/lib/dates";
import { reqText, reqUuid } from "@/lib/forms";
import { loadQuoteVersion, quotePdfData } from "@/lib/quotes/load";
import { parseEditorLines } from "@/lib/quotes/parse-lines";
import { buildQuotePdf } from "@/lib/quotes/quote-pdf";
import { quotePdfTexts } from "@/lib/i18n-pressupostos";
import { createClient } from "@/lib/supabase/server";

const locale = z.enum(["ca", "es"]);
const dateKey = z.string().refine(isValidDateKey, "invalidDate");

export async function createQuoteAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio", "arquitecte");
  const parsed = z.object({ projectId: reqUuid, title: reqText(200), locale })
    .safeParse({ projectId: formData.get("projectId"), title: formData.get("title"), locale: formData.get("locale") });
  if (!parsed.success) return { ok: false, error: "required" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_quote", { p_project_id: parsed.data.projectId, p_title: parsed.data.title, p_locale: parsed.data.locale });
  if (error) return fromPgError(error);
  redirect(`/pressupostos/${data}`);
}

// --- Desar l'esborrany -------------------------------------------------------------------
const draftSchema = z.object({
  versionId: reqUuid, locale, intro: z.string().max(4000).default(""), notes: z.string().max(4000).default(""),
  exclusions: z.string().max(4000).default(""), paymentTerms: z.string().max(4000).default(""),
  lines: z.array(z.unknown()).max(500),
});

export type DraftResult = ActionResult & { lineErrors?: Record<number, string[]> };

export async function saveDraftAction(input: z.input<typeof draftSchema>): Promise<DraftResult> {
  await requireRole("direccio", "arquitecte");
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "genericError" };
  const { rows, errors } = parseEditorLines(parsed.data.lines);
  if (Object.keys(errors).length) return { ok: false, error: "lineErrors", lineErrors: errors };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_quote_draft", {
    p_version_id: parsed.data.versionId, p_locale: parsed.data.locale, p_intro: parsed.data.intro, p_notes: parsed.data.notes,
    p_exclusions: parsed.data.exclusions, p_payment_terms: parsed.data.paymentTerms, p_lines: rows,
  });
  if (error) return fromPgError(error);
  revalidatePath(`/pressupostos/${parsed.data.versionId}`);
  return { ok: true };
}

// --- Canvis d'estat -----------------------------------------------------------------------
export async function sendQuoteAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ versionId: reqUuid, issueDate: dateKey, validUntil: dateKey })
    .safeParse({ versionId: formData.get("versionId"), issueDate: formData.get("issueDate"), validUntil: formData.get("validUntil") });
  if (!p.success) return { ok: false, error: "invalidDates" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_quote_version", { p_version_id: p.data.versionId, p_issue_date: p.data.issueDate, p_valid_until: p.data.validUntil });
  if (error) return fromPgError(error);
  revalidatePath(`/pressupostos/${p.data.versionId}`);
  return { ok: true };
}

export async function outcomeQuoteAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ versionId: reqUuid, outcome: z.enum(["acceptat", "rebutjat"]), date: z.string().optional() })
    .safeParse({ versionId: formData.get("versionId"), outcome: formData.get("outcome"), date: formData.get("date") ?? undefined });
  if (!p.success) return { ok: false, error: "genericError" };
  if (p.data.outcome === "acceptat" && !isValidDateKey(p.data.date)) return { ok: false, error: "invalidDate" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_quote_outcome", {
    p_version_id: p.data.versionId, p_outcome: p.data.outcome, p_date: p.data.outcome === "acceptat" ? p.data.date! : null,
  });
  if (error) return fromPgError(error);
  revalidatePath(`/pressupostos/${p.data.versionId}`);
  return { ok: true };
}

export async function newVersionAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio", "arquitecte");
  const id = reqUuid.safeParse(formData.get("quoteId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("new_quote_version", { p_quote_id: id.data });
  if (error) return fromPgError(error);
  redirect(`/pressupostos/${data}`);
}

export async function duplicateQuoteAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio", "arquitecte");
  const p = z.object({ versionId: reqUuid, projectId: reqUuid, title: reqText(200) })
    .safeParse({ versionId: formData.get("versionId"), projectId: formData.get("projectId"), title: formData.get("title") });
  if (!p.success) return { ok: false, error: "required" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duplicate_quote", { p_version_id: p.data.versionId, p_project_id: p.data.projectId, p_title: p.data.title });
  if (error) return fromPgError(error);
  redirect(`/pressupostos/${data}`);
}

// Desa el PDF d'una versió enviada a la documentació del projecte (bucket privat de pressupostos)
export async function archiveQuotePdfAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const me = await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("versionId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const q = await loadQuoteVersion(supabase, id.data);
  if (!q) return { ok: false, error: "forbidden" };
  if (q.version.status === "esborrany") return { ok: false, error: "invalidState" };
  const bytes = await buildQuotePdf(await quotePdfData(supabase, q), quotePdfTexts(q.version.locale));
  const path = `p/${q.project.id}/${randomUUID()}-${q.quote.code}-v${q.version.version}.pdf`;
  const up = await supabase.storage.from("pressupostos").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) return { ok: false, error: "genericError" };
  const sha = createHash("sha256").update(bytes).digest("hex");
  const { data: doc, error } = await supabase.from("documents").insert({
    project_id: q.project.id, bucket_id: "pressupostos", storage_path: path, category: "pressupost",
    title: `${q.quote.code} · v${q.version.version} · ${q.quote.title}`, mime_type: "application/pdf",
    size_bytes: bytes.length, sha256: sha, uploaded_by: me.id, status: "vigent", visibility: "intern",
  }).select("id").single();
  if (error || !doc) {
    await supabase.storage.from("pressupostos").remove([path]);
    return error ? fromPgError(error) : { ok: false, error: "genericError" };
  }
  const { error: e2 } = await supabase.rpc("attach_quote_pdf", { p_version_id: q.version.id, p_document_id: doc.id });
  if (e2) return fromPgError(e2);
  revalidatePath(`/pressupostos/${q.version.id}`);
  return { ok: true };
}

// --- Publicació al client i pressupost vigent -------------------------------------------------
export async function publishQuoteAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ versionId: reqUuid, published: z.enum(["1", "0"]) }).safeParse({ versionId: formData.get("versionId"), published: formData.get("published") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_quote_version", { p_version_id: p.data.versionId, p_published: p.data.published === "1" });
  if (error) return fromPgError(error);
  revalidatePath(`/pressupostos/${p.data.versionId}`);
  return { ok: true };
}

export async function setCurrentQuoteAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("versionId"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_current_quote", { p_version_id: id.data });
  if (error) return fromPgError(error);
  revalidatePath(`/pressupostos/${id.data}`);
  return { ok: true };
}

// Resposta del client des del portal (si està habilitada)
export async function clientDecideQuoteAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("client");
  const p = z.object({ versionId: reqUuid, decision: z.enum(["acceptat", "rebutjat"]), projectId: reqUuid })
    .safeParse({ versionId: formData.get("versionId"), decision: formData.get("decision"), projectId: formData.get("projectId") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_decide_quote", { p_version_id: p.data.versionId, p_decision: p.data.decision });
  if (error) return fromPgError(error);
  revalidatePath(`/portal/${p.data.projectId}`);
  return { ok: true };
}
