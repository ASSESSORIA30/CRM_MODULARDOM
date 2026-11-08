import { describe, expect, it } from "vitest";
import { divRoundHalfAway, formatQuantity, lineAmountCents, parseQuantityMilli, quoteTotals, type CalcLine } from "./calc";

const L = (kind: CalcLine["kind"], q: number, price: number, vat: number, disc = 0): CalcLine =>
  ({ kind, quantityMilli: q * 1000, unitPriceCents: price, vatRateBp: vat, discountBp: disc });

describe("càlcul de pressupostos", () => {
  it("arrodoneix com PostgreSQL (meitat lluny de zero)", () => {
    expect(divRoundHalfAway(5n, 2n)).toBe(3n);
    expect(divRoundHalfAway(-5n, 2n)).toBe(-3n);
    expect(divRoundHalfAway(4n, 3n)).toBe(1n);
  });
  it("llegeix quantitats", () => {
    expect(parseQuantityMilli("260")).toBe(260000);
    expect(parseQuantityMilli("100,5")).toBe(100500);
    expect(parseQuantityMilli("100.5")).toBe(100500);
    expect(parseQuantityMilli("1.234,567")).toBe(1234567);
    expect(parseQuantityMilli("1.234")).toBe(1234000);
    expect(parseQuantityMilli("0")).toBeNull();
    expect(parseQuantityMilli("-2")).toBeNull();
    expect(parseQuantityMilli("1,2345")).toBeNull();
    expect(formatQuantity(100500)).toBe("100,5");
  });
  it("import de línia amb quantitat decimal i descompte", () => {
    expect(lineAmountCents({ quantityMilli: 100500, unitPriceCents: 100000, discountBp: 0 })).toBe(10050000);
    expect(lineAmountCents({ quantityMilli: 1000, unitPriceCents: 100000, discountBp: 1000 })).toBe(90000);
    expect(lineAmountCents({ quantityMilli: 333, unitPriceCents: 1, discountBp: 0 })).toBe(0);
    expect(lineAmountCents({ quantityMilli: 500, unitPriceCents: 1, discountBp: 0 })).toBe(1);
  });
  it("totals iguals als de la prova de base de dades", () => {
    const t = quoteTotals([
      L("base", 260, 99300, 1000), L("base", 1, 3600000, 1000), L("base", 1, 3560000, 2100),
      L("extra_inicial", 1, 1230000, 1000), L("descompte", 1, -100000, 1000),
    ]);
    expect(t.baseCents).toBe(32978000);
    expect(t.extrasInitialCents).toBe(1230000);
    expect(t.discountCents).toBe(-100000);
    expect(t.taxableCents).toBe(34108000);
    expect(t.vatCents).toBe(3802400);
    expect(t.totalCents).toBe(37910400);
    expect(t.vatBreakdown).toEqual([
      { rateBp: 1000, baseCents: 30548000, vatCents: 3054800 },
      { rateBp: 2100, baseCents: 3560000, vatCents: 747600 },
    ]);
  });
  it("estructura del pressupost de referència (anonimitzat): 333.580 € base + 163.000 € extres", () => {
    const base = [L("base", 260, 99300, 1000), L("base", 1, 3600000, 1000), L("base", 1, 380000, 1000), L("base", 1, 3560000, 2100)];
    const extras = [1230000, 3500000, 2980000, 1820000, 480000, 1875000, 1620000, 1050000, 545000, 1200000].map((p) => L("extra_inicial", 1, p, 1000));
    const t = quoteTotals([...base, ...extras]);
    expect(t.baseCents).toBe(33358000);
    expect(t.extrasInitialCents).toBe(16300000);
    expect(t.taxableCents).toBe(49658000);
  });
});
