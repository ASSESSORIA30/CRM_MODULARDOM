import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AnalyzeForm } from "@/components/avantprojecte/analyze-form";
import { ConfirmSubmit } from "@/components/avantprojecte/confirm-submit";
import { MarkerThumb } from "@/components/avantprojecte/marker-thumb";
import { PlanWorkspace } from "@/components/avantprojecte/plan-workspace";
import { Uploader } from "@/components/avantprojecte/uploader";
import { Card, EmptyState, Field, inputCls } from "@/components/ui";
import { draftAttachments, draftMarkers, isImage, isPreviewable, loadDocuments, projectPeople, signedUrls } from "@/lib/avantprojecte-data";
import { workspaceData } from "@/lib/avantprojecte-workspace";
import { createClient } from "@/lib/supabase/server";
import { clientTexts, mentionable } from "../../projectes/[id]/avantprojecte/shared";
import { deleteDraftItemAction, deleteDraftMarkerAction, moveDraftItemAction, saveDraftItemAction, updateDraftMarkerAction } from "./actions";
import { currentAvantprojecte, viewableDocs, type SectionProps } from "./shared";

export async function SectionSollicitar({ projectId, profile, status, docId, markerId, confirm }:
  SectionProps & { docId?: string; markerId?: string; confirm: boolean }) {
  const L = profile.locale;
  const { T, messages, uploader, categories, rooms } = clientTexts(profile);
  const P = T.portal;
  const supabase = await createClient();

  // Esborrany obert d'abans (si n'hi ha) o, si queden rondes, se n'obre un de nou.
  // Obrir un esborrany NO consumeix cap ronda.
  const { data: existing } = await supabase.from("revision_drafts").select("id").eq("project_id", projectId).eq("status", "esborrany").maybeSingle();
  if (!existing && status.available <= 0) {
    return <Card><p className="text-sm text-ink">{P.noRoundsLeft}</p></Card>;
  }
  const draftId = existing?.id ?? ((await supabase.rpc("open_revision_draft", { p_project_id: projectId })).data as string | null);
  if (!draftId) return <EmptyState>{messages.errors.genericError}</EmptyState>;

  const [{ data: draft }, { data: items }, markers, { groups, current }, people, { data: rules }] = await Promise.all([
    supabase.from("revision_drafts").select("original_text, ai_extraction").eq("id", draftId).single(),
    supabase.from("revision_items").select("id, position, title, description, room, needs_clarification, ai_notes, source_excerpt").eq("draft_id", draftId).order("position"),
    draftMarkers(supabase, draftId),
    loadDocuments(supabase, projectId),
    projectPeople(supabase, projectId),
    supabase.from("upload_rules").select("extension, mime_type, max_bytes").eq("bucket_id", "avantprojecte"),
  ]);
  const itemList = items ?? [];
  const atts = await draftAttachments(supabase, markers.map((m) => m.id), itemList.map((i) => i.id));
  const docs = groups.flat();
  const markerDocs = [...new Set(markers.map((m) => m.document_id))].map((id) => docs.find((d) => d.id === id)).filter(Boolean) as typeof docs;
  const urls = await signedUrls(supabase, [...markerDocs.map((d) => d.storage_path), ...atts.map((a) => a.doc!.storage_path)]);
  const roundNumber = status.used + 1;
  const base = `/portal/${projectId}?apartat=sollicitar`;

  // ---------------- Pantalla de confirmació ----------------
  if (confirm) {
    return (
      <div className="space-y-4">
        <Card>
          <h2 className="text-lg font-semibold text-navy">{P.confirmTitle(roundNumber)}</h2>
          <p className="mt-1 text-sm text-muted">{P.confirmHelp}</p>
          {draft?.original_text && <p className="mt-3 whitespace-pre-line rounded bg-surface p-3 text-sm text-ink"><strong>{P.yourRequest}:</strong> {draft.original_text}</p>}
        </Card>
        {itemList.length === 0 && <EmptyState>{P.noItems}</EmptyState>}
        <ol className="space-y-3">
          {itemList.map((it) => {
            const ms = markers.filter((m) => m.item_id === it.id);
            const ds = atts.filter((a) => a.itemId === it.id || ms.some((m) => m.id === a.annotationId));
            return (
              <li key={it.id} className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm" data-testid="confirm-item">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy font-bold text-white">{it.position}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="font-semibold text-navy">{it.title}</h3>
                    {it.room && <p className="text-xs text-muted">{P.room}: {it.room}</p>}
                    {it.description && <p className="whitespace-pre-line text-sm text-ink">{it.description}</p>}
                    {it.needs_clarification && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">⚠ {P.needsClarification} {it.ai_notes}</p>}
                    <div className="flex flex-wrap gap-3">
                      {ms.map((m) => {
                        const d = docs.find((x) => x.id === m.document_id);
                        const u = d ? urls.get(d.storage_path) : undefined;
                        return d && u ? (
                          <Link key={m.id} href={`${base}&doc=${d.id}&marker=${m.id}#visor`} className="block text-center text-xs text-navy underline">
                            <MarkerThumb url={u} kind={isImage(d.storage_path) ? "image" : "pdf"} page={m.page} x={m.x} y={m.y} w={m.w} h={m.h} label={m.label} width={180} />
                            📍 {P.seeOnPlan}
                          </Link>
                        ) : null;
                      })}
                      {ds.map((a) => (
                        <a key={a.doc!.id} href={urls.get(a.doc!.storage_path) ?? "#"} target="_blank" rel="noopener noreferrer" className="block w-24 text-[11px] text-navy underline">
                          {isImage(a.doc!.storage_path)
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={urls.get(a.doc!.storage_path)} alt={a.doc!.title} className="mb-1 h-20 w-24 rounded object-cover" />
                            : <span className="mb-1 flex h-20 w-24 items-center justify-center rounded bg-surface text-2xl">📄</span>}
                          <span className="line-clamp-1">{a.doc!.title}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-start gap-3">
          <Link href={base} className="rounded-md border border-navy/20 bg-white px-4 py-3 text-sm text-navy">← {P.back}</Link>
          <div className="flex-1">
            <ConfirmSubmit projectId={projectId} draftId={draftId} messages={messages} disabled={itemList.length === 0 || status.available <= 0}
              texts={{ check: P.confirmCheck, send: P.send(roundNumber), sending: P.sending }} />
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Edició de la sol·licitud ----------------
  const viewables = viewableDocs(groups, current);
  const planDoc = viewables.find((d) => d.id === docId) ?? currentAvantprojecte(groups)?.doc ?? viewables[0];
  const ws = planDoc ? await workspaceData(supabase, planDoc, people, L, { itemLabels: new Map(itemList.map((i) => [i.id, `${i.position}. ${i.title}`])), draftId }) : null;
  const planUrl = planDoc ? (await signedUrls(supabase, [planDoc.storage_path])).get(planDoc.storage_path) : undefined;
  const questions = ((draft?.ai_extraction as { questions?: string[] } | null)?.questions ?? []).filter(Boolean);

  return (
    <div className="space-y-6">
      <section id="visor" className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">{P.step1}</h2>
          <p className="text-sm text-muted">{P.step1Help}</p>
        </div>
        {viewables.length > 1 && (
          <nav className="flex flex-wrap gap-1.5">
            {viewables.map((d) => (
              <Link key={d.id} href={`${base}&doc=${d.id}#visor`}
                className={`rounded-full px-3 py-1 text-sm ${d.id === planDoc?.id ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-navy/15"}`}>{d.title}</Link>
            ))}
          </nav>
        )}
        {planDoc && planUrl && ws && isPreviewable(planDoc.storage_path) ? (
          <PlanWorkspace key={planDoc.id} projectId={projectId} documentId={planDoc.id} draftId={draftId}
            source={{ kind: isImage(planDoc.storage_path) ? "image" : "pdf", url: planUrl }}
            annotations={ws.annotations} staff={false} threads={ws.threads}
            items={itemList.map((i) => ({ id: i.id, label: `${i.position}. ${i.title}` }))}
            participants={mentionable(people, profile.id)} messages={messages} focusId={markerId ?? null}
            rules={rules ?? []} categories={categories} rooms={rooms}
            texts={{
              viewer: T.viewer, thread: T.thread, uploader, newMarker: P.itemTitle, comment: T.comment, linkItem: T.linkItem,
              replyTo: T.replyTo, none: T.none, save: T.save, cancel: T.cancel, shared: T.shared, internal: T.internal,
              resolve: T.resolve, reopen: T.reopen, attachPhoto: T.attachPhoto, author: T.author, item: T.item,
              noSelection: T.noSelection, respondsTo: T.respondsTo,
            }} />
        ) : <EmptyState>{P.noCurrent}</EmptyState>}

        {markers.length > 0 && (
          <Card title={P.markersTitle}>
            <ul className="divide-y divide-navy/5">
              {markers.map((m) => (
                <li key={m.id} className="py-3">
                  <ActionForm action={updateDraftMarkerAction} messages={messages} submitLabel={P.save}
                    className="grid gap-2 sm:grid-cols-[2.5rem_1fr_14rem_auto] sm:items-start"
                    submitClassName="rounded-md border border-navy/20 px-3 py-2 text-sm text-navy">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold font-bold text-navy-dark">{m.label}</span>
                    <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="id" value={m.id} />
                    <textarea name="body" rows={2} defaultValue={m.body} className={inputCls} aria-label={T.comment} />
                    <select name="item_id" defaultValue={m.item_id ?? ""} className={inputCls} aria-label={P.linkToItem}>
                      <option value="">{P.linkToItem}: {T.none}</option>
                      {itemList.map((i) => <option key={i.id} value={i.id}>{i.position}. {i.title}</option>)}
                    </select>
                  </ActionForm>
                  <div className="mt-1 flex gap-4 pl-12 text-xs">
                    <Link href={`${base}&doc=${m.document_id}&marker=${m.id}#visor`} className="text-navy underline">📍 {P.seeOnPlan}</Link>
                    <form action={deleteDraftMarkerAction}>
                      <input type="hidden" name="id" value={m.id} /><input type="hidden" name="project_id" value={projectId} />
                      <button className="text-red-700 underline">{P.delete}</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">{P.step2}</h2>
          <p className="text-sm text-muted">{P.step2Help}</p>
        </div>
        <Card>
          <AnalyzeForm projectId={projectId} draftId={draftId} defaultText={draft?.original_text ?? ""} hasItems={itemList.length > 0} messages={messages}
            texts={{ placeholder: P.textPlaceholder, analyze: P.analyze, warning: P.reanalyzeWarning, working: "…" }} />
          {questions.length > 0 && (
            <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">{P.aiQuestions}</p>
              <ul className="mt-1 list-disc pl-5">{questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
        </Card>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">{P.step3}</h2>
          <p className="text-sm text-muted">{P.step3Help}</p>
        </div>
        {itemList.length === 0 && <EmptyState>{P.noItems}</EmptyState>}
        <ol className="space-y-3">
          {itemList.map((it, idx) => {
            const ms = markers.filter((m) => m.item_id === it.id);
            const ds = atts.filter((a) => a.itemId === it.id || ms.some((m) => m.id === a.annotationId));
            return (
              <li key={it.id} className={`rounded-xl border bg-white p-4 shadow-sm ${it.needs_clarification ? "border-amber-300" : "border-navy/10"}`} data-testid="draft-item">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">{it.position}</span>
                  {ms.map((m) => (
                    <Link key={m.id} href={`${base}&doc=${m.document_id}&marker=${m.id}#visor`} className="rounded-full bg-gold px-2 text-xs font-bold text-navy-dark" title={P.seeOnPlan}>📍{m.label}</Link>
                  ))}
                  <div className="ml-auto flex gap-1">
                    {(["up", "down"] as const).map((dir) => (
                      <form key={dir} action={moveDraftItemAction}>
                        <input type="hidden" name="id" value={it.id} /><input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="dir" value={dir} />
                        <button disabled={(dir === "up" && idx === 0) || (dir === "down" && idx === itemList.length - 1)}
                          className="h-8 w-8 rounded border border-navy/15 text-navy disabled:opacity-30" aria-label={dir === "up" ? P.moveUp : P.moveDown}>{dir === "up" ? "↑" : "↓"}</button>
                      </form>
                    ))}
                    <form action={deleteDraftItemAction}>
                      <input type="hidden" name="id" value={it.id} /><input type="hidden" name="project_id" value={projectId} />
                      <button className="h-8 rounded border border-red-200 px-2 text-xs text-red-700">{P.delete}</button>
                    </form>
                  </div>
                </div>
                {it.needs_clarification && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">⚠ {P.needsClarification} {it.ai_notes}</p>}
                <ActionForm action={saveDraftItemAction} messages={messages} submitLabel={P.save} className="grid gap-2 sm:grid-cols-[1fr_12rem]"
                  submitClassName="w-fit rounded-md border border-navy/20 px-3 py-1.5 text-sm text-navy">
                  <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="id" value={it.id} />
                  <Field label={P.itemTitle}><input name="title" defaultValue={it.title} required className={inputCls} /></Field>
                  <Field label={P.room}><input name="room" defaultValue={it.room ?? ""} className={inputCls} /></Field>
                  <Field label={P.itemDescription} className="sm:col-span-2"><textarea name="description" rows={2} defaultValue={it.description} className={inputCls} /></Field>
                </ActionForm>
                {ds.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {ds.map((a) => (
                      <li key={a.doc!.id}>
                        <a href={urls.get(a.doc!.storage_path) ?? "#"} target="_blank" rel="noopener noreferrer" className="block w-20 text-[11px] text-navy underline">
                          {isImage(a.doc!.storage_path)
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={urls.get(a.doc!.storage_path)} alt={a.doc!.title} className="mb-1 h-16 w-20 rounded object-cover" />
                            : <span className="mb-1 flex h-16 w-20 items-center justify-center rounded bg-surface text-2xl">📄</span>}
                          <span className="line-clamp-1">{a.doc!.title}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-navy">📷 {P.attach}</summary>
                  <div className="mt-2">
                    <Uploader compact projectId={projectId} rules={rules ?? []} staff={false} categories={categories} rooms={rooms}
                      defaultCategory="inspiracio" linkItemId={it.id} texts={uploader} />
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
        <Card title={`+ ${P.addItem}`}>
          <ActionForm action={saveDraftItemAction} messages={messages} submitLabel={P.addItem} resetOnSuccess className="grid gap-2 sm:grid-cols-[1fr_12rem]"
            submitClassName="w-fit rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">
            <input type="hidden" name="project_id" value={projectId} /><input type="hidden" name="draft_id" value={draftId} />
            <Field label={P.itemTitle}><input name="title" required className={inputCls} /></Field>
            <Field label={P.room}><input name="room" className={inputCls} /></Field>
            <Field label={P.itemDescription} className="sm:col-span-2"><textarea name="description" rows={2} className={inputCls} /></Field>
          </ActionForm>
        </Card>
        {itemList.length > 0 && (
          <div className="flex justify-end">
            <Link href={`${base}&pas=confirmar`} className="rounded-md bg-gold px-6 py-3 text-base font-bold text-navy-dark shadow-sm" data-testid="go-confirm">
              {P.toConfirm} →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
