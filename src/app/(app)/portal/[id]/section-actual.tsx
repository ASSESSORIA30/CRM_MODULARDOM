import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PlanWorkspace } from "@/components/avantprojecte/plan-workspace";
import { Badge, Card, EmptyState, inputCls } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { isImage, isPreviewable, loadDocuments, projectPeople, signedUrls } from "@/lib/avantprojecte-data";
import { workspaceData } from "@/lib/avantprojecte-workspace";
import { createClient } from "@/lib/supabase/server";
import { clientTexts, mentionable } from "../../projectes/[id]/avantprojecte/shared";
import { confirmDocumentAction } from "./actions";
import { currentAvantprojecte, type SectionProps } from "./shared";

export async function SectionActual({ projectId, profile, docId, markerId }: SectionProps & { docId?: string; markerId?: string }) {
  const L = profile.locale;
  const { T, messages, uploader, categories, rooms } = clientTexts(profile);
  const P = T.portal;
  const supabase = await createClient();
  const [{ groups }, people, { data: rules }] = await Promise.all([
    loadDocuments(supabase, projectId), projectPeople(supabase, projectId),
    supabase.from("upload_rules").select("extension, mime_type, max_bytes").eq("bucket_id", "avantprojecte"),
  ]);
  const cur = currentAvantprojecte(groups);
  // Des del seguiment es pot obrir qualsevol document visible amb ?doc=
  const doc = groups.flat().find((d) => d.id === docId) ?? cur?.doc;
  if (!doc) return <EmptyState>{P.noCurrent}</EmptyState>;
  const group = groups.find((g) => g.some((d) => d.id === doc.id)) ?? [doc];

  const [urls, ws, { data: res }, { data: confs }] = await Promise.all([
    signedUrls(supabase, group.map((d) => d.storage_path)),
    workspaceData(supabase, doc, people, L, { itemLabels: new Map() }),
    supabase.from("version_item_resolutions").select("item_id, resolution, note, revision_items(position, title, round_id, revision_rounds(number))").eq("document_id", doc.id),
    supabase.from("revision_confirmations").select("kind, created_at, profile_id").eq("document_id", doc.id).order("created_at"),
  ]);
  const mine = (confs ?? []).filter((c) => c.profile_id === profile.id);
  const reviewed = mine.find((c) => c.kind === "versio_revisada");
  const isCurrent = cur?.doc.id === doc.id;
  const base = `/portal/${projectId}?apartat=actual`;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-navy">{doc.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <span>{T.version} {doc.version}</span>
              {isCurrent && <Badge className="bg-navy text-white">{P.currentVersion}</Badge>}
              {doc.status === "substituit" && <Badge>{T.previous}</Badge>}
              {doc.published_at && <span>{P.publishedOn} {formatDate(doc.published_at, L)}</span>}
              {doc.approved_at && <Badge className="bg-emerald-600 text-white">✓ {P.approvedOn} {formatDate(doc.approved_at, L)}</Badge>}
            </p>
          </div>
          {urls.get(doc.storage_path) && (
            <a href={urls.get(doc.storage_path)} target="_blank" rel="noopener noreferrer" className="rounded-md border border-navy/20 px-3 py-2 text-sm text-navy">⬇ {T.download}</a>
          )}
        </div>
        {group.length > 1 && (
          <p className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="text-muted">{P.previousVersions}:</span>
            {group.map((v) => (
              <Link key={v.id} href={`${base}&doc=${v.id}`} className={v.id === doc.id ? "font-semibold text-navy" : "text-navy underline"}>
                v{v.version}{v.status === "vigent" && v.visibility === "publicat" ? ` (${P.currentVersion.toLowerCase()})` : ""}
              </Link>
            ))}
          </p>
        )}
      </Card>

      {isPreviewable(doc.storage_path) && urls.get(doc.storage_path) ? (
        <PlanWorkspace key={doc.id} projectId={projectId} documentId={doc.id}
          source={{ kind: isImage(doc.storage_path) ? "image" : "pdf", url: urls.get(doc.storage_path)! }}
          annotations={ws.annotations} items={[]} staff={false} threads={ws.threads} canAnnotate={false}
          participants={mentionable(people, profile.id)} messages={messages} focusId={markerId ?? null}
          rules={rules ?? []} categories={categories} rooms={rooms}
          texts={{
            viewer: T.viewer, thread: T.thread, uploader, newMarker: T.newMarker, comment: T.comment, linkItem: T.linkItem,
            replyTo: T.replyTo, none: T.none, save: T.save, cancel: T.cancel, shared: T.shared, internal: T.internal,
            resolve: T.resolve, reopen: T.reopen, attachPhoto: T.attachPhoto, author: T.author, item: T.item,
            noSelection: T.noSelection, respondsTo: T.respondsTo,
          }} />
      ) : <EmptyState>{T.noPreview}</EmptyState>}

      {(res ?? []).length > 0 && (
        <Card title={P.whatChanged}>
          <ul className="space-y-2 text-sm">
            {(res ?? []).map((r) => {
              const it = (Array.isArray(r.revision_items) ? r.revision_items[0] : r.revision_items) as { position: number; title: string; revision_rounds: { number: number } | { number: number }[] | null } | null;
              const rr = it ? (Array.isArray(it.revision_rounds) ? it.revision_rounds[0] : it.revision_rounds) : null;
              return (
                <li key={r.item_id} className="flex flex-wrap items-center gap-2">
                  <Badge className={r.resolution === "incorporat" ? "bg-emerald-100 text-emerald-800" : r.resolution === "rebutjat" ? "bg-red-50 text-red-700" : "bg-gold-light text-navy"}>
                    {T.resolutions[r.resolution as keyof typeof T.resolutions]}
                  </Badge>
                  <span className="text-ink">{it ? `${T.round} ${rr?.number ?? "?"} · ${it.position}. ${it.title}` : ""}</span>
                  {r.note && <span className="text-muted">— {r.note}</span>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {isCurrent && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title={P.reviewed}>
            {reviewed ? (
              <p className="text-sm text-emerald-700">✓ {formatDateTime(reviewed.created_at, L)}</p>
            ) : (
              <ActionForm action={confirmDocumentAction} messages={messages} submitLabel={P.reviewed} className="space-y-2">
                <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="document_id" value={doc.id} />
                <input type="hidden" name="kind" value="versio_revisada" />
                <textarea name="note" rows={2} placeholder={P.noteOptional} className={inputCls} />
                <label className="flex items-start gap-2 text-sm text-navy"><input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4 accent-navy" /> {P.reviewedConfirm}</label>
              </ActionForm>
            )}
          </Card>
          {doc.category === "avantprojecte" && (
            <Card title={P.approve}>
              {doc.approved_at ? (
                <p className="text-sm text-emerald-700">✓ {P.approvedOn} {formatDateTime(doc.approved_at, L)}</p>
              ) : (
                <ActionForm action={confirmDocumentAction} messages={messages} submitLabel={P.approve} className="space-y-2"
                  submitClassName="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                  <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="document_id" value={doc.id} />
                  <input type="hidden" name="kind" value="avantprojecte_aprovat" />
                  <textarea name="note" rows={2} placeholder={P.noteOptional} className={inputCls} />
                  <label className="flex items-start gap-2 text-sm text-navy"><input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4 accent-navy" /> {P.approveConfirm}</label>
                </ActionForm>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
