/** Filtres i ordenació exclusivament locals sobre els resultats ja carregats. */
import type { Supply } from "./types";
import type { EnergyFilter, SipsSortField } from "./sips-engine";
import { annualActive } from "./parse";
import { gasTariffNumber } from "./gas-tariff";

export type ResultFilters = { text: string; energia: EnergyFilter; tarifa: string; min: number | null; max: number | null };
export type ResultSort = { sortBy: SipsSortField; sortDirection: "asc" | "desc" };
export const emptyResultFilters = (): ResultFilters => ({ text: "", energia: "totes", tarifa: "", min: null, max: null });
const text = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const tariff = (v: unknown) => {
  const n = gasTariffNumber(v);
  return n == null ? text(v).replace(/[.\s]/g, "") : `rl${n}`;
};
const gas = (s: Supply) => /gas/i.test(s.tipoEnergia ?? "") || gasTariffNumber(s.tarifaRaw) != null;

export function validateResultFilters(f: ResultFilters): string | null {
  if ([f.min, f.max].some(v => v != null && (!Number.isFinite(v) || v < 0))) return "El consum ha de ser positiu o zero.";
  if (f.min != null && f.max != null && f.min > f.max) return "El consum màxim no pot ser inferior al mínim.";
  return null;
}

export function filterSipsResults(rows: Supply[], f: ResultFilters, sort: ResultSort): Supply[] {
  const tokens = text(f.text).trim().split(/\s+/).filter(Boolean);
  const collator = new Intl.Collator("ca", { numeric: true, sensitivity: "base" });
  const value = (s: Supply): string | number | null => {
    switch (sort.sortBy) {
      case "consum": return annualActive(s).value;
      case "tarifa": return tariff(s.tarifa ?? s.tarifaRaw) || null;
      case "subministrament": return s.direccion;
      case "comercialitzadora": return s.comercializadora;
      case "lectura": return s.fUltLectura;
    }
  };
  return rows.filter(s => {
    if (f.energia === "gas" && !gas(s)) return false;
    if (f.energia === "luz" && gas(s)) return false;
    if (f.tarifa && tariff(f.tarifa) !== tariff(s.tarifa ?? s.tarifaRaw)) return false;
    const haystack = text([s.cups, s.direccion, s.localidad, s.cp, s.comercializadora].join(" "));
    if (!tokens.every(t => haystack.includes(t))) return false;
    const annual = annualActive(s).value;
    if (f.min != null && (annual == null || annual < f.min)) return false;
    if (f.max != null && (annual == null || annual > f.max)) return false;
    return true;
  }).sort((a, b) => {
    const x = value(a), y = value(b);
    // Dades absents sempre al final, també en ordre descendent.
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    const cmp = x == null || y == null ? 0 : typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y));
    return (sort.sortDirection === "desc" ? -cmp : cmp) || collator.compare(a.cups, b.cups);
  });
}
