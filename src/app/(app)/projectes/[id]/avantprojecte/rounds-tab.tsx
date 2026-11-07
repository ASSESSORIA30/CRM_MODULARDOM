import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/avantprojecte/comment-thread";
import { Badge, Card, EmptyState, Field, inputCls } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { isImage, loadRounds, loadThreads, projectPeople, signedUrls } from "@/lib/avantprojecte-data";
import { ITEM_STATUS_STYLE } from "@/lib/i18n-avantprojecte";
import { createClient } from "@/lib/supabase/server";
import { closeRoundAction, decideEconomicsAction, grantRoundAction, respondItemAction } from "./actions";
import { clientTexts, mentionable, type TabProps } from "./shared";

export async function RoundsTab({ projectId, profile, focusItem }: TabProps & { focusItem?: string }) {
  const L = profile.locale;
  const { T, messages } = clientTexts(profile);
  const isDir = profile.role === "direccio";
  const supabase = await createClient();
  const [{ status, rounds, items, grants }, people] = await Promise.all([loadRounds(supabase, projectId), projectPeople(supabase, projectId)]);
  const ids = items.map((i) => i.id);
  const [{ data: markers }, { data: links }, { data: confirmations }, { data: events }, threads] = await Promise.all([
    ids.length ? supabase.from("plan_annotations").select("id, document_id, item_id, page, created_at").in("item_id", ids).order("created_at") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("document_links").select("item_id, description, documents(id, title, storage_path)").in("item_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("revision_confirmations").select("item_id, kind, note, profile_id, created_at").in("item_id", ids).order("created_at") : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("revision_item_events").select("item_id, kind, from_value, to_value, note, actor_id, created_at").in("item_id", ids).order("created_at") : Promise.resolve({ data: [] }),
    loadThreads(supabase, people, L, { column: "item_id", ids }),
  ]);
  const linkDocs = (links ?? []).map((l) => ({ itemId: l.item_id as string, description: l.description as string | null,
    doc: (Array.isArray(l.documents) ? l.documents[0] : l.documents) as { id: string; title: string; storage_path: string } | null })).filter((l) => l.doc);
  const urls = await signedUrls(supabase, linkDocs.map((l) => l.doc!.storage_path));
  const base = `/projectes/${projectId}/avantprojecte`;
  const total = status.base + status.granted;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-sm text-muted">{T.rounds}</p>
            <div className="mt-1 flex gap-1.5" aria-label={`${status.used} ${T.of} ${total}`}>
              {Array.from({ length: Math.max(total, status.used) }, (_, i) => (
                <span key={i} className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${i < status.used ? "bg-navy text-white" : "border-2 border-navy/20 text-navy/40"} ${i >= status.base ? "ring-2 ring-gold" : ""}`}>{i + 1}</span>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">{status.used} {T.used} · {status.available} {T.available}</p>
          </div>
          {grants.length > 0 && (
            <ul className="text-xs text-muted">
              {grants.map((g) => <li key={g.id}>★ {T.exception}: {g.reason} · {formatDateTime(g.created_at, L)}</li>)}
            </ul>
          )}
          {isDir && (
            <details className="ml-auto">
              <summary className="cursor-pointer text-sm font-medium text-navy">+ {T.grantTitle}</summary>
              <ActionForm action={grantRoundAction} messages={messages} submitLabel={T.grant} resetOnSuccess className="mt-2 flex flex-col gap-2 sm:w-80">
                <input type="hidden" name="project_id" value={projectId} />
                <input name="reason" required placeholder={T.grantReason} className={inputCls} />
              </ActionForm>
            </details>
          )}
        </div>
      </Card>

      {rounds.length === 0 && <EmptyState>{T.noRounds}</EmptyState>}
      {rounds.map((r) => {
        const roundItems = items.filter((i) => i.round_id === r.id);
        return (
          <section key={r.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold text-navy">{T.round} {r.number}</h2>
              {r.is_exception && <Badge className="bg-gold-light text-navy">★ {T.exception}</Badge>}
              <Badge className={r.status === "oberta" ? "bg-sky-50 text-sky-700" : "bg-slate-200 text-slate-700"}>{r.status === "oberta" ? T.roundOpen : T.closed}</Badge>
              <span className="text-xs text-muted">{T.submittedOn}: {formatDateTime(r.submitted_at, L)} · {people.get(r.submitted_by ?? "")?.name ?? "—"}</span>
              {isDir && r.status === "oberta" && (
                <form action={closeRoundAction} className="ml-auto">
                  <input type="hidden" name="round_id" value={r.id} /><input type="hidden" name="project_id" value={projectId} />
                  <button className="rounded-md border border-navy/20 px-3 py-1.5 text-sm text-navy">{T.closeRound}</button>
                </form>
              )}
            </div>
            {r.original_text && (
              <details className="rounded-lg bg-white p-3 text-sm ring-1 ring-navy/10">
                <summary className="cursor-pointer font-medium text-navy">{T.originalText}</summary>
                <p className="mt-2 whitespace-pre-line text-ink">{r.original_text}</p>
              </details>
            )}
            {roundItems.map((it) => {
              const itMarkers = (markers ?? []).filter((m) => m.item_id === it.id);
              const itDocs = linkDocs.filter((l) => l.itemId === it.id);
              const itConf = (confirmations ?? []).filter((c) => c.item_id === it.id);
              const itEvents = (events ?? []).filter((e) => e.item_id === it.id);
              return (
                <article key={it.id} id={`punt-${it.id}`} className={`rounded-xl border bg-white p-4 shadow-sm ${focusItem === it.id ? "border-gold ring-2 ring-gold/40" : "border-navy/10"}`}>
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{it.position}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-navy">{it.title}</h3>
                      <p className="flex flex-wrap gap-1.5 text-xs">
                        <Badge className={ITEM_STATUS_STYLE[it.status]}>{T.itemStatus[it.status as keyof typeof T.itemStatus]}</Badge>
                        {it.room && <Badge className="bg-navy/5 text-navy">{T.room}: {it.room}</Badge>}
                        {it.needs_clarification && <Badge className="bg-amber-100 text-amber-900">⚠ {T.needsClarification}</Badge>}
                        {it.alternative_status !== "cap" && <Badge className="bg-gold-light text-navy">{T.altStatus[it.alternative_status as keyof typeof T.altStatus]}</Badge>}
                        {it.requires_economic_valuation && <Badge className="bg-red-50 text-red-700">€ {T.economicOptions[(it.economic_decision ?? "pendent") as keyof typeof T.economicOptions]}</Badge>}
                        {it.client_reviewed_at && <Badge className="bg-emerald-50 text-emerald-700">✓ {T.clientConfirmations}</Badge>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2 text-sm">
                      {it.description && <p className="whitespace-pre-line text-ink">{it.description}</p>}
                      {it.source_excerpt && <p className="rounded bg-surface p-2 text-xs text-muted"><strong>{T.sourceExcerpt}:</strong> {it.source_excerpt}</p>}
                      {it.ai_notes && <p className="text-xs text-amber-800">{it.ai_notes}</p>}
                      {itMarkers.length > 0 && (
                        <p className="flex flex-wrap gap-2 text-xs">
                          <span className="text-muted">{T.markers}:</span>
                          {itMarkers.map((m) => (
                            <Link key={m.id} href={`${base}?doc=${m.document_id}&marker=${m.id}`} className="font-medium text-navy underline">📍 {T.seeOnPlan} (p.{m.page})</Link>
                          ))}
                        </p>
                      )}
                      {itDocs.length > 0 && (
                        <div>
                          <p className="text-xs text-muted">{T.attachments}:</p>
                          <ul className="mt-1 flex flex-wrap gap-2">
                            {itDocs.map((l) => (
                              <li key={l.doc!.id}>
                                <a href={urls.get(l.doc!.storage_path) ?? "#"} target="_blank" rel="noopener noreferrer" className="block w-24 text-[11px] text-navy underline" title={l.description ?? l.doc!.title}>
                                  {isImage(l.doc!.storage_path)
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={urls.get(l.doc!.storage_path)} alt={l.doc!.title} className="mb-1 h-16 w-24 rounded object-cover" />
                                    : <span className="mb-1 flex h-16 w-24 items-center justify-center rounded bg-surface text-2xl">📄</span>}
                                  <span className="line-clamp-1">{l.doc!.title}</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {it.assessment && <p className="rounded border-l-4 border-navy bg-navy/5 p-2"><strong className="text-navy">{T.assessment}:</strong> {it.assessment}</p>}
                      {it.alternative && <p className="rounded border-l-4 border-gold bg-gold-light/40 p-2"><strong className="text-navy">{T.alternative}:</strong> {it.alternative}</p>}
                      {(itConf.length > 0 || itEvents.length > 0) && (
                        <details>
                          <summary className="cursor-pointer text-xs text-navy">{T.history} ({itEvents.length + itConf.length})</summary>
                          <ol className="mt-1 space-y-0.5 text-xs text-muted">
                            {itEvents.map((e, k) => (
                              <li key={`e${k}`}>{formatDateTime(e.created_at, L)} · {people.get(e.actor_id ?? "")?.name ?? "—"} · {T.events[e.kind as keyof typeof T.events] ?? e.kind}
                                {e.to_value ? `: ${T.itemStatus[e.to_value as keyof typeof T.itemStatus] ?? e.to_value}` : ""}{e.note ? ` — ${e.note}` : ""}</li>
                            ))}
                            {itConf.map((c, k) => (
                              <li key={`c${k}`}>{formatDateTime(c.created_at, L)} · {people.get(c.profile_id)?.name ?? "—"} · {c.kind}{c.note ? ` — ${c.note}` : ""}</li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                    <div className="space-y-3">
                      <ActionForm action={respondItemAction} messages={messages} submitLabel={T.respond} className="space-y-2 rounded-lg bg-surface p-3">
                        <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="item_id" value={it.id} />
                        <select name="status" defaultValue={it.status} className={inputCls}>
                          {Object.entries(T.itemStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <textarea name="assessment" rows={2} placeholder={T.assessment} className={inputCls} />
                        <textarea name="alternative" rows={2} placeholder={T.alternative} className={inputCls} />
                        <label className="flex items-center gap-2 text-sm text-navy">
                          <input type="checkbox" name="requires_economic" defaultChecked={it.requires_economic_valuation} className="h-4 w-4 accent-navy" /> {T.requiresEconomic}
                        </label>
                      </ActionForm>
                      {isDir && it.requires_economic_valuation && (
                        <form action={decideEconomicsAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="item_id" value={it.id} />
                          <Field label={T.economic} className="flex-1">
                            <select name="decision" defaultValue={it.economic_decision ?? "pendent"} className={inputCls}>
                              {Object.entries(T.economicOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </Field>
                          <button className="rounded-md border border-navy/20 px-3 py-2 text-sm text-navy">{T.decide}</button>
                        </form>
                      )}
                      <CommentThread projectId={projectId} target={{ item_id: it.id }} comments={threads[it.id] ?? []}
                        canInternal canResolve participants={mentionable(people, profile.id)} texts={T.thread} messages={messages} />
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
