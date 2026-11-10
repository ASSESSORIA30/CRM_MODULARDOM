// Pujada d'un fitxer des del navegador: URL signada → Storage → verificació al servidor.
import { createClient } from "@/lib/supabase/client";
import { finalizeUpload, prepareUpload } from "@/app/(app)/projectes/[id]/avantprojecte/actions";

export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type UploadMeta = Omit<Parameters<typeof finalizeUpload>[0], "projectId" | "path" | "fileName" | "size" | "sha256">;

export async function uploadFile(projectId: string, file: File, contentType: string, meta: UploadMeta): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const bucket = meta.bucket ?? "avantprojecte";
  const prep = await prepareUpload({ projectId, fileName: file.name, size: file.size, bucket });
  if (!prep.ok || !prep.data) return { ok: false, error: prep.ok ? "genericError" : prep.error };
  const up = await createClient().storage.from(bucket).uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType });
  if (up.error) return { ok: false, error: "genericError" };
  const fin = await finalizeUpload({ ...meta, projectId, path: prep.data.path, fileName: file.name, size: file.size, sha256: await sha256Hex(file) });
  return fin.ok && fin.data ? { ok: true, documentId: fin.data.documentId } : { ok: false, error: fin.ok ? "genericError" : fin.error };
}
