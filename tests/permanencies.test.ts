/**
 * CORRECCIÓ GLOBAL DE PERMANÈNCIES · regla comercial interna: fixes 3.0TD i 6.1TD amb permanència.
 * Iberdrola Flex i altres fixes 3.0TD/6.1TD: catàleg, lector (importacions i actualitzacions), comparativa, rànquing,
 * PDF i proposta pública fan servir la mateixa lògica. 2.0TD, indexades i gas no es modifiquen. Preus fictícis.
 */
import { describe, expect, it, vi } from "vitest";
import {
  INTERNAL_RULE_SOURCE, declaredPermanence, hasNoPermanence, permanenceConflict, permanenceIssues, permanenceLabel, permanenceOf, snapshotPermanenceLabel,
} from "@/comparator/permanence";
import { normalizeOffer } from "@/comparator/tariff-engine";
import { buildSnapshot, presentationOrder } from "@/comparator/snapshot";
import { renderComparisonPdf } from "@/comparator/pdf";
import { applyOfferFilters as applyFilters, EMPTY_FILTERS } from "@/comparator/filters";
import { emptySheet, type OfferVersion, type PermanenceInfo, type SupplyInput } from "@/comparator/types";

vi.mock("server-only", () => ({}));
const TODAY = new Date().toISOString().slice(0, 10);
const NEXT = `${Number(TODAY.slice(0, 4)) + 1}-12-31`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const offer = (n: number, supplier: string, product: string, p: Partial<OfferVersion> = {}): OfferVersion => ({
  ...emptySheet(), id: uuid(n), supplierId: `sup:${supplier.toLowerCase()}`, supplierName: supplier, productId: `prod-${n}`, productName: product, version: 1,
  energyType: "luz", accessTariff: "3.0TD", segments: ["pyme", "industrial"], contractType: "periodes",
  energy: [0.16, 0.14, 0.12, 0.11, 0.1, 0.09], power: [0.06, 0.03, 0.013, 0.011, 0.007, 0.004], permanenceMonths: null, penalty: null, durationMonths: 12, priceGuaranteeMonths: 12,
  eligibility: { minKwh: null, maxKwh: null, minKw: null, maxKw: null, territories: null, notes: null }, validFrom: "2026-01-01", validTo: NEXT, source: "Prova", publishedAt: null, status: "activa", conditions: null, origin: "excel", ...p,
});
const sense: PermanenceInfo = { status: "sense", months: null, startNote: null, cancellation: null, penalty: null, source: "Condicions generals", exception: null };

const FLEX = offer(1, "Iberdrola", "Plan Flex 3.0TD");
const FLEX_FIX24 = offer(2, "Iberdrola", "Plan Flex 3.0TD preu únic", { contractType: "fix24h" });
const FIX61 = offer(3, "Comercialitzadora Fictícia", "Fixa Indústria 6.1TD", { accessTariff: "6.1TD" });
const FIX61_12 = offer(4, "Una Altra", "Fixa 6.1TD 12 mesos", { accessTariff: "6.1TD", permanenceMonths: 12 });
const T20 = offer(5, "Iberdrola", "Plan Flex 2.0TD", { accessTariff: "2.0TD", energy: [0.2, 0.15, 0.1, null, null, null], power: [0.1, 0.05, null, null, null, null] });
const T20_SENSE = offer(6, "Iberdrola", "Plan 2.0TD sense permanència", { accessTariff: "2.0TD", permanence: sense, energy: [0.2, 0.15, 0.1, null, null, null], power: [0.1, 0.05, null, null, null, null] });
const IDX30 = offer(7, "Iberdrola", "Plan OMIE 3.0TD", { contractType: "indexat" });
const CONFLICT = offer(8, "Comercialitzadora Fictícia", "Fixa 3.0TD «sin permanencia»", { permanence: sense });
const EXCEPTION = offer(9, "Comercialitzadora Fictícia", "Fixa 3.0TD amb excepció", { permanence: { ...sense, exception: "Acord de Direcció del 01/10/2026 (prova)" } });

describe("regla interna: fixes 3.0TD i 6.1TD amb permanència", () => {
  it("Iberdrola Flex 3.0TD a preu fix (per períodes o 24 h): amb permanència, mai «Sense permanència»", () => {
    for (const o of [FLEX, FLEX_FIX24, FIX61]) {
      const p = permanenceOf(o);
      expect(p.status).toBe("amb");
      expect(p.months).toBeNull(); // no s'inventa la durada
      expect(p.source).toBe(INTERNAL_RULE_SOURCE);
      expect(permanenceLabel(o)).toBe("Permanència: sí (durada segons condicions de la comercialitzadora)");
      expect(permanenceLabel(o, "es")).not.toMatch(/Sin permanencia/);
      expect(hasNoPermanence(o)).toBe(false);
      expect(permanenceIssues(o)).toEqual([]);
      expect(declaredPermanence(o).status).toBe("no_informada"); // la dada oficial no es confon amb la regla
    }
  });
  it("si consten els mesos, es mostren", () => {
    expect(permanenceLabel(FIX61_12)).toBe("Permanència: 12 mesos");
  });
  it("condicions oficials «sense permanència» en una fixa 3.0TD: avís de revisió, no s'inventa res ni es diu «Sense»", () => {
    expect(permanenceConflict(CONFLICT)).toBe(true);
    expect(permanenceOf(CONFLICT).status).toBe("sense"); // es conserva el que diu el document
    expect(permanenceLabel(CONFLICT)).toBe("Permanència: pendent de revisió administrativa");
    expect(permanenceIssues(CONFLICT)[0]).toMatch(/Revisió administrativa/);
    expect(hasNoPermanence(CONFLICT)).toBe(false);
  });
  it("excepció documentada per Direcció: sí que pot ser «Sense permanència»", () => {
    expect([permanenceLabel(EXCEPTION), hasNoPermanence(EXCEPTION), permanenceIssues(EXCEPTION)]).toEqual(["Sense permanència", true, []]);
  });
  it("2.0TD, indexades i gas: segons les seves condicions (sense canvis)", () => {
    expect(permanenceOf(T20).status).toBe("no_informada");
    expect(permanenceLabel(T20)).toBe("Permanència: no informada");
    expect(permanenceLabel(T20_SENSE)).toBe("Sense permanència");
    expect(permanenceOf(IDX30).status).toBe("no_informada");
    const gas = offer(10, "Gas", "Gas RL2", { energyType: "gas", accessTariff: "RL.2", contractType: "fix24h" });
    expect(permanenceOf(gas).status).toBe("no_informada");
  });
  it("una comparativa antiga (motor 1.0.x) tampoc diu «Sense permanència» d'una fixa 3.0TD", () => {
    expect(snapshotPermanenceLabel(FLEX, "1.0.3")).not.toMatch(/Sense/);
    expect(snapshotPermanenceLabel(T20, "1.0.3")).toBe("Sense permanència"); // text original conservat per a la resta
  });
});

describe("lector de tarifes: importacions noves i actualitzacions", () => {
  it("persisteix la regla a la dada (Flex i qualsevol comercialitzadora), idempotent", () => {
    for (const o of [FLEX, FIX61]) {
      const n = normalizeOffer(o);
      expect(n.offer.permanence).toMatchObject({ status: "amb", months: null, source: INTERNAL_RULE_SOURCE });
      expect(n.changes.join(" ")).toMatch(/regla comercial interna/);
      expect(normalizeOffer(n.offer).changes.some((c) => /regla comercial interna/.test(c))).toBe(false);
      // no toca preus ni potències
      expect([n.offer.energy, n.offer.power, n.offer.contractType]).toEqual([o.energy, o.power, o.contractType]);
    }
  });
  it("si el document diu «sin permanencia» en una fixa 3.0TD, es conserva i queda per revisar", () => {
    const n = normalizeOffer(offer(11, "Iberdrola", "Plan Flex 3.0TD", { conditions: "Contrato sin permanencia." }));
    expect(n.offer.permanence?.status).toBe("sense");
    expect(permanenceIssues(n.offer)[0]).toMatch(/Revisió administrativa/);
  });
  it("no modifica 2.0TD ni indexades", () => {
    expect(normalizeOffer(T20).offer.permanence ?? null).toBeNull();
    expect(normalizeOffer(IDX30).offer.permanence ?? null).toBeNull();
  });
  it("una regla configurada per Direcció sense 6.1TD no l'aplica a 6.1TD", () => {
    expect(normalizeOffer(FIX61, { rule: { enabled: true, tariffs: ["3.0TD"], contractTypes: ["fix24h", "periodes"] } }).offer.permanence ?? null).toBeNull();
  });
});

describe("comparativa, rànquing, filtres i PDF: mateixes condicions", () => {
  const supply: SupplyInput = { energyType: "luz", accessTariff: "3.0TD", territory: "peninsula", segment: null, days: 365, basis: "anual", kwh: [8000, 9000, 7000, 6000, 5000, 9000], kwhTotal: 44000, kw: [30, 30, 30, 30, 30, 30], meterRentEurMonth: null, residentialLowPower: false };
  // Flex és la més barata i la més «sense mesos»: abans rebia l'etiqueta «Sense permanència»
  const snap = buildSnapshot({ mode: "manual", supply, current: { ...emptySheet(), contractType: "periodes", energy: [0.2, 0.18, 0.16, 0.15, 0.13, 0.12], power: [0.07, 0.04, 0.02, 0.015, 0.01, 0.006] }, offers: [FLEX, offer(12, "Una Altra", "Fixa 3.0TD 24 mesos", { energy: [0.17, 0.15, 0.13, 0.12, 0.11, 0.1], permanenceMonths: 24 }), offer(13, "Tercera", "Fixa 3.0TD 12 mesos", { energy: [0.18, 0.16, 0.14, 0.13, 0.12, 0.11], permanenceMonths: 12 })] }, TODAY);
  const flex = snap.result.evaluations.find((e) => e.offer.id === FLEX.id)!;

  it("la comparativa no etiqueta Flex 3.0TD com a «Sense permanència»", () => {
    expect(flex.tags).not.toContain("Sense permanència");
    expect(snap.result.highlights.noPermanence).toBeNull();
    expect(snapshotPermanenceLabel(flex.offer, snap.engineVersion)).toBe("Permanència: sí (durada segons condicions de la comercialitzadora)");
  });
  it("el PDF mostra el mateix text que el CRM (mai «Sense permanència»)", async () => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    for (const lang of ["ca", "es"] as const) {
      const r = renderComparisonPdf(snap, { kind: "detallada", lang, recommendation: null, company: { name: "ASSESSORIA DE PROVA", taxId: null, address: null, phone: null, email: null, web: null, logo: null } as never, salesperson: null });
      const { text } = await extractText(await getDocumentProxy(new Uint8Array(r.bytes)), { mergePages: true });
      const flat = String(text).replace(/\s+/g, " ");
      const screen = snapshotPermanenceLabel(flex.offer, snap.engineVersion, lang).replace(/^Perman[eè]ncia: /, "");
      expect(flat.toLowerCase()).toContain(screen.toLowerCase()); // mateix text que la pantalla (el PDF el posa amb majúscula inicial)
      expect(flat).not.toMatch(lang === "ca" ? /Sense perman/ : /Sin perman/);
    }
    expect(presentationOrder(snap).length).toBe(3);
  });
  it("filtre «Sense permanència» del catàleg: no hi apareixen fixes 3.0TD/6.1TD sense excepció", () => {
    const res = applyFilters([FLEX, FIX61, CONFLICT, EXCEPTION, T20_SENSE], { ...EMPTY_FILTERS, permanence: "sense" }).map((o) => o.id);
    expect(res.sort()).toEqual([EXCEPTION.id, T20_SENSE.id].sort());
    expect(applyFilters([FLEX, FIX61, T20], { ...EMPTY_FILTERS, permanence: "amb" }).map((o) => o.id).sort()).toEqual([FLEX.id, FIX61.id].sort());
  });
});
