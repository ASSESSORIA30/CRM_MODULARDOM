/**
 * REPROCESSAMENT SEGUR DEL CATÀLEG amb el motor únic de normalització (lògica pura).
 *
 *  - Només es mira la versió més recent de cada producte (activa o esborrany). Les arxivades i caducades no es toquen.
 *  - Mai es modifica una versió existent: si el motor canvia alguna dada (unitat del terme fix del gas, 24 hores,
 *    permanència per regla comercial, condicions llegides…), es proposa una VERSIÓ NOVA en esborrany.
 *  - Les comparatives i propostes emeses conserven la seva còpia (snapshot) i les versions usades són immutables:
 *    el reprocessament no les pot alterar.
 *  - Per defecte és una simulació: Direcció revisa l'informe i decideix quines versions noves es creen.
 */
import { latestPerProduct } from "./catalog";
import { normalizeOffer, validateOffer, type Incident } from "./tariff-engine";
import type { OfferVersion } from "./types";
import type { UnitRule } from "./unit-rules";

export interface ReprocessRow {
  id: string; productId: string; supplier: string; product: string; version: number; status: string; usedInProposals: boolean;
  action: "nova_versio" | "sense_canvis";
  changes: string[];
  incidents: Incident[];
  next: OfferVersion | null;
}

const sig = (o: OfferVersion) => JSON.stringify([o.contractType, o.energy, o.energy24h, o.power, o.powerUnit, o.gasFixedEurDay, o.units ?? null, o.permanence ?? null, o.permanenceMonths]);

export function planReprocess(versions: (OfferVersion & { usedAt?: string | null })[], opts: { unitRules?: UnitRule[] } = {}): ReprocessRow[] {
  const pool = versions.filter((v) => v.origin !== "crm" && (v.status === "activa" || v.status === "esborrany"));
  // la més recent de cada producte, sigui activa o esborrany
  const latest = latestPerProduct(pool.map((v) => ({ ...v, status: "activa" as const }))).map((l) => pool.find((v) => v.id === l.id)!).filter(Boolean);
  return latest.map((v) => {
    const n = normalizeOffer(v, { unitRules: opts.unitRules });
    const changed = sig(n.offer) !== sig(v);
    return {
      id: v.id, productId: v.productId, supplier: v.supplierName, product: v.productName, version: v.version, status: v.status, usedInProposals: !!v.usedAt,
      action: changed ? "nova_versio" : "sense_canvis",
      changes: changed ? n.changes : [],
      incidents: validateOffer(n.offer).filter((i) => i.level === "error" || i.level === "falta"),
      next: changed ? { ...n.offer, id: "", status: "esborrany", units: { ...(n.offer.units ?? { formulas: [] }), formulas: [...new Set([...(n.offer.units?.formulas ?? []), `Reprocessada amb el motor de normalització a partir de la v${v.version}`])].slice(0, 20) } } : null,
    };
  });
}
