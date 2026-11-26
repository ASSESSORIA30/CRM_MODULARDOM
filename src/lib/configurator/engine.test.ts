import { describe, expect, it } from "vitest";
import { calculate, estimateRoofArea, validateInput, type ConfigInput } from "./engine";
import { tariffDiff, tariffSchema, WEB_TARIFF_V3 } from "./tariff";

const base: ConfigInput = { metres: 150, habitacions: 3, banys: 2, suite: "bano", cuina: "isla", vehicles: 1, safareig: false, installacions: ["aerotermia"], extres: ["piscina"] };

describe("motor del configurador (regles de la web v3)", () => {
  it("la tarifa inicial compleix l'esquema", () => {
    expect(tariffSchema.safeParse(WEB_TARIFF_V3).success).toBe(true);
  });
  it("calcula línia per línia com la web (150 m², 3 hab., 2 banys, suite amb bany, illa, 1 cotxe, aerotèrmia, piscina)", () => {
    const r = calculate(WEB_TARIFF_V3, base);
    const by = Object.fromEntries(r.lines.map((l) => [l.key, l.amountCents / 100]));
    expect(by).toEqual({
      construccio: 148950, arquitecte: 21300, fonamentacio: 18000, escomeses: 3500,
      distribucio: (3 * 6500 + 2 * 7500 + 9800) / 2, cuina: 10000, installacions: 21000, garatge: 20000, "extra:piscina": 22000,
    });
    const dist = r.lines.find((l) => l.key === "distribucio")!;
    expect(dist.originalCents).toBe(4430000);
    expect(r.baseArqCents).toBe(2130000);
    expect(r.baseObraCents).toBe((148950 + 18000 + 3500 + 22150 + 10000 + 21000 + 20000 + 22000) * 100);
    expect(r.ivaArqCents).toBe(447300);
    expect(r.ivaObraCents).toBe(r.baseObraCents / 10);
    expect(r.totalCents).toBe(r.subtotalCents + r.ivaObraCents + r.ivaArqCents);
  });
  it("honoraris d'arquitecte = 130 €/m² + 1.800 € (sense els 2.800 € antics)", () => {
    expect(calculate(WEB_TARIFF_V3, { ...base, metres: 100 }).lines.find((l) => l.key === "arquitecte")!.amountCents).toBe(1480000);
  });
  it("garatge: 1r vehicle 20.000 € i cada addicional 15.000 €", () => {
    expect(calculate(WEB_TARIFF_V3, { ...base, vehicles: 4 }).lines.find((l) => l.key === "garatge")!.amountCents).toBe(6500000);
    expect(calculate(WEB_TARIFF_V3, { ...base, vehicles: 0 }).lines.some((l) => l.key === "garatge")).toBe(false);
  });
  it("valida les opcions", () => {
    expect(validateInput(WEB_TARIFF_V3, { ...base, metres: 99 })).toEqual([{ field: "metres", code: "min" }]);
    expect(validateInput(WEB_TARIFF_V3, { ...base, habitacions: 7, extres: ["jacuzzi"] }).map((x) => x.field)).toEqual(["habitacions", "extres"]);
  });
  it("un canvi de tarifa canvia el càlcul i queda a l'historial de diferències", () => {
    const nova = structuredClone(WEB_TARIFF_V3);
    nova.construccio_m2 = 1010;
    expect(calculate(nova, base).lines[0].amountCents).toBe(151500 * 100);
    expect(tariffDiff(WEB_TARIFF_V3, nova)).toEqual([{ path: "construccio_m2", before: 993, after: 1010 }]);
  });
});

describe("tarifa inicial de la base de dades", () => {
  it("és idèntica a la tarifa de la web del motor", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261117001100_pressupostos_v2.sql", "utf8");
    const json = sql.split("$json$")[1];
    expect(JSON.parse(json)).toEqual(WEB_TARIFF_V3);
  });
});

describe("del configurador al pressupost", () => {
  it("les partides generades donen exactament els mateixos totals que el motor (200 configuracions)", async () => {
    const { engineToQuoteLines } = await import("./to-quote");
    const { quoteTotals } = await import("@/lib/quotes/calc");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
    for (let i = 0; i < 200; i++) {
      const c: ConfigInput = {
        metres: 100 + Math.floor(rnd() * 400), habitacions: pick([1, 2, 3, 4, 5, 6]), banys: pick([1, 2, 3, 4]),
        suite: pick(["sin", "bano", "bano_vestidor"] as const), cuina: pick(["basica", "isla"] as const), vehicles: pick([0, 1, 2, 3, 4]),
        safareig: rnd() < 0.5, installacions: ["aerotermia", "aireConductos"].filter(() => rnd() < 0.4), extres: ["piscina", "porche", "placasSolares"].filter(() => rnd() < 0.4),
      };
      const r = calculate(WEB_TARIFF_V3, c);
      const lines = engineToQuoteLines(WEB_TARIFF_V3, c, r, "es");
      const t = quoteTotals(lines.map((l) => ({ kind: l.kind as never, status: "inclosa", quantityMilli: Math.round(Number(l.quantity) * 1000), unitPriceCents: l.unit_price_cents!, discountBp: l.discount_bp, vatRateBp: l.vat_rate_bp })));
      expect(t.taxableCents).toBe(r.subtotalCents);
      expect(t.vatCents).toBe(r.ivaObraCents + r.ivaArqCents);
      expect(t.totalCents).toBe(r.totalCents);
    }
  });
});

describe("còpia del motor per a la web", () => {
  it("web-integracio/assets/motor.js és idèntic al motor compilat del CRM", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("web-integracio/assets/motor.js", "utf8")).toBe(readFileSync("public/configurador/motor.js", "utf8"));
  });
});

// Cobertes. Els preus (150 i 180 €/m²) són els fixats per direcció; pendent, voladís i proporció
// són valors de PROVA: els reals els posa direcció a la tarifa.
describe("cobertes inclinades", () => {
  const roof = { inclinada: { preu_m2: 150, pendent_pct: 30 }, dues_aigues: { preu_m2: 180, pendent_pct: 40 }, volada_m: 0.5, proporcio: 1.5 };
  const T = { ...WEB_TARIFF_V3, coberta: roof };
  const house: ConfigInput = { ...base, metres: 200 };
  const flat = calculate(T, { ...house, plantes: 1, coberta: "plana" });

  it("la tarifa amb el bloc de cobertes és vàlida; el bloc a mitges, no", () => {
    expect(tariffSchema.safeParse(T).success).toBe(true);
    expect(tariffSchema.safeParse({ ...T, coberta: { ...roof, proporcio: undefined } }).success).toBe(false);
    expect(tariffSchema.safeParse({ ...T, coberta: { ...roof, inclinada: { preu_m2: 150, pendent_pct: 0 } } }).success).toBe(false);
  });
  it("la coberta plana és l'estàndard: cap partida, mateix total que una configuració antiga", () => {
    expect(flat.lines.some((l) => l.key === "coberta")).toBe(false);
    expect(flat.totalCents).toBe(calculate(T, house).totalCents);
    expect(flat.totalCents).toBe(calculate(WEB_TARIFF_V3, house).totalCents);
    expect(flat.pending).toEqual([]);
  });
  it("una planta: 200 m² de planta, voladís i pendent → 240,0 m² × 150 €", () => {
    const r = calculate(T, { ...house, plantes: 1, coberta: "inclinada" });
    expect(estimateRoofArea(200, 1, 30, 0.5, 1.5)).toBe(240);
    expect(r.roof).toEqual({ type: "inclinada", areaM2: 240, estimated: true, priced: true });
    const line = r.lines.find((l) => l.key === "coberta")!;
    expect(line.amountCents).toBe(3_600_000);
    expect(line.detail!.ca).toBe("240,0 m² de coberta (superfície estimada)");
    expect(r.baseObraCents - flat.baseObraCents).toBe(3_600_000);
    expect(r.totalCents - flat.totalCents).toBe(3_960_000); // + 10 % d'IVA d'obra
  });
  it("dues plantes: es calcula sobre la planta (100 m²), no sobre els 200 m² construïts", () => {
    const r = calculate(T, { ...house, plantes: 2, coberta: "inclinada" });
    expect(r.roof!.areaM2).toBe(126.8);
    expect(r.lines.find((l) => l.key === "coberta")!.amountCents).toBe(1_902_000);
  });
  it("dues aigües: el seu preu i el seu pendent", () => {
    const r = calculate(T, { ...house, plantes: 1, coberta: "dues_aigues" });
    expect(r.roof!.areaM2).toBe(247.6);
    expect(r.lines.find((l) => l.key === "coberta")!.amountCents).toBe(4_456_800);
  });
  it("amb superfície mesurada no s'estima res", () => {
    const r = calculate(T, { ...house, plantes: 2, coberta: "dues_aigues", coberta_m2: 131.25 });
    expect(r.roof).toEqual({ type: "dues_aigues", areaM2: 131.3, estimated: false, priced: true });
    expect(r.lines.find((l) => l.key === "coberta")!.amountCents).toBe(2_363_400);
    expect(r.lines.find((l) => l.key === "coberta")!.detail!.es).toContain("superficie medida");
  });
  it("sense tarifa de cobertes, la inclinada queda pendent de valorar: no és gratuïta ni suma", () => {
    const r = calculate(WEB_TARIFF_V3, { ...house, plantes: 1, coberta: "inclinada" });
    expect(r.lines.find((l) => l.key === "coberta")).toMatchObject({ pending: true, amountCents: 0 });
    expect(r.pending).toEqual(["coberta"]);
    expect(r.roof!.priced).toBe(false);
    expect(r.totalCents).toBe(flat.totalCents);
  });
  it("valida plantes, tipus de coberta i superfície mesurada", () => {
    expect(validateInput(T, { ...house, plantes: 3 as never, coberta: "vegetal" as never, coberta_m2: -1 }).map((x) => x.field)).toEqual(["plantes", "coberta", "coberta_m2"]);
    expect(validateInput(T, { ...house, plantes: 2, coberta: "dues_aigues" })).toEqual([]);
  });
});
