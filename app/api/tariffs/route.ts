import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { finStaff, requireInternal } from "@/server/permissions";
import { remunerationRules } from "@/server/comparisons";
import { activateValidated, importLegacy, legacyReport, listCatalog, permanenceRule, reprocessApply, reprocessPlan, savePermanenceRule, saveVersion, setStatus } from "@/server/tariffs";
import { TARIFF_STATUSES } from "@/comparator/types";
import { applyUnitRule, approveUnitRule, learnUnitRule, listUnitRules, revokeUnitRule } from "@/server/unit-rules";
import { loadUnitRules } from "@/server/tariffs";

export const dynamic = "force-dynamic";

export const GET = handler(async (req): Promise<unknown> => {
  const u = await requireInternal();
  const sp = new URL(req.url).searchParams;
  if (sp.get("r") === "rule") return await permanenceRule(u.sb as never);
  // simulació del reprocessament amb el motor de normalització (no modifica res; només Direcció)
  if (sp.get("r") === "reprocess") return await reprocessPlan(await requireInternal({ staff: true }));
  if (sp.get("r") === "legacy") return await legacyReport(await requireInternal({ staff: true }));
  // 036 · regles d'unitat apreses: les aprovades (per aplicar-les a la previsualització dels lectors) i l'historial
  if (sp.get("r") === "unit_rules") return { rules: await loadUnitRules() };
  if (sp.get("r") === "unit_rules_all") return await listUnitRules(await requireInternal({ staff: true }));
  // Fase 15 · regles de remuneració per estimar la comissió del FEE: dades econòmiques (Direcció i Administració autoritzada)
  if (sp.get("r") === "fee_remuneration") {
    if (!(await finStaff(u))) throw new HttpError(403, "Les comissions només les veuen Direcció i l'Administració autoritzada");
    return { rules: await remunerationRules() };
  }
  // vista interna d'administració: preu base, FEE, preu final, marge anual teòric i comissió estimada d'una comparativa
  if (sp.get("r") === "fee_snapshots") {
    if (!(await finStaff(u))) throw new HttpError(403, "Les dades internes del FEE només les veuen Direcció i l'Administració autoritzada");
    const id = z.string().uuid().parse(sp.get("comparison"));
    const r = await u.sb.from("comparison_pricing_snapshots").select("*").eq("comparison_id", id).order("created_at");
    if (r.error) return { rows: [], migrated: false };
    return { rows: r.data ?? [], migrated: true };
  }
  return await listCatalog(u, { allVersions: new URL(req.url).searchParams.get("all") === "1" });
});

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), offer: z.unknown() }),
  z.object({ action: z.literal("status"), id: z.string().uuid(), status: z.enum(TARIFF_STATUSES) }),
  z.object({ action: z.literal("permanence_rule"), rule: z.unknown() }),
  z.object({ action: z.literal("import_legacy"), ids: z.array(z.string().min(1).max(100)).min(1).max(500) }),
  // crea versions noves en esborrany (mai modifica les existents); cal confirmar-ho explícitament
  z.object({ action: z.literal("reprocess"), ids: z.array(z.string().uuid()).min(1).max(500), confirm: z.literal(true) }),
  // 036 · ensenyar una unitat (Direcció: es desa, s'aplica al catàleg i se'n retorna el resultat verificable)
  z.object({ action: z.literal("unit_rule_learn"), rule: z.unknown() }),
  z.object({ action: z.enum(["unit_rule_approve", "unit_rule_apply", "unit_rule_revoke"]), id: z.string().uuid() }),
  // Fase 15 · Direcció activa d'un cop les tarifes validades (les pendents es queden en esborrany amb el motiu)
  z.object({ action: z.literal("activate_validated"), templateId: z.string().uuid().nullable().optional() }),
]);

/** Alta, edició (crea versió nova si ja s'ha usat o activat) i canvi d'estat. Només equip d'administració. */
export const POST = handler(async (req): Promise<unknown> => {
  const u = await requireInternal({ staff: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Petició no vàlida");
  if (p.data.action === "save") return await saveVersion(u, p.data.offer, { origin: "manual" });
  if (p.data.action === "permanence_rule") return await savePermanenceRule(u, p.data.rule);
  if (p.data.action === "import_legacy") return await importLegacy(u, p.data.ids);
  if (p.data.action === "reprocess") return await reprocessApply(u, p.data.ids);
  if (p.data.action === "unit_rule_learn") return await learnUnitRule(u, p.data.rule);
  if (p.data.action === "unit_rule_approve") return await approveUnitRule(u, p.data.id);
  if (p.data.action === "unit_rule_apply") return await applyUnitRule(u, p.data.id);
  if (p.data.action === "unit_rule_revoke") return await revokeUnitRule(u, p.data.id);
  if (p.data.action === "activate_validated") return await activateValidated(u, { templateId: p.data.templateId ?? null });
  if (p.data.action === "status") return await setStatus(p.data.id, p.data.status);
  throw new HttpError(400, "Acció desconeguda");
});
