import "server-only";
/**
 * REGLES APRESES DEL LECTOR DE FACTURES (migració 037).
 * «Ensenyar aquesta correcció a la IA»: una denominació de línia → concepte econòmic, per a una comercialitzadora o totes.
 *  · Ho pot proposar qualsevol usuari intern que fa comparatives; queda PROPOSADA i no s'aplica.
 *  · Direcció i la cap d'administració l'aproven (si la proposen elles mateixes, l'aproven en el mateix acte).
 *  · Una regla general (totes les comercialitzadores) només la pot crear o aprovar Direcció.
 * Només les aprovades s'apliquen a les factures que es llegeixen a partir d'aleshores (text i lectura IA).
 */
import { z } from "zod";
import { ENERGY_CONCEPTS, lineKey, type LineRule } from "@/comparator/energy-breakdown";
import { adminClient, HttpError } from "./supabase";
import type { U } from "./crm";

type Db = ReturnType<typeof adminClient>;
const MIGRATION = "Falta aplicar la migració supabase/migrations/037_regles_linies_factura.sql a Supabase";
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /invoice_line_rules|schema cache/i.test(e.message ?? ""));
const APPROVERS = ["admin", "cap_administrativa"];
const canApprove = (u: U, general: boolean) => (general ? u.profile.role === "admin" : APPROVERS.includes(u.profile.role));

export interface InvoiceRuleRow {
  id: string; retailer: string | null; pattern: string; concept: LineRule["concept"]; status: "proposada" | "aprovada" | "revocada";
  example_label: string | null; previous_concept: string | null; note: string | null; created_by_name: string | null; approved_by_name: string | null; approved_at: string | null; created_at: string;
}
export const toLineRule = (r: Pick<InvoiceRuleRow, "id" | "retailer" | "pattern" | "concept">): LineRule => ({ id: r.id, retailer: r.retailer, pattern: r.pattern, concept: r.concept });

/** Regles aprovades (si la migració no s'ha aplicat, cap: el lector funciona com abans). */
export async function loadInvoiceRules(db: Db = adminClient()): Promise<LineRule[]> {
  const r = await db.from("invoice_line_rules").select("id,retailer,pattern,concept").eq("status", "aprovada").limit(2000);
  if (r.error) return [];
  return ((r.data ?? []) as InvoiceRuleRow[]).map(toLineRule);
}

const learnInput = z.object({
  retailer: z.string().trim().min(1).max(80).nullable(),
  label: z.string().trim().min(2).max(200),
  concept: z.enum(ENERGY_CONCEPTS),
  previousConcept: z.enum(ENERGY_CONCEPTS).nullish(),
  note: z.string().max(500).nullish(),
});

export async function learnInvoiceRule(u: U, raw: unknown): Promise<{ rule: InvoiceRuleRow; applied: boolean; message: string }> {
  if (u.profile.role === "colaborador") throw new HttpError(403, "Sense accés");
  const b = learnInput.parse(raw);
  const pattern = lineKey(b.label);
  if (pattern.length < 2) throw new HttpError(400, "La línia no té cap text reconeixible per fer-ne una regla (només xifres o unitats)");
  const general = b.retailer == null;
  if (general && u.profile.role !== "admin") throw new HttpError(403, "Només Direcció pot crear regles per a totes les comercialitzadores. Tria «només aquesta comercialitzadora».");
  const db = adminClient();
  const approve = canApprove(u, general);
  const now = new Date().toISOString();
  if (approve) {
    // la nova regla substitueix la vigent per a la mateixa denominació
    let q = db.from("invoice_line_rules").update({ status: "revocada", revoked_at: now }).neq("status", "revocada").eq("pattern", pattern);
    q = general ? q.is("retailer", null) : q.eq("retailer", b.retailer!);
    await q;
  }
  const ins = await db.from("invoice_line_rules").insert({
    retailer: b.retailer, pattern, concept: b.concept, status: approve ? "aprovada" : "proposada", example_label: b.label, previous_concept: b.previousConcept ?? null, note: b.note ?? null,
    created_by: u.user.id, created_by_name: u.profile.name, ...(approve ? { approved_by: u.user.id, approved_by_name: u.profile.name, approved_at: now } : {}),
  }).select("*").single();
  if (ins.error) {
    if (missing(ins.error)) throw new HttpError(409, MIGRATION);
    if (ins.error.code === "23505") throw new HttpError(409, "Ja hi ha una regla proposada per a aquesta línia: falta que l'aprovin");
    throw new HttpError(500, "No s'ha pogut desar la regla");
  }
  const where = general ? "totes les comercialitzadores" : b.retailer;
  return {
    rule: ins.data as InvoiceRuleRow, applied: approve,
    message: approve
      ? `Regla desada i aprovada: «${pattern}» = ${b.concept} (${where}). S'aplicarà a les factures que es llegeixin a partir d'ara.`
      : `Regla proposada: «${pattern}» = ${b.concept} (${where}). Encara NO s'aplica: l'ha d'aprovar Direcció o la cap d'administració.`,
  };
}

export async function decideInvoiceRule(u: U, id: string, approve: boolean): Promise<InvoiceRuleRow> {
  const db = adminClient();
  const cur = await db.from("invoice_line_rules").select("*").eq("id", id).maybeSingle();
  if (cur.error && missing(cur.error)) throw new HttpError(409, MIGRATION);
  const row = cur.data as InvoiceRuleRow | null;
  if (!row) throw new HttpError(404, "Regla no trobada");
  if (!canApprove(u, row.retailer == null)) throw new HttpError(403, row.retailer == null ? "Només Direcció decideix les regles generals" : "Només Direcció o la cap d'administració poden aprovar o revocar regles");
  const now = new Date().toISOString();
  if (approve) {
    if (row.status === "revocada") throw new HttpError(409, "Aquesta regla està revocada: torna-la a ensenyar des de la factura");
    let q = db.from("invoice_line_rules").update({ status: "revocada", revoked_at: now }).eq("status", "aprovada").eq("pattern", row.pattern).neq("id", id);
    q = row.retailer == null ? q.is("retailer", null) : q.eq("retailer", row.retailer);
    await q;
  }
  const r = await db.from("invoice_line_rules").update(approve ? { status: "aprovada", approved_by: u.user.id, approved_by_name: u.profile.name, approved_at: now } : { status: "revocada", revoked_at: now }).eq("id", id).select("*").single();
  if (r.error) throw new HttpError(500, "No s'ha pogut actualitzar la regla");
  return r.data as InvoiceRuleRow;
}

/** Llista per a la pantalla de regles (proposades i aprovades). Els comercials només veuen les aprovades i les seves. */
export async function listInvoiceRules(u: U): Promise<{ rules: InvoiceRuleRow[]; canApprove: boolean; migration: boolean }> {
  const db = adminClient();
  const r = await db.from("invoice_line_rules").select("*").neq("status", "revocada").order("created_at", { ascending: false }).limit(500);
  if (r.error) { if (missing(r.error)) return { rules: [], canApprove: false, migration: false }; throw new HttpError(500, "No s'han pogut carregar les regles"); }
  const all = (r.data ?? []) as (InvoiceRuleRow & { created_by?: string | null })[];
  const approver = APPROVERS.includes(u.profile.role);
  return { rules: approver ? all : all.filter((x) => x.status === "aprovada" || x.created_by === u.user.id), canApprove: approver, migration: true };
}
