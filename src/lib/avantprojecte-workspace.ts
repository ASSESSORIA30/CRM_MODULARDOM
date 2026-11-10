// Prepara les dades del visor amb anotacions per a un document (equip i client).
import "server-only";
import type { AppLocale } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { isImage, loadThreads, signedUrls, type DocRow, type Person } from "@/lib/avantprojecte-data";
import type { WorkspaceAnnotation } from "@/components/avantprojecte/plan-workspace";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

export async function workspaceData(
  supabase: Supa, doc: DocRow, people: Map<string, Person>, locale: AppLocale,
  opts: { itemLabels: Map<string, string>; draftId?: string },
) {
  const { data: anns } = await supabase.from("plan_annotations")
    .select("id, page, kind, x, y, w, h, body, visibility, status, author_id, author_role, item_id, parent_id, draft_id, round_id, created_at")
    .eq("document_id", doc.id).order("created_at");
  const list = anns ?? [];
  const annIds = list.map((a) => a.id);
  const [{ data: links }, threads] = await Promise.all([
    annIds.length ? supabase.from("document_links").select("annotation_id, documents(id, title, storage_path)").in("annotation_id", annIds) : Promise.resolve({ data: [] }),
    loadThreads(supabase, people, locale, { column: "annotation_id", ids: annIds }),
  ]);
  const linkDocs = (links ?? []).map((l) => ({ annotationId: l.annotation_id as string, doc: (Array.isArray(l.documents) ? l.documents[0] : l.documents) as { id: string; title: string; storage_path: string } | null }))
    .filter((l) => l.doc);
  const linkUrls = await signedUrls(supabase, linkDocs.map((l) => l.doc!.storage_path));

  // Etiquetes: els marcadors de l'esborrany actual es numeren 1, 2, 3… (com els veurà la IA);
  // la resta, per ordre al document.
  const draftOrder = list.filter((a) => opts.draftId && a.draft_id === opts.draftId && !a.round_id);
  const labelOf = new Map<string, string>();
  draftOrder.forEach((a, i) => labelOf.set(a.id, String(i + 1)));
  let k = 0;
  for (const a of list) if (!labelOf.has(a.id)) labelOf.set(a.id, opts.draftId ? `·${++k}` : String(++k));

  const annotations: WorkspaceAnnotation[] = list.map((a) => ({
    id: a.id, page: a.page, kind: a.kind as "punt" | "rectangle", x: Number(a.x), y: Number(a.y),
    w: a.w == null ? null : Number(a.w), h: a.h == null ? null : Number(a.h),
    label: labelOf.get(a.id)!, title: a.body,
    tone: a.visibility === "intern" ? "intern" : a.author_role === "client" ? "client" : a.author_role === "direccio" ? "direccio" : "arquitecte",
    body: a.body, author: people.get(a.author_id ?? "")?.name ?? "—", when: formatDateTime(a.created_at, locale),
    visibility: a.visibility as "compartit" | "intern", status: a.status as "obert" | "resolt",
    itemLabel: a.item_id ? opts.itemLabels.get(a.item_id) ?? null : null,
    parentLabel: a.parent_id ? labelOf.get(a.parent_id) ?? null : null,
    attachments: linkDocs.filter((l) => l.annotationId === a.id).map((l) => ({
      id: l.doc!.id, title: l.doc!.title, href: linkUrls.get(l.doc!.storage_path) ?? "#", isImage: isImage(l.doc!.storage_path),
    })),
  }));
  return { annotations, threads };
}

/** Comentaris generals del projecte (sense document, punt ni marcador) */
export async function generalMessages(supabase: Supa, projectId: string, people: Map<string, Person>, locale: AppLocale) {
  const { data } = await supabase.from("comments")
    .select("id, parent_id, body, visibility, resolved_at, created_at, author_id, author_role")
    .eq("project_id", projectId).is("document_id", null).is("item_id", null).is("annotation_id", null)
    .order("created_at").limit(500);
  return (data ?? []).map((c) => ({
    id: c.id, parentId: c.parent_id, body: c.body, visibility: c.visibility as "compartit" | "intern",
    author: people.get(c.author_id ?? "")?.name ?? "—", role: c.author_role ?? "", when: formatDateTime(c.created_at, locale),
    resolved: !!c.resolved_at,
  }));
}
