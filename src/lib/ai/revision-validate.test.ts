import { describe, expect, it } from "vitest";
import { validateExtraction, type RevisionSources } from "./revision-validate";

const sources: RevisionSources = {
  text: "Vull ampliar la cuina, canviar la porta del bany i fer la finestra del menjador més gran.",
  markers: [
    { label: "1", page: 1, comment: "Vull que aquesta finestra sigui més ampla" },
    { label: "2", page: 1, comment: "moure la porta del bany" },
    { label: "3", page: 2, comment: "desplaçar l'envà del dormitori" },
  ],
  attachments: [{ id: "foto-1", description: "Dutxa d'obra amb mampara de vidre" }],
};

const item = (o: Partial<Record<string, unknown>>) => ({
  title: "Ampliar la cuina", description: "Ampliar la cuina", room: "Cuina",
  sources: [{ type: "text", ref: "", excerpt: "ampliar la cuina" }], needs_clarification: false, markers: [], attachments: [], ...o,
});

describe("validació anti-invenció de l'extracció IA", () => {
  it("accepta punts vinculats literalment al text i als marcadors", () => {
    const r = validateExtraction({
      items: [
        item({}),
        item({ title: "Porta del bany", description: "Canviar o moure la porta del bany", room: "Bany",
          sources: [{ type: "text", ref: "", excerpt: "canviar la porta del bany" }, { type: "marker", ref: "2", excerpt: "moure la porta del bany" }], markers: ["2"] }),
        item({ title: "Finestra del menjador", description: "Finestra més gran", room: "Menjador",
          sources: [{ type: "marker", ref: "1", excerpt: "aquesta finestra sigui més ampla" }], markers: ["1"] }),
        item({ title: "Envà del dormitori", description: "Desplaçar l'envà", room: "Dormitori",
          sources: [{ type: "marker", ref: "3", excerpt: "desplaçar l'envà del dormitori" }], markers: ["3"] }),
      ],
    }, sources);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(4);
    expect(r.items.every((i) => !i.needsClarification)).toBe(true);
    expect(r.items[2].markers).toEqual(["1"]);
  });

  it("marca per aclarir els punts que no surten de cap font", () => {
    const r = validateExtraction({ items: [item({ title: "Afegir una piscina", description: "Piscina al jardí",
      sources: [{ type: "text", ref: "", excerpt: "afegir una piscina" }] })] }, sources);
    expect(r.ok && r.items[0].needsClarification).toBe(true);
    expect(r.ok && r.items[0].notes.join(" ")).toMatch(/No s'ha pogut vincular/);
  });

  it("elimina mides i imports inventats", () => {
    const r = validateExtraction({ items: [item({ title: "Ampliar la cuina 4 m²", description: "Ampliar la cuina fins a 18 m² amb un cost de 6.000 €" })] }, sources);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items[0].description).not.toMatch(/18|6\.000|€/);
    expect(r.items[0].title).not.toMatch(/4 m²/);
    expect(r.items[0].needsClarification).toBe(true);
  });

  it("conserva les mides que sí ha dit el client", () => {
    const s = { ...sources, text: "Vull la finestra del menjador de 2 metres d'ample" };
    const r = validateExtraction({ items: [item({ title: "Finestra", description: "Finestra de 2 metres d'ample",
      sources: [{ type: "text", ref: "", excerpt: "finestra del menjador de 2 metres" }] })] }, s);
    expect(r.ok && r.items[0].description).toBe("Finestra de 2 metres d'ample");
    expect(r.ok && r.items[0].needsClarification).toBe(false);
  });

  it("no permet que la IA decideixi la viabilitat", () => {
    const r = validateExtraction({ items: [item({ description: "Ampliar la cuina, no és viable estructuralment" })] }, sources);
    expect(r.ok && r.items[0].description).not.toMatch(/viable/i);
    expect(r.ok && r.items[0].notes.join(" ")).toMatch(/viabilitat/);
  });

  it("descarta marcadors i adjunts inexistents", () => {
    const r = validateExtraction({ items: [item({ markers: ["1", "99"], attachments: ["foto-1", "inventada"] })] }, sources);
    expect(r.ok && r.items[0].markers).toEqual(["1"]);
    expect(r.ok && r.items[0].attachments).toEqual(["foto-1"]);
  });

  it("cap marcador es perd encara que la IA l'ometi", () => {
    const r = validateExtraction({ items: [item({})] }, sources);
    expect(r.ok && r.items.flatMap((i) => i.markers).sort()).toEqual(["1", "2", "3"]);
  });

  it("rebutja respostes amb format incorrecte", () => {
    expect(validateExtraction({ items: "no" }, sources).ok).toBe(false);
    expect(validateExtraction(null, sources).ok).toBe(false);
  });
});
