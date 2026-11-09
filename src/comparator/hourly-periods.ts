/**
 * CONSUM PER PERÍODES A PARTIR DE LA CORBA HORÀRIA REAL (lògica pura).
 *
 * Aplica el calendari tarifari de la Circular CNMC 3/2020 (Península) a cada hora real de consum:
 *  · 2.0TD: dies laborables P1 10–14 h i 18–22 h, P2 8–10 h, 14–18 h i 22–24 h, P3 0–8 h; caps de setmana i festius
 *    nacionals, P3 les 24 hores.
 *  · 3.0TD i 6.xTD: P1–P6 per temporada i franja (calendari configurable d'`open-calendar.ts`).
 * El resultat és CALCULAT (procedència «Corba horària»): només reparteix kWh reals, no n'estima cap.
 */
import Decimal from "decimal.js-light";
import { normalizeTariff } from "./engine";
import { DEFAULT_CALENDAR, holidaySet, isFestiu, periodOf, SIX_PERIOD_TARIFFS, type CalendarConfig, type HourlyKwh } from "./open-calendar";

export interface HourlyPeriods { tariff: string; periods: number; kwh: number[]; total: number; from: string; to: string; hours: number; skipped: number; warnings: string[] }

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Període 2.0TD d'una hora local. */
export function period20(date: string, hour: number, hol: Set<string>): 1 | 2 | 3 {
  if (isFestiu({ date, weekday: weekday(date) }, hol)) return 3;
  if ((hour >= 10 && hour < 14) || (hour >= 18 && hour < 22)) return 1;
  if ((hour >= 8 && hour < 10) || (hour >= 14 && hour < 18) || hour >= 22) return 2;
  return 3;
}

export function periodsFromHourly(rows: HourlyKwh[], tariffRaw: string | null | undefined, cfg: CalendarConfig = DEFAULT_CALENDAR): HourlyPeriods | null {
  const tariff = normalizeTariff(tariffRaw) ?? "";
  const n = tariff === "2.0TD" ? 3 : SIX_PERIOD_TARIFFS.includes(tariff) ? 6 : 0;
  if (!n) return null;
  const valid = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isInteger(r.hour) && r.hour >= 0 && r.hour <= 23 && Number.isFinite(r.kwh) && r.kwh >= 0);
  if (!valid.length) return null;
  const dates = valid.map((r) => r.date).sort();
  const from = dates[0], to = dates[dates.length - 1];
  const hol = holidaySet(from, to, cfg);
  const acc = Array.from({ length: n }, () => new Decimal(0));
  for (const r of valid) {
    const p = n === 3 ? period20(r.date, r.hour, hol) : periodOf({ date: r.date, month: Number(r.date.slice(5, 7)), weekday: weekday(r.date), hour: r.hour, utc: 0 }, hol, cfg);
    acc[p - 1] = acc[p - 1].plus(r.kwh);
  }
  const kwh = acc.map((d) => Number(d.toDecimalPlaces(3).toString()));
  const total = Number(acc.reduce((a, d) => a.plus(d), new Decimal(0)).toDecimalPlaces(3).toString());
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  const warnings: string[] = [];
  if (valid.length < rows.length) warnings.push(`${rows.length - valid.length} hores amb dades no vàlides s'han descartat.`);
  if (days < 360) warnings.push(`La corba cobreix ${days} dies (${from} – ${to}): és el consum d'aquest període, no d'un any complet.`);
  return { tariff, periods: n, kwh, total, from, to, hours: valid.length, skipped: rows.length - valid.length, warnings };
}
