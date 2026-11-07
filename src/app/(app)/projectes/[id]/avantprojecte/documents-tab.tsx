import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { CommentThread } from "@/components/avantprojecte/comment-thread";
import { PlanWorkspace, type WorkspaceAnnotation } from "@/components/avantprojecte/plan-workspace";
import { Uploader } from "@/components/avantprojecte/uploader";
import { Badge, Card, EmptyState, inputCls } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { isImage, isPreviewable, loadDocuments, loadThreads, projectPeople, signedUrls, type DocRow } from "@/lib/avantprojecte-data";
import { createClient } from "@/lib/supabase/server";
import { publicationAction, setResolutionsAction } from "./actions";
import { clientTexts, mentionable, type TabProps } from "./shared";

const VIS_STYLE: Record<string, string> = {
  intern: "bg-slate-200 text-slate-700", revisio: "bg-amber-100 text-amber-900",
  publicat: "bg-emerald-100 text-emerald-800", compartit: "bg-gold-light text-navy",
};

export async function DocumentsTab({ projectId, profile, docId, markerId }: TabProps & { docId?: string; markerId?: string }) {
  const L = profile.locale;
  const { T, messages, uploader, categories, rooms } = clientTexts(profile);
  const staff = profile.role === "direccio" || profile.role === "arquitecte";
  const isDir = profile.role === "direccio";
  const supabase = await createClient();
  const [{ groups, current }, people, { data: rules }, { data: roundItems }] = await Promise.all([
    loadDocuments(supabase, projectId),
    projectPeople(supabase, projectId),
    supabase.from("upload_rules").select("extension, mime_type, max_bytes").eq("bucket_id", "avantprojecte"),
    supabase.from("revision_items").select("id, position, title, round_id, revision_rounds(number)").eq("project_id", projectId).not("round_id", "is", null).order("position"),
  ]);
  const base = `/projectes/${projectId}/avantprojecte`;
  const all = groups.flat();
  const selected: DocRow | undefined = all.find((d) => d.id === docId) ?? (groups[0] ? current(groups[0]) : undefined);
  const items = (roundItems ?? []).map((i) => {
    const r = i.revision_rounds as unknown as { number: number } | { number: number }[] | null;
    const n = Array.isArray(r) ? r[0]?.number : r?.number;
    return { id: i.id, label: `R${n ?? "?"}.${i.position} · ${i.title}` };
  });

  let workspace = null;
  let docThread = null;
  let resolutionForm = null;
  let header = null;
  if (selected) {
    const group = groups.find((g) => g.some((d) => d.id === selected.id))!;
    const latestPublished = group.find((v) => v.visibility === "publicat" && v.status === "vigent");
    const [{ data: anns }, urls] = await Promise.all([
      supabase.from("plan_annotations").select("id, page, kind, x, y, w, h, body, visibility, status, author_id, author_role, item_id, parent_id, created_at")
        .eq("document_id", selected.id).order("created_at"),
      signedUrls(supabase, [selected.storage_path]),
    ]);
    const viewUrl = urls.get(selected.storage_path);
    const { data: dl } = await supabase.storage.from("avantprojecte").createSignedUrl(selected.storage_path, 300, { download: true });
    const annIds = (anns ?? []).map((a) => a.id);
    const [{ data: links }, annThreads, docThreads] = await Promise.all([
      annIds.length ? supabase.from("document_links").select("annotation_id, documents(id, title, storage_path)").in("annotation_id", annIds) : Promise.resolve({ data: [] }),
      loadThreads(supabase, people, L, { column: "annotation_id", ids: annIds }),
      loadThreads(supabase, people, L, { column: "document_id", ids: [selected.id] }),
    ]);
    const linkDocs = (links ?? []).map((l) => ({ annotationId: l.annotation_id as string, doc: (Array.isArray(l.documents) ? l.documents[0] : l.documents) as { id: string; title: string; storage_path: string } | null }))
      .filter((l) => l.doc);
    const linkUrls = await signedUrls(supabase, linkDocs.map((l) => l.doc!.storage_path));
    const labelOf = new Map((anns ?? []).map((a, i) => [a.id, String(i + 1)]));
    const itemLabel = new Map(items.map((i) => [i.id, i.label]));
    const annotations: WorkspaceAnnotation[] = (anns ?? []).map((a) => ({
      id: a.id, page: a.page, kind: a.kind as "punt" | "rectangle", x: Number(a.x), y: Number(a.y),
      w: a.w == null ? null : Number(a.w), h: a.h == null ? null : Number(a.h),
      label: labelOf.get(a.id)!, title: a.body,
      tone: a.visibility === "intern" ? "intern" : a.author_role === "client" ? "client" : a.author_role === "direccio" ? "direccio" : "arquitecte",
      body: a.body, author: people.get(a.author_id ?? "")?.name ?? "—", when: formatDateTime(a.created_at, L),
      visibility: a.visibility as "compartit" | "intern", status: a.status as "obert" | "resolt",
      itemLabel: a.item_id ? itemLabel.get(a.item_id) ?? null : null,
      parentLabel: a.parent_id ? labelOf.get(a.parent_id) ?? null : null,
      attachments: linkDocs.filter((l) => l.annotationId === a.id).map((l) => ({
        id: l.doc!.id, title: l.doc!.title, href: linkUrls.get(l.doc!.storage_path) ?? "#", isImage: isImage(l.doc!.storage_path),
      })),
    }));

    header = (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">{selected.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{T.version} {selected.version}</span>
            <Badge className={VIS_STYLE[selected.visibility]}>{T.visibility[selected.visibility as keyof typeof T.visibility]}</Badge>
            {latestPublished?.id === selected.id && <Badge className="bg-navy text-white">{T.current}</Badge>}
            {selected.status === "substituit" && <Badge>{T.previous}</Badge>}
            {selected.approved_at && <Badge className="bg-emerald-600 text-white">✓ {T.approved} · {formatDate(selected.approved_at, L)}</Badge>}
            {selected.published_at && <span>{T.publishedOn}: {formatDateTime(selected.published_at, L)}</span>}
            <span>· {people.get(selected.uploaded_by ?? "")?.name ?? "—"} · {formatDateTime(selected.created_at, L)}</span>
          </p>
          {selected.description && <p className="mt-1 text-sm text-ink">{selected.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {viewUrl && <a href={viewUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border border-navy/20 px-3 py-1.5 text-sm text-navy">{T.open}</a>}
          {dl?.signedUrl && <a href={dl.signedUrl} className="rounded-md border border-navy/20 px-3 py-1.5 text-sm text-navy">⬇ {T.download}</a>}
          {staff && selected.visibility === "intern" && (
            <ActionForm action={publicationAction} messages={messages} submitLabel={T.requestPublication} className="flex flex-col gap-1"
              submitClassName="rounded-md bg-gold px-3 py-1.5 text-sm font-semibold text-navy-dark">
              <input type="hidden" name="document_id" value={selected.id} /><input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="op" value="request" />
            </ActionForm>
          )}
          {isDir && selected.visibility === "revisio" && (
            <ActionForm action={publicationAction} messages={messages} submitLabel={T.publish} className="flex flex-col gap-1"
              submitClassName="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white">
              <input type="hidden" name="document_id" value={selected.id} /><input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="op" value="publish" />
            </ActionForm>
          )}
        </div>
      </div>
    );

    workspace = viewUrl && isPreviewable(selected.storage_path) ? (
      <PlanWorkspace
        key={selected.id}
        projectId={projectId} documentId={selected.id}
        source={{ kind: isImage(selected.storage_path) ? "image" : "pdf", url: viewUrl }}
        annotations={annotations} items={items} staff={staff} threads={annThreads}
        participants={mentionable(people, profile.id)} messages={messages} focusId={markerId ?? null}
        rules={rules ?? []} categories={categories} rooms={rooms}
        texts={{
          viewer: T.viewer, thread: T.thread, uploader, newMarker: T.newMarker, comment: T.comment, linkItem: T.linkItem,
          replyTo: T.replyTo, none: T.none, save: T.save, cancel: T.cancel, shared: T.shared, internal: T.internal,
          resolve: T.resolve, reopen: T.reopen, attachPhoto: T.attachPhoto, author: T.author, item: T.item,
          noSelection: T.noSelection, respondsTo: T.respondsTo,
        }}
      />
    ) : <EmptyState>{T.noPreview}</EmptyState>;

    docThread = (
      <Card title={T.documentComments}>
        <CommentThread projectId={projectId} target={{ document_id: selected.id }} comments={docThreads[selected.id] ?? []}
          canInternal={staff} canResolve={staff} participants={mentionable(people, profile.id)} texts={T.thread} messages={messages} />
      </Card>
    );

    if (staff && selected.category === "avantprojecte" && ["intern", "revisio"].includes(selected.visibility) && items.length) {
      const { data: res } = await supabase.from("version_item_resolutions").select("item_id, resolution, note").eq("document_id", selected.id);
      const resBy = new Map((res ?? []).map((r) => [r.item_id, r]));
      resolutionForm = (
        <Card title={T.resolutionsTitle}>
          <ActionForm action={setResolutionsAction} messages={messages} submitLabel={T.saveResolutions} className="space-y-2">
            <input type="hidden" name="document_id" value={selected.id} /><input type="hidden" name="project_id" value={projectId} />
            {items.map((i) => (
              <div key={i.id} className="grid gap-2 sm:grid-cols-[1fr_14rem_1fr] sm:items-center">
                <span className="text-sm text-ink">{i.label}</span>
                <select name={`res_${i.id}`} defaultValue={resBy.get(i.id)?.resolution ?? ""} className={inputCls}>
                  <option value="">—</option>
                  {Object.entries(T.resolutions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input name={`note_${i.id}`} defaultValue={resBy.get(i.id)?.note ?? ""} placeholder={T.notePlaceholder} className={inputCls} />
              </div>
            ))}
          </ActionForm>
        </Card>
      );
    }

    if (staff) {
      header = (
        <>
          {header}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-navy">⬆ {T.uploadNewVersion}</summary>
            <div className="mt-2">
              <Uploader projectId={projectId} rules={rules ?? []} staff categories={categories} rooms={rooms}
                previousVersionId={selected.id} texts={uploader} compact />
            </div>
          </details>
          {isDir && selected.visibility === "revisio" && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-red-700">{T.reject}</summary>
              <ActionForm action={publicationAction} messages={messages} submitLabel={T.reject} className="mt-2 space-y-2"
                submitClassName="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700">
                <input type="hidden" name="document_id" value={selected.id} /><input type="hidden" name="project_id" value={projectId} />
                <input type="hidden" name="op" value="reject" />
                <textarea name="note" rows={2} placeholder={T.rejectNote} className={inputCls} />
              </ActionForm>
            </details>
          )}
        </>
      );
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_1fr]">
      <div className="space-y-4">
        <Card title={T.uploadTitle}>
          <Uploader projectId={projectId} rules={rules ?? []} staff={staff} categories={categories} rooms={rooms} texts={uploader} />
        </Card>
        <Card>
          {groups.length ? (
            <ul className="space-y-1">
              {groups.map((g) => {
                const cur = current(g);
                const active = g.some((d) => d.id === selected?.id);
                return (
                  <li key={cur.group_id}>
                    <Link href={`${base}?doc=${cur.id}`} className={`block rounded-md px-2 py-1.5 text-sm ${active ? "bg-navy text-white" : "text-navy hover:bg-surface"}`}>
                      <span className="block truncate font-medium">{cur.title}</span>
                      <span className={`text-xs ${active ? "text-white/70" : "text-muted"}`}>
                        {T.categories[cur.category as keyof typeof T.categories] ?? cur.category} · v{g[0].version} · {T.visibility[g[0].visibility as keyof typeof T.visibility]}
                      </span>
                    </Link>
                    {active && g.length > 1 && (
                      <ul className="ml-3 mt-1 space-y-0.5 border-l border-navy/10 pl-2">
                        {g.map((v) => (
                          <li key={v.id}>
                            <Link href={`${base}?doc=${v.id}`} className={`text-xs ${v.id === selected?.id ? "font-semibold text-navy" : "text-muted hover:text-navy"}`}>
                              {T.version} {v.version} · {T.visibility[v.visibility as keyof typeof T.visibility]}{v.status === "substituit" ? ` · ${T.previous}` : ""}{v.approved_at ? " · ✓" : ""}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState>{T.noDocuments}</EmptyState>}
        </Card>
      </div>
      <div className="min-w-0 space-y-4">
        {selected ? (
          <>
            <Card>{header}</Card>
            {workspace}
            {resolutionForm}
            {docThread}
          </>
        ) : <EmptyState>{T.noDocuments}</EmptyState>}
      </div>
    </div>
  );
}
