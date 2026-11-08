// Càlculs de pressupost idèntics als de la base de dades (columna generada i vista de totals):
// import de línia = round(quantitat × preu × (1 − descompte)), IVA arrodonit per tipus.
// Arrodoniment "meitat lluny de zero", com round(numeric) de PostgreSQL. Tot en enters (BigInt).

export type LineKind = "base" | "extra_inicial" | "extra_posterior" | "descompte";
export const LINE_KINDS: LineKind[] = ["base", "extra_inicial", "extra_posterior", "descompte"];

export type CalcLine = {
  kind: LineKind;
  quantityMilli: number; // quantitat × 1000 (3 decimals)
  unitPriceCents: number;
  discountBp: number;    // 1000 = 10 %
  vatRateBp: number;     // 2100 = 21 %
};

export function divRoundHalfAway(num: bigint, den: bigint): bigint {
  const neg = (num < 0n) !== (den < 0n);
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = (n * 2n + d) / (d * 2n);
  return neg ? -q : q;
}

/** "1.234,5" / "1234.5" / "260" → mil·lèsimes. null si no és vàlid o no és positiu. */
export function parseQuantityMilli(input: string): number | null {
  const s = input.trim().replace(/\s/g, "");
  if (!s) return null;
  let norm: string;
  if (s.includes(",")) norm = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) norm = s.replace(/\./g, "");
  else norm = s;
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(norm);
  if (!m) return null;
  const v = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  return v > 0 && Number.isSafeInteger(v) ? v : null;
}

export function formatQuantity(milli: number, locale: "ca" | "es" = "ca"): string {
  const int = Math.trunc(milli / 1000).toLocaleString(locale === "es" ? "es-ES" : "ca-ES");
  const dec = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return dec ? `${int},${dec}` : int;
}

export function lineAmountCents(l: Pick<CalcLine, "quantityMilli" | "unitPriceCents" | "discountBp">): number {
  const num = BigInt(l.quantityMilli) * BigInt(l.unitPriceCents) * BigInt(10000 - l.discountBp);
  return Number(divRoundHalfAway(num, 10_000_000n));
}

export type QuoteTotals = {
  baseCents: number;
  extrasInitialCents: number;
  extrasLaterCents: number;
  discountCents: number;
  taxableCents: number;
  vatCents: number;
  totalCents: number;
  vatBreakdown: { rateBp: number; baseCents: number; vatCents: number }[];
};

export function quoteTotals(lines: CalcLine[]): QuoteTotals {
  const byKind: Record<LineKind, number> = { base: 0, extra_inicial: 0, extra_posterior: 0, descompte: 0 };
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const a = lineAmountCents(l);
    byKind[l.kind] += a;
    byRate.set(l.vatRateBp, (byRate.get(l.vatRateBp) ?? 0) + a);
  }
  const vatBreakdown = [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rateBp, baseCents]) => ({
    rateBp, baseCents, vatCents: Number(divRoundHalfAway(BigInt(baseCents) * BigInt(rateBp), 10000n)),
  }));
  const taxableCents = vatBreakdown.reduce((s, r) => s + r.baseCents, 0);
  const vatCents = vatBreakdown.reduce((s, r) => s + r.vatCents, 0);
  return {
    baseCents: byKind.base, extrasInitialCents: byKind.extra_inicial, extrasLaterCents: byKind.extra_posterior,
    discountCents: byKind.descompte, taxableCents, vatCents, totalCents: taxableCents + vatCents, vatBreakdown,
  };
}

export const formatRate = (bp: number) => `${(bp / 100).toLocaleString("ca-ES", { maximumFractionDigits: 2 })} %`;
