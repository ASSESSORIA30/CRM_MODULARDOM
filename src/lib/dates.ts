// Dates: es guarden en UTC (timestamptz) i es mostren/introdueixen en hora de Madrid.

export const TZ = "Europe/Madrid";

function partsInTz(date: Date, timeZone = TZ) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

/** Diferència (minuts) entre l'hora local de Madrid i UTC en un instant donat. */
function offsetMinutes(date: Date): number {
  const p = partsInTz(date);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * "2026-11-07T10:30" (hora de Madrid, d'un <input type="datetime-local">) → Date UTC.
 * Gestiona els canvis d'hora d'estiu/hivern.
 */
export function madridLocalToDate(local: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) throw new Error("Data no vàlida");
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  let result = new Date(guess - offsetMinutes(new Date(guess)) * 60000);
  // segona iteració per als instants propers al canvi d'hora
  result = new Date(guess - offsetMinutes(result) * 60000);
  return result;
}

/** Date → "2026-11-07T10:30" en hora de Madrid (per omplir inputs). */
export function toMadridInput(date: Date | string): string {
  const p = partsInTz(new Date(date));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Data de Madrid (YYYY-MM-DD) d'un instant. */
export function madridDateKey(date: Date | string = new Date()): string {
  return toMadridInput(date).slice(0, 10);
}

/** Suma dies a una clau YYYY-MM-DD (aritmètica de calendari, sense hores). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Dia de la setmana (1 = dilluns … 7 = diumenge) d'una clau YYYY-MM-DD. */
export function isoWeekday(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function startOfWeek(key: string): string {
  return addDays(key, 1 - isoWeekday(key));
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function addMonths(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, 1));
  return dt.toISOString().slice(0, 10);
}

export function isValidDateKey(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

const localeTag = (l: "ca" | "es") => (l === "es" ? "es-ES" : "ca-ES");

export function formatDate(value: Date | string | null | undefined, locale: "ca" | "es" = "ca"): string {
  if (!value) return "—";
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat(localeTag(locale), { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatDateTime(value: Date | string | null | undefined, locale: "ca" | "es" = "ca"): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(localeTag(locale), {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

export function formatTime(value: Date | string, locale: "ca" | "es" = "ca"): string {
  return new Intl.DateTimeFormat(localeTag(locale), { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function formatDayHeader(key: string, locale: "ca" | "es" = "ca"): string {
  return new Intl.DateTimeFormat(localeTag(locale), { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${key}T12:00:00Z`));
}

export function formatMonthTitle(key: string, locale: "ca" | "es" = "ca"): string {
  return new Intl.DateTimeFormat(localeTag(locale), { timeZone: "UTC", month: "long", year: "numeric" })
    .format(new Date(`${key}T12:00:00Z`));
}

/** Instant (ISO) desplaçat N dies respecte d'ara. Per a consultes al servidor. */
export function isoFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString();
}
