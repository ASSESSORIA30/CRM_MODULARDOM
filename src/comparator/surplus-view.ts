/**
 * Fase 2 · Taula «Excedents fotovoltaics» compartida per la pantalla i el PDF (mateix resultat, mateixos textos).
 * Només té files quan el subministrament té excedents.
 */
import { surplusKwh } from "./engine";
import { presentationOrder, type Snapshot } from "./snapshot";
import type { CostResult, SurplusResult } from "./types";

type Lang = "ca" | "es";
const eur = (n: number | null | undefined, lang: Lang) => (n == null ? "—" : (Object.is(n, -0) ? 0 : n).toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { style: "currency", currency: "EUR" }));
const nf = (n: number | null | undefined, d: number, lang: Lang) => (n == null ? "—" : n.toLocaleString(lang === "es" ? "es-ES" : "ca-ES", { maximumFractionDigits: d }));

const L = {
  ca: { grid: "Consum de xarxa kWh", energy: "Cost energia", power: "Cost potència", kwh: "Excedents injectats kWh", compKwh: "Excedents compensats kWh", price: "Preu excedents €/kWh", comp: "Compensació aplicada €", battery: "Bateria virtual", net: "Cost final", saving: "Estalvi", monthly: "Estalvi mensual", manual: "manual", notInf: "No informat", pending: "Pendent", toBattery: "al saldo", fee: "quota", lost: "no compensats", title: "Excedents fotovoltaics", balance: "Saldo acumulat actual a la bateria virtual" },
  es: { grid: "Consumo de red kWh", energy: "Coste energía", power: "Coste potencia", kwh: "Excedentes vertidos kWh", compKwh: "Excedentes compensados kWh", price: "Precio excedentes €/kWh", comp: "Compensación aplicada €", battery: "Batería virtual", net: "Coste final", saving: "Ahorro", monthly: "Ahorro mensual", manual: "manual", notInf: "No informado", pending: "Pendiente", toBattery: "al saldo", fee: "cuota", lost: "no compensados", title: "Excedentes fotovoltaicos", balance: "Saldo acumulado actual en la batería virtual" },
} as const;

export interface SurplusView { title: string; columns: string[]; rows: { label: string; cells: string[] }[]; notes: string[]; balance: string | null }

export function hasSurplus(s: Pick<Snapshot, "supply">): boolean {
  return (surplusKwh(s.supply) ?? 0) > 0;
}

/** kWh realment compensats (comparatives antigues: es dedueixen de l'import aplicat). */
export function compensatedKwhOf(x: SurplusResult | null | undefined): number | null {
  if (!x) return null;
  if (x.compensatedKwh != null) return x.compensatedKwh;
  if (x.status !== "aplicada") return x.status === "no_compensa" ? 0 : null;
  return x.valueEur > 0 ? Math.floor((x.kwh * x.compensationEur) / x.valueEur) : 0;
}

/** Etiqueta del període de càlcul (anual o període facturat) per a «Cost final» i «Estalvi». */
export function periodWord(s: Pick<Snapshot, "supply">, lang: Lang = "ca"): string {
  const annual = s.supply.basis === "anual" || s.supply.basis === "anualitzat";
  return annual ? (lang === "es" ? "anual" : "anual") : lang === "es" ? `(${s.supply.days} días)` : `(${s.supply.days} dies)`;
}

/** Estalvi mensual equivalent a partir de l'estalvi del període (mateix motor, cap càlcul nou). */
export function monthlyOf(v: number | null | undefined, days: number): number | null {
  if (v == null || !(days > 0)) return null;
  return Math.round(((v * 365) / days / 12) * 100) / 100;
}

/**
 * Avisos d'excedents comuns a la pantalla i al PDF:
 *  - el client té excedents però falten els kWh → càlcul pendent (no s'inventen dades)
 *  - les ofertes descompten excedents però el contracte actual no té la compensació quantificada → estalvi no homogeni
 */
export function surplusWarnings(s: Pick<Snapshot, "supply" | "result" | "current"> & Partial<Pick<Snapshot, "offers">>, lang: Lang = "ca"): string[] {
  const out: string[] = [];
  if (s.supply.energyType === "gas" || !s.supply.surplus) return out;
  if (!hasSurplus(s)) {
    out.push(lang === "es" ? "El suministro tiene excedentes pero faltan los kWh vertidos: la compensación está pendiente y no se ha descontado en ninguna oferta." : "El subministrament té excedents però falten els kWh injectats: la compensació està pendent i no s'ha descomptat a cap oferta.");
    return out;
  }
  const cur = s.result.current;
  const curQuantified = !!cur?.surplus && (cur.surplus.status === "aplicada" || cur.surplus.status === "no_compensa");
  const altsComp = s.result.evaluations.some((e) => (e.cost.surplus?.compensationEur ?? 0) > 0);
  if (cur?.ok && !curQuantified && altsComp) {
    out.push(lang === "es"
      ? "La compensación del contrato actual no está cuantificada: el ahorro mostrado incluye la compensación de las ofertas pero no la actual. Indica el precio de excedentes actual o el importe compensado en la factura para comparar costes homogéneos."
      : "La compensació del contracte actual no està quantificada: l'estalvi mostrat inclou la compensació de les ofertes però no l'actual. Indica el preu d'excedents actual o l'import compensat a la factura per comparar costos homogenis.");
  }
  return out;
}

export function surplusView(s: Snapshot, lang: Lang = "ca"): SurplusView | null {
  if (!hasSurplus(s)) return null;
  const t = L[lang];
  const alts = presentationOrder(s);
  const cols: { name: string; c: CostResult | null; saving: number | null }[] = [
    { name: s.currentRetailer ?? (lang === "es" ? "Actual" : "Actual"), c: s.result.current, saving: null },
    ...alts.map((e) => ({ name: e.offer.supplierName, c: e.cost as CostResult | null, saving: e.saving })),
  ];
  const grid = s.supply.kwhTotal ?? s.supply.kwh.reduce<number>((a, x) => a + (x ?? 0), 0);
  const row = (label: string, f: (c: CostResult | null, i: number) => string) => ({ label, cells: cols.map((col, i) => f(col.c, i)) });
  const pw = periodWord(s, lang);
  const rows = [
    row(t.grid, () => nf(grid, 0, lang)),
    row(t.energy, (c) => (c?.ok ? eur(c.energy, lang) : "—")),
    row(t.power, (c) => (c?.ok ? eur(c.power, lang) : "—")),
    row(t.kwh, (c) => nf(c?.surplus?.kwh ?? null, 0, lang)),
    row(t.price, (c) => (!c?.surplus ? "—" : c.surplus.priceEurKwh != null ? `${nf(c.surplus.priceEurKwh, 6, lang)}${c.surplus.manual ? ` (${t.manual})` : ""}` : c.surplus.status === "no_informada" ? t.notInf : t.pending)),
    row(t.compKwh, (c) => (!c?.surplus ? "—" : c.surplus.status === "aplicada" || c.surplus.status === "no_compensa" ? nf(compensatedKwhOf(c.surplus), 0, lang) : c.surplus.status === "no_informada" ? t.notInf : t.pending)),
    row(t.comp, (c) => (!c?.surplus ? "—" : c.surplus.status === "aplicada" || c.surplus.status === "no_compensa" ? `−${eur(c.surplus.compensationEur, lang)}` : c.surplus.status === "no_informada" ? t.notInf : t.pending)),
    row(t.battery, (c) => {
      const x = c?.surplus;
      if (!x) return "—";
      if (x.toBatteryEur > 0 || x.batteryFeeEur > 0) return `${eur(x.toBatteryEur, lang)} ${t.toBattery}${x.batteryFeeEur ? ` · ${t.fee} ${eur(x.batteryFeeEur, lang)}` : ""}`;
      return x.lostEur > 0 ? `${eur(x.lostEur, lang)} ${t.lost}` : "—";
    }),
    row(`${t.net} ${pw}`, (c) => (c?.ok ? eur(c.total, lang) : "—")),
    row(`${t.saving} ${pw}`, (_c, i) => (i === 0 ? "" : cols[i].saving == null ? "—" : eur(cols[i].saving, lang))),
    row(t.monthly, (_c, i) => (i === 0 ? "" : eur(monthlyOf(cols[i].saving, s.supply.days), lang))),
  ];
  const notes = [...surplusWarnings(s, lang), ...new Set(cols.map((c) => c.c?.surplus?.note).filter((n): n is string => !!n))];
  const sur = s.supply.surplus;
  const balance = sur?.battery && sur.batteryBalanceEur != null ? `${t.balance}: ${eur(sur.batteryBalanceEur, lang)}` : null;
  return { title: t.title, columns: cols.map((c) => c.name), rows, notes, balance };
}
