// Lectura de dades del mòdul d'avantprojecte (Server Components). Tot passa per RLS.
import "server-only";
import type { AppLocale } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { extensionOf, IMAGE_EXT, PREVIEWABLE } from "@/lib/files";
import { createClient } from "@/lib/supabase/server";
import type { ThreadComment } from "@/components/avantprojecte/comment-thread";

type Supa = Awaited<ReturnType<typeof createClient>>;

export type Person = { id: string; name: string; role: string };

export async function projectPeople(supabase: Supa, projectId: string): Promise<Map<string, Person>> {
  const { data } = await supabase.rpc("project_people", { p_project_id: projectId });
  return new Map(((data ?? []) as { id: string; full_name: string; role: string }[]).map((p) => [p.id, { id: p.id, name: p.full_name, role: p.role }]));
}

export type DocRow = {
  id: string; group_id: string; version: number; title: string; category: string; visibility: string; status: string;
  published_at: string | null; approved_at: string | null; room_tag: string | null; description: string | null;
  storage_path: string; created_at: string; uploaded_by: string | null; previous_version_id: string | null;
};

export async function loadDocuments(supabase: Supa, projectId: string) {
  const { data } = await supabase.from("documents")
    .select("id, group_id, version, title, category, visibility, status, published_at, approved_at, room_tag, description, storage_path, created_at, uploaded_by, previous_version_id")
    .eq("project_id", projectId).eq("bucket_id", "avantprojecte").neq("status", "arxivat")
    .order("created_at", { ascending: false });
  const docs = (data ?? []) as DocRow[];
  const groups = new Map<string, DocRow[]>();
  for (const d of docs) groups.set(d.group_id, [...(groups.get(d.group_id) ?? []), d]);
  for (const vs of groups.values()) vs.sort((a, b) => b.version - a.version);
  /** Versió vigent: l'última publicada vigent; si no n'hi ha, l'última visible */
  const current = (vs: DocRow[]) => vs.find((v) => v.visibility === "publicat" && v.status === "vigent") ?? vs[0];
  return { docs, groups: [...groups.values()], current };
}

export const isPreviewable = (path: string) => PREVIEWABLE.has(extensionOf(path));
export const isImage = (path: string) => IMAGE_EXT.has(extensionOf(path));

export async function signedUrls(supabase: Supa, paths: string[], seconds = 600, bucket = "avantprojecte"): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const { data } = await supabase.storage.from(bucket).createSignedUrls([...new Set(paths)], seconds);
  return new Map((data ?? []).filter((x) => x.signedUrl && x.path).map((x) => [x.path as string, x.signedUrl as string]));
}

export async function loadThreads(
  supabase: Supa, people: Map<string, Person>, locale: AppLocale,
  filter: { column: "annotation_id" | "item_id" | "document_id"; ids: string[] },
): Promise<Record<string, ThreadComment[]>> {
  if (!filter.ids.length) return {};
  const { data } = await supabase.from("comments")
    .select("id, parent_id, body, visibility, resolved_at, created_at, author_id, author_role, annotation_id, item_id, document_id")
    .in(filter.column, filter.ids).order("created_at");
  const out: Record<string, ThreadComment[]> = {};
  for (const c of data ?? []) {
    const key = c[filter.column] as string | null;
    if (!key) continue;
    // Els comentaris d'un document que pertanyen a un punt o marcador no surten al fil del document
    if (filter.column === "document_id" && (c.item_id || c.annotation_id)) continue;
    (out[key] ??= []).push({
      id: c.id, parentId: c.parent_id, body: c.body, visibility: c.visibility as "compartit" | "intern",
      author: people.get(c.author_id ?? "")?.name ?? "—", role: c.author_role ?? "", when: formatDateTime(c.created_at, locale),
      resolved: !!c.resolved_at,
    });
  }
  return out;
}

export async function loadRounds(supabase: Supa, projectId: string) {
  const [{ data: status }, { data: rounds }, { data: items }, { data: grants }] = await Promise.all([
    supabase.rpc("revision_round_status", { p_project_id: projectId }),
    supabase.from("revision_rounds").select("id, number, is_exception, status, submitted_at, submitted_by, original_text, closed_at")
      .eq("project_id", projectId).order("number", { ascending: false }),
    supabase.from("revision_items").select("id, round_id, position, title, description, room, source_excerpt, needs_clarification, ai_notes, status, assessment, alternative, alternative_status, requires_economic_valuation, economic_decision, architect_id, client_reviewed_at")
      .eq("project_id", projectId).not("round_id", "is", null).order("position"),
    supabase.from("revision_round_grants").select("id, reason, created_at").eq("project_id", projectId).order("created_at"),
  ]);
  const st = (Array.isArray(status) ? status[0] : status) as { base: number; granted: number; used: number; available: number } | null;
  return {
    status: st ?? { base: 3, granted: 0, used: 0, available: 3 },
    rounds: rounds ?? [],
    items: items ?? [],
    grants: grants ?? [],
  };
}

export type DraftMarker = { id: string; label: string; page: number; body: string; document_id: string; item_id: string | null; kind: string; x: number; y: number; w: number | null; h: number | null };

/** Marcadors de l'esborrany del client, numerats per ordre de creació (1, 2, 3…). */
export async function draftMarkers(supabase: Supa, draftId: string): Promise<DraftMarker[]> {
  const { data } = await supabase.from("plan_annotations").select("id, page, body, document_id, item_id, kind, x, y, w, h")
    .eq("draft_id", draftId).is("round_id", null).order("created_at");
  return (data ?? []).map((m, i) => ({
    ...m, label: String(i + 1), x: Number(m.x), y: Number(m.y),
    w: m.w == null ? null : Number(m.w), h: m.h == null ? null : Number(m.h),
  }));
}

/** Documents vinculats a marcadors o punts de l'esborrany (per a l'IA i la confirmació). */
export async function draftAttachments(supabase: Supa, annotationIds: string[], itemIds: string[]) {
  const ors = [
    annotationIds.length ? `annotation_id.in.(${annotationIds.join(",")})` : null,
    itemIds.length ? `item_id.in.(${itemIds.join(",")})` : null,
  ].filter(Boolean).join(",");
  if (!ors) return [];
  const { data } = await supabase.from("document_links")
    .select("annotation_id, item_id, description, documents(id, title, description, storage_path)").or(ors);
  return (data ?? []).map((l) => ({
    annotationId: l.annotation_id as string | null, itemId: l.item_id as string | null, linkDescription: l.description as string | null,
    doc: (Array.isArray(l.documents) ? l.documents[0] : l.documents) as { id: string; title: string; description: string | null; storage_path: string } | null,
  })).filter((l) => l.doc);
}

export type ProjectDoc = {
  id: string; bucket_id: string; category: string; title: string; description: string | null; storage_path: string;
  version: number; status: string; published_to_client: boolean; published_at: string | null; created_at: string; url: string | null;
};

/** Contracte, factures i documentació general del projecte (l'RLS filtra què veu cadascú). */
export async function loadProjectDocuments(supabase: Supa, projectId: string): Promise<ProjectDoc[]> {
  const { data } = await supabase.from("documents")
    .select("id, bucket_id, category, title, description, storage_path, version, status, published_to_client, published_at, created_at")
    .eq("project_id", projectId).in("bucket_id", ["contractes", "factures", "documents"]).neq("status", "arxivat")
    .order("created_at", { ascending: false });
  const docs = (data ?? []) as Omit<ProjectDoc, "url">[];
  const urls = new Map<string, string>();
  for (const b of ["contractes", "factures", "documents"]) {
    const m = await signedUrls(supabase, docs.filter((d) => d.bucket_id === b).map((d) => d.storage_path), 300, b);
    for (const [k, v] of m) urls.set(`${b}/${k}`, v);
  }
  return docs.map((d) => ({ ...d, url: urls.get(`${d.bucket_id}/${d.storage_path}`) ?? null }));
}
