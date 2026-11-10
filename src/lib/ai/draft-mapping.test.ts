import { describe, expect, it } from "vitest";
import { mapItemsToRows } from "./draft-mapping";
import { validateExtraction } from "./revision-validate";

describe("de l'anàlisi IA als punts de l'esborrany", () => {
  const sources = {
    text: "Vull ampliar la cuina.",
    markers: [
      { label: "1", page: 1, comment: "ampliar finestra del menjador" },
      { label: "2", page: 1, comment: "moure porta del bany" },
      { label: "3", page: 2, comment: "desplaçar envà del dormitori" },
    ],
    attachments: [{ id: "doc-foto", description: "dutxa de referència" }],
  };
  const raw = {
    items: [
      { title: "Finestra del menjador", description: "Ampliar la finestra", room: "Menjador", needs_clarification: false,
        sources: [{ type: "marker", ref: "1", excerpt: "ampliar finestra del menjador" }], markers: ["1"], attachments: [] },
      { title: "Porta del bany", description: "Moure la porta", room: "Bany", needs_clarification: false,
        sources: [{ type: "marker", ref: "2", excerpt: "moure porta del bany" }], markers: ["2", "1"], attachments: ["doc-foto"] },
      { title: "Envà del dormitori", description: "Desplaçar l'envà", room: "Dormitori", needs_clarification: false,
        sources: [{ type: "marker", ref: "3", excerpt: "desplaçar envà del dormitori" }], markers: ["3"], attachments: [] },
    ],
  };

  it("tres marcadors generen tres punts editables vinculats als marcadors originals", () => {
    const v = validateExtraction(raw, sources);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const rows = mapItemsToRows(v.items, new Map([["1", "ann-1"], ["2", "ann-2"], ["3", "ann-3"]]), new Set(["doc-foto"]));
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(rows[0].annotationIds).toEqual(["ann-1"]);
    expect(rows[1].annotationIds).toEqual(["ann-2"]);          // el marcador 1 ja és del punt 1
    expect(rows[1].documentIds).toEqual(["doc-foto"]);
    expect(rows[2].annotationIds).toEqual(["ann-3"]);
  });

  it("el punt sense font queda marcat per aclarir amb la nota corresponent", () => {
    const v = validateExtraction({ items: [{ title: "Piscina", description: "Fer una piscina", sources: [], markers: [], attachments: [] }] },
      { text: "Vull ampliar la cuina.", markers: [], attachments: [] });
    if (!v.ok) throw new Error();
    const [row] = mapItemsToRows(v.items, new Map(), new Set());
    expect(row.needs_clarification).toBe(true);
    expect(row.ai_notes).toMatch(/No s'ha pogut vincular/);
  });
});
