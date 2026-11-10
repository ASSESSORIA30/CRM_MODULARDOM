/**
 * COMISSIONS DELS SERVEIS QUE NO SÓN D'ENERGIA (fibra, mòbil, paquets, assegurances, alarmes, plaques, altres).
 *
 * L'energia continua amb el motor de sempre (`fin_rules`). Per a la resta, Direcció configura regles per
 * proveïdor i producte a `fin_service_rules` (migració 039) i aquí es calcula la comissió PREVISTA d'un contracte.
 *
 * Principis:
 *  - una regla només compta si està APROVADA, activa i vigent a la data del contracte;
 *  - una regla d'un producte concret substitueix la genèrica del mateix proveïdor i modalitat;
 *  - «condicionada a activació»: fins que el contracte no és actiu, la comissió queda «pendent d'activació»;
 *  - mai es marca com a cobrada perquè el contracte sigui actiu: cobrada = hi ha data de cobrament;
 *    liquidada = hi ha referència de liquidació real;
 *  - la retrocessió s'aplica si el contracte es dona de baixa dins del termini de la regla.
 */
import { SERVICE_FAMILY, addMonths, type ContractService } from "./multiservice";
import type { ContractStatus } from "./crm";

export const SERVICE_COMMISSION_MODALITIES = ["fix_alta", "pct_quota", "recurrent", "per_linia", "per_paquet", "per_installacio", "per_kwp"] as const;
export type ServiceCommissionModality = (typeof SERVICE_COMMISSION_MODALITIES)[number];
export const MODALITY_LABEL: Record<ServiceCommissionModality, string> = {
  fix_alta: "Import fix per alta",
  pct_quota: "Percentatge de la quota",
  recurrent: "Recurrent mensual",
  per_linia: "Per línia",
  per_paquet: "Per paquet",
  per_installacio: "Per instal·lació",
  per_kwp: "Per kWp instal·lat",
};
export const COMMISSION_STATUSES = ["sense_regla", "pendent_activacio", "prevista", "meritada", "liquidada", "cobrada", "retrocedida", "no_aplica"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];
export const COMMISSION_STATUS_LABEL: Record<CommissionStatus, string> = {
  sense_regla: "Sense regla aprovada", pendent_activacio: "Pendent d'activació", prevista: "Prevista", meritada: "Meritada",
  liquidada: "Liquidada", cobrada: "Cobrada", retrocedida: "Retrocedida", no_aplica: "No aplica",
};

export interface ServiceCommissionRule {
  id: string;
  provider: string;
  service: ContractService;
  product: string | null;
  modality: ServiceCommissionModality;
  amount_eur: number | null;
  pct: number | null;
  months: number | null;
  requires_activation: boolean;
  clawback_months: number | null;
  clawback_pct: number | null;
  collaborator_pct: number | null;
  valid_from: string | null;
  valid_to: string | null;
  status: "esborrany" | "aprovada" | "arxivada";
}

export interface CommissionContract {
  service: ContractService; retailer: string; product: string | null; status: ContractStatus;
  signed_at?: string | null; start_date?: string | null; monthly_eur?: number | null;
  details?: Record<string, unknown> | null;
  lines?: { status: string }[];
  /** Data de baixa / anul·lació (per a la retrocessió). */
  ended_at?: string | null;
  has_collaborator?: boolean;
}

export interface CommissionItem { rule_id: string; modality: ServiceCommissionModality; eur: number; explanation: string }
export interface CommissionResult {
  status: CommissionStatus;
  total_eur: number;
  collaborator_eur: number;
  company_eur: number;
  items: CommissionItem[];
  clawback_until: string | null;
  clawback_eur: number;
  warnings: string[];
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;
const sameService = (a: ContractService, b: ContractService) => a === b || SERVICE_FAMILY[a] === SERVICE_FAMILY[b] && SERVICE_FAMILY[a] === "fibra";

/** Regles aplicables a un contracte (aprovades, vigents i del mateix proveïdor, servei i producte). */
export function applicableRules(rules: ServiceCommissionRule[], k: CommissionContract): ServiceCommissionRule[] {
  const at = k.signed_at ?? k.start_date ?? null;
  const base = rules.filter((r) => r.status === "aprovada" && norm(r.provider) === norm(k.retailer) && sameService(r.service, k.service)
    && (!at || ((!r.valid_from || r.valid_from <= at) && (!r.valid_to || r.valid_to >= at)))
    && (!r.product || norm(r.product) === norm(k.product)));
  // una regla de producte concret substitueix la genèrica de la mateixa modalitat
  return base.filter((r) => r.product || !base.some((o) => o.product && o.modality === r.modality));
}

function itemFor(r: ServiceCommissionRule, k: CommissionContract): CommissionItem | { error: string } {
  const amount = r.amount_eur ?? 0;
  const liveLines = (k.lines ?? []).filter((l) => l.status !== "baixa").length;
  switch (r.modality) {
    case "fix_alta": return { rule_id: r.id, modality: r.modality, eur: r2(amount), explanation: `${amount} € per alta` };
    case "per_paquet":
      if (k.service !== "fibra_mobil") return { error: "La regla «per paquet» només s'aplica a fibra + mòbil" };
      return { rule_id: r.id, modality: r.modality, eur: r2(amount), explanation: `${amount} € per paquet` };
    case "per_linia": return { rule_id: r.id, modality: r.modality, eur: r2(amount * liveLines), explanation: `${amount} € × ${liveLines} línies` };
    case "per_installacio": return { rule_id: r.id, modality: r.modality, eur: r2(amount), explanation: `${amount} € per instal·lació` };
    case "per_kwp": {
      const kwp = Number((k.details as { power_kwp?: number } | null)?.power_kwp ?? 0);
      if (!kwp) return { error: "Falta la potència (kWp) per calcular la comissió per kWp" };
      return { rule_id: r.id, modality: r.modality, eur: r2(amount * kwp), explanation: `${amount} € × ${kwp} kWp` };
    }
    case "recurrent": {
      const m = r.months ?? 12;
      return { rule_id: r.id, modality: r.modality, eur: r2(amount * m), explanation: `${amount} €/mes × ${m} mesos` };
    }
    case "pct_quota": {
      if (!k.monthly_eur) return { error: "Falta la quota mensual per calcular el percentatge" };
      const m = r.months ?? 12;
      return { rule_id: r.id, modality: r.modality, eur: r2((k.monthly_eur * (r.pct ?? 0) / 100) * m), explanation: `${r.pct} % de ${k.monthly_eur} €/mes × ${m} mesos` };
    }
  }
}

/** Comissió prevista d'un contracte multiservei. */
export function expectedServiceCommission(rules: ServiceCommissionRule[], k: CommissionContract): CommissionResult {
  const warnings: string[] = [];
  const empty: CommissionResult = { status: "sense_regla", total_eur: 0, collaborator_eur: 0, company_eur: 0, items: [], clawback_until: null, clawback_eur: 0, warnings };
  if (k.status === "esborrany") return { ...empty, status: "no_aplica", warnings: ["Esborrany: encara no genera comissió"] };
  const rs = applicableRules(rules, k);
  if (!rs.length) { warnings.push(`No hi ha cap regla aprovada per a ${k.retailer}${k.product ? ` · ${k.product}` : ""}`); return empty; }
  const items: CommissionItem[] = [];
  for (const r of rs) {
    const it = itemFor(r, k);
    if ("error" in it) warnings.push(it.error); else items.push(it);
  }
  const total = r2(items.reduce((a, i) => a + i.eur, 0));
  const collabPct = k.has_collaborator ? Math.max(0, ...rs.map((r) => r.collaborator_pct ?? 0)) : 0;
  const collaborator = r2(total * collabPct / 100);
  const needsActivation = rs.some((r) => r.requires_activation);
  const start = k.start_date ?? k.signed_at ?? null;
  const clawMonths = Math.max(0, ...rs.map((r) => r.clawback_months ?? 0));
  const clawUntil = clawMonths && start ? addMonths(start, clawMonths) : null;
  let status: CommissionStatus = "prevista";
  let clawback = 0;
  if (k.status === "anullat" || k.status === "baixa") {
    if (clawUntil && (!k.ended_at || k.ended_at <= clawUntil)) {
      const pct = Math.max(0, ...rs.map((r) => r.clawback_pct ?? 100));
      clawback = r2(total * pct / 100);
      status = "retrocedida";
      warnings.push(`Baixa dins del termini de retrocessió (fins al ${clawUntil}): es retrocedeixen ${clawback} €`);
    } else if (k.status === "anullat" && !start) status = "no_aplica";
  } else if (needsActivation && k.status !== "actiu") {
    status = "pendent_activacio";
    warnings.push("Comissió condicionada a l'activació: no es merita fins que el contracte és actiu");
  }
  return { status, total_eur: total, collaborator_eur: collaborator, company_eur: r2(total - collaborator), items, clawback_until: clawUntil, clawback_eur: clawback, warnings };
}

/**
 * Canvi manual de l'estat de la comissió. Mai «cobrada» sense data de cobrament ni «liquidada» sense la
 * referència de la liquidació real, i mai meritada/cobrada si la regla exigeix activació i el contracte no és actiu.
 */
export function checkCommissionStatus(next: CommissionStatus, f: { commission_paid_at?: string | null; settlement_ref?: string | null }, k: { status: ContractStatus }, requiresActivation: boolean): string | null {
  if (next === "cobrada" && !f.commission_paid_at) return "Per marcar-la com a cobrada cal la data de cobrament real";
  if (next === "liquidada" && !f.settlement_ref) return "Per marcar-la com a liquidada cal la referència de la liquidació";
  if (requiresActivation && ["meritada", "liquidada", "cobrada"].includes(next) && k.status !== "actiu" && k.status !== "finalitzat") return "Comissió condicionada a l'activació: el contracte encara no és actiu";
  return null;
}
