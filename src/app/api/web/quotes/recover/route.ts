// Recuperació d'un pressupost web amb el seu enllaç privat: configuració i imports originals.
// No retorna cap dada personal ni identificadors interns.
import { json, signedRequest } from "@/lib/web-leads/request";
import { tokenSchema } from "@/lib/web-leads/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const g = await signedRequest(req, { maxBytes: 1024, contentType: "application/json" });
  if (!g.ok) return g.res;
  let token: unknown;
  try {
    token = (JSON.parse(g.raw.toString("utf8")) as { token?: unknown }).token;
  } catch {
    return json(400, { error: "bad_json" });
  }
  const t = tokenSchema.safeParse(token);
  if (!t.success) return json(404, { error: "not_found" });
  const { data, error } = await g.supabase.rpc("web_recover_quote", { p_token: t.data });
  if (error) return json(500, { error: "server_error" });
  if (!data) return json(404, { error: "not_found" }); // inexistent, caducat o revocat: la mateixa resposta
  const { id: _id, pdfPath, ...rest } = data as Record<string, unknown>;
  void _id;
  return json(200, { ...rest, pdf: Boolean(pdfPath) });
}
