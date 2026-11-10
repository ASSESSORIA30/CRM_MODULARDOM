import "server-only";
/**
 * Contractació multiservei (servidor). Tot passa per `crm_contracts` (vegeu contractAction a crm.ts):
 * aquí hi ha la sincronització de línies de mòbil, la comissió prevista dels serveis i les regles de Direcció.
 */
import { z } from "zod";
import { adminClient, HttpError, type requireUser } from "./supabase";
import { finStaff } from "./permissions";
import { isEnergyService, servicesWithLines, type ContractService, type LineInput } from "@/core/multiservice";
import {
  SERVICE_COMMISSION_MODALITIES, checkCommissionStatus, expectedServiceCommission, COMMISSION_STATUSES,
  type CommissionStatus, type ServiceCommissionRule,
} from "@/core/service-commissions";
import type { ContractStatus } from "@/core/crm";

type U = Awaited<ReturnType<typeof requireUser>>;

/**
 * Desa les línies d'un contracte: les que porten id s'actualitzen, les noves s'afegeixen i les que ja no hi són
 * es donen de BAIXA (no s'esborren mai: l'historial de cada línia es conserva).
 */
export async function syncLines(u: U, contractId: string, service: ContractService, lines: LineInput[]) {
  if (!servicesWithLines.includes(service)) return { inserted: 0, updated: 0, removed: 0 };
  const { data: existing, error } = await u.sb.from("crm_contract_lines").select("id,status").eq("contract_id", contractId);
  if (error) throw new HttpError(500, "No s'han pogut llegir les línies");
  const known = new Map((existing ?? []).map((l) => [l.id as string, l.status as string]));
  const keep = new Set<string>();
  let inserted = 0, updated = 0, removed = 0;
  for (const [i, l] of lines.entries()) {
    const row = {
      position: i + 1, phone_number: l.phone_number, line_type: l.line_type, donor_operator: l.donor_operator, holder_name: l.holder_name, tariff: l.tariff,
      data_gb: l.data_gb, price_monthly_eur: l.price_monthly_eur, included_in_package: service === "fibra_mobil" ? l.included_in_package : false,
      status: l.status, activated_at: l.activated_at, notes: l.notes, removed_at: l.status === "baixa" ? new Date().toISOString() : null,
    };
    if (l.id && known.has(l.id)) {
      keep.add(l.id);
      const r = await u.sb.from("crm_contract_lines").update(row).eq("id", l.id).eq("contract_id", contractId);
      if (r.error) throw new HttpError(400, lineError(r.error.message, i));
      updated++;
    } else {
      const r = await u.sb.from("crm_contract_lines").insert({ ...row, contract_id: contractId }).select("id").single();
      if (r.error) throw new HttpError(400, lineError(r.error.message, i));
      inserted++;
    }
  }
  for (const [id, status] of known) {
    if (keep.has(id) || status === "baixa") continue;
    await u.sb.from("crm_contract_lines").update({ status: "baixa", removed_at: new Date().toISOString() }).eq("id", id);
    removed++;
  }
  return { inserted, updated, removed };
}
const lineError = (msg: string, i: number) => /duplicate|unique/.test(msg) ? `Línia ${i + 1}: aquest número ja és en una altra línia del contracte` : `Línia ${i + 1}: dades no vàlides`;

const AUTO_STATUSES: CommissionStatus[] = ["sense_regla", "pendent_activacio", "prevista", "retrocedida", "no_aplica"];

/**
 * Recalcula la comissió PREVISTA d'un contracte multiservei amb les regles aprovades de Direcció.
 * Només toca l'estat si encara és automàtic: una comissió meritada, liquidada o cobrada no es reescriu mai.
 */
export async function refreshServiceCommission(contractId: string) {
  const sb = adminClient();
  const { data: k } = await sb.from("crm_contracts").select("id,service,retailer,product,status,signed_at,start_date,monthly_eur,details,collaborator_id,client_id,updated_at").eq("id", contractId).maybeSingle();
  if (!k || isEnergyService(k.service as ContractService)) return null;
  const [{ data: rules }, { data: lines }, { data: fin }, { data: client }] = await Promise.all([
    sb.from("fin_service_rules").select("*").eq("status", "aprovada"),
    sb.from("crm_contract_lines").select("status").eq("contract_id", contractId),
    sb.from("crm_contract_finance").select("commission_status").eq("contract_id", contractId).maybeSingle(),
    sb.from("crm_clients").select("collaborator_id").eq("id", k.client_id).maybeSingle(),
  ]);
  const res = expectedServiceCommission((rules ?? []) as ServiceCommissionRule[], {
    service: k.service as ContractService, retailer: k.retailer as string, product: k.product as string | null, status: k.status as ContractStatus,
    signed_at: k.signed_at as string | null, start_date: k.start_date as string | null, monthly_eur: k.monthly_eur == null ? null : Number(k.monthly_eur),
    details: k.details as Record<string, unknown>, lines: (lines ?? []) as { status: string }[],
    ended_at: ["anullat", "baixa"].includes(k.status as string) ? String(k.updated_at).slice(0, 10) : null,
    has_collaborator: !!(k.collaborator_id ?? client?.collaborator_id),
  });
  const current = (fin?.commission_status ?? null) as CommissionStatus | null;
  const patch: Record<string, unknown> = {
    contract_id: contractId, commission_expected_eur: res.total_eur, collaborator_eur: res.collaborator_eur || null, clawback_until: res.clawback_until,
    rule_ids: res.items.map((i) => i.rule_id), commission_model: [...new Set(res.items.map((i) => i.modality))].join("+") || null, updated_at: new Date().toISOString(),
  };
  if (!current || AUTO_STATUSES.includes(current)) patch.commission_status = res.status;
  else if (res.status === "retrocedida") patch.notes = `Baixa dins del termini de retrocessió: ${res.clawback_eur} € a regularitzar`;
  const { error } = await sb.from("crm_contract_finance").upsert(patch, { onConflict: "contract_id" });
  if (error) console.warn("[multiservei] comissió prevista no desada:", error.code);
  return res;
}

/* ======================================================================= estat manual de la comissió */

export const commissionStatusInput = z.object({
  commission_status: z.enum(COMMISSION_STATUSES),
  commission_paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  settlement_ref: z.string().trim().max(80).nullable().optional().transform((v) => v || null),
});
export async function setCommissionStatus(u: U, contractId: string, data: unknown) {
  if (!(await finStaff(u, "edit"))) throw new HttpError(403, "Només Direcció o l'Administració autoritzada poden canviar l'estat de la comissió");
  const f = commissionStatusInput.parse(data);
  const { data: k } = await u.sb.from("crm_contracts").select("status").eq("id", contractId).maybeSingle();
  if (!k) throw new HttpError(404, "Contracte no trobat");
  const { data: fin } = await u.sb.from("crm_contract_finance").select("rule_ids").eq("contract_id", contractId).maybeSingle();
  const ruleIds = (fin?.rule_ids ?? []) as string[];
  const { data: rules } = ruleIds.length ? await u.sb.from("fin_service_rules").select("requires_activation").in("id", ruleIds) : { data: [] };
  const requires = (rules ?? []).some((r) => r.requires_activation);
  const err = checkCommissionStatus(f.commission_status, f, { status: k.status as ContractStatus }, requires);
  if (err) throw new HttpError(400, err);
  const { error } = await u.sb.from("crm_contract_finance").upsert({ contract_id: contractId, ...f, updated_by: u.user.id, updated_at: new Date().toISOString() }, { onConflict: "contract_id" });
  if (error) throw new HttpError(400, "No s'ha pogut desar l'estat de la comissió");
  return { ok: true };
}

/* ======================================================================= regles de Direcció */

export const serviceRuleInput = z.object({
  provider: z.string().trim().min(1, "Falta el proveïdor").max(120),
  service: z.enum(["fibra_telefonia", "assegurances", "alarmes", "fibra", "mobil", "fibra_mobil", "plaques_solars", "altres"]),
  product: z.string().trim().max(160).nullable().optional().transform((v) => v || null),
  modality: z.enum(SERVICE_COMMISSION_MODALITIES),
  amount_eur: z.coerce.number().min(0, "L'import no pot ser negatiu").nullable().optional(),
  pct: z.coerce.number().min(0).max(100, "El percentatge no pot superar el 100 %").nullable().optional(),
  months: z.coerce.number().int().min(1).max(120).nullable().optional(),
  requires_activation: z.boolean().default(true),
  clawback_months: z.coerce.number().int().min(0).max(60).nullable().optional(),
  clawback_pct: z.coerce.number().min(0).max(100).nullable().optional(),
  collaborator_pct: z.coerce.number().min(0).max(100).nullable().optional(),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
}).superRefine((r, ctx) => {
  if (r.modality === "pct_quota" && r.pct == null) ctx.addIssue({ code: "custom", path: ["pct"], message: "Indica el percentatge" });
  if (r.modality !== "pct_quota" && r.amount_eur == null) ctx.addIssue({ code: "custom", path: ["amount_eur"], message: "Indica l'import" });
  if (r.valid_from && r.valid_to && r.valid_to < r.valid_from) ctx.addIssue({ code: "custom", path: ["valid_to"], message: "La data final és anterior a la inicial" });
});

export async function listServiceRules(u: U) {
  if (!(await finStaff(u))) throw new HttpError(403, "Sense accés a les regles de comissió");
  const { data, error } = await u.sb.from("fin_service_rules").select("*").order("provider").order("service");
  if (error) throw new HttpError(500, "No s'han pogut llegir les regles");
  return { rules: data ?? [], canApprove: u.profile.role === "admin" };
}
export async function saveServiceRule(u: U, data: unknown, id?: string) {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot crear o modificar regles de comissió");
  const p = serviceRuleInput.safeParse(data);
  if (!p.success) throw new HttpError(400, [...new Set(p.error.issues.map((i) => i.message))].join(" · "));
  // una regla aprovada no es modifica: es crea una versió nova (traçabilitat de les comissions ja calculades)
  if (id) {
    const { data: cur } = await u.sb.from("fin_service_rules").select("status").eq("id", id).maybeSingle();
    if (!cur) throw new HttpError(404, "Regla no trobada");
    if (cur.status === "aprovada") throw new HttpError(409, "Regla aprovada: arxiva-la i crea'n una de nova");
    const { error } = await u.sb.from("fin_service_rules").update(p.data).eq("id", id);
    if (error) throw new HttpError(400, "No s'ha pogut desar la regla");
    return { id };
  }
  const { data: row, error } = await u.sb.from("fin_service_rules").insert({ ...p.data, status: "esborrany", created_by: u.user.id }).select("id").single();
  if (error) throw new HttpError(400, "No s'ha pogut crear la regla");
  return { id: row.id as string };
}
export async function setServiceRuleStatus(u: U, id: string, status: "aprovada" | "arxivada" | "esborrany") {
  if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció aprova o arxiva regles de comissió");
  const patch = status === "aprovada" ? { status, approved_by: u.user.id, approved_at: new Date().toISOString() } : { status };
  const { error } = await u.sb.from("fin_service_rules").update(patch).eq("id", id);
  if (error) throw new HttpError(400, "No s'ha pogut canviar l'estat de la regla");
  return { ok: true };
}
