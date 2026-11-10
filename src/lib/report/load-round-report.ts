// Dades de l'informe d'una ronda. NOMÉS contingut compartit amb el client:
// cap comentari, marcador ni document intern hi apareix, encara que qui el generi sigui de l'equip.
import "server-only";
import type { AppLocale } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { extensionOf, IMAGE_EXT } from "@/lib/files";
import { projectPeople, signedUrls } from "@/lib/avantprojecte-data";
import type { createClient } from "@/lib/supabase/server";
import type { ReportItem, RoundReport } from "./round-report";

type Supa = Awaited<ReturnType<typeof createClient>>;
const SHARED_DOC = new Set(["publicat", "compartit"]);
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function loadRoundReport(supabase: Supa, projectId: string, roundNumber: number, locale: AppLocale): Promise<RoundReport | null> {
  const [{ data: project }, { data: round }, people] = await Promise.all([
    supabase.from("projects").select("title, code").eq("id", projectId).maybeSingle(),
    supabase.from("revision_rounds").select("id, number, submitted_at, submitted_by, status, closed_at, is_exception, original_text")
      .eq("project_id", projectId).eq("number", roundNumber).maybeSingle(),
    projectPeople(supabase, projectId),
  ]);
  if (!project || !round) return null;
  const name = (id: string | null) => people.get(id ?? "")?.name ?? "—";
  const when = (d: string | null) => (d ? formatDateTime(d, locale) : "");

  const { data: items } = await supabase.from("revision_items")
    .select("id, position, title, description, room, source_excerpt, status, assessment, alternative, alternative_status, requires_economic_valuation, economic_decision")
    .eq("round_id", round.id).order("position");
  const ids = (items ?? []).map((i) => i.id);
  const docSel = "id, title, version, storage_path, visibility, published_at, approved_at, bucket_id";
  const [{ data: anns }, { data: links }, { data: confs }, { data: comments }, { data: res }] = await Promise.all([
    ids.length ? supabase.from("plan_annotations").select(`id, item_id, parent_id, author_id, page, kind, x, y, w, h, body, visibility, created_at, documents(${docSel})`).in("item_id", ids).order("created_at") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("document_links").select(`item_id, annotation_id, description, documents(${docSel}, description)`).in("item_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("revision_confirmations").select("item_id, kind, profile_id, created_at").in("item_id", ids).order("created_at") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("comments").select("item_id, body, visibility, author_id, created_at").in("item_id", ids).eq("visibility", "compartit").order("created_at") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("version_item_resolutions").select(`item_id, resolution, note, documents(${docSel})`).in("item_id", ids) : Promise.resolve({ data: [] }),
  ]);

  type Doc = { id: string; title: string; version: number; storage_path: string; visibility: string; published_at: string | null; approved_at: string | null; bucket_id: string; description?: string | null };
  const sharedAnns = (anns ?? []).map((a) => ({ ...a, doc: one(a.documents as unknown as Doc | Doc[]) }))
    .filter((a) => a.visibility === "compartit" && a.doc && SHARED_DOC.has(a.doc.visibility));
  // Fotografies vinculades al punt o a un dels seus marcadors compartits
  const annItem = new Map(sharedAnns.map((a) => [a.id, a.item_id as string]));
  const { data: annLinks } = annItem.size
    ? await supabase.from("document_links").select(`item_id, annotation_id, description, documents(${docSel}, description)`).in("annotation_id", [...annItem.keys()])
    : { data: [] };
  const seen = new Set<string>();
  const sharedLinks = [...(links ?? []), ...(annLinks ?? [])]
    .map((l) => ({ ...l, item_id: l.item_id ?? annItem.get(l.annotation_id ?? "") ?? null, doc: one(l.documents as unknown as Doc | Doc[]) }))
    .filter((l) => {
      if (!l.doc || !l.item_id || !SHARED_DOC.has(l.doc.visibility)) return false;
      const k = `${l.item_id}:${l.doc.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const sharedRes = (res ?? []).map((r) => ({ ...r, doc: one(r.documents as unknown as Doc | Doc[]) }))
    .filter((r) => r.doc && r.doc.visibility === "publicat");

  const urls = await signedUrls(supabase, [...sharedAnns.map((a) => a.doc!.storage_path), ...sharedLinks.map((l) => l.doc!.storage_path)], 900);
  const labelOf = new Map<string, number>();

  const reportItems: ReportItem[] = (items ?? []).map((it) => {
    const myRes = sharedRes.filter((r) => r.item_id === it.id).sort((a, b) => b.doc!.version - a.doc!.version)[0];
    return {
      ref: `R${round.number}.${it.position}`,
      position: it.position,
      title: it.title,
      description: it.description,
      room: it.room,
      sourceExcerpt: it.source_excerpt,
      status: it.status,
      assessment: it.assessment,
      alternative: it.alternative,
      alternativeStatus: it.alternative_status,
      economic: it.requires_economic_valuation ? it.economic_decision ?? "pendent" : null,
      confirmations: (confs ?? []).filter((c) => c.item_id === it.id).map((c) => ({ kind: c.kind, who: name(c.profile_id), when: when(c.created_at) })),
      // Comentaris compartits + respostes sobre els marcadors, en ordre cronològic
      comments: [
        ...(comments ?? []).filter((c) => c.item_id === it.id).map((c) => ({ at: c.created_at, author: name(c.author_id), body: c.body })),
        ...sharedAnns.filter((a) => a.item_id === it.id && a.parent_id && a.body.trim()).map((a) => ({ at: a.created_at, author: name(a.author_id), body: a.body })),
      ].sort((a, b) => a.at.localeCompare(b.at)).map((c) => ({ author: c.author, when: when(c.at), body: c.body })),
      markers: sharedAnns.filter((a) => a.item_id === it.id && !a.parent_id).map((a) => {
        const n = (labelOf.get(it.id) ?? 0) + 1;
        labelOf.set(it.id, n);
        return {
          label: String(n), page: a.page, kind: a.kind as "punt" | "rectangle", x: Number(a.x), y: Number(a.y),
          w: a.w == null ? null : Number(a.w), h: a.h == null ? null : Number(a.h),
          documentTitle: a.doc!.title, documentVersion: a.doc!.version,
          documentKind: IMAGE_EXT.has(extensionOf(a.doc!.storage_path)) ? "image" as const : "pdf" as const,
          url: urls.get(a.doc!.storage_path) ?? null, comment: a.body,
        };
      }),
      photos: sharedLinks.filter((l) => l.item_id === it.id).map((l) => ({
        title: l.doc!.title, description: l.description ?? l.doc!.description ?? null,
        url: urls.get(l.doc!.storage_path) ?? null, isImage: IMAGE_EXT.has(extensionOf(l.doc!.storage_path)),
      })),
      resolution: myRes ? { documentTitle: myRes.doc!.title, version: myRes.doc!.version, resolution: myRes.resolution, note: myRes.note } : null,
    };
  });

  const versionDocs = new Map<string, Doc>();
  for (const a of sharedAnns) versionDocs.set(a.doc!.id, a.doc!);
  for (const r of sharedRes) versionDocs.set(r.doc!.id, r.doc!);
  return {
    project: { title: project.title, code: project.code },
    round: {
      number: round.number, submittedAt: when(round.submitted_at), submittedBy: name(round.submitted_by), status: round.status,
      closedAt: round.closed_at ? when(round.closed_at) : null, isException: round.is_exception, originalText: round.original_text,
    },
    generatedAt: formatDateTime(new Date(), locale),
    items: reportItems,
    versions: [...versionDocs.values()].sort((a, b) => a.title.localeCompare(b.title) || a.version - b.version)
      .map((d) => ({ title: d.title, version: d.version, publishedAt: d.published_at ? when(d.published_at) : null, approvedAt: d.approved_at ? when(d.approved_at) : null })),
  };
}
