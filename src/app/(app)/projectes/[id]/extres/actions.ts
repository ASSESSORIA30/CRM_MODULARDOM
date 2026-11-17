"use server";

// Extres: proposta, aprovació (direcció o client), incorporació amb annex, execució, facturació i cobrament,
// costos reals i marge. Els estats i bloquejos els garanteix la base de dades.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { isValidDateKey } from "@/lib/dates";
import { optText, reqText, reqUuid } from "@/lib/forms";
import { parseEurosToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

const cents = (v: FormDataEntryValue | null, allowZero = true): number | null => {
  try { const c = parseEurosToCents(String(v ?? "")); return c != null && (allowZero ? c >= 0 : c > 0) ? c : null; } catch { return null; }
};
const refresh = (projectId: string) => revalidatePath(`/projectes/${projectId}/extres`);

export async function createExtraAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ projectId: reqUuid, title: reqText(300), description: optText(2000), vatRateBp: z.coerce.number().int(), conceptType: optText(40), sourceLineId: z.string().uuid().or(z.literal("")) })
    .safeParse({ projectId: formData.get("projectId"), title: formData.get("title"), description: formData.get("description"), vatRateBp: formData.get("vatRateBp"), conceptType: formData.get("conceptType"), sourceLineId: formData.get("sourceLineId") ?? "" });
  if (!p.success) return { ok: false, error: "required" };
  const amount = cents(formData.get("amount"));
  if (amount == null) return { ok: false, error: "invalidAmount" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_project_extra", {
    p_project_id: p.data.projectId, p_title: p.data.title, p_description: p.data.description ?? null, p_amount_cents: amount,
    p_vat_rate_bp: p.data.vatRateBp, p_concept_type: p.data.conceptType ?? null, p_source_line_id: p.data.sourceLineId || null,
  });
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

export async function setExtraStatusAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({
    id: reqUuid, projectId: reqUuid, status: z.enum(["proposat", "pendent_aprovacio", "aprovat", "rebutjat", "incorporat", "executat", "facturat", "cobrat"]),
    date: z.string().optional(), note: optText(1000), annexDocumentId: z.string().uuid().or(z.literal("")).optional(), contractId: z.string().uuid().or(z.literal("")).optional(),
  }).safeParse({
    id: formData.get("id"), projectId: formData.get("projectId"), status: formData.get("status"), date: formData.get("date") ?? undefined,
    note: formData.get("note"), annexDocumentId: formData.get("annexDocumentId") ?? undefined, contractId: formData.get("contractId") ?? undefined,
  });
  if (!p.success) return { ok: false, error: "genericError" };
  const date = p.data.date && isValidDateKey(p.data.date) ? p.data.date : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_extra_status", {
    p_id: p.data.id, p_status: p.data.status, p_date: date, p_note: p.data.note ?? null,
    p_annex_document_id: p.data.annexDocumentId || null, p_contract_id: p.data.contractId || null,
  });
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

export async function updateExtraAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, projectId: reqUuid, paymentTerms: optText(2000) }).safeParse({ id: formData.get("id"), projectId: formData.get("projectId"), paymentTerms: formData.get("paymentTerms") });
  if (!p.success) return { ok: false, error: "genericError" };
  const est = String(formData.get("estimatedCost") ?? "").trim() === "" ? null : cents(formData.get("estimatedCost"));
  if (String(formData.get("estimatedCost") ?? "").trim() !== "" && est == null) return { ok: false, error: "invalidAmount" };
  const patch: Record<string, unknown> = { estimated_cost_cents: est };
  if (formData.has("paymentTerms")) patch.payment_terms = p.data.paymentTerms ?? null;
  const supabase = await createClient();
  const { error } = await supabase.from("project_extras").update(patch).eq("id", p.data.id);
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

export async function addExtraMilestoneAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ extraId: reqUuid, projectId: reqUuid, concept: reqText(300), trigger: optText(500) })
    .safeParse({ extraId: formData.get("extraId"), projectId: formData.get("projectId"), concept: formData.get("concept"), trigger: formData.get("trigger") });
  if (!p.success) return { ok: false, error: "required" };
  const amount = cents(formData.get("amount"), false);
  if (amount == null) return { ok: false, error: "invalidAmount" };
  const supabase = await createClient();
  const { data: last } = await supabase.from("project_extra_milestones").select("position").eq("extra_id", p.data.extraId).order("position", { ascending: false }).limit(1);
  const { error } = await supabase.from("project_extra_milestones").insert({
    extra_id: p.data.extraId, position: (last?.[0]?.position ?? 0) + 1, concept: p.data.concept, amount_cents: amount, trigger_condition: p.data.trigger ?? null,
  });
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

export async function deleteExtraMilestoneAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, projectId: reqUuid }).safeParse({ id: formData.get("id"), projectId: formData.get("projectId") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("project_extra_milestones").delete().eq("id", p.data.id);
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

export async function addExtraCostAction(_: unknown, formData: FormData): Promise<ActionResult> {
  const me = await requireRole("direccio");
  const p = z.object({ extraId: reqUuid, projectId: reqUuid, supplier: optText(200), description: reqText(500), date: z.string().refine(isValidDateKey) })
    .safeParse({ extraId: formData.get("extraId"), projectId: formData.get("projectId"), supplier: formData.get("supplier"), description: formData.get("description"), date: formData.get("date") });
  if (!p.success) return { ok: false, error: "required" };
  const amount = cents(formData.get("amount"));
  if (amount == null) return { ok: false, error: "invalidAmount" };
  const supabase = await createClient();
  const { error } = await supabase.from("project_extra_costs").insert({
    extra_id: p.data.extraId, supplier: p.data.supplier ?? null, description: p.data.description, amount_cents: amount, cost_date: p.data.date, created_by: me.id,
  });
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

export async function deleteExtraCostAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, projectId: reqUuid }).safeParse({ id: formData.get("id"), projectId: formData.get("projectId") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("project_extra_costs").delete().eq("id", p.data.id);
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

export async function markIncludedAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, projectId: reqUuid, versionId: z.string().uuid().or(z.literal("")) })
    .safeParse({ id: formData.get("id"), projectId: formData.get("projectId"), versionId: formData.get("versionId") ?? "" });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_extra_included", { p_id: p.data.id, p_version_id: p.data.versionId || null });
  if (error) return fromPgError(error);
  refresh(p.data.projectId);
  return { ok: true };
}

// Client: acceptar o rebutjar un extra des del portal (si està habilitat)
export async function clientDecideExtraAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("client");
  const p = z.object({ id: reqUuid, projectId: reqUuid, decision: z.enum(["aprovat", "rebutjat"]) })
    .safeParse({ id: formData.get("id"), projectId: formData.get("projectId"), decision: formData.get("decision") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_decide_extra", { p_id: p.data.id, p_decision: p.data.decision });
  if (error) return fromPgError(error);
  revalidatePath(`/portal/${p.data.projectId}`);
  return { ok: true };
}
