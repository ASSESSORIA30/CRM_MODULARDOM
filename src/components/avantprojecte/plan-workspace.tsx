"use client";

// Visor + anotacions persistents: crear marcadors (amb text, visibilitat, punt vinculat
// i resposta a un altre marcador), seleccionar-los, veure'n el fil i els adjunts.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ActionMessages } from "@/components/action-form";
import { CommentThread, type ThreadComment, type ThreadTexts } from "@/components/avantprojecte/comment-thread";
import { Uploader, type UploaderTexts, type UploadRule } from "@/components/avantprojecte/uploader";
import { PlanViewer, type NewAnnotation, type ViewerAnnotation, type ViewerTexts } from "@/components/plan-viewer/plan-viewer";
import { createAnnotation, setAnnotationStatus } from "@/app/(app)/projectes/[id]/avantprojecte/actions";

export type WorkspaceAnnotation = ViewerAnnotation & {
  body: string; author: string; when: string; visibility: "compartit" | "intern"; status: "obert" | "resolt";
  itemLabel: string | null; parentLabel: string | null; attachments: { id: string; title: string; href: string; isImage: boolean }[];
};

export type WorkspaceTexts = {
  viewer: ViewerTexts; thread: ThreadTexts; uploader: UploaderTexts;
  newMarker: string; comment: string; linkItem: string; replyTo: string; none: string; save: string; cancel: string;
  shared: string; internal: string; resolve: string; reopen: string; attachPhoto: string; author: string; item: string;
  noSelection: string; respondsTo: string;
};

export function PlanWorkspace({
  projectId, documentId, source, annotations, items, staff, threads, participants, texts, messages, focusId,
  rules, categories, rooms, canAnnotate = true,
}: {
  projectId: string; documentId: string; source: { kind: "pdf" | "image"; url: string };
  annotations: WorkspaceAnnotation[]; items: { id: string; label: string }[]; staff: boolean;
  threads: Record<string, ThreadComment[]>; participants: { id: string; name: string; isClient: boolean }[];
  texts: WorkspaceTexts; messages: ActionMessages; focusId?: string | null;
  rules: UploadRule[]; categories: { value: string; label: string }[]; rooms: { value: string; label: string }[];
  canAnnotate?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(focusId ?? null);
  const [draft, setDraft] = useState<NewAnnotation | null>(null);
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"compartit" | "intern">("compartit");
  const [itemId, setItemId] = useState("");
  const [asReply, setAsReply] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sel = annotations.find((a) => a.id === selected) ?? null;

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const res = await createAnnotation({
      projectId, documentId, ...draft, body: body.trim(), visibility: staff ? visibility : "compartit",
      itemId: itemId || null, parentId: asReply && sel ? sel.id : null,
    });
    setSaving(false);
    if (!res.ok) { setError(messages.errors[res.error] ?? res.error); return; }
    setDraft(null); setBody(""); setItemId(""); setAsReply(false);
    if (res.data) setSelected(res.data.id);
    router.refresh();
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
      <PlanViewer source={source} annotations={annotations} canAnnotate={canAnnotate} onCreate={(a) => { setDraft(a); setError(null); }}
        onSelect={setSelected} selectedId={selected} focusId={focusId} texts={texts.viewer} />

      <aside className="space-y-3">
        {draft ? (
          <div className="space-y-3 rounded-xl border-2 border-gold bg-white p-4 shadow-sm" role="dialog" aria-label={texts.newMarker}>
            <h3 className="font-semibold text-navy">{texts.newMarker}</h3>
            <textarea autoFocus rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={texts.comment}
              className="block w-full rounded-md border border-navy/20 px-3 py-2 text-base outline-none focus:border-gold sm:text-sm" />
            {staff && (
              <select value={visibility} onChange={(e) => setVisibility(e.target.value as "compartit" | "intern")}
                className="block w-full rounded-md border border-navy/20 bg-white px-2 py-2 text-sm">
                <option value="compartit">👁 {texts.shared}</option>
                <option value="intern">🔒 {texts.internal}</option>
              </select>
            )}
            {items.length > 0 && (
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} className="block w-full rounded-md border border-navy/20 bg-white px-2 py-2 text-sm" aria-label={texts.linkItem}>
                <option value="">{texts.linkItem}: {texts.none}</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
            )}
            {staff && sel && (
              <label className="flex items-center gap-2 text-sm text-navy">
                <input type="checkbox" checked={asReply} onChange={(e) => setAsReply(e.target.checked)} className="h-4 w-4 accent-navy" />
                {texts.replyTo} {sel.label}
              </label>
            )}
            {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={saving} className="flex-1 rounded-md bg-navy px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{texts.save}</button>
              <button type="button" onClick={() => setDraft(null)} className="rounded-md border border-navy/20 px-3 py-2.5 text-sm text-navy">{texts.cancel}</button>
            </div>
          </div>
        ) : sel ? (
          <div className="space-y-3 rounded-xl border border-navy/10 bg-white p-4 shadow-sm" data-testid="annotation-panel">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-navy">{sel.label} · {sel.author}</h3>
              <span className="text-xs text-muted">{sel.when}</span>
            </div>
            <p className="flex flex-wrap gap-1 text-xs">
              {sel.visibility === "intern" && <span className="rounded bg-slate-200 px-1.5 font-semibold text-slate-700">🔒 {texts.internal}</span>}
              {sel.itemLabel && <span className="rounded bg-navy/5 px-1.5 text-navy">{texts.item}: {sel.itemLabel}</span>}
              {sel.parentLabel && <span className="rounded bg-gold-light px-1.5 text-navy">{texts.respondsTo} {sel.parentLabel}</span>}
            </p>
            {sel.body && <p className="whitespace-pre-line text-sm text-ink">{sel.body}</p>}
            {sel.attachments.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {sel.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={a.href} target="_blank" rel="noopener noreferrer" className="block w-20 text-center text-[11px] text-navy underline">
                      {a.isImage
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={a.href} alt={a.title} className="mb-1 h-16 w-20 rounded object-cover" />
                        : <span className="mb-1 flex h-16 w-20 items-center justify-center rounded bg-surface text-2xl">📄</span>}
                      <span className="line-clamp-1">{a.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-sm font-medium text-navy">📷 {texts.attachPhoto}</summary>
              <div className="mt-2">
                <Uploader compact projectId={projectId} rules={rules} staff={staff} categories={categories} rooms={rooms}
                  defaultCategory="inspiracio" linkAnnotationId={sel.id} texts={texts.uploader} accept="image/*,.pdf" />
              </div>
            </details>
            {staff && (
              <form action={setAnnotationStatus}>
                <input type="hidden" name="id" value={sel.id} /><input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="status" value={sel.status === "obert" ? "resolt" : "obert"} />
                <button className="text-xs text-navy underline">{sel.status === "obert" ? texts.resolve : texts.reopen}</button>
              </form>
            )}
            <CommentThread projectId={projectId} target={{ annotation_id: sel.id }} comments={threads[sel.id] ?? []}
              canInternal={staff} canResolve={staff} participants={participants} texts={texts.thread} messages={messages} />
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-navy/20 p-4 text-sm text-muted">{texts.noSelection}</p>
        )}
      </aside>
    </div>
  );
}
