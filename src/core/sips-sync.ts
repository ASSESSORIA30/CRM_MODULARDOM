/**
 * SINCRONITZACIÓ AUTOMÀTICA SIPS (lògica pura, sense base de dades ni xarxa).
 *  - Inventari: tots els CUPS del CRM (subministraments, contractes, renovacions, oportunitats, leads i cartera) agrupats
 *    per la base de 20 caràcters (amb o sense «0F»), amb motiu, prioritat i incidències de qualitat (un CUPS a més d'un client).
 *  - Cua: quan toca consultar cada CUPS (freqüències configurables), reintents amb retard exponencial i classificació d'errors.
 *  - Instantànies: dades normalitzades (tarifa de gas 3.x → RLx conservant l'original, potències aplicables, consum anual
 *    complet o parcial, validació total = suma P1–Pn) per detectar canvis sense falsos positius d'arrodoniment.
 *  - Oportunitats: indicis (no recomanacions) amb clau de deduplicació.
 * La consulta real al proveïdor és a src/server/sips.ts (motor existent); aquí no es fa cap petició.
 */
import { normalizedCups, isValidCups } from "./sips";
import { gasTariffNumber } from "@/energy/lib/gas-tariff";
import { comparatorConsumption, electricityPeriodCount, type AnnualConsumption } from "@/energy/lib/sips-consumption";

/* ======================================================================= configuració */

export const SYNC_REASONS = ["manual", "nou", "renovacio", "oportunitat", "actiu", "historic"] as const;
export type SyncReason = (typeof SYNC_REASONS)[number];
export const REASON_LABEL: Record<SyncReason, string> = { manual: "Actualització manual", nou: "CUPS nou", renovacio: "Renovació pròxima", oportunitat: "Oportunitat activa", actiu: "Contracte actiu", historic: "Registre històric" };
/** Prioritat: 1 = més urgent. */
export const REASON_PRIORITY: Record<SyncReason, number> = { manual: 1, nou: 2, renovacio: 3, oportunitat: 4, actiu: 5, historic: 6 };

export const JOB_STATES = ["pendent", "en_proces", "actualitzat", "sense_dades", "error_temporal", "error_permanent", "bloquejat_permisos"] as const;
export type JobState = (typeof JOB_STATES)[number];
export const JOB_STATE_LABEL: Record<JobState, string> = { pendent: "Pendent", en_proces: "En procés", actualitzat: "Actualitzat", sense_dades: "Sense dades", error_temporal: "Error temporal", error_permanent: "Error permanent", bloquejat_permisos: "Bloquejat per permisos" };

export interface SyncSettings {
  /** Sincronització programada activada (només amb l'autorització del proveïdor registrada). */
  enabled: boolean;
  paused: boolean;
  /** Dies entre consultes per motiu (0 = tan aviat com sigui possible). */
  frequencies: Record<Exclude<SyncReason, "manual">, number>;
  /** Dies abans de la data de fi d'un contracte per considerar-lo «renovació pròxima». */
  renewalWindowDays: number;
  includeHistoric: boolean;
  /** CUPS màxims per execució, concurrència i peticions per minut al proveïdor. */
  maxPerRun: number;
  concurrency: number;
  perMinute: number;
  maxAttempts: number;
  /** Retard base dels reintents (minuts); es duplica a cada intent fins a `maxBackoffHours`. */
  backoffMinutes: number;
  maxBackoffHours: number;
  /** Finestra horària (hora d'Espanya) de l'execució programada. */
  windowStartHour: number;
  windowEndHour: number;
  /** Llindars de detecció. */
  consumptionChangePct: number;
  minConsumptionChangeKwh: number;
  powerToleranceKw: number;
  /** Màxim demandat / contractat per sota del qual hi ha indici de sobredimensionament (p. ex. 0,6 = 60 %). */
  oversizeRatio: number;
  /** Mesos de màxims demandats necessaris per avaluar la potència. */
  oversizeMinMonths: number;
  errorRateAlertPct: number;
  staleAlertHours: number;
  /** Instantànies que es conserven per CUPS (control del volum d'històric). */
  historyPerCups: number;
}

export const DEFAULT_SETTINGS: SyncSettings = {
  enabled: false, paused: false,
  frequencies: { nou: 0, renovacio: 3, oportunitat: 7, actiu: 7, historic: 30 },
  renewalWindowDays: 60, includeHistoric: true,
  maxPerRun: 40, concurrency: 2, perMinute: 20, maxAttempts: 6, backoffMinutes: 60, maxBackoffHours: 168,
  windowStartHour: 2, windowEndHour: 7,
  consumptionChangePct: 25, minConsumptionChangeKwh: 500, powerToleranceKw: 0.01, oversizeRatio: 0.6, oversizeMinMonths: 6,
  errorRateAlertPct: 30, staleAlertHours: 48, historyPerCups: 24,
};

const clamp = (v: unknown, d: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
/** Combina la configuració desada amb els valors per defecte i els límits segurs. */
export function resolveSettings(raw: Partial<SyncSettings> | null | undefined): SyncSettings {
  const r = raw ?? {};
  const d = DEFAULT_SETTINGS;
  const f = (r.frequencies ?? {}) as Partial<SyncSettings["frequencies"]>;
  return {
    enabled: r.enabled === true, paused: r.paused === true,
    frequencies: { nou: clamp(f.nou, d.frequencies.nou, 0, 30), renovacio: clamp(f.renovacio, d.frequencies.renovacio, 1, 90), oportunitat: clamp(f.oportunitat, d.frequencies.oportunitat, 1, 90), actiu: clamp(f.actiu, d.frequencies.actiu, 1, 180), historic: clamp(f.historic, d.frequencies.historic, 1, 365) },
    renewalWindowDays: clamp(r.renewalWindowDays, d.renewalWindowDays, 7, 180),
    includeHistoric: r.includeHistoric !== false,
    maxPerRun: clamp(r.maxPerRun, d.maxPerRun, 1, 500), concurrency: clamp(r.concurrency, d.concurrency, 1, 4), perMinute: clamp(r.perMinute, d.perMinute, 1, 120),
    maxAttempts: clamp(r.maxAttempts, d.maxAttempts, 1, 20), backoffMinutes: clamp(r.backoffMinutes, d.backoffMinutes, 1, 1440), maxBackoffHours: clamp(r.maxBackoffHours, d.maxBackoffHours, 1, 720),
    windowStartHour: clamp(r.windowStartHour, d.windowStartHour, 0, 23), windowEndHour: clamp(r.windowEndHour, d.windowEndHour, 1, 24),
    consumptionChangePct: clamp(r.consumptionChangePct, d.consumptionChangePct, 1, 500), minConsumptionChangeKwh: clamp(r.minConsumptionChangeKwh, d.minConsumptionChangeKwh, 0, 1e7),
    powerToleranceKw: clamp(r.powerToleranceKw, d.powerToleranceKw, 0, 10), oversizeRatio: clamp(r.oversizeRatio, d.oversizeRatio, 0.1, 0.95), oversizeMinMonths: clamp(r.oversizeMinMonths, d.oversizeMinMonths, 1, 12),
    errorRateAlertPct: clamp(r.errorRateAlertPct, d.errorRateAlertPct, 1, 100), staleAlertHours: clamp(r.staleAlertHours, d.staleAlertHours, 6, 720), historyPerCups: clamp(r.historyPerCups, d.historyPerCups, 2, 120),
  };
}

/** Hora (0–23) a Espanya peninsular, amb canvi d'horari d'estiu inclòs. */
export function madridHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(d)) % 24;
}
/** Data local (AAAA-MM-DD) a Espanya: serveix de clau diària per a avisos sense duplicats. */
export function madridDay(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** L'execució programada és dins de la finestra nocturna? (tolera crons que no comencen exactament a l'hora) */
export function inWindow(d: Date, s: Pick<SyncSettings, "windowStartHour" | "windowEndHour">): boolean {
  const h = madridHour(d);
  return s.windowStartHour <= s.windowEndHour ? h >= s.windowStartHour && h < s.windowEndHour : h >= s.windowStartHour || h < s.windowEndHour;
}

/* ======================================================================= CUPS */

/** Clau de deduplicació (20 caràcters) i variant original. Un CUPS amb i sense «0F» és el mateix punt. */
export function cupsKey(raw: string | null | undefined): { key: string; full: string } | null {
  const full = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^ES\d{16}[A-Z]{2}([0-9][A-Z])?$/.test(full)) return null;
  const key = normalizedCups(full);
  return isValidCups(key) ? { key, full } : null;
}

/* ======================================================================= inventari */

export type SourceKind = "subministrament" | "contracte" | "oportunitat" | "lead" | "cartera";
export interface InventoryRecord {
  source: SourceKind;
  id: string;
  cups: string | null;
  /** Identitat del client: id del CRM o, per a la cartera/leads, NIF normalitzat (o nom si no n'hi ha). */
  clientKey: string | null;
  clientName: string | null;
  clientId?: string | null;
  supplyId?: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  retailer?: string | null;
  tariff?: string | null;
  energy?: "luz" | "gas" | null;
  /** Contractes: estat i data de fi; oportunitats/leads: actiu o no. */
  status?: string | null;
  endDate?: string | null;
  active?: boolean;
}
export interface InventoryItem {
  cups20: string;
  /** Variants originals vistes (amb i sense sufix). La de 22 serveix de segon intent. */
  variants: string[];
  reason: Exclude<SyncReason, "manual">;
  priority: number;
  sources: Record<SourceKind, number>;
  clientIds: string[];
  clientNames: string[];
  ownerIds: string[];
  ownerNames: string[];
  retailers: string[];
  tariff: string | null;
  energy: "luz" | "gas" | null;
  renewalDate: string | null;
  /** Incidència de qualitat: el mateix CUPS apareix a més d'un client (no es fusiona res). */
  multiClient: boolean;
  refs: { source: SourceKind; id: string }[];
}

const ACTIVE_CONTRACT = new Set(["actiu", "renovacio_pendent", "enviat_comercialitzadora", "en_tramitacio", "pendent_signatura", "pendent_documentacio"]);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const normTaxId = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
const normName = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\b(S\.?L\.?U?|S\.?A\.?U?|SLU|SAU)\b/g, "").replace(/[^A-Z0-9]+/g, " ").trim() || null;

/**
 * Agrupa tots els registres per CUPS (base 20) i decideix motiu i prioritat:
 * renovació pròxima > oportunitat activa > contracte actiu > històric. Els CUPS sense cap registre vigent són «històric».
 */
export function buildInventory(records: InventoryRecord[], s: Pick<SyncSettings, "renewalWindowDays" | "includeHistoric">, today: string): InventoryItem[] {
  const map = new Map<string, InventoryItem & { _clients: Map<string, string>; _rank: number }>();
  for (const r of records) {
    const k = cupsKey(r.cups);
    if (!k) continue;
    let it = map.get(k.key);
    if (!it) {
      it = { cups20: k.key, variants: [], reason: "historic", priority: REASON_PRIORITY.historic, sources: { subministrament: 0, contracte: 0, oportunitat: 0, lead: 0, cartera: 0 }, clientIds: [], clientNames: [], ownerIds: [], ownerNames: [], retailers: [], tariff: null, energy: null, renewalDate: null, multiClient: false, refs: [], _clients: new Map(), _rank: 9 };
      map.set(k.key, it);
    }
    if (!it.variants.includes(k.full)) it.variants.push(k.full);
    it.sources[r.source]++;
    it.refs.push({ source: r.source, id: r.id });
    if (r.clientId && !it.clientIds.includes(r.clientId)) it.clientIds.push(r.clientId);
    if (r.clientName && !it.clientNames.includes(r.clientName)) it.clientNames.push(r.clientName);
    if (r.ownerId && !it.ownerIds.includes(r.ownerId)) it.ownerIds.push(r.ownerId);
    if (r.ownerName && !it.ownerNames.includes(r.ownerName)) it.ownerNames.push(r.ownerName);
    if (r.retailer && !it.retailers.includes(r.retailer)) it.retailers.push(r.retailer);
    if (r.tariff && !it.tariff) it.tariff = r.tariff;
    if (r.energy && !it.energy) it.energy = r.energy;
    // identitat de client per detectar el mateix CUPS en clients diferents (id del CRM, NIF o nom)
    const ident = r.clientKey ?? normName(r.clientName);
    if (ident) it._clients.set(ident, r.clientName ?? ident);

    let rank = 9;
    if (r.source === "contracte" || r.source === "cartera") {
      const active = r.source === "cartera" ? r.active !== false : ACTIVE_CONTRACT.has(r.status ?? "");
      if (active && r.endDate) {
        const d = daysBetween(today, r.endDate);
        if (d >= -15 && d <= s.renewalWindowDays) { rank = 3; if (!it.renewalDate || r.endDate < it.renewalDate) it.renewalDate = r.endDate; }
        else if (d > s.renewalWindowDays) rank = 5;
      } else if (active) rank = 5;
      if (r.status === "renovacio_pendent") { rank = 3; if (r.endDate && (!it.renewalDate || r.endDate < it.renewalDate)) it.renewalDate = r.endDate; }
    } else if (r.source === "oportunitat" || r.source === "lead") rank = r.active === false ? 9 : 4;
    else if (r.source === "subministrament") rank = r.active === false ? 9 : 6.5; // punt del CRM sense contracte vigent
    if (rank < it._rank) it._rank = rank;
  }
  const out: InventoryItem[] = [];
  for (const it of map.values()) {
    const { _clients, _rank, ...rest } = it;
    // dues identitats que en realitat són el mateix client (id del CRM i el seu NIF/nom) no compten com a duplicat:
    // només hi ha incidència si hi ha 2+ identitats del mateix tipus (2 ids, 2 NIF o 2 noms diferents)
    const ids = [..._clients.keys()];
    const uuids = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)), taxes = ids.filter((x) => /^[A-Z]\d|^\d{8}[A-Z]$|^[XYZ]\d/.test(x) && !/\s/.test(x)), names = ids.filter((x) => !uuids.includes(x) && !taxes.includes(x));
    rest.multiClient = uuids.length > 1 || taxes.length > 1 || (uuids.length + taxes.length === 0 && names.length > 1);
    rest.reason = _rank <= 3 ? "renovacio" : _rank <= 4 ? "oportunitat" : _rank <= 5 ? "actiu" : "historic";
    if (rest.reason === "historic" && !s.includeHistoric && !rest.sources.subministrament) continue;
    rest.priority = REASON_PRIORITY[rest.reason];
    rest.variants.sort((a, b) => b.length - a.length);
    out.push(rest);
  }
  return out.sort((a, b) => a.priority - b.priority || a.cups20.localeCompare(b.cups20));
}

/* ======================================================================= cua */

/** Pròxima consulta segons el motiu (des de l'últim èxit). «nou» = ara. */
export function nextDue(reason: SyncReason, s: Pick<SyncSettings, "frequencies">, from: Date): Date {
  if (reason === "manual") return from;
  return new Date(from.getTime() + s.frequencies[reason] * 86_400_000);
}

export type ErrorCode = "timeout" | "limit" | "no_disponible" | "credencials" | "sense_permisos" | "cups_invalid" | "not_found" | "incomplet" | "transformacio" | "base_dades" | "no_configurat" | "consulta";
export interface ErrorOutcome {
  state: JobState;
  code: ErrorCode;
  /** Atura tota l'execució (credencials o límit del proveïdor): no té sentit continuar consultant. */
  stopRun: boolean;
  retryAt: Date | null;
}
/**
 * Comportament davant de cada error del proveïdor (taula de la Fase 10).
 * Timeout / 5xx: reintent amb retard exponencial. 429: respecta Retry-After i atura l'execució.
 * 401/403 i credencials: atura i avisa (no es repeteixen les credencials). CUPS invàlid: error permanent.
 */
export function classifyError(e: { status?: number; code?: string; retryAfterSec?: number | null } | null, attempts: number, s: Pick<SyncSettings, "backoffMinutes" | "maxBackoffHours" | "maxAttempts">, now: Date): ErrorOutcome {
  const status = e?.status ?? 0;
  const code = e?.code ?? "";
  const backoff = () => new Date(now.getTime() + Math.min(s.backoffMinutes * 2 ** Math.max(0, attempts - 1), s.maxBackoffHours * 60) * 60_000);
  const temp = (c: ErrorCode): ErrorOutcome => attempts >= s.maxAttempts ? { state: "error_permanent", code: c, stopRun: false, retryAt: null } : { state: "error_temporal", code: c, stopRun: false, retryAt: backoff() };
  if (code === "credencials" || status === 401) return { state: "bloquejat_permisos", code: "credencials", stopRun: true, retryAt: null };
  if (status === 403 || code === "sense_permisos") return { state: "bloquejat_permisos", code: "sense_permisos", stopRun: true, retryAt: null };
  if (code === "no_configurat" || status === 503 && code === "no_configurat") return { state: "bloquejat_permisos", code: "no_configurat", stopRun: true, retryAt: null };
  if (status === 429 || code === "limit") {
    const wait = Math.max(60, Math.min(e?.retryAfterSec ?? 15 * 60, 24 * 3600));
    return { state: "error_temporal", code: "limit", stopRun: true, retryAt: new Date(now.getTime() + wait * 1000) };
  }
  if (status === 400 || code === "cups_invalid") return { state: "error_permanent", code: "cups_invalid", stopRun: false, retryAt: null };
  if (code === "transformacio") return temp("transformacio");
  if (status === 504 || code === "timeout" || /timeout|temps esgotat/i.test(code)) return temp("timeout");
  if (code === "base_dades") return temp("base_dades");
  if (status >= 500 || code === "no_disponible") return temp("no_disponible");
  return temp("consulta");
}

/** Repartiment del ritme: mil·lisegons mínims entre l'inici de dues consultes. */
export const spacingMs = (perMinute: number) => Math.ceil(60_000 / Math.max(1, perMinute));
/** Consultes estimades al proveïdor per CUPS: llistat + resum de consums + històric (llum). */
export const REQUESTS_PER_CUPS = 3;

/* ======================================================================= instantànies */

export interface CacheLike {
  cups: string;
  returned_cups?: string | null;
  status: "found" | "not_found" | "error";
  consulted_at: string;
  energy_type?: "luz" | "gas" | null;
  tariff?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  distributor?: string | null;
  retailer?: string | null;
  annual_kwh?: number | null;
  contracted_power_kw?: (number | null)[] | null;
  monthly_kwh?: (number | null)[] | null;
  monthly_max_kw?: (number | null)[] | null;
  max_power_year_kw?: number | null;
  last_reading_date?: string | null;
  source?: string | null;
  source_detail?: string | null;
  raw?: Record<string, unknown> | null;
  annual_consumption?: AnnualConsumption | null;
}

export interface Snapshot {
  cups20: string;
  consultedAt: string;
  energy: "luz" | "gas" | null;
  /** Tarifa normalitzada (gas 3.x → RLx) i la rebuda del proveïdor */
  tariff: string | null;
  tariffOriginal: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  distributor: string | null;
  /** Potències contractades només dels períodes aplicables (2.0TD: 2; 3.0TD/6.xTD: 6) */
  powerKw: (number | null)[];
  /** Màxims demandats per mes (separats de les contractades) */
  maxDemandKw: (number | null)[];
  maxDemandMonths: number;
  annualKwh: number | null;
  periodKwh: (number | null)[] | null;
  consumptionFrom: string | null;
  consumptionTo: string | null;
  /** completa = 12 mesos consecutius validats; parcial = n mesos; sense = no n'hi ha */
  consumptionStatus: "completa" | "parcial" | "sense";
  monthsAvailable: number;
  /** La suma P1–Pn quadra amb el total (tolerància d'arrodoniment) */
  totalMatches: boolean | null;
  /** Excedents: el SIPS d'EAS no els informa; es deixa explícit en lloc d'inventar-los */
  surplusKwh: number | null;
  surplusNote: string;
  source: string;
  warnings: string[];
}

/** Gas: 3.1 → RL1 … 3.4 → RL4 (i RL.n → RLn). L'electricitat (3.0TD, 6.1TD…) no es toca mai. */
export function normalizeTariff(tariff: string | null | undefined, energy: "luz" | "gas" | null | undefined): { tariff: string | null; original: string | null } {
  const original = tariff == null || String(tariff).trim() === "" ? null : String(tariff).trim();
  if (!original) return { tariff: null, original: null };
  const compact = original.toUpperCase().replace(/\s/g, "");
  if (/TD$/.test(compact)) return { tariff: compact, original };
  const isGas = energy === "gas" || /^RL/.test(compact);
  const n = isGas ? gasTariffNumber(compact) : null;
  return { tariff: n != null ? `RL${n}` : compact, original };
}

/** Períodes de potència aplicables segons la tarifa elèctrica (gas: cap). */
export function powerPeriods(tariff: string | null): number {
  const t = (tariff ?? "").toUpperCase();
  if (t === "2.0TD") return 2;
  if (/^(3\.0|6\.[1-4])TD$/.test(t)) return 6;
  return /^RL/.test(t) ? 0 : 6;
}

const roundTo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
export function snapshotFromCache(row: CacheLike): Snapshot {
  const warnings: string[] = [];
  const energy = row.energy_type ?? (/^RL/i.test(row.tariff ?? "") ? "gas" : null);
  const { tariff, original } = normalizeTariff(row.tariff, energy);
  const np = powerPeriods(tariff);
  const powerKw = Array.from({ length: np }, (_, i) => { const v = row.contracted_power_kw?.[i]; return v == null || !Number.isFinite(Number(v)) ? null : roundTo(Number(v), 3); });
  const maxDemandKw = (row.monthly_max_kw ?? []).slice(0, 12).map((v) => (v == null || !Number.isFinite(Number(v)) ? null : roundTo(Number(v), 3)));
  const maxDemandMonths = maxDemandKw.filter((v) => v != null).length;
  const monthsAvailable = (row.monthly_kwh ?? []).filter((v) => v != null).length;
  let periodKwh: (number | null)[] | null = null, from: string | null = null, to: string | null = null, totalMatches: boolean | null = null;
  let annual = row.annual_kwh ?? null;
  let status: Snapshot["consumptionStatus"] = annual == null ? "sense" : monthsAvailable >= 12 || energy === "gas" ? "completa" : monthsAvailable > 0 ? "parcial" : "completa";
  const detail = energy !== "gas" ? comparatorConsumption(row.annual_consumption ?? null, tariff) : null;
  if (detail) {
    const n = electricityPeriodCount(tariff) ?? 6;
    periodKwh = detail.kwh.slice(0, n);
    from = detail.periodFrom; to = detail.periodTo;
    const sum = periodKwh.reduce<number>((a, v) => a + (v ?? 0), 0);
    totalMatches = Math.abs(sum - detail.kwhTotal) <= 1;
    annual = detail.kwhTotal;
    status = "completa";
    if (!totalMatches) warnings.push("La suma P1–Pn no quadra amb el total anual.");
  } else if (energy !== "gas" && row.annual_consumption) {
    const ac = row.annual_consumption;
    if (ac.status === "incomplete") { warnings.push(ac.warning ?? "Consum per períodes incomplet."); if (annual != null && monthsAvailable < 12) status = "parcial"; }
    from = ac.from; to = ac.to;
  }
  if (status === "parcial") warnings.push(`Dades parcials: ${monthsAvailable} mesos disponibles (no s'anualitzen).`);
  return {
    cups20: row.cups, consultedAt: row.consulted_at, energy, tariff, tariffOriginal: original,
    address: row.address ?? null, postalCode: row.postal_code ?? null, city: row.city ?? null, distributor: row.distributor ?? null,
    powerKw, maxDemandKw, maxDemandMonths, annualKwh: annual == null ? null : roundTo(annual, 3), periodKwh, consumptionFrom: from, consumptionTo: to,
    consumptionStatus: status, monthsAvailable, totalMatches, surplusKwh: null, surplusNote: "El proveïdor SIPS no informa d'energia excedentària: no es calcula ni s'inventa.",
    source: row.source_detail ?? row.source ?? "SIPS", warnings,
  };
}

/** Empremta d'una instantània: dues consultes amb les mateixes dades no generen una entrada nova a l'històric. */
export function snapshotHash(s: Snapshot): string {
  const pick = [s.energy, s.tariff, s.powerKw, s.maxDemandKw, s.annualKwh, s.periodKwh, s.consumptionFrom, s.consumptionTo, s.consumptionStatus, s.address, s.distributor];
  const str = JSON.stringify(pick);
  let h1 = 0x811c9dc5, h2 = 0;
  for (let i = 0; i < str.length; i++) { h1 = Math.imul(h1 ^ str.charCodeAt(i), 16777619); h2 = (h2 * 31 + str.charCodeAt(i)) | 0; }
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

/* ======================================================================= detecció de canvis */

export type ChangeKind = "potencia" | "tarifa" | "consum_augment" | "consum_reduccio" | "dades_noves" | "incoherent";
export const CHANGE_LABEL: Record<ChangeKind, string> = { potencia: "Canvi de potència contractada", tarifa: "Canvi de tarifa d'accés", consum_augment: "Augment important del consum", consum_reduccio: "Reducció important del consum", dades_noves: "Dades noves disponibles", incoherent: "Canvi potencialment incoherent" };
export interface ChangeEvent { kind: ChangeKind; field: string; oldValue: unknown; newValue: unknown; magnitude: number | null; note: string }

/**
 * Compara dues instantànies. No genera canvis per diferències d'arrodoniment i no qualifica un augment de consum
 * d'anomalia (pot ser estacionalitat o activitat real): només l'informa.
 */
export function detectChanges(prev: Snapshot | null, next: Snapshot, s: Pick<SyncSettings, "consumptionChangePct" | "minConsumptionChangeKwh" | "powerToleranceKw">): ChangeEvent[] {
  const out: ChangeEvent[] = [];
  if (!prev) return out;
  if (prev.tariff && next.tariff && prev.tariff !== next.tariff) out.push({ kind: "tarifa", field: "tariff", oldValue: prev.tariff, newValue: next.tariff, magnitude: null, note: `${prev.tariff} → ${next.tariff}` });
  const n = Math.max(prev.powerKw.length, next.powerKw.length);
  const changed: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = prev.powerKw[i], b = next.powerKw[i];
    if (a != null && b != null && Math.abs(a - b) > s.powerToleranceKw) changed.push(`P${i + 1}: ${a} → ${b} kW`);
  }
  if (changed.length) out.push({ kind: "potencia", field: "powerKw", oldValue: prev.powerKw, newValue: next.powerKw, magnitude: null, note: changed.join(" · ") });
  // consum: només es comparen anuals complets (no barrejar parcials ni finestres solapades idèntiques)
  if (prev.annualKwh != null && next.annualKwh != null && prev.consumptionStatus === "completa" && next.consumptionStatus === "completa" && !(prev.consumptionFrom && prev.consumptionFrom === next.consumptionFrom && prev.consumptionTo === next.consumptionTo && prev.annualKwh === next.annualKwh)) {
    const diff = next.annualKwh - prev.annualKwh;
    const pct = prev.annualKwh > 0 ? (diff / prev.annualKwh) * 100 : null;
    if (pct != null && Math.abs(pct) >= s.consumptionChangePct && Math.abs(diff) >= s.minConsumptionChangeKwh) {
      out.push({ kind: diff > 0 ? "consum_augment" : "consum_reduccio", field: "annualKwh", oldValue: prev.annualKwh, newValue: next.annualKwh, magnitude: roundTo(pct, 1), note: `${Math.round(prev.annualKwh)} → ${Math.round(next.annualKwh)} kWh (${pct > 0 ? "+" : ""}${roundTo(pct, 1)} %)${next.consumptionFrom ? ` · ${next.consumptionFrom} – ${next.consumptionTo}` : ""}. Pot respondre a estacionalitat o a canvis reals d'activitat.` });
    }
  }
  const newData: string[] = [];
  if (prev.periodKwh == null && next.periodKwh != null) newData.push("consum per períodes");
  if (prev.annualKwh == null && next.annualKwh != null) newData.push("consum anual");
  if (prev.maxDemandMonths === 0 && next.maxDemandMonths > 0) newData.push("potències màximes demandades");
  if (prev.powerKw.every((v) => v == null) && next.powerKw.some((v) => v != null)) newData.push("potències contractades");
  if (newData.length) out.push({ kind: "dades_noves", field: "data", oldValue: null, newValue: newData, magnitude: null, note: `Ara hi ha ${newData.join(", ")}.` });
  // incoherències: dades que no poden ser certes alhora
  const inc: string[] = [];
  if (prev.energy && next.energy && prev.energy !== next.energy) inc.push(`el tipus de subministrament ha passat de ${prev.energy} a ${next.energy}`);
  if (next.totalMatches === false) inc.push("la suma P1–Pn no quadra amb el total anual");
  if (next.tariff === "2.0TD" && next.powerKw.some((v) => v != null && v > 15)) inc.push("tarifa 2.0TD amb potència superior a 15 kW");
  if (next.tariff && /^(3\.0|6\.)/.test(next.tariff) && next.powerKw.some((v) => v != null && v <= 15) && next.powerKw.every((v) => v == null || v <= 15)) inc.push(`tarifa ${next.tariff} amb totes les potències ≤ 15 kW`);
  if (inc.length) out.push({ kind: "incoherent", field: "data", oldValue: null, newValue: inc, magnitude: null, note: `Revisa-ho: ${inc.join("; ")}.` });
  return out;
}

/* ======================================================================= oportunitats */

export type OpportunityKind = "optimitzacio_potencia" | "augment_consum" | "renovacio";
export const OPPORTUNITY_LABEL: Record<OpportunityKind, string> = { optimitzacio_potencia: "Possible optimització de potència", augment_consum: "Augment significatiu del consum", renovacio: "Renovació pròxima amb dades actualitzades" };
export interface OpportunityCandidate { kind: OpportunityKind; title: string; quality: "alta" | "mitjana" | "baixa"; dedupeKey: string; details: Record<string, unknown> }

/**
 * Indicis comercials a partir d'una instantània. Mai no recomanen per si sols una acció: l'estalvi s'ha de calcular
 * amb les tarifes corresponents (Comparatives IA) i validar abans d'enviar res al client.
 */
export function detectOpportunities(snap: Snapshot, events: ChangeEvent[], ctx: { renewalDate: string | null }, s: Pick<SyncSettings, "oversizeRatio" | "oversizeMinMonths">): OpportunityCandidate[] {
  const out: OpportunityCandidate[] = [];
  // A. potència: tots els màxims dels mesos disponibles per sota d'una fracció de la contractada en el període de més potència
  if (snap.energy !== "gas" && snap.maxDemandMonths >= s.oversizeMinMonths) {
    const contracted = Math.max(...snap.powerKw.filter((v): v is number => v != null), 0);
    const maxDemand = Math.max(...snap.maxDemandKw.filter((v): v is number => v != null), 0);
    if (contracted > 0 && maxDemand > 0 && maxDemand / contracted <= s.oversizeRatio) {
      const ratio = roundTo((maxDemand / contracted) * 100, 0);
      out.push({
        kind: "optimitzacio_potencia", title: `Màxim demandat ${maxDemand} kW (${ratio} % de ${contracted} kW contractats)`,
        quality: snap.maxDemandMonths >= 12 ? "alta" : "mitjana",
        dedupeKey: `potencia:${snap.cups20}:${contracted}:${Math.floor(ratio / 10)}`,
        details: { contractedKw: snap.powerKw, maxDemandKw: snap.maxDemandKw, months: snap.maxDemandMonths, ratio, tariff: snap.tariff, note: "Indici de sobredimensionament. No és una recomanació: cal calcular l'estalvi amb les tarifes, revisar els períodes P1–P6, les restriccions de la distribuïdora i validar-ho abans de proposar-ho." },
      });
    }
  }
  // B. augment de consum (informatiu)
  const up = events.find((e) => e.kind === "consum_augment");
  if (up) out.push({ kind: "augment_consum", title: `Consum +${up.magnitude} % (${up.oldValue} → ${up.newValue} kWh)`, quality: snap.consumptionStatus === "completa" ? "alta" : "baixa", dedupeKey: `consum:${snap.cups20}:${snap.consumptionTo ?? snap.consultedAt.slice(0, 7)}`, details: { old: up.oldValue, new: up.newValue, pct: up.magnitude, from: snap.consumptionFrom, to: snap.consumptionTo, note: up.note } });
  // C. renovació: dades fresques per preparar la comparativa
  if (ctx.renewalDate && snap.annualKwh != null) out.push({ kind: "renovacio", title: `Renovació el ${ctx.renewalDate}: dades SIPS actualitzades`, quality: snap.consumptionStatus === "completa" ? "alta" : "mitjana", dedupeKey: `renovacio:${snap.cups20}:${ctx.renewalDate}`, details: { renewalDate: ctx.renewalDate, annualKwh: snap.annualKwh, tariff: snap.tariff } });
  return out;
}

/** Percentatge d'avanç (feina programada completada) a partir dels comptadors reals de la cua. */
export function progressPct(c: Partial<Record<JobState, number>>): number {
  const done = (c.actualitzat ?? 0) + (c.sense_dades ?? 0) + (c.error_permanent ?? 0);
  const total = JOB_STATES.reduce((a, k) => a + (c[k] ?? 0), 0);
  return total ? Math.round((done / total) * 1000) / 10 : 0;
}
