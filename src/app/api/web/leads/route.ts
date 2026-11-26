// Recepció de sol·licituds de la web pública (modulardom-web). Contracte: docs/09-INTEGRACIO-WEB-LEADS.md.
// Només servidor a servidor: la petició ha d'anar signada amb el secret compartit (WEB_LEADS_SECRET).
// Desactivada per defecte: mentre WEB_LEADS_ENABLED no sigui "true" la ruta respon 404 i no toca la base de dades.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { webLeadSchema } from "@/lib/web-leads/schema";
import { isIdempotencyKey, verifySignature } from "@/lib/web-leads/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16 * 1024;
const PER_IP = { limit: 30, windowSeconds: 60 };
const GLOBAL = { limit: 600, windowSeconds: 3600 };
// per visitant de la web (pseudònim signat dins del cos): atura qui omple formularis en bucle, encara que la web tingui moltes instàncies
const PER_VISITOR = { limit: 8, windowSeconds: 3600 };

const json = (status: number, body: Record<string, unknown>, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export async function POST(req: Request) {
  const secret = process.env.WEB_LEADS_SECRET ?? "";
  if (process.env.WEB_LEADS_ENABLED !== "true" || secret.length < 32) return json(404, { error: "not_found" });

  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json(415, { error: "unsupported_media_type" });
  }
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "too_large" });
  // El cos es llegeix com a text: la signatura es calcula sobre els bytes rebuts, no sobre un JSON reserialitzat.
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return json(413, { error: "too_large" });

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return json(503, { error: "unavailable" });
  }

  // Límit de peticions persistent (base de dades), abans de comprovar la signatura per frenar intents de força bruta.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60) || "unknown";
  for (const [bucket, rule] of [[`leads:ip:${ip}`, PER_IP], ["leads:global", GLOBAL]] as const) {
    const { data, error } = await supabase.rpc("web_rate_hit", { p_bucket: bucket, p_limit: rule.limit, p_window_seconds: rule.windowSeconds });
    if (error) return json(503, { error: "unavailable" });
    if (data !== true) return json(429, { error: "rate_limited" }, { "Retry-After": String(rule.windowSeconds) });
  }

  const verified = verifySignature({
    secret,
    timestamp: req.headers.get("x-modulardom-timestamp"),
    signature: req.headers.get("x-modulardom-signature"),
    rawBody: raw,
  });
  if (!verified.ok) return json(401, { error: "unauthorized" });

  const key = req.headers.get("idempotency-key");
  if (!isIdempotencyKey(key)) return json(400, { error: "bad_idempotency_key" });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_json" });
  }
  const parsed = webLeadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return json(422, { error: "invalid", fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].slice(0, 20) });
  }

  const { visitor, ...lead } = parsed.data;
  if (visitor) {
    const { data, error } = await supabase.rpc("web_rate_hit", { p_bucket: `leads:visitor:${visitor}`, p_limit: PER_VISITOR.limit, p_window_seconds: PER_VISITOR.windowSeconds });
    if (error) return json(503, { error: "unavailable" });
    if (data !== true) return json(429, { error: "rate_limited" }, { "Retry-After": String(PER_VISITOR.windowSeconds) });
  }

  // Alta atòmica: client + projecte + activitat + registre d'idempotència en una sola transacció.
  const { data, error } = await supabase.rpc("web_create_lead", {
    p_idempotency_key: key,
    p_signature: verified.signature,
    p_payload: lead,
  });
  if (error) {
    if (error.code === "22023") return json(422, { error: "invalid" });
    console.error("[web-leads] web_create_lead ha fallat:", error.code);
    return json(500, { error: "server_error" });
  }
  const out = data as { id: string; duplicate: boolean };
  return out.duplicate ? json(200, { id: out.id, duplicate: true }) : json(201, { id: out.id });
}
