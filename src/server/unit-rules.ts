import "server-only";
/**
 * REGLES D'UNITAT APRESES (migració 036): guardar → aprovar → APLICAR (reprocessar el catàleg) → revalidar → informar.
 * El xat d'aprenentatge només confirma «Norma aplicada» quan aquest circuit ha acabat bé i en dona les xifres.
 * Seguretat: només Direcció aprova i aplica; les validacions del catàleg (checkVersion, permanència) no es relaxen mai
 * i una tarifa només passa a activa (validada) si l'ÚNIC bloqueig que tenia era la unitat que la regla resol.
 */
import { z } from "zod";
import { latestPerProduct } from "@/comparator/catalog";
import { permanenceIssues } from "@/comparator/permanence";
import { normalizeOffer, validateOffer } from "@/comparator/tariff-engine";
import { isUnitBlocker, pickRule, reportText, describeRule, unknownUnit, UNIT_LABEL, UNIT_CONCEPTS, type RuleApplicationReport, type UnitRule } from "@/comparator/unit-rules";
import type { OfferVersion } from "@/comparator/types";
import { adminClient, HttpError } from "./supabase";
import type { U } from "./crm";
import { listCatalog, loadUnitRules, permanenceRule, saveVersion, setStatus, unitRuleFromRow, type UnitRuleRow as Row } from "./tariffs";

type Db = ReturnType<typeof adminClient>;
const MIGRATION = "Falta aplicar la migració supabase/migrations/036_regles_unitat_apreses.sql a Supabase";
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /tariff_unit_rules|tariff_rule_runs|schema cache/i.test(e.message ?? ""));
const staff = (u: U) => { if (!["admin", "cap_administrativa", "administrativa"].includes(u.profile.role)) throw new HttpError(403, "Només l'administració pot ensenyar regles al lector de tarifes"); };
const admin = (u: U) => { if (u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot aprovar i aplicar regles al catàleg"); };
const toRule = unitRuleFromRow;

const learnInput = z.object({
  supplier: z.string().trim().min(1).max(80),
  energyType: z.enum(["luz", "gas"]),
  concept: z.enum(UNIT_CONCEPTS),
  unit: z.enum(["eur_dia", "eur_mes", "eur_any"]),
  product: z.string().trim().max(200).nullish(),
  accessTariff: z.string().trim().max(20).nullish(),
  templateId: z.string().uuid().nullish(),
  instruction: z.string().max(2000).nullish(),
});

/**
 * Desa la regla. Si la desa Direcció, queda aprovada i S'APLICA tot seguit (reprocessament + validació); si la desa
 * l'administració, queda proposada i el xat diu clarament que encara no s'ha aplicat.
 */
export async function learnUnitRule(u: U, raw: unknown) {
  staff(u);
  const b = learnInput.parse(raw);
  const db = adminClient();
  let templateName: string | null = null;
  if (b.templateId) templateName = ((await db.from("tariff_templates").select("name").eq("id", b.templateId).maybeSingle()).data?.name as string | undefined) ?? null;
  const isAdmin = u.profile.role === "admin";
  const now = new Date().toISOString();
  if (isAdmin) await revokeSameScope(db, b.supplier, b.energyType, b.concept, b.product ?? null, b.accessTariff ?? null, templateName);
  const ins = await db.from("tariff_unit_rules").insert({
    supplier: b.supplier, energy_type: b.energyType, concept: b.concept, unit: b.unit, product: b.product || null, access_tariff: b.accessTariff || null,
    template_id: b.templateId ?? null, template_name: templateName, status: isAdmin ? "aprovada" : "proposada", source: "xat", instruction: b.instruction ?? null,
    created_by: u.user.id, created_by_name: u.profile.name, ...(isAdmin ? { approved_by: u.user.id, approved_by_name: u.profile.name, approved_at: now } : {}),
  }).select("*").single();
  if (ins.error) {
    if (missing(ins.error)) throw new HttpError(409, MIGRATION);
    if (ins.error.code === "23505") throw new HttpError(409, "Ja hi ha una regla proposada amb aquest mateix abast: Direcció l'ha d'aprovar o revocar");
    throw new HttpError(500, "No s'ha pogut desar la regla");
  }
  const rule = toRule(ins.data as Row);
  if (isAdmin) return applyUnitRule(u, rule.id);
  // proposada: es diu quantes tarifes afectaria, però no s'aplica res
  const affected = (await affectedVersions(u, [...(await loadUnitRules(db)), { ...rule, status: "aprovada" }], rule.id)).length;
  const report: RuleApplicationReport = { rule: describeRule(rule), originalUnit: UNIT_LABEL[rule.unit], targetUnit: "€/dia", persisted: true, approved: false, affected, reprocessed: 0, validated: 0, pending: [], failed: [], completed: false };
  return { ruleId: rule.id, report, text: reportText(report) };
}

async function revokeSameScope(db: Db, supplier: string, energy: string, concept: string, product: string | null, tariff: string | null, template: string | null) {
  const cur = await db.from("tariff_unit_rules").select("id,supplier,product,access_tariff,template_name").eq("energy_type", energy).eq("concept", concept).neq("status", "revocada");
  if (cur.error) { if (missing(cur.error)) throw new HttpError(409, MIGRATION); return; }
  const same = ((cur.data ?? []) as Row[]).filter((r) => r.supplier.trim().toLowerCase() === supplier.trim().toLowerCase() && (r.product ?? "").toLowerCase() === (product ?? "").toLowerCase() && (r.access_tariff ?? "").toUpperCase() === (tariff ?? "").toUpperCase() && (r.template_name ?? "") === (template ?? ""));
  if (same.length) await db.from("tariff_unit_rules").update({ status: "revocada", revoked_at: new Date().toISOString() }).in("id", same.map((r) => r.id));
}

/** Versions del catàleg (la més recent de cada producte, activa o esborrany) que la regla resol. */
async function affectedVersions(u: U, rules: UnitRule[], ruleId: string) {
  const { versions } = await listCatalog(u, { allVersions: true });
  const pool = (versions as (OfferVersion & { usedAt?: string | null })[]).filter((v) => v.origin !== "crm" && (v.status === "activa" || v.status === "esborrany"));
  const latest = latestPerProduct(pool.map((v) => ({ ...v, status: "activa" as const }))).map((l) => pool.find((v) => v.id === l.id)!).filter(Boolean);
  return latest.filter((v) => UNIT_CONCEPTS.some((c) => unknownUnit(v, c) && pickRule(rules, v, c).rule?.id === ruleId));
}

export async function approveUnitRule(u: U, id: string) {
  admin(u);
  const db = adminClient();
  const r = await db.from("tariff_unit_rules").select("*").eq("id", z.string().uuid().parse(id)).maybeSingle();
  if (r.error) { if (missing(r.error)) throw new HttpError(409, MIGRATION); throw new HttpError(500, "No s'ha pogut llegir la regla"); }
  if (!r.data) throw new HttpError(404, "Regla no trobada");
  const row = r.data as Row;
  if (row.status === "revocada") throw new HttpError(409, "La regla està revocada");
  if (row.status !== "aprovada") {
    await db.from("tariff_unit_rules").update({ status: "revocada", revoked_at: new Date().toISOString() }).neq("id", row.id).eq("energy_type", row.energy_type).eq("concept", row.concept).eq("status", "aprovada").ilike("supplier", row.supplier).then(() => undefined);
    const up = await db.from("tariff_unit_rules").update({ status: "aprovada", approved_by: u.user.id, approved_by_name: u.profile.name, approved_at: new Date().toISOString() }).eq("id", row.id);
    if (up.error) throw new HttpError(500, "No s'ha pogut aprovar la regla");
  }
  return applyUnitRule(u, row.id);
}

/**
 * Aplica una regla aprovada al catàleg: reprocessa amb el motor únic, revalida i actualitza l'estat.
 * Una tarifa passa a ACTIVA (validada) només si abans l'únic bloqueig era la unitat i ara no en té cap (ni avisos).
 * La resta queda en esborrany amb els motius exactes. Les versions usades en propostes no es toquen: se'n crea una de nova.
 */
export async function applyUnitRule(u: U, id: string) {
  admin(u);
  const db = adminClient();
  const rules = await loadUnitRules(db);
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new HttpError(409, "La regla no està aprovada: no s'aplica");
  const run = await db.from("tariff_rule_runs").insert({ rule_id: id, run_by: u.user.id, run_by_name: u.profile.name }).select("id").single();
  if (run.error) throw new HttpError(missing(run.error) ? 409 : 500, missing(run.error) ? MIGRATION : "No s'ha pogut iniciar l'aplicació");
  const report: RuleApplicationReport = { rule: describeRule(rule), originalUnit: UNIT_LABEL[rule.unit] ?? rule.unit, targetUnit: "€/dia", persisted: true, approved: true, affected: 0, reprocessed: 0, validated: 0, pending: [], failed: [], completed: false };
  try {
    const permRule = await permanenceRule(db);
    const targets = await affectedVersions(u, rules, id);
    report.affected = targets.length;
    for (const v of targets) {
      const label = `${v.supplierName} · ${v.productName}${v.accessTariff ? ` (${v.accessTariff})` : ""}`;
      try {
        const blocking = (o: OfferVersion) => [...validateOffer(o).filter((i) => i.level === "error" || i.level === "falta" || i.level === "avis").map((i) => i.text), ...permanenceIssues(o, permRule)];
        const before = blocking(v);
        const n = normalizeOffer(v, { rule: permRule, unitRules: rules });
        if (n.offer.gasFixedEurDay == null) { report.failed.push({ product: label, error: n.changes.find((c) => c.startsWith("⚠")) ?? "La regla no ha pogut convertir el valor" }); continue; }
        const after = blocking(n.offer);
        const onlyUnit = before.length > 0 && before.every(isUnitBlocker);
        const saved = await saveVersion(u, { ...n.offer, id: v.id, status: "esborrany" }, { origin: "manual" });
        report.reprocessed++;
        if (v.status === "activa" || (onlyUnit && after.length === 0)) {
          await setStatus(saved.id, "activa"); // torna a validar (checkVersion + permanència) abans d'activar
          report.validated++;
        } else {
          const reasons = after.length ? after : before.filter((x) => !isUnitBlocker(x));
          report.pending.push({ product: label, reasons: reasons.length ? reasons : ["Estava en esborrany per una revisió anterior: cal activar-la manualment"] });
        }
      } catch (e) {
        report.failed.push({ product: label, error: String((e as { message?: unknown })?.message ?? e).slice(0, 200) });
      }
    }
    report.completed = report.failed.length === 0;
  } finally {
    await db.from("tariff_rule_runs").update({ finished_at: new Date().toISOString(), status: report.completed ? "completada" : "amb_errors", affected: report.affected, reprocessed: report.reprocessed, validated: report.validated, pending: report.pending.length, failed: report.failed.length, report }).eq("id", run.data!.id);
  }
  return { ruleId: id, runId: run.data!.id as string, report, text: reportText(report) };
}

export async function listUnitRules(u: U) {
  staff(u);
  const db = adminClient();
  const r = await db.from("tariff_unit_rules").select("*").order("created_at", { ascending: false }).limit(300);
  if (r.error) { if (missing(r.error)) return { rules: [], migrated: false }; throw new HttpError(500, "No s'han pogut llegir les regles"); }
  const runs = await db.from("tariff_rule_runs").select("rule_id,started_at,finished_at,status,affected,reprocessed,validated,pending,failed").order("started_at", { ascending: false }).limit(500);
  const last = new Map<string, unknown>();
  for (const x of runs.data ?? []) if (!last.has(x.rule_id as string)) last.set(x.rule_id as string, x);
  return { rules: ((r.data ?? []) as Row[]).map((x) => ({ ...toRule(x), createdBy: x.created_by_name, createdAt: x.created_at, instruction: x.instruction, lastRun: last.get(x.id) ?? null })), migrated: true };
}

/** Revoca una regla: deixa d'aplicar-se a lectures noves. Les tarifes ja reprocessades conserven el valor (i la fórmula). */
export async function revokeUnitRule(u: U, id: string) {
  admin(u);
  const r = await adminClient().from("tariff_unit_rules").update({ status: "revocada", revoked_at: new Date().toISOString() }).eq("id", z.string().uuid().parse(id)).neq("status", "revocada").select("id").maybeSingle();
  if (r.error) throw new HttpError(missing(r.error) ? 409 : 500, missing(r.error) ? MIGRATION : "No s'ha pogut revocar");
  if (!r.data) throw new HttpError(404, "Regla no trobada o ja revocada");
  return { ok: true };
}
