"use client";

// Pujada múltiple de fitxers directament a Storage (URL signada d'un sol ús),
// amb verificació posterior del tipus real al servidor.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { extensionOf } from "@/lib/files";
import { uploadFile } from "@/lib/upload-client";

export type UploadRule = { extension: string; mime_type: string; max_bytes: number };
type Option = { value: string; label: string };
export type UploaderTexts = {
  choose: string; upload: string; category: string; visibility: string; room: string; description: string;
  internal: string; review: string; uploading: string; done: string; formats: string; camera: string;
  errors: Record<string, string>;
};

type FileState = { file: File; title: string; status: "pending" | "uploading" | "done" | "error"; error?: string };

export function Uploader({
  projectId, rules, staff, categories, rooms, texts, defaultCategory = "planol", previousVersionId, linkItemId, linkAnnotationId,
  linkCommentId, compact = false, accept, bucket = "avantprojecte",
}: {
  projectId: string; rules: UploadRule[]; staff: boolean; categories: Option[]; rooms: Option[]; texts: UploaderTexts;
  defaultCategory?: string; previousVersionId?: string; linkItemId?: string; linkAnnotationId?: string; linkCommentId?: string;
  compact?: boolean; accept?: string;
  bucket?: "avantprojecte" | "contractes" | "factures" | "documents";
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileState[]>([]);
  const [category, setCategory] = useState(defaultCategory);
  const [visibility, setVisibility] = useState<"intern" | "revisio">("intern");
  const [room, setRoom] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const byExt = new Map(rules.map((r) => [r.extension, r]));
  const acceptAttr = accept ?? rules.map((r) => `.${r.extension}`).join(",");

  function pick(list: FileList | null) {
    if (!list) return;
    setFiles([...list].map((file) => {
      const rule = byExt.get(extensionOf(file.name));
      const error = !rule ? "fileTypeNotAllowed" : file.size > rule.max_bytes ? "fileTooLarge" : undefined;
      return { file, title: file.name.replace(/\.[^.]+$/, ""), status: error ? "error" : "pending", error };
    }));
  }

  async function uploadAll() {
    setBusy(true);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.status !== "pending") continue;
      const set = (patch: Partial<FileState>) => setFiles((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      set({ status: "uploading" });
      try {
        const rule = byExt.get(extensionOf(f.file.name))!;
        const res = await uploadFile(projectId, f.file, rule.mime_type, {
          title: f.title.trim() || f.file.name, category: category as never, visibility,
          roomTag: (room || null) as never, description: description.trim() || null,
          previousVersionId: previousVersionId ?? null, linkItemId: linkItemId ?? null,
          linkAnnotationId: linkAnnotationId ?? null, linkCommentId: linkCommentId ?? null, bucket,
        });
        set(res.ok ? { status: "done" } : { status: "error", error: res.error });
      } catch {
        set({ status: "error", error: "genericError" });
      }
    }
    setBusy(false);
    router.refresh();
  }

  const sel = "rounded-md border border-navy/20 bg-white px-2 py-1.5 text-sm outline-none focus:border-gold";
  const pending = files.filter((f) => f.status === "pending").length;

  return (
    <div className={`space-y-3 ${compact ? "" : "rounded-xl border border-dashed border-navy/25 bg-white p-4"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" multiple accept={acceptAttr} className="hidden" onChange={(e) => pick(e.target.files)} data-testid="file-input" />
        <button type="button" onClick={() => inputRef.current?.click()} className="rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-medium text-navy hover:border-gold">
          📎 {texts.choose}
        </button>
        {!previousVersionId && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={sel} aria-label={texts.category}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        )}
        {staff && bucket === "avantprojecte" && (
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as "intern" | "revisio")} className={sel} aria-label={texts.visibility}>
            <option value="intern">{texts.internal}</option>
            <option value="revisio">{texts.review}</option>
          </select>
        )}
        {!compact && (
          <select value={room} onChange={(e) => setRoom(e.target.value)} className={sel} aria-label={texts.room}>
            <option value="">{texts.room}: —</option>
            {rooms.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}
      </div>
      {!compact && (
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={texts.description}
          className="block w-full rounded-md border border-navy/20 px-3 py-2 text-sm outline-none focus:border-gold" />
      )}
      {files.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {files.map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              <input value={f.title} disabled={f.status !== "pending"} onChange={(e) => setFiles((xs) => xs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                className="min-w-0 flex-1 rounded border border-navy/15 px-2 py-1 text-sm" />
              <span className="shrink-0 text-xs text-muted">{(f.file.size / 1048576).toFixed(1)} MB</span>
              <span className={`shrink-0 text-xs ${f.status === "error" ? "text-red-700" : f.status === "done" ? "text-emerald-700" : "text-muted"}`}>
                {f.status === "error" ? texts.errors[f.error ?? "genericError"] ?? f.error : f.status === "done" ? `✓ ${texts.done}` : f.status === "uploading" ? texts.uploading : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || pending === 0} onClick={uploadAll}
          className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? texts.uploading : `${texts.upload}${pending ? ` (${pending})` : ""}`}
        </button>
        <span className="text-xs text-muted">{texts.formats}</span>
      </div>
    </div>
  );
}
