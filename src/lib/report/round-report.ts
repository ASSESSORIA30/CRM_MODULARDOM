// Model de dades de l'informe de revisió d'una ronda i resum automàtic.
// El resum es construeix NOMÉS amb dades registrades (estats, respostes, confirmacions,
// relació de punts per versió): no hi ha cap text generat que pugui inventar decisions.
// Cada línia cita el punt (R<ronda>.<núm>) i la versió que l'origina. Funcions pures (Vitest).

export type ReportMarker = {
  label: string; page: number; kind: "punt" | "rectangle"; x: number; y: number; w: number | null; h: number | null;
  documentTitle: string; documentVersion: number; documentKind: "pdf" | "image"; url: string | null; comment: string;
};
export type ReportPhoto = { title: string; description: string | null; url: string | null; isImage: boolean };
export type ReportItem = {
  ref: string;
  position: number;
  title: string;
  description: string;
  room: string | null;
  sourceExcerpt: string | null;
  status: string;
  assessment: string | null;
  alternative: string | null;
  alternativeStatus: string;
  economic: string | null;
  confirmations: { kind: string; who: string; when: string }[];
  comments: { author: string; when: string; body: string }[];
  markers: ReportMarker[];
  photos: ReportPhoto[];
  /** Resolució a l'última versió que l'esmenta */
  resolution: { documentTitle: string; version: number; resolution: string; note: string | null } | null;
};
export type RoundReport = {
  project: { title: string; code: string };
  round: { number: number; submittedAt: string; submittedBy: string; status: string; closedAt: string | null; isException: boolean; originalText: string | null };
  generatedAt: string;
  items: ReportItem[];
  versions: { title: string; version: number; publishedAt: string | null; approvedAt: string | null }[];
};

export type RoundSummary = {
  requested: string[];
  incorporated: string[];
  partial: string[];
  notViable: string[];
  alternativesAccepted: string[];
  pending: string[];
  discarded: string[];
};

/** Classifica cada punt segons el que consta registrat. Un punt pot aparèixer en més d'un grup. */
export function summarizeRound(items: ReportItem[]): RoundSummary {
  const s: RoundSummary = { requested: [], incorporated: [], partial: [], notViable: [], alternativesAccepted: [], pending: [], discarded: [] };
  for (const it of items) {
    s.requested.push(it.ref);
    const res = it.resolution?.resolution;
    if (it.status === "incorporat" || res === "incorporat") s.incorporated.push(it.ref);
    else if (res === "parcial") s.partial.push(it.ref);
    if (it.status === "no_viable" || res === "rebutjat") s.notViable.push(it.ref);
    if (it.alternativeStatus === "acceptada" || res === "alternativa") s.alternativesAccepted.push(it.ref);
    if (it.status === "descartat") s.discarded.push(it.ref);
    const closed = ["incorporat", "descartat", "no_viable"].includes(it.status) || ["incorporat", "rebutjat", "alternativa"].includes(res ?? "");
    if (!closed) s.pending.push(it.ref);
  }
  return s;
}
