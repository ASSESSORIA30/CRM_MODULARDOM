// Registre d'un pressupost orientatiu descarregat des del configurador de la web.
// Mateixa autenticació que /api/web/leads. Crea o reutilitza client i oportunitat, desa la versió
// del pressupost i retorna la referència que val (l'original si ja existia) i un enllaç de recuperació.
import { configHash, json, rateHit, signedRequest } from "@/lib/web-leads/request";
import { webQuoteRequestSchema } from "@/lib/web-leads/schema";
import { isIdempotencyKey } from "@/lib/web-leads/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const g = await signedRequest(req, { maxBytes: 48 * 1024, contentType: "application/json" });
  if (!g.ok) return g.res;
  const key = req.headers.get("idempotency-key");
  if (!isIdempotencyKey(key)) return json(400, { error: "bad_idempotency_key" });
  let body: unknown;
  try {
    body = JSON.parse(g.raw.toString("utf8"));
  } catch {
    return json(400, { error: "bad_json" });
  }
  const parsed = webQuoteRequestSchema.safeParse(body);
  if (!parsed.success) return json(422, { error: "invalid", fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].slice(0, 20) });
  const { visitor, ...lead } = parsed.data.lead;
  if (visitor) {
    const limited = await rateHit(g.supabase, `quotes:visitor:${visitor}`, 12, 3600);
    if (limited) return limited;
  }
  const cfg = lead.configurator!;
  const { data, error } = await g.supabase.rpc("web_register_quote", {
    p_idempotency_key: key,
    p_signature: g.signature,
    p_lead: lead,
    p_quote: { ...parsed.data.quote, configHash: configHash(cfg.input, cfg.visual) },
  });
  if (error) {
    if (error.code === "22023") return json(422, { error: "invalid" });
    console.error("[web-quotes] web_register_quote ha fallat:", error.code);
    return json(500, { error: "server_error" });
  }
  const out = data as { id: string; reference: string; version: number; created: boolean; createdAt: string; pdfStored: boolean; token: string; tokenDays: number };
  return json(out.created ? 201 : 200, { id: out.id, reference: out.reference, version: out.version, created: out.created, createdAt: out.createdAt, pdfStored: out.pdfStored, token: out.token, tokenDays: out.tokenDays });
}
