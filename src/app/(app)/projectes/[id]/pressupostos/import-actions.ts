"use server";

// Pressupostos pujats (PDF, Excel, Word): registre, lectura IA, previsualització validada i conversió a editable.
// El document original es conserva sempre intacte al bucket privat de pressupostos.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { structuredCall, type Block } from "@/lib/ai/provider";
import { requireRole } from "@/lib/auth";
import { docxText, pdfPageTexts, xlsxText } from "@/lib/contracts/extract-text";
import { extensionOf } from "@/lib/files";
import { reqText, reqUuid } from "@/lib/forms";
import { IMPORT_PROMPT_VERSION, IMPORT_SYSTEM, importJsonSchema, importReadingSchema, previewFromReading } from "@/lib/quotes/import-reading";
import { parseEditorLines } from "@/lib/quotes/parse-lines";
import { createClient } from "@/lib/supabase/server";

const DECLARED = ["esborrany", "enviat", "aprovat", "rebutjat"] as const;

export async function registerImportAction(input: { projectId: string; documentId: string; title: string; declaredStatus: string }): Promise<ActionResult<{ importId: string }>> {
  await requireRole("direccio");
  const p = z.object({ projectId: reqUuid, documentId: reqUuid, title: reqText(200), declaredStatus: z.enum(DECLARED) }).safeParse(input);
  if (!p.success) return { ok: false, error: "required" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("register_quote_import", {
    p_project_id: p.data.projectId, p_document_id: p.data.documentId, p_title: p.data.title, p_declared_status: p.data.declaredStatus,
  });
  if (error) return fromPgError(error);
  return { ok: true, data: { importId: data as string } };
}

export async function setDeclaredStatusAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, projectId: reqUuid, declaredStatus: z.enum(DECLARED) })
    .safeParse({ id: formData.get("id"), projectId: formData.get("projectId"), declaredStatus: formData.get("declaredStatus") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("quote_imports").update({ declared_status: p.data.declaredStatus }).eq("id", p.data.id);
  if (error) return fromPgError(error);
  revalidatePath(`/projectes/${p.data.projectId}/pressupostos/importacions/${p.data.id}`);
  return { ok: true };
}

export async function discardImportAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, projectId: reqUuid }).safeParse({ id: formData.get("id"), projectId: formData.get("projectId") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("quote_imports").update({ status: "descartat" }).eq("id", p.data.id).neq("status", "convertit");
  if (error) return fromPgError(error);
  revalidatePath(`/projectes/${p.data.projectId}/pressupostos`);
  return { ok: true };
}

/** Lectura amb IA: proposa partides; la previsualització es valida abans de convertir. */
export async function analyzeImportAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, projectId: reqUuid }).safeParse({ id: formData.get("id"), projectId: formData.get("projectId") });
  if (!p.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { data: imp } = await supabase.from("quote_imports").select("id, status, documents(bucket_id, storage_path, size_bytes)").eq("id", p.data.id).maybeSingle();
  if (!imp) return { ok: false, error: "forbidden" };
  if (imp.status === "convertit" || imp.status === "descartat") return { ok: false, error: "invalidState" };
  const doc = (Array.isArray(imp.documents) ? imp.documents[0] : imp.documents) as { bucket_id: string; storage_path: string; size_bytes: number | null } | null;
  if (!doc) return { ok: false, error: "invalidDocument" };
  const dl = await supabase.storage.from(doc.bucket_id).download(doc.storage_path);
  if (dl.error || !dl.data) return { ok: false, error: "genericError" };
  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const ext = extensionOf(doc.storage_path);

  let content: Block[];
  let textPages: string[] | null = null;
  if (ext === "pdf") {
    const t = await pdfPageTexts(bytes);
    if (!t) return { ok: false, error: "invalidDocument" };
    if (t.numPages > 100) return { ok: false, error: "tooManyPages" };
    textPages = t.pages.length ? t.pages : null;
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } },
      { type: "text", text: `Pressupost en PDF de ${t.numPages} pàgines.` },
    ];
  } else if (ext === "xlsx") {
    const t = xlsxText(bytes);
    if (!t) return { ok: false, error: "invalidDocument" };
    textPages = [t];
    content = [{ type: "text", text: `Pressupost en Excel (sense pàgines: indica full i fila a "row").\n\n${t.slice(0, 300_000)}` }];
  } else if (ext === "docx") {
    const t = docxText(bytes);
    if (!t) return { ok: false, error: "invalidDocument" };
    textPages = [t];
    content = [{ type: "text", text: `Pressupost en Word (sense pàgines: page = null).\n\n${t.slice(0, 300_000)}` }];
  } else {
    return { ok: false, error: "fileTypeNotAllowed" };
  }
  const ai = await structuredCall({
    system: IMPORT_SYSTEM, content, toolName: "registrar_pressupost", toolDescription: "Registra les partides del pressupost tal com hi són escrites.",
    inputSchema: importJsonSchema, maxTokens: 32000, timeoutMs: 280_000,
  });
  if (!ai.ok) return { ok: false, error: ai.error === "not_configured" ? "aiNotConfigured" : "aiUnavailable" };
  const parsed = importReadingSchema.safeParse(ai.data);
  if (!parsed.success) return { ok: false, error: "aiInvalid" };
  const preview = previewFromReading(parsed.data, ext === "pdf" ? textPages : textPages ? [textPages.join("\n")] : null);
  const { error } = await supabase.rpc("record_quote_import_analysis", {
    p_import_id: p.data.id, p_provider: "anthropic", p_model: `${ai.model} · ${IMPORT_PROMPT_VERSION}`,
    p_extraction: { reading: parsed.data, preview, text_layer: textPages != null, format: ext },
  });
  if (error) return fromPgError(error);
  revalidatePath(`/projectes/${p.data.projectId}/pressupostos/importacions/${p.data.id}`);
  return { ok: true };
}

const convertSchema = z.object({
  importId: reqUuid, projectId: reqUuid, title: reqText(200), locale: z.enum(["ca", "es"]),
  intro: z.string().max(4000).default(""), notes: z.string().max(4000).default(""),
  exclusions: z.string().max(4000).default(""), paymentTerms: z.string().max(4000).default(""),
  lines: z.array(z.unknown()).min(1).max(500),
});

export async function convertImportAction(input: z.input<typeof convertSchema>): Promise<ActionResult & { lineErrors?: Record<number, string[]> }> {
  await requireRole("direccio");
  const p = convertSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "required" };
  const { rows, errors } = parseEditorLines(p.data.lines);
  if (Object.keys(errors).length) return { ok: false, error: "lineErrors", lineErrors: errors };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("convert_quote_import", {
    p_import_id: p.data.importId, p_title: p.data.title, p_locale: p.data.locale, p_intro: p.data.intro, p_notes: p.data.notes,
    p_exclusions: p.data.exclusions, p_payment_terms: p.data.paymentTerms, p_lines: rows,
  });
  if (error) return fromPgError(error);
  redirect(`/pressupostos/${data}`);
}
