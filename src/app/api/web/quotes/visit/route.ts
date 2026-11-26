// Visita a la casa pilot demanada des d'un pressupost web: es lliga al mateix client i pressupost
// a partir de l'enllaç privat, sense tornar a demanar dades. Queda pendent de confirmació comercial.
import { z } from "zod";
import { json, signedRequest } from "@/lib/web-leads/request";
import { tokenSchema } from "@/lib/web-leads/schema";
import { isIdempotencyKey } from "@/lib/web-leads/verify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.strictObject({ token: tokenSchema, reference: z.string().regex(/^W\d{6}-[A-Z0-9]{4}$/) });

export async function POST(req: Request) {
  const g = await signedRequest(req, { maxBytes: 1024, contentType: "application/json" });
  if (!g.ok) return g.res;
  const key = req.headers.get("idempotency-key");
  if (!isIdempotencyKey(key)) return json(400, { error: "bad_idempotency_key" });
  let raw: unknown;
  try {
    raw = JSON.parse(g.raw.toString("utf8"));
  } catch {
    return json(400, { error: "bad_json" });
  }
  const b = bodySchema.safeParse(raw);
  if (!b.success) return json(422, { error: "invalid" });
  const { data, error } = await g.supabase.rpc("web_quote_request_visit", { p_idempotency_key: key, p_signature: g.signature, p_token: b.data.token, p_reference: b.data.reference });
  if (error) return json(500, { error: "server_error" });
  if (!data) return json(404, { error: "not_found" });
  const out = data as { id: string; duplicate: boolean; quoteReference: string };
  return json(out.duplicate ? 200 : 201, { id: out.id, quoteReference: out.quoteReference, ...(out.duplicate ? { duplicate: true } : {}) });
}
