/** Consum EAS per intervals. No anualitza ni estima períodes absents. */
export type AnnualConsumption = {
  status: "complete" | "incomplete";
  revision?: number;
  from: string | null;
  to: string | null;
  lastAvailable: string | null;
  periods: (number | null)[];
  total: number | null;
  annualListTotal: number | null;
  difference: number | null;
  warning: string | null;
  source: string;
  /** El resum EAS pot repartir intervals entre mesos: no és una factura mensual. */
  basis?: "provider_summary" | "history";
  providerTotal?: number | null;
  monthlyTotal?: number | null;
};

/** Es conserva al raw JSONB existent, sense canviar l'esquema de Supabase. */
export const ANNUAL_CONSUMPTION_KEY = "SIPS · Consum anual per períodes v2";

export function electricityPeriodCount(tariff: unknown): 3 | 6 | null {
  const t = String(tariff ?? "").toUpperCase().replace(/\s/g, "");
  if (t === "2.0TD") return 3;
  if (/^(3\.0|6\.[1-4])TD$/.test(t)) return 6;
  return null;
}

/** JSON del proveïdor: el punt és decimal, també quan té exactament 3 decimals. */
function jsonNumber(value: unknown): number | null {
  if (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim())) value = Number(value);
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** POST /services/Core/PuntoSuministro/ResumenConsumosU12M (captura real d'EAS). */
export function annualFromEasSummary(raw: Record<string, unknown>, count: 3 | 6, listTotal: unknown): AnnualConsumption {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  const series = (key: string): (number | null)[] | null => {
    const a = raw[key];
    return Array.isArray(a) && a.length === 12 ? a.map(jsonNumber) : null;
  };
  const sum = (a: (number | null)[] | null) => a && a.every(v => v != null) ? a.reduce<number>((s, v) => s + v!, 0) : null;
  const monthlyTotal = sum(series("EActivaMes"));
  const periods = Array.from({ length: count }, (_, i) => {
    const value = sum(series(`EActivaMesP${i + 1}`));
    return value == null ? null : round(value);
  });
  const total = periods.every(v => v != null) ? round(periods.reduce<number>((s, v) => s + v!, 0)) : null;
  const year1 = jsonNumber(raw["Año1"]), year12 = jsonNumber(raw["Año12"]);
  const month1 = jsonNumber(raw.Mes1), month12 = jsonNumber(raw.Mes12);
  const validMonth = (y: number | null, m: number | null) => y != null && Number.isInteger(y) && y >= 1900 && y <= 9999 && m != null && Number.isInteger(m) && m >= 1 && m <= 12;
  const validDates = validMonth(year1, month1) && validMonth(year12, month12) && (year12! * 12 + month12!) - (year1! * 12 + month1!) === 11;
  const from = validDates ? `${year1}-${String(month1).padStart(2, "0")}-01` : null;
  const to = validDates ? new Date(Date.UTC(year12!, month12!, 0)).toISOString().slice(0, 10) : null;
  const providerTotal = jsonNumber(raw.EActiva);
  const annualListTotal = jsonNumber(listTotal);
  const issues: string[] = [];
  if (!validDates) issues.push("La finestra temporal del resum EAS no correspon a 12 mesos consecutius.");
  if (periods.some(v => v == null)) issues.push(`Falten dades mensuals de consum d'algun període P1–P${count}.`);
  // El total mensual (EActivaMes) només serveix de contrast: si falta però els P1–Pn i la finestra són complets, els
  // períodes són dades reals igualment (abans es descartaven tots per aquest motiu).
  const notes: string[] = [];
  if (monthlyTotal == null) notes.push("El resum EAS no inclou el total mensual: la suma per períodes no s'ha pogut contrastar amb EActivaMes.");
  if (total != null && monthlyTotal != null && Math.abs(total - monthlyTotal) > 1) issues.push("La suma P1–P6 no coincideix amb la suma mensual EAS.");
  if (total != null && providerTotal != null && Math.abs(total - providerTotal) > 1) issues.push("La suma per períodes no coincideix amb EActiva del resum EAS.");
  const difference = total != null && annualListTotal != null ? round(total - annualListTotal) : null;
  const warning = [...issues, ...notes, ...(difference != null && Math.abs(difference) > 1 ? ["E.A. Anual del llistat difereix del resum; poden ser finestres temporals diferents."] : [])].join(" ") || null;
  return { status: issues.length ? "incomplete" : "complete", from, to, lastAvailable: null, periods, total,
    annualListTotal, difference, warning, source: "EAS · ResumenConsumosU12M", basis: "provider_summary", providerTotal,
    monthlyTotal: monthlyTotal == null ? null : round(monthlyTotal) };
}

export function savedAnnualConsumption(raw: Record<string, unknown> | null | undefined): AnnualConsumption | null {
  const text = raw?.[ANNUAL_CONSUMPTION_KEY];
  if (typeof text !== "string") return null;
  try {
    const r = JSON.parse(text) as AnnualConsumption;
    if (!["complete", "incomplete"].includes(r.status) || !Array.isArray(r.periods) || ![3, 6].includes(r.periods.length) ||
      !r.periods.every(v => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0))) return null;
    return r;
  } catch { return null; }
}

/** Només un desglossament complet i coherent es pot traspassar com a dada real. */
export function comparatorConsumption(reading: AnnualConsumption | null | undefined, tariff: unknown) {
  const count = electricityPeriodCount(tariff);
  if (!count || reading?.status !== "complete" || reading.periods.length !== count || !reading.from || !reading.to ||
    reading.total == null || !reading.periods.every(v => v != null && Number.isFinite(v))) return null;
  return { kwh: Array.from({ length: 6 }, (_, i) => i < count ? reading.periods[i] : null),
    kwhTotal: reading.total, periodFrom: reading.from, periodTo: reading.to,
    days: Math.round((Date.parse(reading.to) - Date.parse(reading.from)) / 86400000) + 1 };
}

/** Les dades que arriben en segon pla no substitueixen una factura o una edició manual. */
export function canAutofillConsumption(values: unknown[], source: string | null | undefined): boolean {
  if (/^(manual|factura|corba)/i.test(source ?? "")) return false;
  return values.every(v => v == null || v === "") || /^(sips|crm|calculat)$/i.test(source ?? "");
}

type Rec = { start: string; end: string; values: (number | null)[]; signature: string };
const DAY = 86400000;
const utc = (s: string): number => Date.parse(`${s}T00:00:00Z`);
const iso = (n: number): string => new Date(n).toISOString().slice(0, 10);
const monthEnd = (n: number) => new Date(Date.UTC(new Date(n).getUTCFullYear(), new Date(n).getUTCMonth() + 1, 0)).getTime();
const yearBefore = (endExclusive: number) => {
  const d = new Date(endExclusive), y = d.getUTCFullYear() - 1, m = d.getUTCMonth();
  return Date.UTC(y, m, Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
};

/** 1.958,168 -> 1958.168; 1,958.168 -> 1958.168; blanks are null. */
export function easNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  let s = value.trim().replace(/\s|\u00a0/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const comma = s.lastIndexOf(","), dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) s = comma > dot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (comma >= 0) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function norm(k: string) { return k.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function get(r: Record<string, unknown>, aliases: string[]): unknown {
  const pairs = Object.entries(r);
  const wanted = new Set(aliases.map(norm));
  return pairs.find(([k]) => wanted.has(norm(k)))?.[1];
}
function dateValue(x: unknown): string | null {
  if (x == null) return null;
  const s = String(x).trim();
  let isoDate: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) isoDate = s.slice(0, 10);
  else { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s); if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`; }
  return isoDate && Number.isFinite(utc(isoDate)) && iso(utc(isoDate)) === isoDate ? isoDate : null;
}
const startKeys = ["FechaInicio", "FechaInicioConsumo", "FInicio", "FechaDesde", "Desde", "FechaInicial", "Inicio"];
const endKeys = ["FechaFin", "FechaFinConsumo", "FFin", "FechaHasta", "Hasta", "FechaFinal", "Fin"];

/** Fields in 'Consumo Punto Suministro' are kWh, not reactive energy or power. */
function readRecord(o: Record<string, unknown>, count: number): Rec | null {
  const start = dateValue(get(o, startKeys)), end = dateValue(get(o, endKeys));
  if (!start || !end || utc(end) < utc(start)) return null;
  const values = Array.from({ length: count }, (_, i) => {
    const p = i + 1;
    return jsonNumber(get(o, [`E.A. P${p} (kWh)`, `EAP${p}`, `EActivaP${p}`, `EnergiaActivaP${p}`, `ConsumoEnergiaActivaP${p}`, `ConsumoEnergiaActivaEnKWhP${p}`]));
  });
  return { start, end, values, signature: `${start}|${end}|${values.join("|")}` };
}

/** Últim tram de dotze mesos cobert íntegrament; també admet lectures a mig mes. */
export function annualFromEasHistory(history: Record<string, unknown>[], count: 3 | 6, annualList: unknown): AnnualConsumption {
  const annualListTotal = easNumber(annualList);
  const dedup = new Map<string, Rec>();
  for (const h of history) { const r = readRecord(h, count); if (r) dedup.set(r.signature, r); }
  const records = [...dedup.values()].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const lastAvailable = records.length ? records.map(r => r.end).sort().at(-1)! : null;
  const empty = (warning: string): AnnualConsumption => ({ status: "incomplete", from: null, to: null, lastAvailable, periods: Array(count).fill(null), total: null, annualListTotal, difference: null, warning, source: "EAS · Consumo Punto Suministro", basis: "history", revision: 3 });
  if (!records.length) return empty("No hi ha registres de consum per períodes a la resposta d'EAS.");
  const latestMonth = monthEnd(utc(lastAvailable!));
  const candidates = new Set(records.flatMap(r => [utc(r.end), utc(r.end) - DAY]));
  for (let month = latestMonth, i = 0; i < 36; i++) {
    candidates.add(month);
    const d = new Date(month); month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0);
  }
  for (const candidate of [...candidates].sort((a, b) => b - a)) {
    // EAS pot expressar el final com a dia inclòs o com a lectura límit exclusiva.
    // Només acceptem cobertura exacta, sense prorratejar cap interval.
    for (const exclusive of [false, true]) {
    const begin = yearBefore(candidate + DAY);
    const inWindow = records.filter(r => utc(r.start) >= begin && utc(r.end) <= candidate + (exclusive ? DAY : 0) && utc(r.end) > utc(r.start) - (exclusive ? 0 : 1));
    if (inWindow.length) {
      let next = begin;
      let valid = true;
      const sums = Array(count).fill(0) as number[];
      for (const r of inWindow) {
        const a = utc(r.start), b = utc(r.end);
        if (a !== next || r.values.some(v => v == null)) { valid = false; break; }
        r.values.forEach((v, i) => { sums[i] += v!; });
        next = b + (exclusive ? 0 : DAY);
      }
      if (valid && next === candidate + DAY) {
        const periods = sums.map(v => Math.round(v * 1000) / 1000);
        const total = Math.round(sums.reduce((a, b) => a + b, 0) * 1000) / 1000;
        const difference = annualListTotal == null ? null : Math.round((total - annualListTotal) * 1000) / 1000;
        const warning = difference != null && Math.abs(difference) > 1 ? "El resum E.A. Anual difereix del tram calculat; poden ser finestres temporals diferents." : null;
        return { status: "complete", from: iso(begin), to: iso(candidate), lastAvailable, periods, total, annualListTotal, difference, warning, source: "EAS · Consumo Punto Suministro", basis: "history", revision: 3 };
      }
    }
    }
  }
  return empty("Històric incomplet: no hi ha 12 mesos consecutius amb cobertura íntegra i sense solapaments.");
}

/** Migra una vegada el resum antic; reintenta els incomplets cada 15 minuts. */
export function needsConsumptionRefresh(entry: { status: string; energy_type?: string | null; tariff?: string | null; consulted_at?: string | null; annual_consumption?: AnnualConsumption | null } | null | undefined, now = Date.now()): boolean {
  if (!entry || entry.status !== "found") return true;
  if (entry.energy_type === "gas" || /^RL/i.test(entry.tariff ?? "")) return false;
  const r = entry.annual_consumption;
  if (!r || r.revision !== 3) return true;
  return !comparatorConsumption(r, entry.tariff) && (!entry.consulted_at || !Number.isFinite(Date.parse(entry.consulted_at)) || now - Date.parse(entry.consulted_at) >= 15 * 60_000);
}
