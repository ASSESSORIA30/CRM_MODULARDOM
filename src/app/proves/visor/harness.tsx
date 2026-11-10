"use client";

import { useState } from "react";
import { PlanViewer, type NewAnnotation, type ViewerAnnotation } from "@/components/plan-viewer/plan-viewer";

const TEXTS = {
  navigate: "Navegar", point: "Marcador", area: "Zona", zoomIn: "Ampliar", zoomOut: "Reduir", fit: "Ajustar",
  fullscreen: "Pantalla completa", page: "Pàgina", of: "de", previous: "Anterior", next: "Següent",
  loading: "Carregant…", error: "No s'ha pogut obrir el document", annotateHint: "Toca o arrossega sobre el plànol",
};

declare global {
  interface Window { __annotations?: ViewerAnnotation[] }
}

export function Harness({ source }: { source: { kind: "pdf" | "image"; url: string } }) {
  const [items, setItems] = useState<ViewerAnnotation[]>([
    { id: "arq-1", page: 2, kind: "rectangle", x: 0.5, y: 0.1, w: 0.45, h: 0.5, label: "A", tone: "arquitecte", title: "Resposta de l'arquitecte" },
  ]);
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const add = (a: NewAnnotation) => {
    setItems((xs) => {
      const next = [...xs, { ...a, id: `n${xs.length}`, label: String(xs.filter((x) => x.tone === "client").length + 1), tone: "client" as const }];
      window.__annotations = next;
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <PlanViewer source={source} annotations={items} canAnnotate onCreate={add} onSelect={setSelected}
        focusId={focus} selectedId={selected} texts={TEXTS} />
      <ul className="flex flex-wrap gap-2 text-sm" data-testid="list">
        {items.map((a) => (
          <li key={a.id}>
            <button type="button" data-testid={`focus-${a.id}`} onClick={() => setFocus(`${a.id}`)} className="rounded border px-2 py-1">
              Veure al plànol {a.label} (p.{a.page})
            </button>
          </li>
        ))}
      </ul>
      <p data-testid="selected">{selected ?? ""}</p>
    </div>
  );
}
