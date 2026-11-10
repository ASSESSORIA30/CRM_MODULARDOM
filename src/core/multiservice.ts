/**
 * CONTRACTACIÓ MULTISERVEI (lògica pura, sense base de dades).
 *
 * Un contracte de fibra, mòbil, paquet fibra + mòbil, assegurança, alarma, plaques solars o «altres serveis» és
 * un registre de `crm_contracts` com els d'energia (no hi ha cap segon sistema de contractes). El que canvia és:
 *  - `service`: quin servei és;
 *  - `details`: les dades pròpies del servei, validades aquí amb un esquema per servei;
 *  - `crm_contract_lines`: les línies de mòbil, cadascuna amb la seva tarifa, preu i estat.
 * Els camps d'energia (CUPS, P1–P6, tarifa d'accés) NO s'exigeixen mai als serveis que no són d'energia.
 */
import { z } from "zod";
import {
  CONTRACT_SERVICES, ENERGY_CONTRACT_SERVICES, isEnergyService,
  type ContractService, type ContractStatus,
} from "./crm";

export { CONTRACT_SERVICES, isEnergyService };
export type { ContractService };

/* ============================================================== serveis i targetes de «Nou contracte» */

export const CONTRACT_SERVICE_LABEL: Record<ContractService, string> = {
  llum_residencial: "Electricitat (particular)",
  llum_empresa: "Electricitat (empresa)",
  gas: "Gas natural",
  fibra_telefonia: "Fibra i telefonia (antic)",
  assegurances: "Assegurança",
  alarmes: "Alarma",
  fibra: "Fibra",
  mobil: "Mòbil",
  fibra_mobil: "Fibra + mòbil",
  plaques_solars: "Plaques solars",
  altres: "Altres serveis",
};

/** Família: agrupa els serveis a la fitxa 360° i decideix quin formulari s'obre. */
export type ServiceFamily = "electricitat" | "gas" | "fibra" | "mobil" | "fibra_mobil" | "assegurances" | "alarmes" | "plaques_solars" | "altres";
export const SERVICE_FAMILY: Record<ContractService, ServiceFamily> = {
  llum_residencial: "electricitat", llum_empresa: "electricitat", gas: "gas",
  fibra_telefonia: "fibra", fibra: "fibra", mobil: "mobil", fibra_mobil: "fibra_mobil",
  assegurances: "assegurances", alarmes: "alarmes", plaques_solars: "plaques_solars", altres: "altres",
};
export const FAMILY_LABEL: Record<ServiceFamily, string> = {
  electricitat: "Electricitat", gas: "Gas natural", fibra: "Fibra", mobil: "Mòbil", fibra_mobil: "Fibra + mòbil",
  assegurances: "Assegurances", alarmes: "Alarmes", plaques_solars: "Plaques solars", altres: "Altres serveis",
};
/** Ordre de les targetes del selector «Nou contracte». */
export const SERVICE_CARDS: { family: ServiceFamily; hint: string }[] = [
  { family: "electricitat", hint: "CUPS, potències P1–P6, SIPS i comparatives" },
  { family: "gas", hint: "CUPS de gas, tarifa RL i comparatives" },
  { family: "fibra", hint: "Operador, velocitat, instal·lació i portabilitat del fix" },
  { family: "mobil", hint: "Una o més línies, cadascuna amb la seva tarifa" },
  { family: "fibra_mobil", hint: "Paquet: preu conjunt sense comptar dues vegades" },
  { family: "assegurances", hint: "Pòlissa, prima, efecte i venciment" },
  { family: "alarmes", hint: "Equips, central receptora i permanència" },
  { family: "plaques_solars", hint: "kWp, pressupost, fases d'obra i garanties" },
  { family: "altres", hint: "Qualsevol altre servei contractat" },
];

/** Servei concret d'una família (l'electricitat depèn de si el client és particular o empresa). */
export function serviceForFamily(f: ServiceFamily, clientKind?: string | null): ContractService {
  if (f === "electricitat") return clientKind === "particular" ? "llum_residencial" : "llum_empresa";
  return f;
}

/** Servei d'un contracte. Els antics (sense `service`) es dedueixen del subministrament: llum o gas. */
export function serviceOf(k: { service?: ContractService | null }, supplyEnergy?: "luz" | "gas" | null, clientKind?: string | null): ContractService {
  if (k.service) return k.service;
  if (supplyEnergy === "gas") return "gas";
  return clientKind === "particular" ? "llum_residencial" : "llum_empresa";
}

/** Proveïdors suggerits (es pot escriure qualsevol altre). */
export const FIBRA_OPERATORS = ["O2", "DIGI", "Movistar", "Orange", "Vodafone", "Altres"] as const;
export const ALARM_COMPANIES = ["SEGURMA", "Securitas Direct", "Prosegur", "ADT", "Altres"] as const;
export const INSURANCE_TYPES = ["llar", "vida", "salut", "auto", "negoci", "responsabilitat_civil", "comunitat", "altres"] as const;
export const INSURANCE_TYPE_LABEL: Record<(typeof INSURANCE_TYPES)[number], string> = {
  llar: "Llar", vida: "Vida", salut: "Salut", auto: "Automòbil", negoci: "Negoci / multirisc", responsabilitat_civil: "Responsabilitat civil", comunitat: "Comunitat", altres: "Altres",
};
export const PERIODICITIES = ["mensual", "trimestral", "semestral", "anual", "unica"] as const;
export const PERIODICITY_LABEL: Record<(typeof PERIODICITIES)[number], string> = { mensual: "Mensual", trimestral: "Trimestral", semestral: "Semestral", anual: "Anual", unica: "Pagament únic" };

export const FIBRA_OPERATIONS = ["alta_nova", "portabilitat", "canvi_operador", "canvi_tarifa", "canvi_titular", "trasllat"] as const;
export const FIBRA_OPERATION_LABEL: Record<(typeof FIBRA_OPERATIONS)[number], string> = {
  alta_nova: "Alta nova", portabilitat: "Portabilitat", canvi_operador: "Canvi d'operador", canvi_tarifa: "Canvi de tarifa", canvi_titular: "Canvi de titular", trasllat: "Trasllat de domicili",
};
export const SOLAR_PHASES = ["estudi", "pressupost", "acceptat", "materials", "installacio", "legalitzacio", "en_servei"] as const;
export const SOLAR_PHASE_LABEL: Record<(typeof SOLAR_PHASES)[number], string> = {
  estudi: "Estudi", pressupost: "Pressupost", acceptat: "Pressupost acceptat", materials: "Materials", installacio: "Instal·lació", legalitzacio: "Legalització", en_servei: "En servei",
};
export const LINE_STATUSES = ["pendent", "portabilitat_en_curs", "activa", "incidencia", "baixa"] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];
export const LINE_STATUS_LABEL: Record<LineStatus, string> = { pendent: "Pendent", portabilitat_en_curs: "Portabilitat en curs", activa: "Activa", incidencia: "Incidència", baixa: "Baixa" };

/* ============================================================== estats per servei */

/** Estats que té sentit fer servir a cada família (la base de dades admet la unió). */
export const STATUS_FLOW: Record<ServiceFamily, readonly ContractStatus[]> = {
  electricitat: ["esborrany", "pendent_documentacio", "pendent_signatura", "enviat_comercialitzadora", "en_tramitacio", "actiu", "renovacio_pendent", "incidencia", "finalitzat", "anullat"],
  gas: ["esborrany", "pendent_documentacio", "pendent_signatura", "enviat_comercialitzadora", "en_tramitacio", "actiu", "renovacio_pendent", "incidencia", "finalitzat", "anullat"],
  fibra: ["esborrany", "pendent_documentacio", "pendent_signatura", "en_tramitacio", "pendent_installacio", "actiu", "incidencia", "baixa", "finalitzat", "anullat"],
  mobil: ["esborrany", "pendent_documentacio", "pendent_signatura", "en_tramitacio", "pendent_portabilitat", "actiu", "incidencia", "baixa", "finalitzat", "anullat"],
  fibra_mobil: ["esborrany", "pendent_documentacio", "pendent_signatura", "en_tramitacio", "pendent_installacio", "pendent_portabilitat", "actiu", "incidencia", "baixa", "finalitzat", "anullat"],
  assegurances: ["esborrany", "pendent_documentacio", "pendent_signatura", "en_tramitacio", "actiu", "renovacio_pendent", "incidencia", "baixa", "finalitzat", "anullat"],
  alarmes: ["esborrany", "pendent_documentacio", "pendent_signatura", "pendent_installacio", "actiu", "incidencia", "baixa", "finalitzat", "anullat"],
  // unes plaques no es «renoven» cada any: no hi ha renovacio_pendent
  plaques_solars: ["esborrany", "pendent_documentacio", "pendent_signatura", "en_execucio", "pendent_legalitzacio", "actiu", "incidencia", "finalitzat", "anullat"],
  altres: ["esborrany", "pendent_documentacio", "pendent_signatura", "en_tramitacio", "actiu", "renovacio_pendent", "incidencia", "baixa", "finalitzat", "anullat"],
};
/** Etiqueta d'estat adaptada al servei (p. ex. «Actiu» d'unes plaques = «En servei»). */
export function statusLabelFor(service: ContractService, status: ContractStatus, base: Record<ContractStatus, string>) {
  if (SERVICE_FAMILY[service] === "plaques_solars" && status === "actiu") return "En servei";
  if (SERVICE_FAMILY[service] === "assegurances" && status === "actiu") return "En vigor";
  return base[status];
}
const CLOSED: ContractStatus[] = ["finalitzat", "anullat", "baixa"];
/**
 * Pot passar un contracte d'un estat a un altre? Els tancats no tornen enrere (es crea un contracte nou),
 * i cada servei només admet els seus estats.
 */
export function canTransition(service: ContractService, from: ContractStatus | null, to: ContractStatus): { ok: true } | { ok: false; reason: string } {
  const flow = STATUS_FLOW[SERVICE_FAMILY[service]];
  if (!flow.includes(to)) return { ok: false, reason: `L'estat «${to}» no s'aplica a ${FAMILY_LABEL[SERVICE_FAMILY[service]].toLowerCase()}` };
  if (from && from !== to && CLOSED.includes(from)) return { ok: false, reason: "Contracte tancat: no es pot reobrir. Crea'n un de nou (es conserva l'historial)." };
  return { ok: true };
}

/* ============================================================== números i dates */

/** Llegeix un import escrit a l'espanyola o a l'anglesa: «1.234,56», «12,5», «12.5», «1234». */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let t = String(v).trim().replace(/\s|€/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
const amount = (label: string) => z.union([z.number(), z.string(), z.null()]).optional().transform((v, ctx) => {
  const n = parseAmount(v);
  if (n === null) return null;
  if (Number.isNaN(n)) { ctx.addIssue({ code: "custom", message: `${label}: número no vàlid` }); return z.NEVER; }
  if (n < 0) { ctx.addIssue({ code: "custom", message: `${label}: no pot ser negatiu` }); return z.NEVER; }
  return Math.round(n * 10000) / 10000;
});
const intIn = (label: string, max: number) => z.union([z.number(), z.string(), z.null()]).optional().transform((v, ctx) => {
  const n = parseAmount(v);
  if (n === null) return null;
  if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > max) { ctx.addIssue({ code: "custom", message: `${label}: ha de ser un número enter entre 0 i ${max}` }); return z.NEVER; }
  return n;
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data no vàlida").nullable().optional().or(z.literal("").transform(() => null)).transform((v) => v || null);
const text = (max: number) => z.string().trim().max(max, `Màxim ${max} caràcters`).nullable().optional().transform((v) => (v ? v : null));
const PHONE = /^(\+34)?[6789]\d{8}$/;
const cleanPhone = (v: string) => v.replace(/[\s.-]/g, "");

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/* ============================================================== esquemes per servei */

const address = z.object({ street: text(200), city: text(100), postal_code: z.string().trim().regex(/^\d{5}$/, "Codi postal: 5 xifres").nullable().optional().or(z.literal("").transform(() => null)), province: text(80) }).partial().nullable().optional();
/** Titular del servei: es pot omplir amb les dades del client (sense trepitjar el que s'ha escrit). */
const holder = z.object({ name: text(200), tax_id: text(20), phone: text(30), email: z.string().trim().email("Correu no vàlid").nullable().optional().or(z.literal("").transform(() => null)) }).partial().default({});
const telecomEconomics = z.object({
  monthly_eur: amount("Quota mensual"),
  promo_monthly_eur: amount("Quota en promoció"),
  promo_months: intIn("Mesos de promoció", 60),
  activation_eur: amount("Cost d'alta"),
  installation_eur: amount("Cost d'instal·lació"),
  permanence_months: intIn("Mesos de permanència", 60),
  penalty_eur: amount("Penalització"),
}).partial().default({});
const telecomDates = z.object({ requested_at: date, installation_at: date, activated_at: date }).partial().default({});

const fibraFields = {
  holder,
  operator: z.string({ required_error: "Tria l'operador", invalid_type_error: "Tria l'operador" }).trim().min(1, "Tria l'operador").max(60),
  product: text(160),
  operation: z.enum(FIBRA_OPERATIONS).default("alta_nova"),
  speed_mbps: intIn("Velocitat", 100_000),
  technology: z.enum(["FTTH", "HFC", "altres"]).nullable().optional(),
  install_address: address,
  fixed_line: z.object({
    enabled: z.boolean().default(false),
    number: z.string().trim().nullable().optional(),
    portability: z.boolean().default(false),
    donor_operator: text(60),
  }).default({ enabled: false, portability: false }),
  operator_ref: text(80),
  economics: telecomEconomics,
  dates: telecomDates,
  observations: text(4000),
};

export const fibraDetails = z.object(fibraFields).superRefine((d, ctx) => {
  if (d.fixed_line.enabled && d.fixed_line.number && !PHONE.test(cleanPhone(d.fixed_line.number))) ctx.addIssue({ code: "custom", path: ["fixed_line", "number"], message: "Número de fix no vàlid (9 xifres)" });
  if (d.fixed_line.enabled && d.fixed_line.portability && !d.fixed_line.number) ctx.addIssue({ code: "custom", path: ["fixed_line", "number"], message: "Per portar el fix cal el número actual" });
  if (d.fixed_line.portability && !d.fixed_line.donor_operator) ctx.addIssue({ code: "custom", path: ["fixed_line", "donor_operator"], message: "Indica l'operador donant de la portabilitat" });
  if (d.economics.promo_monthly_eur != null && !d.economics.promo_months) ctx.addIssue({ code: "custom", path: ["economics", "promo_months"], message: "Indica quants mesos dura la promoció" });
});
export const mobilDetails = z.object({
  holder,
  operator: fibraFields.operator, product: fibraFields.product, operator_ref: fibraFields.operator_ref,
  economics: telecomEconomics, dates: telecomDates, observations: fibraFields.observations,
});
export const fibraMobilDetails = z.object({
  ...fibraFields,
  package: z.object({
    package_monthly_eur: amount("Preu del paquet"),
    name: text(160),
  }).default({}),
}).superRefine((d, ctx) => {
  if (d.package.package_monthly_eur == null) ctx.addIssue({ code: "custom", path: ["package", "package_monthly_eur"], message: "Indica el preu mensual del paquet" });
});
export const assegurancaDetails = z.object({
  holder,
  insurer: z.string({ required_error: "Indica la companyia asseguradora", invalid_type_error: "Indica la companyia asseguradora" }).trim().min(1, "Indica la companyia asseguradora").max(80),
  insurance_type: z.enum(INSURANCE_TYPES, { errorMap: () => ({ message: "Tria el tipus d'assegurança" }) }),
  policy_number: text(60),
  insured_object: text(200),
  /** Prima ANUAL. La periodicitat és la forma de pagament. */
  premium_eur: amount("Prima anual"),
  periodicity: z.enum(PERIODICITIES).default("anual"),
  effect_date: date,
  expiry_date: date,
  auto_renewal: z.boolean().default(true),
  notice_days: intIn("Dies de preavís", 365),
  /** Data del PROPER rebut: no és el venciment de la pòlissa. */
  next_payment_date: date,
  observations: text(4000),
}).superRefine((d, ctx) => {
  if (d.effect_date && d.expiry_date && d.expiry_date <= d.effect_date) ctx.addIssue({ code: "custom", path: ["expiry_date"], message: "El venciment ha de ser posterior a la data d'efecte" });
  if (d.premium_eur == null) ctx.addIssue({ code: "custom", path: ["premium_eur"], message: "Indica la prima anual" });
});
export const alarmaDetails = z.object({
  holder,
  company: z.string({ required_error: "Indica l'empresa d'alarmes", invalid_type_error: "Indica l'empresa d'alarmes" }).trim().min(1, "Indica l'empresa d'alarmes").max(80),
  product: text(160),
  install_address: address,
  equipment: z.array(z.object({ name: z.string().trim().min(1, "Nom de l'equip").max(80), qty: intIn("Quantitat", 999).default(1) })).max(40).default([]),
  central_receptora: z.boolean().default(true),
  contract_ref: text(80),
  economics: telecomEconomics,
  dates: telecomDates,
  incidents: text(4000),
  observations: text(4000),
});
export const plaquesDetails = z.object({
  holder,
  install_address: address,
  installer: z.string({ required_error: "Indica l'instal·lador", invalid_type_error: "Indica l'instal·lador" }).trim().min(1, "Indica l'instal·lador").max(120),
  power_kwp: amount("Potència pic"),
  panels: z.object({ count: intIn("Nombre de plaques", 10_000), model: text(120), watt: intIn("Potència per placa", 2000) }).partial().default({}),
  inverter: z.object({ model: text(120), kw: amount("Potència de l'inversor") }).partial().default({}),
  battery: z.object({ model: text(120), kwh: amount("Capacitat de bateria") }).partial().nullable().optional(),
  estimated_production_kwh: amount("Producció estimada"),
  surplus: z.enum(["compensacio", "venda", "sense"]).default("compensacio"),
  budget_eur: amount("Pressupost"),
  financing: z.object({ kind: z.enum(["comptat", "financat", "renting"]).default("comptat"), entity: text(80), months: intIn("Mesos de finançament", 240), monthly_eur: amount("Quota del finançament") }).default({ kind: "comptat" }),
  payment_schedule: z.array(z.object({ concept: z.string().trim().min(1).max(120), due_date: date, amount_eur: amount("Import del pagament"), paid: z.boolean().default(false) })).max(24).default([]),
  phase: z.enum(SOLAR_PHASES).default("estudi"),
  warranties: z.array(z.object({ concept: z.string().trim().min(1).max(120), years: intIn("Anys de garantia", 50) })).max(20).default([]),
  maintenance_next_date: date,
  observations: text(4000),
}).superRefine((d, ctx) => {
  if (d.power_kwp == null || d.power_kwp === 0) ctx.addIssue({ code: "custom", path: ["power_kwp"], message: "Indica la potència de la instal·lació (kWp)" });
  const sched = d.payment_schedule.reduce((a, p) => a + (p.amount_eur ?? 0), 0);
  if (d.budget_eur != null && sched > 0 && Math.abs(sched - d.budget_eur) > 0.01) ctx.addIssue({ code: "custom", path: ["payment_schedule"], message: `El calendari de pagaments suma ${sched.toFixed(2)} € i el pressupost és de ${d.budget_eur.toFixed(2)} €` });
  if (d.financing.kind !== "comptat" && !d.financing.entity) ctx.addIssue({ code: "custom", path: ["financing", "entity"], message: "Indica l'entitat del finançament" });
});
export const altresDetails = z.object({
  holder,
  provider: z.string({ required_error: "Indica el proveïdor", invalid_type_error: "Indica el proveïdor" }).trim().min(1, "Indica el proveïdor").max(120),
  description: z.string({ required_error: "Descriu el servei", invalid_type_error: "Descriu el servei" }).trim().min(1, "Descriu el servei").max(400),
  monthly_eur: amount("Quota mensual"),
  observations: text(4000),
});

export const lineInput = z.object({
  id: z.string().uuid().optional(),
  phone_number: z.string().trim().nullable().optional().transform((v) => (v ? cleanPhone(v) : null)),
  line_type: z.enum(["nova", "portabilitat"]).default("nova"),
  donor_operator: text(60),
  holder_name: text(160),
  tariff: text(120),
  data_gb: amount("Dades (GB)"),
  price_monthly_eur: amount("Preu de la línia"),
  included_in_package: z.boolean().default(false),
  status: z.enum(LINE_STATUSES).default("pendent"),
  activated_at: date,
  notes: text(1000),
}).superRefine((l, ctx) => {
  if (l.phone_number && !PHONE.test(l.phone_number)) ctx.addIssue({ code: "custom", path: ["phone_number"], message: "Número de mòbil no vàlid (9 xifres)" });
  if (l.line_type === "portabilitat" && !l.phone_number) ctx.addIssue({ code: "custom", path: ["phone_number"], message: "Una portabilitat necessita el número actual" });
  if (l.line_type === "portabilitat" && !l.donor_operator) ctx.addIssue({ code: "custom", path: ["donor_operator"], message: "Indica l'operador donant" });
  if (!l.tariff) ctx.addIssue({ code: "custom", path: ["tariff"], message: "Cada línia necessita la seva tarifa" });
  if (l.status === "activa" && !l.activated_at) ctx.addIssue({ code: "custom", path: ["activated_at"], message: "Indica la data d'activació de la línia" });
});
export type LineInput = z.infer<typeof lineInput>;

const SCHEMA: Partial<Record<ContractService, z.ZodTypeAny>> = {
  fibra: fibraDetails, fibra_telefonia: fibraDetails, mobil: mobilDetails, fibra_mobil: fibraMobilDetails,
  assegurances: assegurancaDetails, alarmes: alarmaDetails, plaques_solars: plaquesDetails, altres: altresDetails,
};
export const servicesWithLines: readonly ContractService[] = ["mobil", "fibra_mobil"];

export interface Issue { path: string; message: string }
const issuesOf = (e: z.ZodError, prefix = ""): Issue[] => e.issues.map((i) => ({ path: [prefix, ...i.path].filter((x) => x !== "").join("."), message: i.message }));

/** Valida les dades pròpies d'un servei i en retorna la versió neta (la que es desa a `details`). */
export function parseDetails(service: ContractService, details: unknown): { ok: true; data: Record<string, unknown> } | { ok: false; issues: Issue[] } {
  const schema = SCHEMA[service];
  if (!schema) return { ok: true, data: {} }; // energia: les dades són a les columnes de sempre
  const r = schema.safeParse(details ?? {});
  return r.success ? { ok: true, data: r.data as Record<string, unknown> } : { ok: false, issues: issuesOf(r.error, "details") };
}

export interface ServiceContractDraft {
  service: ContractService; status: ContractStatus; details?: unknown; lines?: unknown[];
  supply_id?: string | null; retailer?: string | null; start_date?: string | null; end_date?: string | null; signed_at?: string | null;
}
/**
 * Validació completa d'un contracte multiservei (formulari en temps real i servidor).
 * Un esborrany admet dades incompletes, però mai números negatius ni formats incorrectes.
 */
export function validateServiceContract(k: ServiceContractDraft): { ok: boolean; issues: Issue[]; details: Record<string, unknown>; lines: LineInput[] } {
  const issues: Issue[] = [];
  const draft = k.status === "esborrany";
  const fam = SERVICE_FAMILY[k.service];
  const tr = canTransition(k.service, null, k.status);
  if (!tr.ok) issues.push({ path: "status", message: tr.reason });
  if (isEnergyService(k.service)) {
    if (!k.retailer) issues.push({ path: "retailer", message: "Falta la comercialitzadora" });
    return { ok: issues.length === 0, issues, details: {}, lines: [] };
  }
  // un servei que no és d'energia no s'enllaça mai a un CUPS
  if (k.supply_id) issues.push({ path: "supply_id", message: "Aquest servei no té CUPS: no s'ha d'enllaçar a un subministrament d'energia" });
  const p = parseDetails(k.service, k.details);
  let details: Record<string, unknown> = {};
  if (p.ok) details = p.data;
  else issues.push(...(draft ? p.issues.filter((i) => /negatiu|no vàlid|enter|Codi postal|posterior|caràcters/.test(i.message)) : p.issues));
  const lines: LineInput[] = [];
  if (servicesWithLines.includes(k.service)) {
    (k.lines ?? []).forEach((raw, i) => {
      const r = lineInput.safeParse(raw);
      if (r.success) lines.push(r.data);
      else issues.push(...issuesOf(r.error, `lines.${i}`).filter((x) => !draft || /negatiu|no vàlid/.test(x.message)));
    });
    const live = lines.filter((l) => l.status !== "baixa");
    if (!draft && fam === "mobil" && live.length === 0) issues.push({ path: "lines", message: "Afegeix com a mínim una línia de mòbil" });
    const nums = live.map((l) => l.phone_number).filter(Boolean);
    const dup = nums.find((n, i) => nums.indexOf(n) !== i);
    if (dup) issues.push({ path: "lines", message: `El número ${dup} està repetit en dues línies` });
  }
  if (!draft && fam === "assegurances" && !(details as { expiry_date?: string }).expiry_date && k.status !== "esborrany") issues.push({ path: "details.expiry_date", message: "Indica la data de venciment de la pòlissa" });
  if (k.start_date && k.end_date && k.end_date < k.start_date) issues.push({ path: "end_date", message: "La data de finalització és anterior a la d'inici" });
  return { ok: issues.length === 0, issues, details, lines };
}

/* ============================================================== imports i paquet (sense doble comptatge) */

export interface ServiceTotals {
  /** Quota mensual real que paga el client (la que compta per a informes i comissions). */
  monthly_eur: number;
  /** Suma de les quotes individuals (només informativa en un paquet). */
  individual_sum_eur: number;
  /** Estalvi del paquet respecte de contractar-ho per separat (≥ 0 o null si no és un paquet). */
  package_saving_eur: number | null;
  one_off_eur: number;
  active_lines: number;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
/**
 * Totals d'un contracte. En un paquet fibra + mòbil el preu és el del paquet: les línies incloses
 * NO se sumen una altra vegada; només s'hi afegeixen les línies extra no incloses.
 */
export function serviceTotals(service: ContractService, details: Record<string, unknown>, lines: { price_monthly_eur?: number | string | null; included_in_package?: boolean | null; status?: string | null }[] = []): ServiceTotals {
  const d = details as { economics?: { monthly_eur?: number | null; activation_eur?: number | null; installation_eur?: number | null }; package?: { package_monthly_eur?: number | null }; premium_eur?: number | null; periodicity?: (typeof PERIODICITIES)[number]; monthly_eur?: number | null; budget_eur?: number | null };
  const live = lines.filter((l) => l.status !== "baixa");
  const linesSum = live.reduce((a, l) => a + Number(l.price_monthly_eur ?? 0), 0);
  const oneOff = (d.economics?.activation_eur ?? 0) + (d.economics?.installation_eur ?? 0);
  switch (service) {
    case "mobil": return { monthly_eur: r2(linesSum), individual_sum_eur: r2(linesSum), package_saving_eur: null, one_off_eur: r2(oneOff), active_lines: live.length };
    case "fibra_mobil": {
      const pack = d.package?.package_monthly_eur ?? 0;
      const extra = live.filter((l) => !l.included_in_package).reduce((a, l) => a + Number(l.price_monthly_eur ?? 0), 0);
      const individual = (d.economics?.monthly_eur ?? 0) + linesSum;
      return { monthly_eur: r2(pack + extra), individual_sum_eur: r2(individual), package_saving_eur: individual > 0 ? r2(Math.max(0, individual - pack - extra)) : null, one_off_eur: r2(oneOff), active_lines: live.length };
    }
    case "assegurances": {
      // la prima és ANUAL; la periodicitat només diu com es paga (un pagament únic no és una quota)
      const once = d.periodicity === "unica";
      const monthly = once ? 0 : (d.premium_eur ?? 0) / 12;
      return { monthly_eur: r2(monthly), individual_sum_eur: r2(monthly), package_saving_eur: null, one_off_eur: once ? r2(d.premium_eur ?? 0) : 0, active_lines: 0 };
    }
    case "plaques_solars": return { monthly_eur: 0, individual_sum_eur: 0, package_saving_eur: null, one_off_eur: r2(d.budget_eur ?? 0), active_lines: 0 };
    case "altres": return { monthly_eur: r2(d.monthly_eur ?? 0), individual_sum_eur: r2(d.monthly_eur ?? 0), package_saving_eur: null, one_off_eur: 0, active_lines: 0 };
    default: {
      const m = d.economics?.monthly_eur ?? 0;
      return { monthly_eur: r2(m), individual_sum_eur: r2(m), package_saving_eur: null, one_off_eur: r2(oneOff), active_lines: 0 };
    }
  }
}

/**
 * Columnes «resum» que es desen a `crm_contracts` a partir de les dades del servei, perquè els filtres,
 * els informes i els avisos funcionin igual per a tots els serveis.
 *  - retailer: el proveïdor (operador, asseguradora, empresa d'alarmes, instal·lador…);
 *  - end_date: només quan el servei té un venciment real (pòlissa). Les plaques no en tenen;
 *  - permanence_end: final de la permanència (fibra, mòbil, alarma).
 */
export function summaryColumns(service: ContractService, details: Record<string, unknown>, lines: LineInput[], startDate: string | null) {
  const d = details as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const provider = d.operator ?? d.insurer ?? d.company ?? d.installer ?? d.provider ?? null;
  const months = d.economics?.permanence_months as number | null | undefined;
  const from = startDate ?? d.dates?.activated_at ?? d.dates?.installation_at ?? null;
  const permanence_end = months && from ? addMonths(from, months) : null;
  const t = serviceTotals(service, details, lines);
  return {
    retailer: provider as string | null,
    product: (d.product ?? d.package?.name ?? (d.insurance_type ? INSURANCE_TYPE_LABEL[d.insurance_type as keyof typeof INSURANCE_TYPE_LABEL] : null) ?? d.description ?? null) as string | null,
    provider_ref: (d.operator_ref ?? d.policy_number ?? d.contract_ref ?? null) as string | null,
    end_date: service === "assegurances" ? (d.expiry_date ?? null) as string | null : null,
    permanence_end,
    monthly_eur: t.monthly_eur || null,
  };
}

/* ============================================================== avisos */

export type AlertKind = "permanencia" | "venciment_polissa" | "preavis_polissa" | "promocio" | "manteniment" | "pagament_obra" | "incidencia" | "linia_pendent";
export interface ContractAlert { kind: AlertKind; level: "info" | "warn" | "urgent"; date: string | null; days: number | null; message: string }

export interface AlertContract {
  service: ContractService; status: ContractStatus; start_date?: string | null; end_date?: string | null; permanence_end?: string | null;
  details?: Record<string, unknown> | null; lines?: { status: string; phone_number?: string | null }[];
}
/**
 * Avisos d'un contracte a data `today`. La data del proper rebut d'una assegurança NO és el venciment:
 * el venciment surt de `expiry_date`, i el preavís per no renovar es calcula a partir d'aquest.
 */
export function contractAlerts(k: AlertContract, today: string, horizonDays = 60): ContractAlert[] {
  const out: ContractAlert[] = [];
  if (CLOSED.includes(k.status)) return out;
  const d = (k.details ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fam = SERVICE_FAMILY[k.service];
  const push = (kind: AlertKind, date: string | null, message: string, urgentAt = 15) => {
    const days = date ? daysBetween(today, date) : null;
    if (days != null && (days > horizonDays || days < -365)) return;
    out.push({ kind, date, days, message, level: days == null ? "warn" : days <= urgentAt ? "urgent" : "warn" });
  };
  if (k.status === "incidencia") out.push({ kind: "incidencia", level: "urgent", date: null, days: null, message: "Contracte amb una incidència oberta" });
  if ((fam === "fibra" || fam === "mobil" || fam === "fibra_mobil" || fam === "alarmes") && k.permanence_end) {
    push("permanencia", k.permanence_end, `La permanència acaba el ${k.permanence_end}${d.economics?.penalty_eur ? ` (penalització actual ${d.economics.penalty_eur} €)` : ""}`);
  }
  if ((fam === "fibra" || fam === "fibra_mobil" || fam === "mobil") && d.economics?.promo_months && (k.start_date || d.dates?.activated_at)) {
    const end = addMonths(k.start_date ?? d.dates.activated_at, d.economics.promo_months);
    push("promocio", end, `La promoció acaba el ${end}: la quota passarà a ${d.economics.monthly_eur ?? "?"} €/mes`);
  }
  if (fam === "assegurances") {
    const exp = (d.expiry_date ?? k.end_date ?? null) as string | null;
    if (exp) {
      push("venciment_polissa", exp, d.auto_renewal ? `La pòlissa es renova automàticament el ${exp}` : `La pòlissa venç el ${exp} i NO es renova sola`);
      if (d.auto_renewal && d.notice_days) {
        const limit = addDaysIso(exp, -Number(d.notice_days));
        push("preavis_polissa", limit, `Últim dia per comunicar la no renovació: ${limit} (${d.notice_days} dies de preavís)`, 7);
      }
    }
  }
  if (fam === "plaques_solars") {
    if (d.maintenance_next_date) push("manteniment", d.maintenance_next_date, `Manteniment previst el ${d.maintenance_next_date}`);
    for (const p of (d.payment_schedule ?? []) as { concept: string; due_date: string | null; paid: boolean }[]) if (!p.paid && p.due_date) push("pagament_obra", p.due_date, `Pagament pendent: ${p.concept} (${p.due_date})`, 7);
  }
  for (const l of k.lines ?? []) if (l.status === "incidencia") out.push({ kind: "linia_pendent", level: "urgent", date: null, days: null, message: `Línia ${l.phone_number ?? "nova"} amb incidència` });
  return out.sort((a, b) => (a.days ?? -9999) - (b.days ?? -9999));
}
function addDaysIso(iso: string, n: number) {
  const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}

/* ============================================================== autocompletar dades del client */

/**
 * Omple el formulari amb les dades del client SENSE trepitjar el que l'usuari ja ha escrit o tocat:
 * només s'omplen els camps buits i no tocats.
 */
export function fillFromClient<T extends Record<string, unknown>>(form: T, client: Partial<Record<keyof T, unknown>>, touched: ReadonlySet<keyof T | string>): { form: T; filled: (keyof T)[] } {
  const next = { ...form };
  const filled: (keyof T)[] = [];
  for (const key of Object.keys(client) as (keyof T)[]) {
    const v = client[key];
    if (v == null || v === "") continue;
    const cur = next[key];
    if (touched.has(key) || (cur != null && cur !== "")) continue;
    (next as Record<keyof T, unknown>)[key] = v;
    filled.push(key);
  }
  return { form: next, filled };
}

/** Serveis d'energia (es mantenen tal com estaven). */
export const ENERGY = ENERGY_CONTRACT_SERVICES;

/** Famílies de servei vives d'un client (per a la fitxa 360°): energia pels subministraments i la resta pels contractes. */
export function activeFamilies(contracts: { service?: ContractService | null; status: ContractStatus }[], supplies: { energy_type: string; status?: string | null; archived_at?: string | null }[]): ServiceFamily[] {
  const set = new Set<ServiceFamily>();
  for (const s of supplies) if (!s.archived_at && s.status === "actiu") set.add(s.energy_type === "gas" ? "gas" : "electricitat");
  for (const k of contracts) if (k.service && ["actiu", "renovacio_pendent"].includes(k.status)) set.add(SERVICE_FAMILY[k.service]);
  return SERVICE_CARDS.map((c) => c.family).filter((f) => set.has(f));
}
