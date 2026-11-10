"use client";
/** Plantilles de lectura IA (Fase 11): client de /api/tariffs/reading-templates. */
import type { ReadResult, TemplateCheck, TemplateDef, TemplateOp, WorkbookGrid } from "@/comparator/xlsx-template";
import type { ReadingRule } from "@/comparator/tariff-table";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}
const post = <T,>(action: string, data: unknown) => call<T>("/api/tariffs/reading-templates", { method: "POST", body: JSON.stringify({ action, data }) });

export type TemplateStatus = "pendent" | "verificada" | "revisio" | "error" | "desactivada";
export interface TemplateRow { id: string; retailer_id: string | null; supplier: string; name: string; doc_type: string; status: TemplateStatus; active: boolean; current_version: number; verified_version: number | null; verified_at: string | null; verified_by_name: string | null; last_read_at: string | null; last_read_status: string | null; last_errors: { text: string }[]; validated_pct: number | null; created_by_name: string | null; created_at: string; updated_at: string }
export interface TemplateDetail {
  template: TemplateRow;
  version: { version: number; definition: TemplateDef; sample_name: string | null; sample_grid: WorkbookGrid | null; checks: TemplateCheck[]; note: string | null; created_by_name: string | null; created_at: string } | null;
  versions: { version: number; note: string | null; sample_name: string | null; created_by_name: string | null; created_at: string }[];
  corrections: { id: string; version: number | null; instruction: string; ops: TemplateOp[]; status: string; created_by_name: string | null; created_at: string }[];
  reads: { id: string; version: number; file_name: string; status: string; imported: boolean; created_by_name: string | null; created_at: string; summary: { stats: ReadResult["stats"] | null; compatibility: ReadResult["compatibility"] | null; validity: ReadResult["validity"] | null } }[];
  /** Fase 12: biblioteca de regles apreses d'aquesta plantilla, exemples validats i regles generals aprovades. */
  library?: LibraryRule[];
  examples?: { id: string; version: number | null; product_key: string; product_name: string; row_number: number | null; expected: (number | null)[]; explanation: string | null; explained: boolean; status: string; created_by_name: string | null; created_at: string; decided_by_name: string | null }[];
  generalRules?: { supplier: string; rule: ReadingRule }[];
}
export interface LibraryRule { id: string; supplier: string; product: string; rule: ReadingRule; source: string; status: "proposada" | "aprovada" | "rebutjada" | "substituida"; note: string | null; template_id: string | null; template_version: number | null; scope: string | null; columns: string[] | null; example: unknown; created_by_name: string | null; created_at: string; decided_by_name: string | null; decided_at: string | null }
export const STATUS_TXT: Record<TemplateStatus, { label: string; cls: string }> = {
  verificada: { label: "VERIFICADA", cls: "bg-emerald-500/12 text-emerald-700 ring-emerald-600/25 dark:text-emerald-300" },
  pendent: { label: "PENDENT DE VERIFICACIÓ", cls: "bg-amber-500/12 text-amber-800 ring-amber-600/25 dark:text-amber-300" },
  revisio: { label: "REVISIÓ NECESSÀRIA", cls: "bg-orange-500/12 text-orange-800 ring-orange-600/25 dark:text-orange-300" },
  error: { label: "ERROR DE LECTURA", cls: "bg-red-500/12 text-red-700 ring-red-600/25 dark:text-red-300" },
  desactivada: { label: "DESACTIVADA", cls: "bg-zinc-500/12 text-zinc-600 ring-zinc-500/25 dark:text-zinc-300" },
};

export const tplApi = {
  list: (p: { retailer?: string; supplier?: string; defs?: boolean } = {}) =>
    call<{ templates: TemplateRow[]; defs?: { templateId: string; version: number; definition: TemplateDef }[]; generalRules?: { supplier: string; rule: ReadingRule }[]; migrated: boolean }>(`/api/tariffs/reading-templates?${new URLSearchParams({ r: "list", ...(p.retailer ? { retailer: p.retailer } : {}), ...(p.supplier ? { supplier: p.supplier } : {}), ...(p.defs ? { defs: "1" } : {}) })}`),
  get: (id: string, version?: number, effective = false) => call<TemplateDetail>(`/api/tariffs/reading-templates?${new URLSearchParams({ r: "get", id, ...(version ? { version: String(version) } : {}), ...(effective ? { effective: "1" } : {}) })}`),
  previous: (id: string) => call<{ read: { id: string; file_name: string; created_at: string; summary: Pick<ReadResult, "products" | "validity"> } | null }>(`/api/tariffs/reading-templates?r=previous&id=${encodeURIComponent(id)}`),
  create: (d: { retailerId: string | null; supplier: string; name: string; definition: TemplateDef; sample: WorkbookGrid | null; note?: string | null }) => post<{ template: TemplateRow; checks: TemplateCheck[] }>("create", d),
  version: (d: { id: string; definition: TemplateDef; note?: string | null; instruction?: string | null; ops?: TemplateOp[]; sample?: WorkbookGrid | null }) => post<{ template: TemplateRow; version: number; checks: TemplateCheck[] }>("version", d),
  verify: (id: string, version: number) => post<VerifyResult>("verify", { id, version }),
  active: (id: string, active: boolean) => post<{ template: TemplateRow }>("active", { id, active }),
  duplicate: (id: string, name: string) => post<{ template: TemplateRow }>("duplicate", { id, name }),
  restore: (id: string, version: number) => post<{ template: TemplateRow; version: number }>("restore", { id, version }),
  read: (d: { id: string; version: number; fileName: string; result: ReadResult; imported?: boolean }) => post<{ id: string; status: string }>("read", d),
  imported: (readId: string) => post<{ ok: boolean }>("imported", { readId }),
  learn: (d: { templateId: string; rule: ReadingRule; scope: "producte" | "plantilla" | "general"; instruction?: string | null; example?: { productKey: string; productName: string; row: number | null; expected: (number | null)[]; explanation: string | null; discountApplied: boolean | null; explained: boolean } | null }) =>
    post<LearnResult>("learn", d),
  decideRule: (id: string, decision: "aprovada" | "rebutjada") => post<{ ok: boolean; status: string; version: number | null; unitReports?: string[]; effect?: RuleEffect | null; catalog?: CatalogReprocess | { error: string } | null }>("decideRule", { id, decision }),
  rules: (p: { id?: string; supplier?: string }) => call<{ rules: LibraryRule[]; migrated: boolean }>(`/api/tariffs/reading-templates?${new URLSearchParams({ r: "rules", ...(p.id ? { id: p.id } : {}), ...(p.supplier ? { supplier: p.supplier } : {}) })}`),
  learnPricing: (d: { supplier: string; product: string | null; title: string; model: string; feeAllowed: string | null; feeUnit: string | null; instruction: string | null }) => post<{ id: string; status: string; version: number }>("learnPricing", d),
  aiSuggest: (supplier: string, rows: string[]) => post<{ proposals: { row: number; title: string; set: Record<string, unknown>; explanation: string }[] }>("aiSuggest", { supplier, rows }),
};

/** Excel (XLSX/XLS) o CSV del navegador → graella amb un parser real (SheetJS; es carrega només quan cal). Sense OCR. */
export async function readWorkbook(file: File): Promise<WorkbookGrid> {
  const [XLSX, { gridFromXlsx }] = await Promise.all([import("xlsx"), import("@/comparator/xlsx-template")]);
  return gridFromXlsx(XLSX as never, await file.arrayBuffer(), file.name);
}

/* 036 · regles d'unitat apreses: es desen, s'apliquen al catàleg i retornen un informe verificable */
export interface UnitRuleReport { rule: string; originalUnit: string; targetUnit: string; persisted: boolean; approved: boolean; affected: number; reprocessed: number; validated: number; pending: { product: string; reasons: string[] }[]; failed: { product: string; error: string }[]; completed: boolean }
const tPost = <T,>(b: unknown) => call<T>("/api/tariffs", { method: "POST", body: JSON.stringify(b) });
export const unitRulesApi = {
  learn: (rule: { supplier: string; energyType: "luz" | "gas"; concept: "terme_fix_gas"; unit: "eur_dia" | "eur_mes" | "eur_any"; product?: string | null; accessTariff?: string | null; templateId?: string | null; instruction?: string | null }) =>
    tPost<{ ruleId: string; report: UnitRuleReport; text: string }>({ action: "unit_rule_learn", rule }),
  approve: (id: string) => tPost<{ ruleId: string; report: UnitRuleReport; text: string }>({ action: "unit_rule_approve", id }),
  apply: (id: string) => tPost<{ ruleId: string; report: UnitRuleReport; text: string }>({ action: "unit_rule_apply", id }),
};

/** Fase 15 · resultat verificable d'ensenyar una regla (cada estat per separat). */
export interface RuleEffect { executed: boolean; reason?: string; version?: number; document?: string | null; ruleFound?: boolean; affected?: number; resolved?: number; pending?: { row: number; name: string; reasons: string[] }[]; counts?: { identified: number; interpreted: number; review: number; pending: number; failed: number } | null }
export interface CatalogReprocess { affected: number; unchanged: number; updated: number; validated: number; pending: { product: string; reasons: string[] }[]; skipped: { product: string; reason: string }[]; failed: { product: string; error: string }[]; note?: string }
export interface LearnResult {
  libraryId: string | null; status: string; version: number | null; approved: boolean; persisted: boolean; duplicate: boolean; replaced: string[]; warning?: string;
  existing?: { title: string; approved: boolean } | null;
  verification?: { verified: boolean; failing: string[] } | null; effect?: RuleEffect | null; catalog?: CatalogReprocess | { error: string } | null;
}

/** Text del xat amb els QUATRE estats separats: regla guardada · regla aprovada · plantilla verificada · tarifes validades. */
export function learnSummary(r: LearnResult, scopeLabel: string): string {
  const e = r.effect;
  const c = r.catalog && !("error" in r.catalog) ? r.catalog : null;
  const head = r.approved && e?.executed && (e.affected ?? 0) > 0 ? `REGLA APLICADA CORRECTAMENT${r.duplicate ? " (ja existia i s'ha tornat a executar)" : ""}\n• Tarifes afectades: ${e.affected} · resoltes: ${e.resolved} · continuen pendents: ${e.pending?.length ?? 0}` : r.approved && e?.executed ? "ATENCIÓ: la regla està desada i aprovada però NO s'aplica a cap tarifa d'aquest document (revisa l'abast o la condició)" : null;
  const lines = [
    ...(head ? [head] : []),
    r.duplicate ? `• Regla guardada: ja existia una regla idèntica («${r.existing?.title ?? "—"}», ${r.existing?.approved ? "aprovada" : "pendent d'aprovació"}); no s'ha duplicat i s'ha tornat a executar.` : `• Regla guardada: SÍ (${scopeLabel.toLowerCase()}${r.version ? `, versió ${r.version} de la plantilla` : ", biblioteca"}), comprovada a Supabase.${r.replaced.length ? ` Substitueix: ${r.replaced.join(" · ")}.` : ""}`,
    `• Regla aprovada: ${r.approved ? "SÍ (Direcció)" : "NO — pendent d'aprovació de Direcció; fins llavors les tarifes surten «pendent d'aprovació»"}.`,
    `• Plantilla verificada: ${!r.verification ? "no s'ha intentat (cal Direcció)" : r.verification.verified ? "SÍ" : `NO — ${r.verification.failing.slice(0, 3).join(" · ") || "comprovacions pendents"} (les regles aprovades s'apliquen igualment)`}.`,
    e?.executed ? `• Motor: la regla s'executa sobre «${e.document ?? "document desat"}» (v${e.version}): ${e.affected} tarifes afectades, ${e.resolved} resoltes, ${e.pending?.length ?? 0} encara pendents.${e.counts ? ` Total del document: ${e.counts.identified} identificades · ${e.counts.interpreted} interpretades · ${e.counts.review + e.counts.pending} pendents.` : ""}` : `• Motor: ${e?.reason ?? "no s'ha pogut comprovar"}.`,
    ...(e?.pending ?? []).slice(0, 8).map((p) => `   – fila ${p.row} «${p.name}»: ${p.reasons.join("; ") || "pendent"}`),
    c ? `• Tarifes validades al catàleg: ${c.validated} (afectades ${c.affected} · actualitzades ${c.updated} · sense canvis ${c.unchanged} · pendents ${c.pending.length}${c.skipped.length ? ` · d'altres documents ${c.skipped.length}` : ""}${c.failed.length ? ` · ERRORS ${c.failed.length}` : ""}).` : r.catalog && "error" in r.catalog ? `• Catàleg: NO reprocessat (${r.catalog.error}).` : "• Catàleg: no reprocessat (només ho fa Direcció quan la regla està aprovada).",
    ...(c?.failed ?? []).slice(0, 5).map((f) => `   – ERROR ${f.product}: ${f.error}`),
  ];
  return lines.join("\n");
}

/** Fase 15 · resultat de verificar: comprovacions de LECTURA amb les tarifes que bloquegen i les discrepàncies amb el catàleg. */
export interface VerifyResult {
  verified: boolean; message?: string; template?: TemplateRow;
  checks: (TemplateCheck & { blockers?: { row: number; name: string; reasons: string[] }[] })[];
  counts?: { identified: number; interpreted: number; review: number; pending: number; failed: number } | null;
  catalog?: CatalogReprocess | null;
}
export function verifySummary(r: VerifyResult): string {
  const c = r.counts;
  const lines = [
    r.verified ? "PLANTILLA VERIFICADA (lectura correcta)." : "La plantilla NO es pot verificar encara.",
    c ? `• Document: ${c.identified} identificades · ${c.interpreted} interpretades · ${c.review + c.pending} pendents · ${c.failed} fallides.` : "",
    ...r.checks.filter((x) => !x.ok).map((x) => `• ✗ ${x.label}: ${x.detail}`),
    ...r.checks.filter((x) => !x.ok).flatMap((x) => (x.blockers ?? []).slice(0, 15).map((b) => `   – fila ${b.row} «${b.name}»: ${b.reasons.join("; ")}`)),
  ];
  const com = r.checks.find((x) => x.id === "comercial");
  if (com?.blockers?.length) lines.push(`• Validació COMERCIAL pendent (no impedeix verificar la lectura; aquestes tarifes no s'activen): ${com.blockers.length}`, ...com.blockers.slice(0, 15).map((b) => `   – fila ${b.row} «${b.name}»: ${b.reasons.join("; ")}`));
  if (r.catalog) lines.push(`• Catàleg (simulació): ${r.catalog.affected} tarifes d'aquest document · ${r.catalog.updated} amb diferències respecte de la lectura · ${r.catalog.validated} validables${r.catalog.skipped.length ? ` · ${r.catalog.skipped.length} d'altres documents` : ""}.`);
  return lines.filter(Boolean).join("\n");
}
