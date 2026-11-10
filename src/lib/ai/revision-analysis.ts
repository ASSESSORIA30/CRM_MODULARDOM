// Anàlisi IA de les peticions de modificació de l'avantprojecte.
import "server-only";
import { structuredCall } from "./provider";
import { validateExtraction, type RevisionSources, type ValidatedItem } from "./revision-validate";

const SYSTEM = `Ets un assistent que ordena les peticions de modificació d'un client sobre l'avantprojecte de la seva casa.
Regles estrictes:
- Separa cada canvi en un punt independent. Un punt per canvi.
- Usa només el que el client ha escrit als seus textos, als comentaris dels marcadors i a les descripcions dels adjunts.
- Per a cada punt, cita a "sources" els fragments LITERALS (copiats exactament) d'on surt.
- No inventis mides, superfícies, materials, marques, colors, costos ni solucions constructives.
- No valoris si una petició és viable o no: això ho decideix l'arquitecte.
- Una fotografia d'inspiració és una referència: no assumeixis que tot el que s'hi veu s'ha de reproduir.
- Si un canvi és ambigu, contradictori o li falta informació, marca needs_clarification i formula una pregunta concreta.
- Vincula cada punt als marcadors (pel seu número) i adjunts (pel seu identificador) que hi corresponguin.
- Escriu en l'idioma del client.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Títol curt del canvi" },
          description: { type: "string", description: "Descripció clara, sense afegir informació" },
          room: { type: ["string", "null"], description: "Estança afectada si es pot identificar" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["text", "marker", "attachment"] },
                ref: { type: "string", description: "Número del marcador o id de l'adjunt; buit per al text" },
                excerpt: { type: "string", description: "Fragment literal copiat de la font" },
              },
              required: ["type", "ref", "excerpt"],
            },
          },
          needs_clarification: { type: "boolean" },
          clarification_question: { type: ["string", "null"] },
          markers: { type: "array", items: { type: "string" } },
          attachments: { type: "array", items: { type: "string" } },
        },
        required: ["title", "description", "sources", "needs_clarification", "markers", "attachments"],
      },
    },
    general_questions: { type: "array", items: { type: "string" } },
  },
  required: ["items", "general_questions"],
};

export type AnalysisResult =
  | { ok: true; items: ValidatedItem[]; questions: string[]; raw: unknown; model: string }
  | { ok: false; error: "not_configured" | "provider_error" | "invalid_ai_output" | "empty" };

export async function analyzeRevisionRequest(
  sources: RevisionSources,
  opts: { roundNumber: number; imageUrls?: { id: string; url: string }[] },
): Promise<AnalysisResult> {
  if (!sources.text.trim() && sources.markers.every((m) => !m.comment.trim())) return { ok: false, error: "empty" };

  const lines = [
    `Ronda de modificacions número ${opts.roundNumber}.`,
    "TEXT DEL CLIENT:",
    sources.text.trim() || "(cap text general)",
    "",
    "MARCADORS SOBRE EL PLÀNOL:",
    ...(sources.markers.length
      ? sources.markers.map((m) => `- Marcador ${m.label} (pàgina ${m.page}${m.documentTitle ? `, ${m.documentTitle}` : ""}): ${m.comment || "(sense comentari)"}`)
      : ["(cap)"]),
    "",
    "ADJUNTS:",
    ...(sources.attachments.length ? sources.attachments.map((a) => `- ${a.id}: ${a.description || "(sense descripció)"}`) : ["(cap)"]),
  ];
  const content: ({ type: "text"; text: string } | { type: "image"; source: { type: "url"; url: string } })[] = [
    { type: "text", text: lines.join("\n") },
  ];
  for (const img of opts.imageUrls ?? []) {
    content.push({ type: "text", text: `Imatge de l'adjunt ${img.id}:` });
    content.push({ type: "image", source: { type: "url", url: img.url } });
  }

  const res = await structuredCall({
    system: SYSTEM,
    content,
    toolName: "registrar_peticions",
    toolDescription: "Registra la llista de peticions de modificació detectades",
    inputSchema: SCHEMA,
  });
  if (!res.ok) return res;
  const v = validateExtraction(res.data, sources);
  if (!v.ok) return { ok: false, error: "invalid_ai_output" };
  return { ok: true, items: v.items, questions: v.questions, raw: res.data, model: res.model };
}
