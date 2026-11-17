"use client";

// Pujar un pressupost extern (PDF, Excel o Word). L'original es desa sense canvis i es registra la importació.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { registerImportAction } from "@/app/(app)/projectes/[id]/pressupostos/import-actions";
import { extensionOf } from "@/lib/files";
import type { QuoteV2Texts } from "@/lib/i18n-pressupostos-v2";
import { uploadFile } from "@/lib/upload-client";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function QuoteUpload({ projectId, X, errors }: { projectId: string; X: QuoteV2Texts; errors: Record<string, string> }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [declared, setDeclared] = useState("esborrany");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ext = file ? extensionOf(file.name) : "";

  function submit() {
    if (!file || !MIME[ext]) { setErr(errors.fileTypeNotAllowed); return; }
    start(async () => {
      setErr(null);
      const up = await uploadFile(projectId, file, MIME[ext], { title: title.trim() || file.name, category: "pressupost" as never, visibility: "intern", roomTag: null, description: null, bucket: "pressupostos" });
      if (!up.ok) { setErr(errors[up.error] ?? errors.genericError); return; }
      const reg = await registerImportAction({ projectId, documentId: up.documentId, title: title.trim() || file.name, declaredStatus: declared });
      if (!reg.ok || !reg.data) { setErr(errors[reg.ok ? "genericError" : reg.error] ?? errors.genericError); return; }
      router.push(`/projectes/${projectId}/pressupostos/importacions/${reg.data.importId}`);
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="quote-upload">
      <label className="text-sm sm:col-span-2"><span className="mb-1 block font-medium text-navy">{X.chooseFile} (PDF, Excel, Word)</span>
        <input type="file" accept=".pdf,.xlsx,.docx" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "")); }}
          className="block w-full text-sm" /></label>
      <label className="text-sm"><span className="mb-1 block font-medium text-navy">{X.uploadTitle}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="w-full rounded-md border border-navy/20 px-3 py-2" /></label>
      <label className="text-sm"><span className="mb-1 block font-medium text-navy">{X.declaredStatus}</span>
        <select value={declared} onChange={(e) => setDeclared(e.target.value)} className="w-full rounded-md border border-navy/20 px-3 py-2">
          {Object.entries(X.declared).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="button" onClick={submit} disabled={pending || !file} className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? X.uploading : X.uploadAndRegister}</button>
        {err && <span role="alert" className="text-sm text-red-700">{err}</span>}
      </div>
    </div>
  );
}
