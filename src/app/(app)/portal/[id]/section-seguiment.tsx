import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/avantprojecte/comment-thread";
import { Badge, EmptyState, inputCls } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { isImage, loadRounds, loadThreads, projectPeople, signedUrls } from "@/lib/avantprojecte-data";
import { ITEM_STATUS_STYLE } from "@/lib/i18n-avantprojecte";
import { createClient } from "@/lib/supabase/server";
import { clientTexts, mentionable } from "../../projectes/[id]/avantprojecte/shared";
import { clientRespondAction } from "./actions";
import type { SectionProps } from "./shared";

export async function SectionSeguiment({ projectId, profile, focusItem }: SectionProps & { focusItem?: string }) {
  const L = profile.locale;
  const { T, messages } = clientTexts(profile);
  const P = T.portal;
  const supabase = await createClient();
  const [{ rounds, items }, people] = await Promise.all([loadRounds(supabase, projectId), projectPeople(supabase, projectId)]);
  if (!rounds.length) return <EmptyState>{P.noRounds}</EmptyState>;
  const ids = items.map((i) => i.id);
  const [{ data: markers }, { data: links }, threads] = await Promise.all([
    ids.length ? supabase.from("plan_annotations").select("id, document_id, item_id, page").in("item_id", ids).order("created_at") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("document_links").select("item_id, documents(id, title, storage_path)").in("item_id", ids) : Promise.resolve({ data: [] }),
    loadThreads(supabase, people, L, { column: "item_id", ids }),
  ]);
  const linkDocs = (links ?? []).map((l) => ({ itemId: l.item_id as string, doc: (Array.isArray(l.documents) ? l.documents[0] : l.documents) as { id: string; title: string; storage_path: string } | null })).filter((l) => l.doc);
  const urls = await signedUrls(supabase, linkDocs.map((l) => l.doc!.storage_path));
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;

  return (
    <div className="space-y-8">
      {rounds.map((r) => (
        <section key={r.id} className="space-y-3">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-navy">
            {T.round} {r.number}
            {r.is_exception && <Badge className="bg-gold-light text-navy">★ {T.exception}</Badge>}
            <span className="text-xs font-normal text-muted">{formatDateTime(r.submitted_at, L)}</span>
            <Link href={`/projectes/${projectId}/avantprojecte/informe/${r.number}`} className="ml-auto rounded-md border border-gold bg-gold-light px-3 py-1 text-sm font-semibold text-navy">📑 {T.report.open_report}</Link>
          </h2>
          {r.original_text && (
            <details className="rounded-lg bg-white p-3 text-sm ring-1 ring-navy/10">
              <summary className="cursor-pointer text-navy">{P.yourRequest}</summary>
              <p className="mt-2 whitespace-pre-line text-ink">{r.original_text}</p>
            </details>
          )}
          {items.filter((i) => i.round_id === r.id).map((it) => {
            const ms = (markers ?? []).filter((m) => m.item_id === it.id);
            const ds = linkDocs.filter((l) => l.itemId === it.id);
            return (
              <article key={it.id} id={`punt-${it.id}`} data-testid="tracking-item"
                className={`space-y-3 rounded-xl border bg-white p-4 shadow-sm ${focusItem === it.id ? "border-gold ring-2 ring-gold/40" : "border-navy/10"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{it.position}</span>
                  <h3 className="font-semibold text-navy">{it.title}</h3>
                  <Badge className={ITEM_STATUS_STYLE[it.status]}>{T.itemStatus[it.status as keyof typeof T.itemStatus]}</Badge>
                  {it.client_reviewed_at && <Badge className="bg-emerald-50 text-emerald-700">✓ {P.reviewedDone}</Badge>}
                </div>
                {it.description && <p className="whitespace-pre-line text-sm text-ink">{it.description}</p>}
                <div className="flex flex-wrap gap-3 text-xs">
                  {ms.map((m) => (
                    <Link key={m.id} href={`/portal/${projectId}?apartat=actual&doc=${m.document_id}&marker=${m.id}`} className="font-medium text-navy underline">📍 {P.seeOnPlan} (p.{m.page})</Link>
                  ))}
                </div>
                {ds.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {ds.map((l) => (
                      <li key={l.doc!.id}>
                        <a href={urls.get(l.doc!.storage_path) ?? "#"} target="_blank" rel="noopener noreferrer" className="block w-20 text-[11px] text-navy underline">
                          {isImage(l.doc!.storage_path)
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={urls.get(l.doc!.storage_path)} alt={l.doc!.title} className="mb-1 h-16 w-20 rounded object-cover" />
                            : <span className="mb-1 flex h-16 w-20 items-center justify-center rounded bg-surface text-2xl">📄</span>}
                          <span className="line-clamp-1">{l.doc!.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {it.assessment && (
                  <div className="rounded-lg border-l-4 border-navy bg-navy/5 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-navy">{P.architectAnswer}</p>
                    <p className="mt-1 whitespace-pre-line text-ink">{it.assessment}</p>
                  </div>
                )}
                {it.alternative && (
                  <div className="space-y-2 rounded-lg border-l-4 border-gold bg-gold-light/40 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-navy">{P.alternative} · {T.altStatus[it.alternative_status as keyof typeof T.altStatus]}</p>
                    <p className="whitespace-pre-line text-ink">{it.alternative}</p>
                    {["proposada", "aclariment"].includes(it.alternative_status) && (
                      <div className="flex flex-wrap gap-2">
                        <ActionForm action={clientRespondAction} messages={messages} submitLabel={`✓ ${P.acceptAlt}`} className="flex flex-col gap-1"
                          submitClassName="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">
                          {hidden("project_id", projectId)}{hidden("item_id", it.id)}{hidden("action", "acceptar_alternativa")}
                        </ActionForm>
                        <ActionForm action={clientRespondAction} messages={messages} submitLabel={P.rejectAlt} className="flex flex-col gap-1"
                          submitClassName="rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-navy">
                          {hidden("project_id", projectId)}{hidden("item_id", it.id)}{hidden("action", "rebutjar_alternativa")}
                        </ActionForm>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-start gap-3">
                  {(it.assessment || it.alternative) && !it.client_reviewed_at && (
                    <ActionForm action={clientRespondAction} messages={messages} submitLabel={P.markReviewed} className="flex flex-col gap-1"
                      submitClassName="rounded-md border border-navy/20 px-3 py-2 text-sm text-navy">
                      {hidden("project_id", projectId)}{hidden("item_id", it.id)}{hidden("action", "revisat")}
                    </ActionForm>
                  )}
                  <details className="min-w-60 flex-1">
                    <summary className="cursor-pointer text-sm text-navy underline">{P.askClarification}</summary>
                    <ActionForm action={clientRespondAction} messages={messages} submitLabel={T.thread.send} resetOnSuccess className="mt-2 space-y-2">
                      {hidden("project_id", projectId)}{hidden("item_id", it.id)}{hidden("action", "demanar_aclariment")}
                      <textarea name="note" rows={2} required placeholder={P.clarificationText} className={inputCls} />
                    </ActionForm>
                  </details>
                </div>
                <CommentThread projectId={projectId} target={{ item_id: it.id }} comments={threads[it.id] ?? []}
                  canInternal={false} canResolve participants={mentionable(people, profile.id)} texts={T.thread} messages={messages} />
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
