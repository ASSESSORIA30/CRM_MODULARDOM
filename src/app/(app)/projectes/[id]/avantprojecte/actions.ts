"use server";

// Accions del mòdul d'avantprojecte. Les fan servir direcció, l'arquitecte i (etapa C) el client.
// Tota l'autorització real és a PostgreSQL (RLS + funcions); aquí es valida l'entrada.
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveProfile, requireRole } from "@/lib/auth";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { contentMatchesExtension, extensionOf, safeFileName } from "@/lib/files";
import { formObject, optText, optUuid, reqText, reqUuid } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "avantprojecte";
const CATEGORIES = ["avantprojecte", "planol", "inspiracio", "fotografia", "distribucio_interior", "facanes",
  "instal_lacions", "memoria", "observacions", "altres",
  // documents del projecte (només direcció)
  "contracte", "annex", "factura", "justificant_pagament", "llicencia", "visat", "projecte_tecnic",
  "certificacio", "acta_entrega", "identificacio"] as const;

// Quines categories van a cada bucket. Els buckets que no són d'avantprojecte són només de direcció.
const BUCKETS = ["avantprojecte", "contractes", "factures", "documents"] as const;
type Bucket = (typeof BUCKETS)[number];
const BUCKET_CATEGORIES: Record<Bucket, readonly string[]> = {
  avantprojecte: ["avantprojecte", "planol", "inspiracio", "fotografia", "distribucio_interior", "facanes", "instal_lacions", "memoria", "observacions", "altres"],
  contractes: ["contracte", "annex"],
  factures: ["factura", "justificant_pagament"],
  documents: ["llicencia", "visat", "projecte_tecnic", "memoria", "certificacio", "acta_entrega", "identificacio", "altres"],
};
const ROOMS = ["cuina", "banys", "habitacions", "sala_estar", "facana", "jardi", "instal_lacions", "altres"] as const;

const refresh = (projectId: string) => {
  revalidatePath(`/projectes/${projectId}/avantprojecte`);
  revalidatePath(`/portal/${projectId}`);
};

// ---------------------------------------------------------------------
// Pujada de fitxers: 1) URL signada  2) pujada directa a Storage  3) verificació i registre
// ---------------------------------------------------------------------
const prepareSchema = z.object({
  projectId: reqUuid,
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  bucket: z.enum(BUCKETS).default(BUCKET),
});

export async function prepareUpload(input: z.input<typeof prepareSchema>): Promise<ActionResult<{ path: string; token: string }>> {
  const me = await requireRole("direccio", "arquitecte", "client");
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "genericError" };
  const v = parsed.data;
  if (v.bucket !== BUCKET && me.role !== "direccio") return { ok: false, error: "forbidden" };
  const ext = extensionOf(v.fileName);
  const supabase = await createClient();

  const { data: rule } = await supabase.from("upload_rules").select("max_bytes")
    .eq("bucket_id", v.bucket).eq("extension", ext).maybeSingle();
  if (!rule) return { ok: false, error: "fileTypeNotAllowed" };
  if (v.size > rule.max_bytes) return { ok: false, error: "fileTooLarge" };

  const { data: project } = await supabase.from("projects").select("id").eq("id", v.projectId).maybeSingle();
  if (!project) return { ok: false, error: "forbidden" };

  const path = `p/${v.projectId}/${randomUUID()}-${safeFileName(v.fileName)}`;
  const { data, error } = await supabase.storage.from(v.bucket).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "forbidden" };
  return { ok: true, data: { path: data.path, token: data.token } };
}

const finalizeSchema = z.object({
  projectId: reqUuid,
  path: z.string().max(400),
  fileName: z.string().min(1).max(255),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().trim().min(1).max(200),
  category: z.enum(CATEGORIES),
  visibility: z.enum(["intern", "revisio"]).default("intern"),
  roomTag: z.enum(ROOMS).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  previousVersionId: z.string().uuid().nullable().optional(),
  linkItemId: z.string().uuid().nullable().optional(),
  linkAnnotationId: z.string().uuid().nullable().optional(),
  linkCommentId: z.string().uuid().nullable().optional(),
  bucket: z.enum(BUCKETS).default(BUCKET),
});

export async function finalizeUpload(input: z.input<typeof finalizeSchema>): Promise<ActionResult<{ documentId: string }>> {
  const me = await requireRole("direccio", "arquitecte", "client");
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "genericError" };
  const v = parsed.data;
  if (v.bucket !== BUCKET && me.role !== "direccio") return { ok: false, error: "forbidden" };
  if (!BUCKET_CATEGORIES[v.bucket].includes(v.category)) return { ok: false, error: "genericError" };
  const ext = extensionOf(v.fileName);
  // La ruta l'ha generat prepareUpload: ha de ser del projecte i sense salts de directori
  if (!v.path.startsWith(`p/${v.projectId}/`) || v.path.includes("..") || extensionOf(v.path) !== ext) {
    return { ok: false, error: "forbidden" };
  }
  if (!process.env.SUPABASE_SECRET_KEY) return { ok: false, error: "secretMissing" };
  const admin = createAdminClient();
  const discard = () => admin.storage.from(v.bucket).remove([v.path]);

  // Tipus real: es llegeixen els primers bytes del fitxer ja pujat
  const { data: signed } = await admin.storage.from(v.bucket).createSignedUrl(v.path, 60);
  if (!signed) return { ok: false, error: "genericError" };
  const head = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-63" } }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
  if (!head || !contentMatchesExtension(ext, new Uint8Array(head))) {
    await discard();
    return { ok: false, error: "invalidFileType" };
  }

  const supabase = await createClient();
  const { data: rule } = await supabase.from("upload_rules").select("mime_type").eq("bucket_id", v.bucket).eq("extension", ext).maybeSingle();

  let version = 1;
  if (v.previousVersionId) {
    const { data: prev } = await supabase.from("documents").select("version, project_id, bucket_id")
      .eq("id", v.previousVersionId).maybeSingle();
    if (!prev || prev.project_id !== v.projectId || prev.bucket_id !== v.bucket) { await discard(); return { ok: false, error: "forbidden" }; }
    const { data: last } = await supabase.from("documents").select("version")
      .eq("project_id", v.projectId).eq("bucket_id", v.bucket)
      .eq("group_id", (await supabase.from("documents").select("group_id").eq("id", v.previousVersionId).single()).data?.group_id ?? "")
      .order("version", { ascending: false }).limit(1).maybeSingle();
    version = (last?.version ?? prev.version) + 1;
  }

  const isDir = me.role === "direccio";
  const { data: doc, error } = await supabase.from("documents").insert({
    project_id: v.projectId,
    bucket_id: v.bucket,
    storage_path: v.path,
    category: me.role === "client" && v.category === "avantprojecte" ? "observacions" : v.category,
    title: v.title,
    description: v.description ?? null,
    room_tag: v.roomTag ?? null,
    mime_type: rule?.mime_type ?? null,
    size_bytes: v.size,
    sha256: v.sha256,
    uploaded_by: me.id,
    status: isDir ? "vigent" : "pendent_revisio",
    visibility: me.role === "client" ? "compartit" : v.bucket === BUCKET ? v.visibility : "intern",
    version,
    previous_version_id: v.previousVersionId ?? null,
  }).select("id").single();
  if (error || !doc) {
    await discard();
    return error ? fromPgError(error) : { ok: false, error: "genericError" };
  }

  const link = v.linkItemId ? { item_id: v.linkItemId } : v.linkAnnotationId ? { annotation_id: v.linkAnnotationId }
    : v.linkCommentId ? { comment_id: v.linkCommentId } : null;
  if (link) {
    const { error: e2 } = await supabase.from("document_links").insert({ project_id: v.projectId, document_id: doc.id, ...link });
    if (e2) return fromPgError(e2);
  }
  refresh(v.projectId);
  return { ok: true, data: { documentId: doc.id } };
}

/** URL signada de curta durada (5 min) per veure o descarregar. L'RLS decideix si hi ha accés. */
export async function documentUrl(documentId: string, download = false): Promise<ActionResult<{ url: string }>> {
  await requireActiveProfile();
  if (!z.string().uuid().safeParse(documentId).success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("bucket_id, storage_path, title").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false, error: "forbidden" };
  const name = `${safeFileName(doc.title).replace(/\.[a-z0-9]+$/i, "")}.${extensionOf(doc.storage_path)}`;
  const { data } = await supabase.storage.from(doc.bucket_id).createSignedUrl(doc.storage_path, 300, download ? { download: name } : undefined);
  return data ? { ok: true, data: { url: data.signedUrl } } : { ok: false, error: "forbidden" };
}

// ---------------------------------------------------------------------
// Anotacions
// ---------------------------------------------------------------------
const annotationSchema = z.object({
  projectId: reqUuid,
  documentId: reqUuid,
  page: z.number().int().min(1).max(2000),
  kind: z.enum(["punt", "rectangle"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1).nullable(),
  h: z.number().gt(0).max(1).nullable(),
  body: z.string().trim().max(2000),
  visibility: z.enum(["compartit", "intern"]).default("compartit"),
  itemId: z.string().uuid().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  draftId: z.string().uuid().nullable().optional(),
});

export async function createAnnotation(input: z.infer<typeof annotationSchema>): Promise<ActionResult<{ id: string }>> {
  await requireRole("direccio", "arquitecte", "client");
  const parsed = annotationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "genericError" };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.from("plan_annotations").insert({
    project_id: v.projectId, document_id: v.documentId, page: v.page, kind: v.kind,
    x: v.x, y: v.y, w: v.kind === "rectangle" ? v.w : null, h: v.kind === "rectangle" ? v.h : null,
    body: v.body, visibility: v.visibility, item_id: v.itemId ?? null, parent_id: v.parentId ?? null, draft_id: v.draftId ?? null,
  }).select("id").single();
  if (error || !data) return error ? fromPgError(error) : { ok: false, error: "genericError" };
  refresh(v.projectId);
  return { ok: true, data: { id: data.id } };
}

export async function setAnnotationStatus(formData: FormData) {
  await requireRole("direccio", "arquitecte");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  const status = z.enum(["obert", "resolt"]).safeParse(formData.get("status"));
  if (!id.success || !projectId.success || !status.success) return;
  const supabase = await createClient();
  await supabase.from("plan_annotations").update({ status: status.data }).eq("id", id.data);
  refresh(projectId.data);
}

// ---------------------------------------------------------------------
// Comentaris (per document, punt o marcador) amb mencions
// ---------------------------------------------------------------------
const commentSchema = z.object({
  project_id: reqUuid,
  document_id: optUuid,
  item_id: optUuid,
  annotation_id: optUuid,
  parent_id: optUuid,
  body: reqText(4000),
  visibility: z.enum(["compartit", "intern"]).default("compartit"),
});

export async function addCommentAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio", "arquitecte", "client");
  const parsed = commentSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required" };
  const v = parsed.data;
  // Sense objectiu = missatge general del projecte (apartat Missatges)
  const supabase = await createClient();
  const { data, error } = await supabase.from("comments").insert(v).select("id, visibility").single();
  if (error || !data) return error ? fromPgError(error) : { ok: false, error: "genericError" };
  const mentions = formData.getAll("mentions").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  if (mentions.length) {
    const { error: e2 } = await supabase.from("comment_mentions").insert(mentions.map((profile_id) => ({ comment_id: data.id, profile_id })));
    if (e2) return { ok: true, message: "mentionsSkipped" };
  }
  refresh(v.project_id);
  return { ok: true, message: "silent" };
}

export async function resolveCommentAction(formData: FormData) {
  await requireRole("direccio", "arquitecte", "client");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  const reopen = formData.get("reopen") === "1";
  if (!id.success || !projectId.success) return;
  const supabase = await createClient();
  await supabase.from("comments").update({ resolved_at: reopen ? null : new Date().toISOString() }).eq("id", id.data);
  refresh(projectId.data);
}

// ---------------------------------------------------------------------
// Punts: resposta tècnica, decisió econòmica
// ---------------------------------------------------------------------
const ITEM_STATUSES = ["pendent", "en_estudi", "necessita_aclariment", "viable", "viable_amb_modificacions",
  "no_viable", "incorporat", "descartat"] as const;

const respondSchema = z.object({
  project_id: reqUuid,
  item_id: reqUuid,
  status: z.enum(ITEM_STATUSES),
  assessment: optText(4000),
  alternative: optText(4000),
  requires_economic: z.string().optional(),
});

export async function respondItemAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio", "arquitecte");
  const parsed = respondSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required" };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("respond_revision_item", {
    p_item_id: v.item_id, p_status: v.status, p_assessment: v.assessment ?? null,
    p_alternative: v.alternative ?? null, p_requires_economic: v.requires_economic === "on",
  });
  if (error) return fromPgError(error);
  refresh(v.project_id);
  return { ok: true };
}

export async function decideEconomicsAction(formData: FormData) {
  await requireRole("direccio");
  const itemId = z.string().uuid().safeParse(formData.get("item_id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  const decision = z.enum(["pendent", "pressupostar", "sense_cost"]).safeParse(formData.get("decision"));
  if (!itemId.success || !projectId.success || !decision.success) return;
  const supabase = await createClient();
  await supabase.rpc("decide_item_economics", { p_item_id: itemId.data, p_decision: decision.data });
  refresh(projectId.data);
}

// ---------------------------------------------------------------------
// Rondes: excepcions i tancament (direcció)
// ---------------------------------------------------------------------
export async function grantRoundAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio");
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  if (!projectId.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("grant_revision_round", { p_project_id: projectId.data, p_reason: String(formData.get("reason") ?? "") });
  if (error) return fromPgError(error);
  refresh(projectId.data);
  return { ok: true };
}

export async function closeRoundAction(formData: FormData) {
  await requireRole("direccio");
  const roundId = z.string().uuid().safeParse(formData.get("round_id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  if (!roundId.success || !projectId.success) return;
  const supabase = await createClient();
  await supabase.rpc("close_revision_round", { p_round_id: roundId.data });
  refresh(projectId.data);
}

// ---------------------------------------------------------------------
// Publicació de documents i relació de punts per versió
// ---------------------------------------------------------------------
export async function publicationAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  const me = await requireRole("direccio", "arquitecte");
  const docId = z.string().uuid().safeParse(formData.get("document_id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  const op = z.enum(["request", "publish", "reject"]).safeParse(formData.get("op"));
  if (!docId.success || !projectId.success || !op.success) return { ok: false, error: "genericError" };
  if (op.data !== "request" && me.role !== "direccio") return { ok: false, error: "forbidden" };
  const supabase = await createClient();
  const { error } = op.data === "request"
    ? await supabase.rpc("request_document_publication", { p_document_id: docId.data })
    : op.data === "publish"
      ? await supabase.rpc("publish_document", { p_document_id: docId.data })
      : await supabase.rpc("reject_document_publication", { p_document_id: docId.data, p_note: String(formData.get("note") ?? "") });
  if (error) return fromPgError(error);
  refresh(projectId.data);
  return { ok: true };
}

const RESOLUTIONS = ["incorporat", "parcial", "pendent", "rebutjat", "alternativa"] as const;

export async function setResolutionsAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio", "arquitecte");
  const docId = z.string().uuid().safeParse(formData.get("document_id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  if (!docId.success || !projectId.success) return { ok: false, error: "genericError" };
  const rows: { document_id: string; item_id: string; resolution: string; note: string | null }[] = [];
  for (const [k, val] of formData.entries()) {
    const m = k.match(/^res_([0-9a-f-]{36})$/);
    if (m && typeof val === "string" && (RESOLUTIONS as readonly string[]).includes(val)) {
      const note = String(formData.get(`note_${m[1]}`) ?? "").trim();
      rows.push({ document_id: docId.data, item_id: m[1], resolution: val, note: note || null });
    }
  }
  const supabase = await createClient();
  const { error: e1 } = await supabase.from("version_item_resolutions").delete().eq("document_id", docId.data);
  if (e1) return fromPgError(e1);
  if (rows.length) {
    const { error } = await supabase.from("version_item_resolutions").insert(rows);
    if (error) return fromPgError(error);
  }
  refresh(projectId.data);
  return { ok: true };
}

// ---------------------------------------------------------------------
// Documents del projecte (contracte, factures…): publicar / retirar per al client
// ---------------------------------------------------------------------
export async function setProjectDocumentPublishedAction(formData: FormData) {
  const me = await requireRole("direccio");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  const publish = formData.get("publish") === "1";
  if (!id.success || !projectId.success) return;
  const supabase = await createClient();
  await supabase.from("documents").update(publish
    ? { published_to_client: true, status: "vigent", published_at: new Date().toISOString(), published_by: me.id }
    : { published_to_client: false })
    .eq("id", id.data).in("bucket_id", ["contractes", "factures", "documents"]);
  revalidatePath(`/projectes/${projectId.data}/documents`);
  revalidatePath(`/portal/${projectId.data}`);
}

export async function archiveProjectDocumentAction(formData: FormData) {
  await requireRole("direccio");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  if (!id.success || !projectId.success) return;
  const supabase = await createClient();
  await supabase.from("documents").update({ status: "arxivat", published_to_client: false })
    .eq("id", id.data).in("bucket_id", ["contractes", "factures", "documents"]);
  revalidatePath(`/projectes/${projectId.data}/documents`);
  revalidatePath(`/portal/${projectId.data}`);
}
