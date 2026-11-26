// Comprovacions comunes de les rutes que crida la web pública (servidor a servidor):
// integració activada, mida, límit de peticions persistent i signatura sobre el cos rebut.
import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySignature } from "./verify";

export const json = (status: number, body: Record<string, unknown>, headers?: Record<string, string>) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export type Admin = ReturnType<typeof createAdminClient>;
type Ok = { ok: true; raw: Buffer; signature: string; supabase: Admin };
type Fail = { ok: false; res: NextResponse };

export async function rateHit(supabase: Admin, bucket: string, limit: number, windowSeconds: number): Promise<NextResponse | null> {
  const { data, error } = await supabase.rpc("web_rate_hit", { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) return json(503, { error: "unavailable" });
  return data === true ? null : json(429, { error: "rate_limited" }, { "Retry-After": String(windowSeconds) });
}

/**
 * `signed` diu quin text ha de portar signat la petició, a partir del cos rebut. Per a JSON és el cos mateix;
 * per a un fitxer, un text curt que n'inclou el SHA-256.
 */
export async function signedRequest(req: Request, opts: { maxBytes: number; contentType: string; signed?: (raw: Buffer) => string }): Promise<Ok | Fail> {
  const fail = (res: NextResponse): Fail => ({ ok: false, res });
  const secret = process.env.WEB_LEADS_SECRET ?? "";
  if (process.env.WEB_LEADS_ENABLED !== "true" || secret.length < 32) return fail(json(404, { error: "not_found" }));
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith(opts.contentType)) return fail(json(415, { error: "unsupported_media_type" }));
  if (Number(req.headers.get("content-length") ?? 0) > opts.maxBytes) return fail(json(413, { error: "too_large" }));
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.byteLength > opts.maxBytes) return fail(json(413, { error: "too_large" }));
  let supabase: Admin;
  try {
    supabase = createAdminClient();
  } catch {
    return fail(json(503, { error: "unavailable" }));
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 60) || "unknown";
  const limited = (await rateHit(supabase, `web:ip:${ip}`, 60, 60)) ?? (await rateHit(supabase, "web:global", 1200, 3600));
  if (limited) return fail(limited);
  const verified = verifySignature({
    secret,
    timestamp: req.headers.get("x-modulardom-timestamp"),
    signature: req.headers.get("x-modulardom-signature"),
    rawBody: opts.signed ? opts.signed(raw) : raw.toString("utf8"),
  });
  if (!verified.ok) return fail(json(401, { error: "unauthorized" }));
  return { ok: true, raw, signature: verified.signature, supabase };
}

export const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** JSON amb les claus ordenades: la mateixa configuració dona sempre la mateixa empremta. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Empremta d'una configuració: el que entra al motor i les tries del model. Les llistes, ordenades. */
export function configHash(input: Record<string, unknown>, visual: unknown): string {
  const norm = { ...input, plantes: input.plantes ?? 1, coberta: input.coberta ?? "plana" } as Record<string, unknown>;
  for (const k of ["installacions", "extres"]) if (Array.isArray(norm[k])) norm[k] = [...(norm[k] as string[])].sort();
  return sha256Hex(`${stableStringify(norm)}|${stableStringify(visual ?? null)}`);
}

export const PDF_BUCKET = "pressupostos-web";
