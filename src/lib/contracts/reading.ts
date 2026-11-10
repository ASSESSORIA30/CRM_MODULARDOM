// Lector de contractes: esquema de la resposta de la IA, validació estricta i verificació econòmica.
// La IA NO decideix res: proposa dades amb pàgina i text original; aquest mòdul comprova que
// quadrin i genera les discrepàncies que direcció ha de resoldre abans de validar.
import { z } from "zod";

export const PROMPT_VERSION = "contracte-v1";

const cents = z.number().int().min(0).max(1e12);
const page = z.number().int().min(1).max(2000).nullable();
const text = (max = 2000) => z.string().max(max);

export const milestoneSchema = z.object({
  code: text(30).nullable(),
  concept: text(500).min(1),
  amount_cents: cents,
  amount_text: text(60),
  vat_text: text(60).nullable(),
  trigger_condition: text(1000).nullable(),
  page,
  source_text: text(1500),
});
export const phaseSchema = z.object({
  code: text(30).nullable(),
  name: text(300).min(1),
  is_extra: z.boolean(),
  declared_amount_cents: cents.nullable(),
  declared_amount_text: text(60).nullable(),
  page,
  milestones: z.array(milestoneSchema).max(80),
  no_milestones_reason: text(500).nullable(),
});
const located = z.object({ text: text(2000), page });

export const readingSchema = z.object({
  holders: z.array(z.object({ name: text(200), tax_id: text(30).nullable(), page })).max(10),
  contractor: z.object({ name: text(200), tax_id: text(30).nullable(), page }).nullable(),
  site_address: located.nullable(),
  cadastral_ref: located.nullable(),
  document_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  signed_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  total_cents: cents.nullable(),
  total_text: text(80).nullable(),
  total_page: page,
  vat_clause: located.nullable(),
  chapters: z.array(z.object({ concept: text(300), amount_cents: cents, page, source_text: text(800) })).max(40),
  phases: z.array(phaseSchema).max(60),
  payment_terms: located.nullable(),
  later_extras_rule: located.nullable(),
  deadlines: z.array(located).max(20),
  special_conditions: z.array(located).max(40),
  linked_documents: z.array(z.object({ name: text(300), page })).max(30),
  modifications: z.array(located).max(20),
  undetermined: z.array(z.object({ field: text(100), reason: text(500) })).max(50),
});
export type ContractReading = z.infer<typeof readingSchema>;

// Esquema JSON per a l'eina (sortida estructurada del model)
const S = (type: string | string[], extra: Record<string, unknown> = {}) => ({ type, ...extra });
const nstr = S(["string", "null"]);
const npage = S(["integer", "null"], { description: "Número de pàgina del PDF on apareix (1 = primera). null si no se sap." });
const loc = S(["object", "null"], { properties: { text: S("string"), page: npage }, required: ["text", "page"] });
export const readingJsonSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    holders: S("array", { items: S("object", { properties: { name: S("string"), tax_id: nstr, page: npage }, required: ["name", "tax_id", "page"] }) }),
    contractor: S(["object", "null"], { properties: { name: S("string"), tax_id: nstr, page: npage }, required: ["name", "tax_id", "page"] }),
    site_address: loc, cadastral_ref: loc,
    document_date: S(["string", "null"], { description: "AAAA-MM-DD, només si consta escrita" }),
    signed_date: S(["string", "null"], { description: "AAAA-MM-DD de la signatura, només si consta escrita (si el lloc i data estan en blanc: null)" }),
    total_cents: S(["integer", "null"], { description: "Preu total sense IVA en cèntims d'euro" }),
    total_text: nstr, total_page: npage, vat_clause: loc,
    chapters: S("array", { items: S("object", { properties: { concept: S("string"), amount_cents: S("integer"), page: npage, source_text: S("string") }, required: ["concept", "amount_cents", "page", "source_text"] }) }),
    phases: S("array", {
      description: "Totes les fases/blocs de cobrament en l'ordre del contracte, inclosos els extres (cada extra amb les seves fites pròpies).",
      items: S("object", {
        properties: {
          code: nstr, name: S("string"), is_extra: S("boolean"),
          declared_amount_cents: S(["integer", "null"]), declared_amount_text: S(["string", "null"], { description: "Import de la fase exactament com està escrit" }),
          page: npage,
          milestones: S("array", { items: S("object", {
            properties: {
              code: nstr, concept: S("string"), amount_cents: S("integer"), amount_text: S("string", { description: "Import exactament com està escrit" }),
              vat_text: S(["string", "null"], { description: "Tipus d'IVA només si el contracte l'especifica per a aquesta fita" }),
              trigger_condition: S(["string", "null"], { description: "Condició o fet que activa el cobrament, amb paraules del contracte" }),
              page: npage, source_text: S("string", { description: "Fragment literal del contracte (màx. 300 caràcters)" }),
            },
            required: ["code", "concept", "amount_cents", "amount_text", "vat_text", "trigger_condition", "page", "source_text"],
          }) }),
          no_milestones_reason: S(["string", "null"], { description: "Si la fase no té fites al contracte, explica-ho; NO inventis fites ni percentatges" }),
        },
        required: ["code", "name", "is_extra", "declared_amount_cents", "declared_amount_text", "page", "milestones", "no_milestones_reason"],
      }),
    }),
    payment_terms: loc, later_extras_rule: loc,
    deadlines: S("array", { items: loc }), special_conditions: S("array", { items: loc }),
    linked_documents: S("array", { items: S("object", { properties: { name: S("string"), page: npage }, required: ["name", "page"] }) }),
    modifications: S("array", { items: loc }),
    undetermined: S("array", { items: S("object", { properties: { field: S("string"), reason: S("string") }, required: ["field", "reason"] }) }),
  },
  required: ["holders", "contractor", "site_address", "cadastral_ref", "document_date", "signed_date", "total_cents", "total_text", "total_page",
    "vat_clause", "chapters", "phases", "payment_terms", "later_extras_rule", "deadlines", "special_conditions", "linked_documents", "modifications", "undetermined"],
};

export const READING_SYSTEM = `Ets un lector de contractes d'obra de ModularDom. Llegeix el contracte COMPLET, inclosos els annexos, i omple l'eina.
Regles obligatòries:
- Copia només el que hi ha escrit. No dedueixis, no completis i no arrodoneixis res.
- Imports SEMPRE sense IVA, en cèntims d'euro (35.600,00 € = 3560000). Copia també el text literal de l'import.
- Extreu CADA fita de cobrament per separat, en l'ordre del contracte, amb el codi, el concepte, l'import, la condició que l'activa, la pàgina i un fragment literal.
- Cada contracte té els seus imports i fites. No apliquis mai calendaris o percentatges genèrics.
- Els extres amb fites pròpies s'han d'extreure amb aquestes fites. Si un extre o una fase no té fites al contracte, deixa "milestones" buit i explica-ho a "no_milestones_reason".
- La regla de pagament dels extres posteriors (si n'hi ha) va a "later_extras_rule": no l'apliquis als extres contractats.
- Si un import està mal escrit (p. ex. "39.5000,00 €"), copia'l literalment a *_text i posa a *_cents el valor que en resulti; la verificació ho marcarà.
- Si no pots determinar una dada, posa null i afegeix-la a "undetermined" amb el motiu.
- L'IVA: només si el contracte fixa un tipus concret per a la fita. "Tipus legal vigent" no és un tipus: deixa vat_text null.
- Les pàgines són les del fitxer PDF (la primera és 1).`;

// ------------------------------------------------------------------------------------------
// Verificació
// ------------------------------------------------------------------------------------------
export type Severity = "alta" | "mitjana" | "baixa";
export type Discrepancy = {
  kind: string; severity: Severity; message: string;
  expected_cents: number | null; found_cents: number | null; refs: { page?: number | null; code?: string | null }[];
};
export type FlatMilestone = {
  position: number; code: string | null; phase: string; subphase: string | null; concept: string; amount_cents: number;
  vat_rate_bp: number | null; concept_type: string | null; trigger_condition: string | null; is_extra: boolean; extra_label: string | null;
  source_page: number | null; source_text: string | null;
};

/** Text d'import en format espanyol → cèntims. null si el format és anòmal. */
export function strictAmountCents(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/€|\+\s*IVA|IVA|EUR|euros?/gi, "").replace(/\s/g, "");
  const m = /^(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1].replace(/\./g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

const VAT_TEXT = /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/;
export function vatFromText(s: string | null): number | null {
  const m = s ? VAT_TEXT.exec(s) : null;
  if (!m) return null;
  const bp = Math.round(Number(m[1].replace(",", ".")) * 100);
  return [0, 400, 1000, 2100].includes(bp) ? bp : null;
}

const EUR = (c: number) => `${(c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Suggeriment de tipus de concepte (només per proposar l'IVA per defecte; direcció el confirma). */
export function suggestConceptType(phase: string, isExtra: boolean): string | null {
  if (isExtra) return "extra_constructiu";
  const n = norm(phase);
  if (/projecte|proyecto|direccio|direccion/.test(n)) return "projecte_direccio";
  if (/fonament|cimentacio|cimentacion/.test(n)) return "cimentacio";
  if (/escomes|acometid|connexi|conexi/.test(n)) return "escomeses";
  if (/estructura|envolupant|envolvente|interior|instal|fuster|carpinter|entrega|construcc/.test(n)) return "construccio";
  return null;
}

export function flattenMilestones(r: ContractReading): FlatMilestone[] {
  const out: FlatMilestone[] = [];
  for (const ph of r.phases) {
    for (const m of ph.milestones) {
      out.push({
        position: out.length + 1, code: m.code, phase: ph.code ? `${ph.code} ${ph.name}` : ph.name, subphase: null,
        concept: m.concept, amount_cents: m.amount_cents, vat_rate_bp: vatFromText(m.vat_text),
        concept_type: suggestConceptType(ph.name, ph.is_extra), trigger_condition: m.trigger_condition,
        is_extra: ph.is_extra, extra_label: ph.is_extra ? ph.name : null, source_page: m.page, source_text: m.source_text.slice(0, 1500),
      });
    }
  }
  return out;
}

export type QuoteRef = { taxableCents: number; extrasCents: number } | null;

/**
 * Verificació econòmica. pageTexts: text de cada pàgina (si el PDF en té) per comprovar
 * que els imports que diu la IA hi són realment.
 */
export function verifyReading(r: ContractReading, quote: QuoteRef, pageTexts: string[] | null): Discrepancy[] {
  const d: Discrepancy[] = [];
  const add = (x: Discrepancy) => d.push(x);
  const all = r.phases.flatMap((p) => p.milestones.map((m) => ({ ...m, phase: p })));
  const sum = all.reduce((s, m) => s + m.amount_cents, 0);

  if (r.total_cents == null) {
    add({ kind: "total_no_determinable", severity: "alta", message: "No s'ha pogut determinar l'import total del contracte.", expected_cents: null, found_cents: null, refs: [] });
  } else {
    if (r.total_text && strictAmountCents(r.total_text) !== r.total_cents) {
      add({ kind: "format_import", severity: "mitjana", message: `L'import total està escrit com "${r.total_text}": revisa'l.`, expected_cents: null, found_cents: r.total_cents, refs: [{ page: r.total_page }] });
    }
    if (r.chapters.length) {
      const ch = r.chapters.reduce((s, c) => s + c.amount_cents, 0);
      if (ch !== r.total_cents) add({ kind: "suma_capitols", severity: "alta", message: `La suma dels capítols (${EUR(ch)}) no coincideix amb el total del contracte (${EUR(r.total_cents)}).`, expected_cents: r.total_cents, found_cents: ch, refs: r.chapters.map((c) => ({ page: c.page })) });
    }
    if (sum !== r.total_cents) {
      const missing = r.phases.filter((p) => p.milestones.length === 0);
      add({
        kind: sum < r.total_cents ? "fites_falten" : "fites_sobren", severity: "alta",
        message: `La suma de les fites (${EUR(sum)}) no coincideix amb el total del contracte (${EUR(r.total_cents)}). Diferència: ${EUR(Math.abs(r.total_cents - sum))}.`
          + (missing.length ? ` Fases sense fites: ${missing.map((p) => p.code ?? p.name).join(", ")}.` : ""),
        expected_cents: r.total_cents, found_cents: sum, refs: missing.map((p) => ({ page: p.page, code: p.code })),
      });
    }
  }

  for (const p of r.phases) {
    const ps = p.milestones.reduce((s, m) => s + m.amount_cents, 0);
    if (p.declared_amount_text && p.declared_amount_cents != null && strictAmountCents(p.declared_amount_text) !== p.declared_amount_cents) {
      add({ kind: "format_import", severity: "mitjana", message: `${p.code ?? p.name}: l'import de la fase està escrit com "${p.declared_amount_text}". Es pren ${EUR(p.declared_amount_cents)} perquè coincideix amb la suma de les fites; confirma-ho.`, expected_cents: p.declared_amount_cents, found_cents: ps, refs: [{ page: p.page, code: p.code }] });
    }
    if (p.milestones.length === 0) {
      add({
        kind: "sense_fites", severity: "alta",
        message: `${p.code ?? ""} ${p.name}${p.declared_amount_cents != null ? ` (${EUR(p.declared_amount_cents)})` : ""}: el contracte no indica fites de cobrament. No es pot determinar; direcció ha de definir-les.${p.no_milestones_reason ? ` Lectura: ${p.no_milestones_reason}` : ""}`.trim(),
        expected_cents: p.declared_amount_cents, found_cents: 0, refs: [{ page: p.page, code: p.code }],
      });
    } else if (p.declared_amount_cents != null && ps !== p.declared_amount_cents) {
      add({ kind: "suma_fase", severity: "alta", message: `${p.code ?? p.name}: la suma de les fites (${EUR(ps)}) no coincideix amb l'import de la fase (${EUR(p.declared_amount_cents)}).`, expected_cents: p.declared_amount_cents, found_cents: ps, refs: [{ page: p.page, code: p.code }] });
    }
  }

  // Imports i codis duplicats
  const seenCodes = new Map<string, number>();
  for (const m of all) if (m.code) seenCodes.set(m.code, (seenCodes.get(m.code) ?? 0) + 1);
  for (const [code, n] of seenCodes) if (n > 1) add({ kind: "codi_duplicat", severity: "mitjana", message: `El codi de fita ${code} apareix ${n} vegades.`, expected_cents: null, found_cents: null, refs: [{ code }] });
  const seenDup = new Set<string>();
  for (const m of all) {
    const k = `${norm(m.concept)}|${m.amount_cents}`;
    if (seenDup.has(k)) add({ kind: "fita_duplicada", severity: "mitjana", message: `Possible fita duplicada: "${m.concept}" (${EUR(m.amount_cents)}).`, expected_cents: null, found_cents: m.amount_cents, refs: [{ page: m.page, code: m.code }] });
    seenDup.add(k);
  }

  // Cada import ha d'estar escrit al contracte i tenir referència
  for (const m of all) {
    const parsed = strictAmountCents(m.amount_text);
    if (m.amount_cents === 0) add({ kind: "import_zero", severity: "mitjana", message: `${m.code ?? m.concept}: import zero.`, expected_cents: null, found_cents: 0, refs: [{ page: m.page, code: m.code }] });
    if (parsed !== m.amount_cents) add({ kind: "format_import", severity: "mitjana", message: `${m.code ?? m.concept}: l'import està escrit com "${m.amount_text}" i s'ha llegit ${EUR(m.amount_cents)}.`, expected_cents: null, found_cents: m.amount_cents, refs: [{ page: m.page, code: m.code }] });
    if (m.page == null || !m.source_text.trim()) {
      add({ kind: "sense_referencia", severity: "mitjana", message: `${m.code ?? m.concept}: sense pàgina o text de referència.`, expected_cents: null, found_cents: m.amount_cents, refs: [{ code: m.code }] });
    } else if (pageTexts && pageTexts[m.page - 1] != null && !amountOnPage(m.amount_cents, pageTexts[m.page - 1])) {
      add({ kind: "import_no_trobat", severity: "alta", message: `${m.code ?? m.concept}: l'import ${EUR(m.amount_cents)} no apareix a la pàgina ${m.page} del document. Comprova-ho.`, expected_cents: null, found_cents: m.amount_cents, refs: [{ page: m.page, code: m.code }] });
    }
  }

  // Contracte vs pressupost acceptat
  if (quote && r.total_cents != null && quote.taxableCents !== r.total_cents) {
    add({ kind: "pressupost_contracte", severity: "alta", message: `El pressupost acceptat (${EUR(quote.taxableCents)}) i el contracte (${EUR(r.total_cents)}) no coincideixen. Diferència: ${EUR(Math.abs(quote.taxableCents - r.total_cents))}. El contracte original no es modifica.`, expected_cents: quote.taxableCents, found_cents: r.total_cents, refs: [{ page: r.total_page }] });
  }
  if (quote && quote.extrasCents > 0) {
    const ex = r.phases.filter((p) => p.is_extra).reduce((s, p) => s + (p.declared_amount_cents ?? p.milestones.reduce((a, m) => a + m.amount_cents, 0)), 0);
    if (ex !== quote.extrasCents) add({ kind: "extres_pressupost", severity: "alta", message: `Els extres del contracte (${EUR(ex)}) no coincideixen amb els del pressupost acceptat (${EUR(quote.extrasCents)}).`, expected_cents: quote.extrasCents, found_cents: ex, refs: [] });
  }
  if (!r.signed_date) add({ kind: "data_signatura", severity: "mitjana", message: "No consta la data de signatura (o està en blanc). Introdueix-la manualment.", expected_cents: null, found_cents: null, refs: [] });
  if (all.some((m) => vatFromText(m.vat_text) == null)) {
    add({ kind: "iva_no_determinable", severity: "baixa", message: "El contracte no fixa el tipus d'IVA de cada fita. Assigna'l (per defecte: 10 % construcció, 21 % arquitectura) abans de validar.", expected_cents: null, found_cents: null, refs: r.vat_clause ? [{ page: r.vat_clause.page }] : [] });
  }
  for (const u of r.undetermined) add({ kind: "no_determinable", severity: "mitjana", message: `${u.field}: ${u.reason}`, expected_cents: null, found_cents: null, refs: [] });
  return d;
}

/** L'import apareix escrit a la pàgina? (accepta 35.600,00 / 35600,00 / 35.600 € / 35.600€…) */
export function amountOnPage(c: number, pageText: string): boolean {
  const euros = Math.trunc(c / 100);
  const dec = String(c % 100).padStart(2, "0");
  const dotted = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".").replace(/\./g, "\\.");
  const num = `(?:${dotted}|${euros})`;
  const withDec = new RegExp(`(?<![\\d.,])${num},${dec}(?!\\d)`);
  if (withDec.test(pageText)) return true;
  return dec === "00" && new RegExp(`(?<![\\d.,])${num}(?![\\d]|[.,]\\d)`).test(pageText);
}
