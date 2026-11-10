// Converteix els punts validats de la IA en files de revision_items i vincles amb
// marcadors i adjunts. Funció pura (Vitest).
import type { ValidatedItem } from "./revision-validate";

export type DraftItemRow = {
  position: number;
  title: string;
  description: string;
  room: string | null;
  source_excerpt: string | null;
  needs_clarification: boolean;
  ai_notes: string | null;
  annotationIds: string[];
  documentIds: string[];
};

export function mapItemsToRows(
  items: ValidatedItem[],
  markerIdByLabel: Map<string, string>,
  attachmentDocIds: Set<string>,
): DraftItemRow[] {
  const usedMarkers = new Set<string>();
  return items.map((it, i) => {
    // Un marcador només es vincula al primer punt que el reclama (un marcador = un punt)
    const annotationIds = it.markers
      .map((l) => markerIdByLabel.get(l))
      .filter((id): id is string => !!id && !usedMarkers.has(id));
    annotationIds.forEach((id) => usedMarkers.add(id));
    return {
      position: i + 1,
      title: it.title.slice(0, 160) || `Punt ${i + 1}`,
      description: it.description,
      room: it.room,
      source_excerpt: it.sourceExcerpt || null,
      needs_clarification: it.needsClarification,
      ai_notes: it.notes.length ? it.notes.join(" ") : null,
      annotationIds,
      documentIds: it.attachments.filter((a) => attachmentDocIds.has(a)),
    };
  });
}
