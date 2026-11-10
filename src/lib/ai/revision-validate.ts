// Validació de l'extracció de peticions feta per la IA.
// Principi: la IA només estructura el que ha dit el client. Tot el que no es pugui
// vincular literalment a una font (text, comentari d'un marcador o descripció d'un
// adjunt) es descarta o es marca per aclarir. Mai decideix viabilitat ni inventa
// mides, materials, marques ni costos. Funció pura, provada amb Vitest.
import { z } from "zod";

export type RevisionSources = {
  text: string;
  markers: { label: string; page: number; comment: string; documentTitle?: string }[];
  attachments: { id: string; description: string }[];
};

const refSchema = z.object({
  type: z.enum(["text", "marker", "attachment"]),
  ref: z.string().max(80).default(""),
  excerpt: z.string().max(600),
});

export const extractionSchema = z.object({
  items: z.array(z.object({
    title: z.string().min(1).max(160),
    description: z.string().max(1200),
    room: z.string().max(80).nullable().optional(),
    sources: z.array(refSchema).max(10),
    needs_clarification: z.boolean().default(false),
    clarification_question: z.string().max(400).nullable().optional(),
    markers: z.array(z.string().max(20)).max(20).default([]),
    attachments: z.array(z.string().max(80)).max(20).default([]),
  })).max(40),
  general_questions: z.array(z.string().max(400)).max(10).default([]),
});

export type RawExtraction = z.infer<typeof extractionSchema>;

export type ValidatedItem = {
  title: string;
  description: string;
  room: string | null;
  sourceExcerpt: string;
  markers: string[];
  attachments: string[];
  needsClarification: boolean;
  notes: string[];
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function containsLiteral(haystack: string, needle: string) {
  const n = norm(needle);
  return n.length >= 3 && norm(haystack).includes(n);
}

// Mides, imports, percentatges i marques comercials habituals
const MEASURE_RE = /\d+(?:[.,]\d+)?\s*(?:mm|cm|m2|m²|m³|m3|m|metres?|metros?|€|eur|euros?|%|kw|kwp|ml|cv)\b/giu;
const NUMBER_RE = /\d+(?:[.,]\d+)?/g;
const VIABILITY_RE = /\b(no\s+(?:es\s+)?viable|viable|inviable|factible|no\s+es\s+possible|no\s+es\s+posible|estructuralment|estructuralmente)\b/iu;

function inventedFigures(output: string, sources: string): string[] {
  const src = norm(sources);
  const found = new Set<string>();
  for (const m of output.match(MEASURE_RE) ?? []) {
    const num = m.match(NUMBER_RE)?.[0];
    if (num && !src.includes(norm(num))) found.add(m.trim());
  }
  return [...found];
}

/** Valida i neteja la resposta de la IA. `raw` pot ser qualsevol cosa (JSON no fiable). */
export function validateExtraction(raw: unknown, sources: RevisionSources):
  { ok: true; items: ValidatedItem[]; questions: string[] } | { ok: false; error: string } {
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_ai_output" };

  const markerByLabel = new Map(sources.markers.map((m) => [m.label, m]));
  const attachmentIds = new Set(sources.attachments.map((a) => a.id));
  const allSourceText = [sources.text, ...sources.markers.map((m) => m.comment), ...sources.attachments.map((a) => a.description)].join("\n");

  const items: ValidatedItem[] = parsed.data.items.map((it) => {
    const notes: string[] = [];

    // 1) Cada referència ha de ser literal
    const validRefs = it.sources.filter((r) => {
      if (r.type === "text") return containsLiteral(sources.text, r.excerpt);
      if (r.type === "marker") return markerByLabel.has(r.ref) && containsLiteral(markerByLabel.get(r.ref)!.comment, r.excerpt);
      return attachmentIds.has(r.ref) && containsLiteral(sources.attachments.find((a) => a.id === r.ref)!.description, r.excerpt);
    });
    const markers = [...new Set([...it.markers, ...validRefs.filter((r) => r.type === "marker").map((r) => r.ref)])]
      .filter((l) => markerByLabel.has(l));
    const attachments = [...new Set(it.attachments)].filter((a) => attachmentIds.has(a));
    if (it.markers.some((l) => !markerByLabel.has(l)) || it.attachments.some((a) => !attachmentIds.has(a))) {
      notes.push("La IA ha citat marcadors o adjunts inexistents; s'han descartat.");
    }

    let needs = it.needs_clarification;
    let description = it.description.trim();
    let title = it.title.trim();
    if (validRefs.length === 0) {
      needs = true;
      notes.push("No s'ha pogut vincular aquest punt a cap frase del client: revisa'l abans d'enviar.");
    }

    // 2) Cap mida, import o marca que no aparegui a les fonts
    const invented = inventedFigures(`${title} ${description}`, allSourceText);
    if (invented.length) {
      needs = true;
      notes.push(`S'han eliminat dades que el client no ha indicat: ${invented.join(", ")}.`);
      description = validRefs.map((r) => r.excerpt).join(" · ") || description.replace(MEASURE_RE, "[pendent de definir]");
      title = title.replace(MEASURE_RE, "").replace(/\s{2,}/g, " ").trim() || title;
    }

    // 3) La IA no decideix la viabilitat
    if (VIABILITY_RE.test(`${title} ${description}`) && !VIABILITY_RE.test(allSourceText)) {
      notes.push("S'ha eliminat una valoració de viabilitat: la decideix l'arquitecte.");
      description = description.replace(VIABILITY_RE, "").replace(/\s{2,}/g, " ").trim();
    }

    if (needs && it.clarification_question) notes.push(it.clarification_question.trim());

    return {
      title: title.slice(0, 160),
      description: description.slice(0, 1200),
      room: it.room?.trim() || null,
      sourceExcerpt: validRefs.map((r) => (r.type === "text" ? r.excerpt : `[${r.type === "marker" ? "marcador" : "adjunt"} ${r.ref}] ${r.excerpt}`)).join(" | ").slice(0, 1000),
      markers,
      attachments,
      needsClarification: needs,
      notes,
    };
  });

  // 4) Marcadors que la IA no ha convertit en cap punt: no es perden
  const covered = new Set(items.flatMap((i) => i.markers));
  for (const m of sources.markers) {
    if (!covered.has(m.label) && m.comment.trim()) {
      items.push({
        title: m.comment.trim().slice(0, 120),
        description: m.comment.trim(),
        room: null,
        sourceExcerpt: `[marcador ${m.label}] ${m.comment.trim()}`,
        markers: [m.label],
        attachments: [],
        needsClarification: false,
        notes: ["Afegit des del marcador perquè la IA no l'havia inclòs."],
      });
    }
  }

  return { ok: true, items, questions: parsed.data.general_questions };
}
