"use server";

// Accions del client a "EL MEU AVANTPROJECTE". Cap d'aquestes accions consumeix rondes,
// excepte submitRoundAction (que crida la funció transaccional submit_revision_round).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { analyzeRevisionRequest } from "@/lib/ai/revision-analysis";
import { mapItemsToRows } from "@/lib/ai/draft-mapping";
import { draftAttachments, draftMarkers, isImage, signedUrls } from "@/lib/avantprojecte-data";
import { formObject, optText, optUuid, reqText, reqUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const refresh = (projectId: string) => {
  revalidatePath(`/portal/${projectId}`);
  revalidatePath(`/projectes/${projectId}/avantprojecte`);
};

// ---------------------------------------------------------------------
// Anàlisi amb IA (no consumeix rondes)
// ---------------------------------------------------------------------
export async function analyzeDraftAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("client", "direccio");
  const projectId = reqUuid.safeParse(formData.get("project_id"));
  const draftId = reqUuid.safeParse(formData.get("draft_id"));
  const text = String(formData.get("text") ?? "").slice(0, 8000);
  if (!projectId.success || !draftId.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();

  const markers = await draftMarkers(supabase, draftId.data);
  const { data: items } = await supabase.from("revision_items").select("id").eq("draft_id", draftId.data);
  const atts = await draftAttachments(supabase, markers.map((m) => m.id), (items ?? []).map((i) => i.id));
  const docs = [...new Map(atts.map((a) => [a.doc!.id, a.doc!])).values()];
  const { data: docTitles } = markers.length
    ? await supabase.from("documents").select("id, title").in("id", [...new Set(markers.map((m) => m.document_id))])
    : { data: [] as { id: string; title: string }[] };
  const titleOf = new Map((docTitles ?? []).map((d) => [d.id, d.title]));
  const { data: status } = await supabase.rpc("revision_round_status", { p_project_id: projectId.data });
  const used = ((Array.isArray(status) ? status[0] : status) as { used: number } | null)?.used ?? 0;

  const imageDocs = docs.filter((d) => isImage(d.storage_path)).slice(0, 5);
  const urls = await signedUrls(supabase, imageDocs.map((d) => d.storage_path), 600);
  const sources = {
    text,
    markers: markers.map((m) => ({ label: m.label, page: m.page, comment: m.body, documentTitle: titleOf.get(m.document_id) })),
    attachments: docs.map((d) => ({ id: d.id, description: [d.title, d.description, ...atts.filter((a) => a.doc!.id === d.id).map((a) => a.linkDescription)].filter(Boolean).join(" — ") })),
  };
  const res = await analyzeRevisionRequest(sources, {
    roundNumber: used + 1,
    imageUrls: imageDocs.map((d) => ({ id: d.id, url: urls.get(d.storage_path) ?? "" })).filter((x) => x.url),
  });

  if (!res.ok) {
    // Es desa igualment el text del client; els punts es poden afegir a mà
    await supabase.rpc("save_draft_analysis", { p_draft_id: draftId.data, p_original_text: text, p_extraction: null, p_model: null });
    refresh(projectId.data);
    return { ok: false, error: res.error === "not_configured" ? "aiNotConfigured" : res.error === "empty" ? "required" : "aiError" };
  }

  const { error: e1 } = await supabase.rpc("save_draft_analysis", {
    p_draft_id: draftId.data, p_original_text: text,
    p_extraction: { raw: res.raw, questions: res.questions, items: res.items }, p_model: res.model,
  });
  if (e1) return fromPgError(e1);

  // Substitueix els punts de l'esborrany pels de la nova anàlisi
  await supabase.from("plan_annotations").update({ item_id: null }).eq("draft_id", draftId.data).is("round_id", null);
  await supabase.from("revision_items").delete().eq("draft_id", draftId.data);
  const rows = mapItemsToRows(res.items, new Map(markers.map((m) => [m.label, m.id])), new Set(docs.map((d) => d.id)));
  for (const r of rows) {
    const { data: created, error } = await supabase.from("revision_items").insert({
      draft_id: draftId.data, project_id: projectId.data, position: r.position, title: r.title, description: r.description,
      room: r.room, source_excerpt: r.source_excerpt, needs_clarification: r.needs_clarification, ai_notes: r.ai_notes,
    }).select("id").single();
    if (error || !created) return error ? fromPgError(error) : { ok: false, error: "genericError" };
    if (r.annotationIds.length) await supabase.from("plan_annotations").update({ item_id: created.id }).in("id", r.annotationIds);
    for (const docId of r.documentIds) {
      await supabase.from("document_links").insert({ project_id: projectId.data, document_id: docId, item_id: created.id });
    }
  }
  refresh(projectId.data);
  return { ok: true, message: "silent" };
}

// ---------------------------------------------------------------------
// Edició de punts de l'esborrany (no consumeix rondes)
// ---------------------------------------------------------------------
const itemSchema = z.object({
  project_id: reqUuid,
  draft_id: optUuid,
  id: optUuid,
  title: reqText(160),
  description: optText(2000),
  room: optText(80),
});

export async function saveDraftItemAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("client", "direccio");
  const parsed = itemSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required" };
  const v = parsed.data;
  const supabase = await createClient();
  if (v.id) {
    const { error } = await supabase.from("revision_items")
      .update({ title: v.title, description: v.description ?? "", room: v.room ?? null, needs_clarification: false })
      .eq("id", v.id).is("round_id", null);
    if (error) return fromPgError(error);
  } else {
    if (!v.draft_id) return { ok: false, error: "genericError" };
    const { data: last } = await supabase.from("revision_items").select("position").eq("draft_id", v.draft_id)
      .order("position", { ascending: false }).limit(1).maybeSingle();
    const { error } = await supabase.from("revision_items").insert({
      draft_id: v.draft_id, project_id: v.project_id, position: (last?.position ?? 0) + 1,
      title: v.title, description: v.description ?? "", room: v.room ?? null,
    });
    if (error) return fromPgError(error);
  }
  refresh(v.project_id);
  return { ok: true, message: v.id ? undefined : "silent" };
}

export async function deleteDraftItemAction(formData: FormData) {
  await requireRole("client", "direccio");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  if (!id.success || !projectId.success) return;
  const supabase = await createClient();
  await supabase.from("plan_annotations").update({ item_id: null }).eq("item_id", id.data).is("round_id", null);
  await supabase.from("revision_items").delete().eq("id", id.data).is("round_id", null);
  refresh(projectId.data);
}

export async function moveDraftItemAction(formData: FormData) {
  await requireRole("client", "direccio");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  const dir = formData.get("dir") === "up" ? -1 : 1;
  if (!id.success || !projectId.success) return;
  const supabase = await createClient();
  const { data: me } = await supabase.from("revision_items").select("draft_id").eq("id", id.data).is("round_id", null).maybeSingle();
  if (!me?.draft_id) return;
  const { data: all } = await supabase.from("revision_items").select("id").eq("draft_id", me.draft_id).order("position");
  const ids = (all ?? []).map((x) => x.id);
  const i = ids.indexOf(id.data);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  for (let k = 0; k < ids.length; k++) await supabase.from("revision_items").update({ position: k + 1 }).eq("id", ids[k]);
  refresh(projectId.data);
}

/** Vincula (o desvincula) un marcador amb un punt de l'esborrany i n'actualitza el text. */
export async function updateDraftMarkerAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("client", "direccio");
  const v = z.object({ project_id: reqUuid, id: reqUuid, item_id: optUuid, body: optText(2000) }).safeParse(formObject(formData));
  if (!v.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("plan_annotations").update({ item_id: v.data.item_id, body: v.data.body ?? "" })
    .eq("id", v.data.id).is("round_id", null);
  if (error) return fromPgError(error);
  refresh(v.data.project_id);
  return { ok: true };
}

export async function deleteDraftMarkerAction(formData: FormData) {
  await requireRole("client", "direccio");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  if (!id.success || !projectId.success) return;
  const supabase = await createClient();
  await supabase.from("plan_annotations").update({ item_id: null }).eq("id", id.data).is("round_id", null);
  await supabase.from("plan_annotations").delete().eq("id", id.data).is("round_id", null);
  refresh(projectId.data);
}

// ---------------------------------------------------------------------
// ENVIAMENT DE LA RONDA: l'únic punt que consumeix una ronda
// ---------------------------------------------------------------------
export async function submitRoundAction(projectId: string, draftId: string, idempotencyKey: string): Promise<ActionResult<unknown>> {
  await requireRole("client");
  if (![projectId, draftId, idempotencyKey].every((x) => reqUuid.safeParse(x).success)) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_revision_round", { p_draft_id: draftId, p_idempotency_key: idempotencyKey });
  if (error) return fromPgError(error);
  refresh(projectId);
  redirect(`/portal/${projectId}?apartat=seguiment&enviada=1`);
}

// ---------------------------------------------------------------------
// Respostes i confirmacions del client (no consumeixen rondes)
// ---------------------------------------------------------------------
export async function clientRespondAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("client");
  const v = z.object({
    project_id: reqUuid, item_id: reqUuid,
    action: z.enum(["revisat", "acceptar_alternativa", "rebutjar_alternativa", "demanar_aclariment"]),
    note: optText(2000),
  }).safeParse(formObject(formData));
  if (!v.success) return { ok: false, error: "genericError" };
  if (v.data.action === "demanar_aclariment" && !v.data.note) return { ok: false, error: "required" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("client_respond_item", { p_item_id: v.data.item_id, p_action: v.data.action, p_note: v.data.note ?? null });
  if (error) return fromPgError(error);
  refresh(v.data.project_id);
  return { ok: true };
}

export async function confirmDocumentAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("client");
  const v = z.object({
    project_id: reqUuid, document_id: reqUuid, kind: z.enum(["versio_revisada", "avantprojecte_aprovat"]), note: optText(2000),
    confirm: z.literal("on"),
  }).safeParse(formObject(formData));
  if (!v.success) return { ok: false, error: "required" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_document", { p_document_id: v.data.document_id, p_kind: v.data.kind, p_note: v.data.note ?? null });
  if (error) return fromPgError(error);
  refresh(v.data.project_id);
  return { ok: true };
}
