import { describe, expect, it } from "vitest";
import { quoteTotals } from "./calc";
import { diffVersions, type CompareLine } from "./compare";

const L = (description: string, q: number, p: number, extra: Partial<CompareLine> = {}): CompareLine =>
  ({ kind: "base", description, quantityMilli: q * 1000, unitPriceCents: p, discountBp: 0, vatRateBp: 1000, ...extra });

describe("comparar versions", () => {
  it("detecta partides afegides, eliminades i modificades i quadra amb la diferència de totals", () => {
    const v1 = [L("Construcción", 150, 99300), L("Cimentación", 150, 12000), L("Piscina", 1, 2200000, { kind: "extra_inicial", status: "opcional" })];
    const v2 = [L("Construcción", 160, 99300), L("Piscina", 1, 2200000, { kind: "extra_inicial", status: "inclosa" }), L("Porche", 1, 800000, { kind: "extra_inicial" })];
    const d = diffVersions(v1, v2);
    expect(d.map((r) => `${r.description}:${r.change}`)).toEqual(["Construcción:changed", "Piscina:changed", "Porche:added", "Cimentación:removed"]);
    const sum = d.reduce((s, r) => s + r.deltaCents, 0);
    expect(sum).toBe(quoteTotals(v2).taxableCents - quoteTotals(v1).taxableCents);
  });
  it("versions idèntiques: cap diferència", () => {
    const v = [L("A", 1, 100), L("A", 1, 100)];
    expect(diffVersions(v, v).every((r) => r.change === "unchanged")).toBe(true);
  });
});
