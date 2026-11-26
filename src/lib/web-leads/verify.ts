// Autenticació de les peticions de la web pública (modulardom-web → POST /api/web/leads).
// La web signa "<timestamp>.<cos>" amb HMAC-SHA256 i un secret compartit que només viu als dos servidors.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Antiguitat màxima d'una petició signada (segons). */
export const MAX_SKEW_SECONDS = 300;

export type VerifyFailure = "missing_headers" | "bad_timestamp" | "stale" | "bad_signature";
export type VerifyResult = { ok: true; signature: string } | { ok: false; reason: VerifyFailure };

export function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Comprova la signatura sobre el cos ORIGINAL (text rebut, sense tornar-lo a serialitzar) i que el
 * timestamp sigui recent. La comparació és de temps constant.
 */
export function verifySignature(opts: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowMs?: number;
}): VerifyResult {
  const { secret, timestamp, rawBody } = opts;
  const signature = opts.signature?.trim().toLowerCase() ?? "";
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{9,11}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return { ok: false, reason: "bad_timestamp" };
  const expected = Buffer.from(sign(secret, timestamp, rawBody), "hex");
  const received = Buffer.from(signature, "hex");
  // primer la signatura: qui no té el secret no ha de poder distingir un timestamp caducat d'un de vàlid
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return { ok: false, reason: "bad_signature" };
  const now = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale" };
  return { ok: true, signature };
}

export const isIdempotencyKey = (v: string | null): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
