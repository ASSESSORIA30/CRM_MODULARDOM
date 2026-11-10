import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, parseEurosToCents } from "./money";

describe("parseEurosToCents", () => {
  it.each([
    ["496.580", 49658000],
    ["496580", 49658000],
    ["496.580,00", 49658000],
    ["496580,5", 49658050],
    ["1.234,56 €", 123456],
    ["350000.5", 35000050],
    ["0,01", 1],
    ["-300", -30000],
    ["  12 300 ", 1230000],
  ])("%s → %d cèntims", (input, cents) => {
    expect(parseEurosToCents(input)).toBe(cents);
  });

  it("buit → null", () => {
    expect(parseEurosToCents("")).toBeNull();
    expect(parseEurosToCents(null)).toBeNull();
  });

  it.each(["abc", "1,2,3", "12,345", "1.23.4", "12.3456"])("rebutja %s", (input) => {
    expect(() => parseEurosToCents(input)).toThrow();
  });

  it("no perd precisió amb imports grans", () => {
    expect(parseEurosToCents("90.071.992.547.409,91")).toBe(9007199254740991);
  });
});

describe("formatCents", () => {
  it("format espanyol", () => {
    expect(formatCents(49658000)).toBe("496.580,00 €");
    expect(formatCents(49628000, { decimals: false })).toBe("496.280 €");
    expect(formatCents(-30000)).toBe("-300,00 €");
    expect(formatCents(5)).toBe("0,05 €");
    expect(formatCents(null)).toBe("—");
  });

  it("anada i tornada", () => {
    for (const c of [0, 1, 99, 100, 12345678, 49658000]) {
      expect(parseEurosToCents(centsToInput(c))).toBe(c);
    }
  });

  it("la diferència pressupost-contracte de referència és exactament 300 €", () => {
    const pressupost = parseEurosToCents("496.580")!;
    const contracte = parseEurosToCents("496.280")!;
    expect(formatCents(pressupost - contracte)).toBe("300,00 €");
  });
});
