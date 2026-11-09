import { gasTariffAliases } from "./gas-tariff";
/**
 * MOTOR SIPS (origen: ASSESSORIA30/cups2 · api/sips.ts) — compartit per tota la plataforma.
 *
 * Inicia sessió al portal EAS (https://eas.renovaenergy.es, plataforma Serenity) amb
 * credencials que NOMÉS existeixen al servidor i consulta el servei intern
 * `POST /Services/Core/PuntoSuministro/List`. Retorna files amb les mateixes 97 capçaleres
 * que l'exportació PuntoSuministro_*.xlsx, de manera que passen pel mateix importador.
 *
 * Mòdul pur (sense `server-only`) per poder-lo provar amb un `fetch` simulat. Només
 * s'ha d'importar des del servidor (src/server/*) o des dels tests: mai des del navegador.
 */
import { ANNUAL_CONSUMPTION_KEY, annualFromEasHistory, annualFromEasSummary, electricityPeriodCount, savedAnnualConsumption, type AnnualConsumption } from "./sips-consumption";
export type Cell = string | number | boolean | null;

/** Campo del servicio → cabecera del Excel (orden exacto de la exportación). */
export const FIELD_HEADERS: [string, string][] = [
  ["TipoEnergia", "Tipo Energía"],
  ["CUPS", "CUPS"],
  ["Direccion", "Dirección"],
  ["IdProvinciaNombreProvincia", "Provincia"],
  ["IdLocalidadNombreLocalidad", "Localidad"],
  ["CodigoPostal", "Código Postal"],
  ["IdDistribuidoraNombreDistribuidora", "Distribuidora"],
  ["IdComercializadoraNombreComercializadora", "Comercializadora"],
  ["IdTarifaNombreTarifa", "Tarifa"],
  ["PotenciaContratadaP1", "Pot. P1 (kW)"],
  ["PotenciaContratadaP2", "Pot. P2 (kW)"],
  ["PotenciaContratadaP3", "Pot. P3 (kW)"],
  ["PotenciaContratadaP4", "Pot. P4 (kW)"],
  ["PotenciaContratadaP5", "Pot. P5 (kW)"],
  ["PotenciaContratadaP6", "Pot. P6 (kW)"],
  ["FechaAlta", "F. Alta"],
  ["IdTensionNombreTension", "Tensión (V)"],
  ["PotenciaMaximaBIE", "Pot. Máx. BIE (kW)"],
  ["PotenciaMaximaAPM", "Pot. Máx. APM (kW)"],
  ["IdTipoPuntoMedidaNombreTipoPuntoMedida", "Tipo P.M."],
  ["DisponibilidadICP", "Disp. ICP"],
  ["IdTipoPerfilConsumoNombreTipoPerfilConsumo", "Tipo Perfil Consumo"],
  ["DerechosExtension", "Derechos Extensión (kW)"],
  ["DerechosAcceso", "Derechos Acceso (kW)"],
  ["IdTipoPropiedadEquipoMedidaNombreTipoPropiedad", "Prop. E.M."],
  ["IdTipoPropiedadICPNombreTipoPropiedad", "Prop. ICP"],
  ["FechaUltimoMovimientoContrato", "F. Últ. Mov. Contrato"],
  ["FechaUltimoCambioComercializadora", "F. Últ. Cambio Comer."],
  ["FechaLimiteDerechosReconocidos", "F. Límite Derechos Reconocidos"],
  ["FechaUltimaLectura", "F. Últ. Lectura"],
  ["InformacionImpagos", "Informacion Impagos"],
  ["ImporteDepositoGarantia", "Importe Deposito Garantía (€)"],
  ["IdTipoIdentificadorTitularNombreTipoIdentificadorTitular", "Tipo Id. Titular"],
  ["ViviendaHabitual", "Vivienda Habitual"],
  ["IdTipoTelegestionNombreTipoTelegestion", "Telegestión"],
  ["IdTipoFasesEquipoMedidaNombreTipoFasesEquipoMedida", "Fases E.M."],
  ["IdTipoAutoconsumoNombreTipoAutoconsumo", "Autoconsumo"],
  ["IdTipoContratoATRNombreTipoContratoATR", "Tipo Contrato ATR"],
  ["IdTipoPeriodicidadFacturacionNombreTipoPeriodicidadFacturacion", "Per. Facturación"],
  ["CodigoBIE", "Código BIE"],
  ["FechaEmisionBIE", "F. Emisión BIE"],
  ["FechaCaducidadBIE", "F. Caducidad BIE"],
  ["CodigoAPM", "Código APM"],
  ["FechaEmisionAPM", "F. Emisión APM"],
  ["FechaCaducidadAPM", "F. Caducidad APM"],
  ["RelacionTransformacionIntensidad", "Relación Trans. Intensidad"],
  ["IdCNAECodigoCNAE", "CNAE"],
  ["IdTipoControlPotenciaNombreTipoControlPotencia", "Ctrl Potencia"],
  ["PotenciaCgp", "Potencia CGP"],
  ["IdTipoDHEquipoMedidaNombreTipoDHEquipoMedida", "Tipo D.H. E.M."],
  ["IdTipoAccesoContadorNombreTipoAccesoContador", "Acceso Contador"],
  ["Contratable", "Contratable"],
  ["MotivoNoContratable", "Motivo NO Contratable"],
  ["IdTensionEquipoMedidaNombreTension", "Tensión E.M. (V)"],
  ["IdTipoExpedienteNombreTipoExpediente", "Tipo Exp."],
  ["IdTipoMotivoExpedienteNombreTipoMotivoExpediente", "Motivo Exp."],
  ["IdTipoSuministroNombreTipoSuministro", "Tipo Suministro"],
  ["BonoSocial", "Bono Social"],
  ["EActivaAnual", "E.A. Anual (kWh)"],
  ["EReactivaAnual", "E.R. Anual (kVArh)"],
  ["PotenciaAnual", "Pot. Anual (kW)"],
  ...monthFields("EActivaMes", "E.A.", "kWh"),
  ...monthFields("EReactivaMes", "E.R.", "kVArh"),
  ...monthFields("PotenciaMes", "Pot.", "kW"),
];

function monthFields(prefix: string, label: string, unit: string): [string, string][] {
  const M = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  return M.map((m, i) => [`${prefix}${String(i + 1).padStart(2, "0")}`, `${label} ${m} (${unit})`]);
}

/** Tipus d'energia: llum (TipoEnergia = 1), gas (TipoEnergia = 2) o tots dos. */
export type EnergyFilter = "luz" | "gas" | "totes";
export const SIPS_SORT_FIELDS = {
  consum: "EActivaAnual", tarifa: "IdTarifaNombreTarifa", subministrament: "Direccion",
  comercialitzadora: "IdComercializadoraNombreComercializadora", lectura: "FechaUltimaLectura",
} as const;
export type SipsSortField = keyof typeof SIPS_SORT_FIELDS;

export interface SearchInput {
  /** Per defecte: «totes» en cerques per CUPS (el CUPS ja identifica el punt) i «luz» per adreça. */
  energia?: EnergyFilter;
  cups?: string;
  cp?: string;
  direccion?: string;
  tarifa?: string;
  minKWh?: number;
  maxKWh?: number;
  resultText?: string;
  sortBy?: SipsSortField;
  sortDirection?: "asc" | "desc";
  skip?: number;
  take?: number;
}

const TARIFAS = ["2.0TD", "3.0TD", "6.1TD", "6.2TD", "6.3TD", "6.4TD"];
/** Peatges de gas (RL.1–RL.11). El portal pot escriure «RL.1», «RL1» o «RL 1»: es busquen les tres variants. */
export const TARIFAS_GAS = Array.from({ length: 11 }, (_, i) => `RL.${i + 1}`);

function gasTariffCriteria(t: string): unknown | null {
  const aliases = gasTariffAliases(t);
  if (!aliases.length) return null;
  const clauses = aliases.map((v) => [["IdTarifaNombreTarifa"], "=", v]);
  return clauses.slice(1).reduce<unknown>((acc, c) => [acc, "or", c], clauses[0]);
}

/** Camps addicionals del portal (p. ex. específics del gas) configurables sense tocar el codi: SIPS_EXTRA_COLUMNS=CampA,CampB */
export function extraFields(): string[] {
  const raw = typeof process !== "undefined" ? process.env.SIPS_EXTRA_COLUMNS ?? "" : "";
  return raw.split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(x) && !FIELD_HEADERS.some(([f]) => f === x));
}

/** Variant-based matching for portals with a case-sensitive database collation.
 * Covers uppercase, lowercase and common title-case data without relying on
 * SQL functions that older Serenity installations might reject. */
export function caseVariants(field: string, value: string, prefix = "", suffix = ""): unknown {
  const title = value.toLocaleLowerCase("es-ES").replace(/(^|[\s/.,-])([^\s/.,-])/g, (_, sep: string, c: string) => sep + c.toLocaleUpperCase("es-ES"));
  const candidates = [...new Set([value, value.toLocaleUpperCase("es-ES"), value.toLocaleLowerCase("es-ES"), title])];
  const clauses = candidates.map((v) => [[field], "like", `${prefix}${v}${suffix}`]);
  return clauses.slice(1).reduce<unknown>((acc, c) => [acc, "or", c], clauses[0]);
}

/** Valida la consulta y construye la petición Serenity. Exige CUPS completo o código postal. */
export function buildListRequest(q: SearchInput): { ok: true; request: Record<string, unknown> } | { ok: false; error: string } {
  const cups = String(q.cups ?? "").toUpperCase().replace(/[\s\-.]/g, "");
  const cp = String(q.cp ?? "").trim();
  const take = Math.max(1, Math.min(100, Math.floor(Number(q.take ?? 50)) || 50));
  const skip = Math.max(0, Math.floor(Number(q.skip ?? 0)) || 0);
  const energia: EnergyFilter = q.energia ?? (cups ? "totes" : "luz");
  const sortBy = q.sortBy ?? "consum";
  if (!Object.prototype.hasOwnProperty.call(SIPS_SORT_FIELDS, sortBy) || (q.sortDirection != null && !["asc", "desc"].includes(q.sortDirection))) return { ok: false, error: "Ordenació no vàlida." };
  for (const value of [q.minKWh, q.maxKWh]) if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) return { ok: false, error: "El consum ha de ser un nombre positiu o zero." };
  if (q.minKWh != null && q.maxKWh != null && Number(q.minKWh) > Number(q.maxKWh)) return { ok: false, error: "El consum màxim no pot ser inferior al mínim." };
  if (!["luz", "gas", "totes"].includes(energia)) return { ok: false, error: "Tipus d'energia no vàlid." };
  // CUPS sense filtre de tipus: el mateix CUPS identifica el punt (llum o gas). Per adreça, «totes» = llum O gas.
  const base: unknown =
    energia === "luz" ? [["TipoEnergia"], "=", 1] : energia === "gas" ? [["TipoEnergia"], "=", 2] : cups ? null : [[["TipoEnergia"], "=", 1], "or", [["TipoEnergia"], "=", 2]];
  const extra: unknown[] = [];
  const eq: Record<string, string> = {};
  if (cups) {
    if (!/^ES\d{16}[A-Z]{2}([0-9A-Z]{2})?$/.test(cups)) return { ok: false, error: "CUPS incompleto o con formato no válido (ES + 16 dígitos + 2 letras), de luz o de gas." };
    // Los CUPS eléctricos del CRM suelen omitir los dos caracteres opcionales
    // de frontera (por ejemplo, 0F). Para 20 caracteres, buscar por prefijo
    // tanto suministros con sufijo como sin él; con 22, coincidencia exacta.
    extra.push(caseVariants("CUPS", cups, "", cups.length === 20 ? "%" : ""));
  } else {
    if (!/^\d{5}$/.test(cp)) return { ok: false, error: "Indica un CUPS completo o un código postal de 5 dígitos (sin código postal la búsqueda en 32 millones de suministros no responde)." };
    eq.CodigoPostal = cp;
    const dir = String(q.direccion ?? "").trim().replace(/[%_\[\]]/g, " ").replace(/\s+/g, " ").trim();
    if (dir) extra.push(caseVariants("Direccion", dir, "%", "%"));
  }
  if (q.tarifa) {
    const gasT = gasTariffCriteria(q.tarifa);
    if (TARIFAS.includes(q.tarifa) && energia !== "gas") extra.push([["IdTarifaNombreTarifa"], "=", q.tarifa]);
    else if (gasT && energia !== "luz") extra.push(gasT);
    else return { ok: false, error: "Tarifa no válida per al tipus d'energia seleccionat." };
  }
  if (q.minKWh != null && Number(q.minKWh) > 0) extra.push([["EActivaAnual"], ">=", Number(q.minKWh)]);
  if (q.maxKWh != null) extra.push([["EActivaAnual"], "<=", Number(q.maxKWh)]);
  const text = String(q.resultText ?? "").slice(0, 120).replace(/[%_\[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (text) {
    const clauses = ["CUPS", "Direccion", "IdLocalidadNombreLocalidad", "IdComercializadoraNombreComercializadora"].map(field => caseVariants(field, text, "%", "%"));
    extra.push(clauses.slice(1).reduce<unknown>((acc, clause) => [acc, "or", clause], clauses[0]));
  }
  const Criteria = base == null ? extra.slice(1).reduce((acc, c) => [acc, "and", c], extra[0]) : extra.reduce((acc, c) => [acc, "and", c], base);
  return {
    ok: true,
    request: {
      Take: take,
      Skip: skip,
      EqualityFilter: eq,
      Criteria,
      Sort: [`${SIPS_SORT_FIELDS[sortBy]} ${(q.sortDirection ?? (sortBy === "consum" ? "desc" : "asc")).toUpperCase()}`, "CUPS"],
      IncludeColumns: ["Id", "IdPuntoSuministro", ...FIELD_HEADERS.map(([f]) => f), ...extraFields()],
    },
  };
}

function toCell(field: string, v: unknown): Cell {
  if (v == null || v === "") return null;
  if (field === "TipoEnergia") return v === 1 ? "Electricidad" : v === 2 ? "Gas" : String(v);
  if (typeof v === "boolean") return v ? "S" : "N";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}

export function entitiesToRows(entities: Record<string, unknown>[]): Cell[][] {
  // Les 97 columnes de l'exportació + camps addicionals configurats (es conserven a la fitxa tècnica).
  const extras = [...extraFields(), ...(entities.some(e => e[ANNUAL_CONSUMPTION_KEY] != null) ? [ANNUAL_CONSUMPTION_KEY] : [])];
  return [
    [...FIELD_HEADERS.map(([, h]) => h), ...extras],
    ...entities.map((e) => [...FIELD_HEADERS.map(([f]) => toCell(f, e[f])), ...extras.map((f) => toCell(f, e[f]))]),
  ];
}

/** Tipus d'energia d'una fila o d'un subministrament («Electricidad» / «Gas» / 1 / 2). */
export function energyOf(v: unknown): "luz" | "gas" | null {
  if (v === 2 || /gas/i.test(String(v ?? ""))) return "gas";
  if (v === 1 || /electri|luz|llum/i.test(String(v ?? ""))) return "luz";
  return null;
}

/* ---------- Sesión con el portal ---------- */

type Session = { cookies: Map<string, string>; at: number };
let session: Session | null = null;
const SESSION_TTL = 15 * 60 * 1000;

function absorb(cookies: Map<string, string>, res: Response) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = (c: Map<string, string>) => [...c.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
const csrf = (c: Map<string, string>) => c.get("CSRF-TOKEN") ?? [...c.entries()].find(([k]) => /csrf/i.test(k))?.[1] ?? "";

export async function login(base: string, user: string, pass: string, f0: typeof fetch = fetch): Promise<Session> {
  const f = timed(f0);
  const cookies = new Map<string, string>();
  const r1 = await f(`${base}/Account/Login/`, { redirect: "manual" }).catch((e) => { throw netError(e); });
  absorb(cookies, r1);
  const r2 = await f(`${base}/Account/Login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf(cookies), Cookie: cookieHeader(cookies) },
    body: JSON.stringify({ NombreUsuario: user, Password: pass }),
  }).catch((e) => { throw netError(e); });
  absorb(cookies, r2);
  if (r2.status >= 500) throw new SipsError(503, `El portal SIPS no està disponible (error ${r2.status}).`, "no_disponible");
  if (r2.status >= 400 || (r2.status === 200 && /"Error"\s*:\s*\{/.test(await r2.clone().text().catch(() => "")))) {
    // no es retorna el cos de la resposta del portal (pot contenir detalls interns)
    throw new SipsError(502, "El portal SIPS ha rebutjat l'usuari o la contrasenya (SIPS_USER / SIPS_PASSWORD). Revisa les credencials a Vercel.", "credencials");
  }
  return { cookies, at: Date.now() };
}

export async function listSupplies(base: string, s: Session, request: Record<string, unknown>, f0: typeof fetch = fetch) {
  const f = timed(f0);
  const r = await f(`${base}/Services/Core/PuntoSuministro/List`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf(s.cookies), Cookie: cookieHeader(s.cookies) },
    body: JSON.stringify(request),
  }).catch((e) => { throw netError(e); });
  absorb(s.cookies, r);
  if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) return { expired: true as const };
  if (r.status === 429) { const e = new SipsError(429, "El portal SIPS ha limitat les consultes. Espera uns minuts.", "limit"); e.retryAfterSec = retryAfterSeconds(r.headers.get("retry-after")); throw e; }
  if (!r.ok) throw new SipsError(r.status === 504 ? 504 : 503, `El portal SIPS ha respost ${r.status}${r.status === 504 ? " (temps esgotat: acota la cerca)" : ""}.`, "no_disponible");
  let j: { Entities?: Record<string, unknown>[]; TotalCount?: number; Error?: { Message?: string } };
  try { j = await r.json(); } catch { throw new SipsError(502, "La resposta del portal SIPS no té el format esperat.", "transformacio"); }
  if (j.Error) throw new SipsError(502, `El portal SIPS ha retornat un error: ${String(j.Error.Message ?? "desconegut").slice(0, 160)}`, "consulta");
  return { expired: false as const, entities: j.Entities ?? [], total: j.TotalCount ?? 0 };
}

/** Petició de lectura identificada a Network. ID dinàmic de la cerca, mai el CUPS. */
async function consumptionSummary(base: string, s: Session, id: number | string, f0: typeof fetch) {
  const r = await timed(f0)(`${base}/services/Core/PuntoSuministro/ResumenConsumosU12M`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf(s.cookies), Cookie: cookieHeader(s.cookies) },
    body: JSON.stringify({ idPuntoSuministro: id }),
  }).catch(e => { throw netError(e); });
  absorb(s.cookies, r);
  if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) return { expired: true as const };
  if (!r.ok) throw new SipsError(r.status === 429 ? 429 : 503, "No s'ha pogut recuperar el resum de consums EAS.", r.status === 429 ? "limit" : "no_disponible");
  let data: Record<string, unknown>;
  try { data = await r.json(); } catch { throw new SipsError(502, "El resum de consums EAS no és JSON.", "transformacio"); }
  if (!data || typeof data !== "object" || Array.isArray(data) || data.Error) throw new SipsError(502, "El resum de consums EAS no té el format esperat.", "transformacio");
  return { expired: false as const, data };
}

/** Servei i filtre verificats al JS públic d'EAS (ConsumoPuntoSuministroElectricidadGrid).
 * Es llegeix l'històric, sense activar ImportarCNMC ni modificar el portal. */
async function consumptionHistory(base: string, s: Session, id: number | string, f0: typeof fetch) {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const deadline = Date.now() + 18_000;
  for (let page = 0; page < 50; page++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SipsError(504, "Temps esgotat llegint l'històric per períodes.", "no_disponible");
    const r = await timed(f0)(`${base}/Services/Core/ConsumoPuntoSuministro/List`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(Math.min(SIPS_TIMEOUT_MS, remaining)),
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf(s.cookies), Cookie: cookieHeader(s.cookies) },
      body: JSON.stringify({ EqualityFilter: { IdPuntoSuministro: id }, Skip: rows.length, Take: 200,
        Sort: ["FechaFinConsumo DESC", "FechaInicioConsumo DESC", "IdConsumoPuntoSuministro DESC"],
        IncludeColumns: ["IdConsumoPuntoSuministro", "IdPuntoSuministro", "FechaInicioConsumo", "FechaFinConsumo", ...Array.from({ length: 6 }, (_, i) => `EActivaP${i + 1}`)] }),
    }).catch(e => { throw netError(e); });
    absorb(s.cookies, r);
    if (r.status === 401 || r.status === 403 || (r.status >= 300 && r.status < 400)) return { expired: true as const };
    if (!r.ok) throw new SipsError(r.status === 429 ? 429 : 503, "No s'ha pogut recuperar l'històric de consums EAS.", r.status === 429 ? "limit" : "no_disponible");
    const data = await r.json();
    if (data?.Error || !Array.isArray(data?.Entities)) throw new SipsError(502, "L'històric EAS no té el format esperat.", "transformacio");
    const batch = data.Entities as Record<string, unknown>[];
    if (batch.some(row => !row || typeof row !== "object" || Array.isArray(row) || (row.IdPuntoSuministro != null && String(row.IdPuntoSuministro) !== String(id)))) throw new SipsError(502, "L'històric EAS no correspon al subministrament consultat.", "transformacio");
    const signature = JSON.stringify(batch);
    if (batch.length && seen.has(signature)) throw new SipsError(502, "EAS repeteix una pàgina de l'històric; no es dupliquen els consums.", "transformacio");
    seen.add(signature); rows.push(...batch);
    if (!batch.length || (typeof data.TotalCount === "number" ? rows.length >= data.TotalCount : batch.length < 200)) return { expired: false as const, rows };
  }
  throw new SipsError(502, "L'històric EAS supera el límit de paginació; no es calcula un anual parcial.", "transformacio");
}

/* ---------- API d'alt nivell (utilitzada per src/server/sips.ts) ---------- */

export interface SipsConfig {
  base: string;
  user: string;
  pass: string;
}

/**
 * Tipus d'error del buscador (Fase 8), perquè la interfície els distingeixi:
 * no_configurat · credencials · no_disponible · cups_invalid · sense_permisos · limit · transformacio · sense_resultats
 */
export type SipsErrorCode = "no_configurat" | "credencials" | "no_disponible" | "cups_invalid" | "sense_permisos" | "limit" | "transformacio" | "consulta";
export class SipsError extends Error {
  /** Segons d'espera indicats pel proveïdor (capçalera Retry-After d'un 429), si n'hi ha. */
  retryAfterSec: number | null = null;
  constructor(public status: number, message: string, public code: SipsErrorCode = status === 400 ? "cups_invalid" : status === 503 ? "no_configurat" : "no_disponible") {
    super(message);
  }
}
/** Retry-After en segons (número o data HTTP). */
export function retryAfterSeconds(h: string | null | undefined, now = Date.now()): number | null {
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - now) / 1000)) : null;
}

/** Temps màxim de cada petició al portal. */
export const SIPS_TIMEOUT_MS = 12_000;
const timed = (f: typeof fetch): typeof fetch => (input, init) => f(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(SIPS_TIMEOUT_MS) });
const netError = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return new SipsError(504, "El portal SIPS no ha respost a temps (més de 12 s). Torna-ho a provar d'aquí a uns minuts.", "no_disponible");
  return new SipsError(503, "No s'ha pogut connectar amb el portal SIPS (servei no disponible o xarxa).", "no_disponible");
};

/** Base de 20 caràcters d'un CUPS elèctric (sense el sufix opcional de frontera). */
export function cupsBase(raw: unknown): string {
  return String(raw ?? "").toUpperCase().replace(/[\s\-.]/g, "").slice(0, 20);
}

/**
 * Executa una consulta validada contra el portal i reutilitza la sessió.
 * - Si la sessió caduca (401/403/3xx) torna a iniciar sessió una sola vegada.
 * - En mode CUPS verifica que cada CUPS retornat correspon al sol·licitat (mateixa base de 20 caràcters).
 */
export async function sipsQuery(q: SearchInput, cfg: SipsConfig, f: typeof fetch = fetch): Promise<{ total: number; entities: Record<string, unknown>[] }> {
  if (!cfg.user || !cfg.pass) throw new SipsError(503, "Buscador SIPS no configurat: falten SIPS_USER o SIPS_PASSWORD al servidor (Vercel → Environment Variables).", "no_configurat");
  const built = buildListRequest(q);
  if (!built.ok) throw new SipsError(400, built.error);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!session || Date.now() - session.at > SESSION_TTL || attempt > 0) session = await login(cfg.base, cfg.user, cfg.pass, f);
      // Important: els LIKE amb prefix poden esgotar el temps al portal.
      // Primer cal provar el CUPS exacte conegut (0F en els CUPS habituals);
      // les cerques obertes queden per al final, mai abans de l'exacta.
      const full = String(q.cups ?? "").toUpperCase().replace(/[\s\-.]/g, "");
      const want = cupsBase(full);
      const sameBase = (e: Record<string, unknown>) => cupsBase(e.CUPS) === want && (full.length !== 22 || String(e.CUPS ?? "").toUpperCase() === full);
      const exact = (value: string): Record<string, unknown> => {
        const r = buildListRequest({ ...q, cups: value });
        if (!r.ok) throw new SipsError(400, r.error);
        return r.request;
      };
      const queries: Record<string, unknown>[] = !full
        ? [built.request]
        : full.length === 20
          ? [exact(`${want}0F`), exact(want), built.request]
          : [exact(full), exact(`${want}0F`), exact(want), (() => {
              const prefix = buildListRequest({ ...q, cups: want });
              return prefix.ok ? prefix.request : built.request;
            })()];
      let entities: Record<string, unknown>[] = [];
      let total = 0;
      let expired = false;
      let lastSearchError: SipsError | null = null;
      for (let i = 0; i < queries.length; i++) {
        let r: Awaited<ReturnType<typeof listSupplies>>;
        try {
          r = await listSupplies(cfg.base, session, queries[i], f);
        } catch (e) {
          // Una consulta alternativa pot fallar sense que falli tot el servei.
          // No amagarem errors si cap de les variants arriba a respondre.
          if (!full || !(e instanceof SipsError) || (e.status !== 503 && e.status !== 504 && e.code !== "consulta")) throw e;
          lastSearchError = e;
          continue;
        }
        if (r.expired) { expired = true; break; }
        const matches = full ? r.entities.filter(sameBase) : r.entities;
        if (matches.length) {
          entities = matches;
          total = full ? matches.length : r.total;
          break;
        }
        if (!full) { total = r.total; break; }
        // Una resposta vàlida sense coincidències és suficient per indicar
        // 'no trobat' si les altres variants tampoc funcionen.
        lastSearchError = null;
      }
      if (!expired && entities.length === 0 && lastSearchError) throw lastSearchError;
      if (expired) { session = null; continue; }
      // Per adreça no es fan 50 peticions addicionals: la UI ofereix consultar el CUPS de cada fila.
      if (full) for (const entity of entities) {
        const count = electricityPeriodCount(entity.IdTarifaNombreTarifa);
        if (!count || energyOf(entity.TipoEnergia) === "gas") continue;
        const id = entity.IdPuntoSuministro ?? entity.Id;
        let reading: AnnualConsumption;
        try {
          if ((typeof id !== "number" && typeof id !== "string") || !/^\d+$/.test(String(id)) || Number(id) <= 0) throw new SipsError(502, "La cerca EAS no ha retornat l'identificador intern del subministrament.", "transformacio");
          let historyIssue: string | null = null;
          try {
            const history = await consumptionHistory(cfg.base, session, id, f);
            if (history.expired) { expired = true; break; }
            reading = annualFromEasHistory(history.rows, count, entity.EActivaAnual);
            if (reading.status === "complete") {
              entity[ANNUAL_CONSUMPTION_KEY] = JSON.stringify(reading);
              continue;
            }
            historyIssue = reading.warning;
          } catch (err) {
            historyIssue = err instanceof Error ? err.message : "No s'ha pogut llegir l'històric.";
          }
          const summary = await consumptionSummary(cfg.base, session, id, f);
          if (summary.expired) { expired = true; break; }
          reading = { ...annualFromEasSummary(summary.data, count, entity.EActivaAnual), revision: 3 };
          if (historyIssue) reading.warning = [reading.warning, `Històric: ${historyIssue}`].filter(Boolean).join(" ");
        } catch (err) {
          reading = annualFromEasHistory([], count, entity.EActivaAnual);
          reading.warning = err instanceof SipsError ? err.message : "No s'ha pogut recuperar el resum de consums EAS.";
        }
        entity[ANNUAL_CONSUMPTION_KEY] = JSON.stringify({ ...reading, revision: 3 });
      }
      if (expired) { session = null; continue; }
      return { total, entities };
    }
    // sessió que caduca immediatament després d'iniciar-la: el portal no accepta l'usuari
    throw new SipsError(502, "El portal SIPS no manté la sessió amb aquestes credencials. Revisa SIPS_USER / SIPS_PASSWORD.", "credencials");
  } catch (err) {
    session = null;
    if (err instanceof SipsError) throw err;
    throw new SipsError(502, "Error inesperat consultant el portal SIPS.", "no_disponible");
  }
}

/** Només interpreta registres d'històric explícitament retornats pel portal;
 * NO intenta deduir el desglossament a partir del consum anual del llistat. */
export function consumptionFromEntities(entities: Record<string, unknown>[]): Record<string, AnnualConsumption> {
  const out: Record<string, AnnualConsumption> = {};
  for (const e of entities) {
    const cups = String(e.CUPS ?? "").toUpperCase();
    const saved = savedAnnualConsumption(e);
    if (saved) { out[cups] = saved; continue; }
    const raw = e.ConsumoPuntoSuministro ?? e.ConsumosPuntoSuministro ?? e.Consumos;
    const rows = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { Entities?: unknown[] }).Entities) ? (raw as { Entities: unknown[] }).Entities : [];
    const count = electricityPeriodCount(e.IdTarifaNombreTarifa);
    if (!count) continue;
    out[cups] = annualFromEasHistory(rows.filter((r): r is Record<string, unknown> => r != null && typeof r === "object" && !Array.isArray(r)), count, e.EActivaAnual);
  }
  return out;
}

/** Consulta i retorna la matriu [capçaleres, ...files] de 97 columnes (format de l'exportació Excel). */
export async function sipsSearchRows(q: SearchInput, cfg: SipsConfig, f: typeof fetch = fetch) {
  const { total, entities } = await sipsQuery(q, cfg, f);
  return { total, rows: entitiesToRows(entities), annualConsumptions: consumptionFromEntities(entities), consultedAt: new Date().toISOString(), source: "Portal SIPS · EAS Renovae" };
}

/** Converteix una fila de 97 columnes en un objecte {capçalera: valor} (columna `raw` de sips_cache). */
export function rowToRecord(headers: Cell[], row: Cell[]): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  headers.forEach((h, i) => {
    if (h != null && h !== "") out[String(h)] = row[i] ?? null;
  });
  return out;
}

/** Inversa de rowToRecord: torna a la matriu de l'importador. */
export function recordsToRows(records: Record<string, Cell>[]): Cell[][] {
  const headers = FIELD_HEADERS.map(([, h]) => h);
  return [headers, ...records.map((r) => headers.map((h) => r[h] ?? null))];
}

/** Només per a proves. */
export function __resetSession() {
  session = null;
}
