// Comparació econòmica entre dues versions d'un pressupost.
import { lineAmountCents, type CalcLine, type LineStatus } from "./calc";

export type CompareLine = CalcLine & { description: string; catalogKey?: string | null; status?: LineStatus };
export type DiffRow = {
  key: string; description: string; kind: string;
  a: { amountCents: number; status: string } | null;
  b: { amountCents: number; status: string } | null;
  change: "added" | "removed" | "changed" | "unchanged";
  deltaCents: number; // efecte sobre el total (només partides incloses)
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const keyOf = (l: CompareLine) => `${l.kind}|${l.catalogKey ?? norm(l.description)}`;
const counted = (l: { amountCents: number; status: string } | null) => (l && l.status === "inclosa" ? l.amountCents : 0);

/** a = versió anterior, b = versió nova. Les partides repetides s'aparellen en ordre. */
export function diffVersions(a: CompareLine[], b: CompareLine[]): DiffRow[] {
  const pool = new Map<string, CompareLine[]>();
  for (const l of a) { const k = keyOf(l); pool.set(k, [...(pool.get(k) ?? []), l]); }
  const rows: DiffRow[] = [];
  for (const l of b) {
    const k = keyOf(l);
    const match = pool.get(k)?.shift();
    const nb = { amountCents: lineAmountCents(l), status: l.status ?? "inclosa" };
    const na = match ? { amountCents: lineAmountCents(match), status: match.status ?? "inclosa" } : null;
    const same = na && na.amountCents === nb.amountCents && na.status === nb.status && match!.quantityMilli === l.quantityMilli && match!.unitPriceCents === l.unitPriceCents && match!.vatRateBp === l.vatRateBp;
    rows.push({ key: k, description: l.description, kind: l.kind, a: na, b: nb, change: !na ? "added" : same ? "unchanged" : "changed", deltaCents: counted(nb) - counted(na) });
  }
  for (const [k, rest] of pool) for (const l of rest) {
    const na = { amountCents: lineAmountCents(l), status: l.status ?? "inclosa" };
    rows.push({ key: k, description: l.description, kind: l.kind, a: na, b: null, change: "removed", deltaCents: -counted(na) });
  }
  return rows;
}
