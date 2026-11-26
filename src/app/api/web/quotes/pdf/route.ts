// PDF d'un pressupost web: la web el desa (PUT) un cop generat i el torna a demanar (POST) quan el
// client descarrega el mateix pressupost o el recupera amb el seu enllaç. El bucket és privat.
import { z } from "zod";
import { json, PDF_BUCKET, sha256Hex, signedRequest } from "@/lib/web-leads/request";
import { tokenSchema } from "@/lib/web-leads/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const uuid = z.string().uuid();

// PUT ?id=<pressupost> · cos = PDF · signatura sobre "<timestamp>.<id>.<sha256 del PDF>"
export async function PUT(req: Request) {
  const id = uuid.safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return json(400, { error: "bad_id" });
  const g = await signedRequest(req, { maxBytes: 4 * 1024 * 1024, contentType: "application/pdf", signed: (raw) => `${id.data}.${sha256Hex(raw)}` });
  if (!g.ok) return g.res;
  if (g.raw.subarray(0, 5).toString("latin1") !== "%PDF-") return json(422, { error: "not_pdf" });
  const { data: q } = await g.supabase.from("web_quotes").select("id, reference, pdf_path, created_at").eq("id", id.data).maybeSingle();
  if (!q) return json(404, { error: "not_found" });
  if (q.pdf_path) return json(200, { stored: true, kept: "original" });
  const path = `${String(q.created_at).slice(0, 4)}/${q.id}/${q.reference}.pdf`;
  const up = await g.supabase.storage.from(PDF_BUCKET).upload(path, g.raw, { contentType: "application/pdf", upsert: true });
  if (up.error) {
    console.error("[web-quotes] no s'ha pogut desar el PDF");
    return json(500, { error: "storage_error" });
  }
  const { error } = await g.supabase.rpc("web_quote_set_pdf", { p_quote_id: q.id, p_path: path });
  if (error) return json(500, { error: "server_error" });
  return json(201, { stored: true });
}

// POST {id} (acabat de registrar) o {token} (enllaç de recuperació) → el PDF original
export async function POST(req: Request) {
  const g = await signedRequest(req, { maxBytes: 1024, contentType: "application/json" });
  if (!g.ok) return g.res;
  let body: { id?: unknown; token?: unknown };
  try {
    body = JSON.parse(g.raw.toString("utf8"));
  } catch {
    return json(400, { error: "bad_json" });
  }
  let path: string | null = null, reference = "";
  const token = tokenSchema.safeParse(body.token), id = uuid.safeParse(body.id);
  if (token.success) {
    const { data } = await g.supabase.rpc("web_recover_quote", { p_token: token.data });
    const r = data as { pdfPath: string | null; reference: string } | null;
    path = r?.pdfPath ?? null; reference = r?.reference ?? "";
  } else if (id.success) {
    const { data } = await g.supabase.from("web_quotes").select("pdf_path, reference").eq("id", id.data).maybeSingle();
    path = data?.pdf_path ?? null; reference = data?.reference ?? "";
  } else return json(400, { error: "bad_request" });
  if (!path) return json(404, { error: "not_found" });
  const file = await g.supabase.storage.from(PDF_BUCKET).download(path);
  if (file.error || !file.data) return json(404, { error: "not_found" });
  return new Response(Buffer.from(await file.data.arrayBuffer()), { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Reference": reference } });
}
