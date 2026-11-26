import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { webLeadSchema } from "./schema";
import { isIdempotencyKey, sign, verifySignature } from "./verify";

const secret = "s".repeat(48);
const now = 1_795_000_000_000;
const ts = String(now / 1000);

// Exactament el que construeix la web (modulardom-web · src/server/leads.ts · toCrm)
const payload = {
  reference: "W261126-AB3K",
  capturedAt: "2026-11-26T20:00:00.000Z",
  source: "configurador",
  kind: "quote",
  page: "/ca/configurador",
  client: { kind: "persona", display_name: "Prova Fictícia", email: "prova@example.com", phone: "+34 600 000 001", locale: "ca", city: null },
  project: { municipality: "Bellvís", plot_address: null, surface_m2: 180 },
  configurator: {
    input: { metres: 180, habitacions: 3, banys: 2, suite: "bano", cuina: "isla", vehicles: 1, safareig: true, installacions: ["aerotermia"], extres: ["piscina"] },
    visual: { floors: 1, system: "cellular", facade: "mineral", roof: "flat", volume: "compact" },
    tariff: "7",
    totalCents: 12345600,
  },
  notes: "Terreny: en té\nObservacions",
};
const body = JSON.stringify(payload);

describe("signatura de la web", () => {
  it("coincideix amb la fórmula de la web: HMAC-SHA256(\"<ts>.<cos>\")", () => {
    expect(sign(secret, ts, body)).toBe(createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex"));
  });
  it("accepta una petició ben signada i recent", () => {
    expect(verifySignature({ secret, timestamp: ts, signature: sign(secret, ts, body), rawBody: body, nowMs: now + 120_000 }).ok).toBe(true);
  });
  it("rebutja el cos alterat, encara que el JSON sigui equivalent", () => {
    const sig = sign(secret, ts, body);
    expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body + " ", nowMs: now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body.replace("180", "181"), nowMs: now }).ok).toBe(false);
  });
  it("rebutja un altre secret, un timestamp canviat i les capçaleres absents", () => {
    expect(verifySignature({ secret, timestamp: ts, signature: sign("x".repeat(48), ts, body), rawBody: body, nowMs: now }).ok).toBe(false);
    expect(verifySignature({ secret, timestamp: String(now / 1000 + 1), signature: sign(secret, ts, body), rawBody: body, nowMs: now }).ok).toBe(false);
    expect(verifySignature({ secret, timestamp: null, signature: null, rawBody: body, nowMs: now })).toEqual({ ok: false, reason: "missing_headers" });
    expect(verifySignature({ secret, timestamp: "ara", signature: "zz", rawBody: body, nowMs: now })).toEqual({ ok: false, reason: "bad_timestamp" });
  });
  it("rebutja peticions de fa més de 5 minuts (o del futur)", () => {
    const sig = sign(secret, ts, body);
    expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now + 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now - 301_000 })).toEqual({ ok: false, reason: "stale" });
    expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now + 299_000 }).ok).toBe(true);
  });
  it("valida el format de la clau d'idempotència", () => {
    expect(isIdempotencyKey("a".repeat(64))).toBe(true);
    expect(isIdempotencyKey("A".repeat(64))).toBe(false);
    expect(isIdempotencyKey(null)).toBe(false);
  });
});

describe("esquema del cos", () => {
  it("accepta els quatre tipus de sol·licitud", () => {
    expect(webLeadSchema.safeParse(payload).success).toBe(true);
    for (const kind of ["info", "visit", "mineral"]) {
      expect(webLeadSchema.safeParse({ ...payload, kind, source: "web", configurator: null }).success).toBe(true);
    }
  });
  it("rebutja camps desconeguts, tipus inventats i dades fora de rang", () => {
    expect(webLeadSchema.safeParse({ ...payload, admin: true }).success).toBe(false);
    expect(webLeadSchema.safeParse({ ...payload, kind: "altres" }).success).toBe(false);
    expect(webLeadSchema.safeParse({ ...payload, client: { ...payload.client, email: "no-es-un-correu" } }).success).toBe(false);
    expect(webLeadSchema.safeParse({ ...payload, client: { ...payload.client, role: "direccio" } }).success).toBe(false);
    expect(webLeadSchema.safeParse({ ...payload, project: { ...payload.project, surface_m2: -5 } }).success).toBe(false);
    expect(webLeadSchema.safeParse({ ...payload, configurator: { ...payload.configurator, totalCents: 1.5 } }).success).toBe(false);
    expect(webLeadSchema.safeParse({ ...payload, notes: "x".repeat(4001) }).success).toBe(false);
  });
});
