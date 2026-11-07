"use client";

// Visor interactiu de plànols (PDF multipàgina i imatges) amb zoom, desplaçament,
// pantalla completa i anotacions (marcador puntual i rectangle).
// - Coordenades normalitzades [0,1] respecte de la pàgina: no depenen del zoom ni del dispositiu.
// - Mode navegació i mode anotació separats: moure o ampliar mai crea anotacions.
// - Dos dits sempre fan zoom/desplaçament i cancel·len l'anotació en curs.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  TAP_TOLERANCE_PX, centerOn, clampView, distance, rectFromPoints, toNormalized, zoomAt,
  type NPoint, type NRect, type View,
} from "./geometry";

export type ViewerAnnotation = {
  id: string;
  page: number;
  kind: "punt" | "rectangle";
  x: number;
  y: number;
  w?: number | null;
  h?: number | null;
  label: string;
  title?: string;
  tone: "client" | "arquitecte" | "direccio" | "intern";
};

export type NewAnnotation = { page: number; kind: "punt" | "rectangle"; x: number; y: number; w: number | null; h: number | null };

export type ViewerTexts = {
  navigate: string; point: string; area: string; zoomIn: string; zoomOut: string; fit: string;
  fullscreen: string; page: string; of: string; previous: string; next: string; loading: string; error: string;
  annotateHint: string;
};

type Mode = "navegar" | "punt" | "rectangle";
type Gesture =
  | { type: "pan"; startX: number; startY: number; view: View; moved: boolean }
  | { type: "pinch"; startDist: number; startMid: { x: number; y: number }; view: View }
  | { type: "annot"; startX: number; startY: number; start: NPoint; moved: boolean }
  | null;

const TONE: Record<ViewerAnnotation["tone"], string> = {
  client: "bg-gold text-navy-dark ring-white",
  arquitecte: "bg-navy text-white ring-gold",
  direccio: "bg-emerald-600 text-white ring-white",
  intern: "bg-slate-500 text-white ring-white",
};
const TONE_RECT: Record<ViewerAnnotation["tone"], string> = {
  client: "border-gold bg-gold/15",
  arquitecte: "border-navy bg-navy/10",
  direccio: "border-emerald-600 bg-emerald-600/10",
  intern: "border-slate-500 bg-slate-500/10 border-dashed",
};

export function PlanViewer({
  source, annotations, canAnnotate, onCreate, onSelect, focusId, selectedId, texts, initialPage = 1, heightClass = "h-[65vh]",
}: {
  source: { kind: "pdf" | "image"; url: string };
  annotations: ViewerAnnotation[];
  canAnnotate: boolean;
  onCreate?: (a: NewAnnotation) => void;
  onSelect?: (id: string) => void;
  focusId?: string | null;
  selectedId?: string | null;
  texts: ViewerTexts;
  initialPage?: number;
  heightClass?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>(null);

  const [page, setPage] = useState(initialPage);
  const [numPages, setNumPages] = useState(1);
  const [aspect, setAspect] = useState<number | null>(null); // alt / ample de la pàgina
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<Mode>("navegar");
  const [draft, setDraft] = useState<NRect | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const content = useMemo(() => ({ width: box.width, height: aspect ? box.width * aspect : 0 }), [box.width, aspect]);
  const fitView = useCallback((): View => clampView({ zoom: 1, tx: 0, ty: 0 }, box, content), [box, content]);

  // La vista es reinicia (ajustada) quan canvia la pàgina o la mida, sense efectes:
  // l'estat guarda la clau per a la qual és vàlid.
  const viewKey = `${page}:${box.width}:${box.height}:${aspect ?? 0}`;
  const [viewState, setViewState] = useState<{ key: string; view: View }>({ key: "", view: { zoom: 1, tx: 0, ty: 0 } });
  const view = viewState.key === viewKey ? viewState.view : fitView();
  const setView = useCallback((next: View | ((v: View) => View)) => {
    setViewState((prev) => {
      const base = prev.key === viewKey ? prev.view : fitView();
      return { key: viewKey, view: typeof next === "function" ? next(base) : next };
    });
  }, [viewKey, fitView]);

  // "Veure al plànol": canvia de pàgina i centra el marcador (estat derivat de la prop focusId)
  const [lastFocus, setLastFocus] = useState<string | null | undefined>(undefined);
  const [pendingFocus, setPendingFocus] = useState<ViewerAnnotation | null>(null);
  if (focusId !== lastFocus) {
    setLastFocus(focusId);
    const a = focusId ? annotations.find((x) => x.id === focusId) : undefined;
    if (a) {
      if (a.page !== page) setPage(a.page);
      setPendingFocus(a);
    }
  }
  if (pendingFocus && pendingFocus.page === page && content.height > 0) {
    const a = pendingFocus;
    setPendingFocus(null);
    const cx = a.kind === "rectangle" ? a.x + (a.w ?? 0) / 2 : a.x;
    const cy = a.kind === "rectangle" ? a.y + (a.h ?? 0) / 2 : a.y;
    setViewState({ key: viewKey, view: centerOn({ x: cx, y: cy }, Math.max(2, view.zoom), box, content) });
  }

  // Mida del contenidor
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Carrega d'imatges
  useEffect(() => {
    if (source.kind !== "image") return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) { setAspect(img.naturalHeight / img.naturalWidth); setStatus("ready"); } };
    img.onerror = () => { if (!cancelled) setStatus("error"); };
    img.src = source.url;
    return () => { cancelled = true; };
  }, [source.kind, source.url]);

  // Carrega del PDF
  useEffect(() => {
    if (source.kind !== "pdf") return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ url: source.url }).promise;
        if (cancelled) return;
        pdfRef.current = doc as unknown as typeof pdfRef.current;
        setNumPages(doc.numPages);
        setPage((p) => Math.min(Math.max(1, p), doc.numPages));
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [source.kind, source.url]);

  // Renderitzat de la pàgina PDF (es torna a renderitzar amb més resolució en ampliar)
  const renderZoom = Math.min(4, Math.max(1, Math.ceil(view.zoom)));
  useEffect(() => {
    if (source.kind !== "pdf" || !pdfRef.current || !box.width) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      try {
        const p = (await pdfRef.current!.getPage(page)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvas: HTMLCanvasElement; viewport: unknown }) => { cancel: () => void; promise: Promise<void> };
        };
        if (cancelled) return;
        const base = p.getViewport({ scale: 1 });
        setAspect(base.height / base.width);
        const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const scale = (box.width * dpr * renderZoom) / base.width;
        const vp = p.getViewport({ scale: Math.min(scale, 8) });
        const canvas = canvasRef.current!;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        task = p.render({ canvas, viewport: vp });
        await task.promise;
        if (!cancelled) setStatus("ready");
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) setStatus("error");
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [source.kind, page, box.width, renderZoom, numPages]);

  // Roda del ratolí: zoom al voltant del cursor
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => clampView(zoomAt(v, v.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top), box, content));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [box, content, setView]);

  const pageBox = () => pageRef.current!.getBoundingClientRect();

  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("[data-annotation]")) return; // clic en un marcador
    containerRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      setDraft(null);
      gesture.current = { type: "pinch", startDist: distance(pts[0], pts[1]), startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }, view };
      return;
    }
    if (pts.length > 2) return;
    if (mode === "navegar" || !canAnnotate) {
      gesture.current = { type: "pan", startX: e.clientX, startY: e.clientY, view, moved: false };
    } else {
      gesture.current = { type: "annot", startX: e.clientX, startY: e.clientY, start: toNormalized(e.clientX, e.clientY, pageBox()), moved: false };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const r = containerRef.current!.getBoundingClientRect();
    if (g.type === "pinch") {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const z = g.view.zoom * (distance(pts[0], pts[1]) / g.startDist);
      const zoomed = zoomAt(g.view, z, g.startMid.x - r.left, g.startMid.y - r.top);
      setView(clampView({ ...zoomed, tx: zoomed.tx + mid.x - g.startMid.x, ty: zoomed.ty + mid.y - g.startMid.y }, box, content));
    } else if (g.type === "pan") {
      const dx = e.clientX - g.startX, dy = e.clientY - g.startY;
      if (Math.hypot(dx, dy) > TAP_TOLERANCE_PX) g.moved = true;
      setView(clampView({ zoom: g.view.zoom, tx: g.view.tx + dx, ty: g.view.ty + dy }, box, content));
    } else if (g.type === "annot") {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TAP_TOLERANCE_PX) g.moved = true;
      if (mode === "rectangle" && g.moved) setDraft(rectFromPoints(g.start, toNormalized(e.clientX, e.clientY, pageBox())));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) {
      // en aixecar un dit d'un pessic, el gest continua com a desplaçament
      if (g?.type === "pinch") {
        const [p] = [...pointers.current.values()];
        gesture.current = { type: "pan", startX: p.x, startY: p.y, view, moved: true };
      }
      return;
    }
    gesture.current = null;
    if (g?.type !== "annot" || !onCreate) { setDraft(null); return; }
    const end = toNormalized(e.clientX, e.clientY, pageBox());
    if (mode === "punt" && !g.moved) {
      onCreate({ page, kind: "punt", x: g.start.x, y: g.start.y, w: null, h: null });
    } else if (mode === "rectangle" && g.moved) {
      const rect = rectFromPoints(g.start, end);
      if (rect) onCreate({ page, kind: "rectangle", x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }
    setDraft(null);
  }

  function onPointerCancel(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setDraft(null);
  }

  const zoomBy = (k: number) => setView((v) => clampView(zoomAt(v, v.zoom * k, box.width / 2, box.height / 2), box, content));
  const toggleFullscreen = () => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  };

  const pageAnnotations = annotations.filter((a) => a.page === page);
  const inv = 1 / view.zoom;
  const btn = "flex h-10 min-w-10 items-center justify-center rounded-md px-2 text-sm font-medium";

  return (
    <div ref={wrapperRef} className="flex flex-col overflow-hidden rounded-xl border border-navy/15 bg-white shadow-sm [&:fullscreen]:h-screen">
      <div className="flex flex-wrap items-center gap-1 border-b border-navy/10 bg-surface p-1.5" role="toolbar">
        {canAnnotate && (
          <div className="mr-1 flex rounded-lg bg-white p-0.5 ring-1 ring-navy/15" role="radiogroup">
            {([["navegar", texts.navigate, "✋"], ["punt", texts.point, "📍"], ["rectangle", texts.area, "▭"]] as const).map(([m, label, icon]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} data-mode={m} onClick={() => setMode(m)}
                className={`${btn} gap-1 ${mode === m ? "bg-navy text-white" : "text-navy hover:bg-surface"}`}>
                <span aria-hidden>{icon}</span><span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => zoomBy(1 / 1.4)} className={`${btn} text-navy hover:bg-white`} aria-label={texts.zoomOut}>−</button>
        <span className="w-12 text-center text-xs tabular-nums text-muted" data-testid="zoom">{Math.round(view.zoom * 100)}%</span>
        <button type="button" onClick={() => zoomBy(1.4)} className={`${btn} text-navy hover:bg-white`} aria-label={texts.zoomIn}>+</button>
        <button type="button" onClick={() => setView(fitView())} className={`${btn} text-navy hover:bg-white`}>{texts.fit}</button>
        <button type="button" onClick={toggleFullscreen} className={`${btn} text-navy hover:bg-white`} aria-label={texts.fullscreen}>⛶</button>
        {numPages > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className={`${btn} text-navy disabled:opacity-40`} aria-label={texts.previous}>‹</button>
            <span className="text-xs text-muted" data-testid="page-indicator">{texts.page} {page} {texts.of} {numPages}</span>
            <button type="button" disabled={page >= numPages} onClick={() => setPage((p) => p + 1)} className={`${btn} text-navy disabled:opacity-40`} aria-label={texts.next}>›</button>
          </div>
        )}
      </div>
      {canAnnotate && mode !== "navegar" && (
        <p className="bg-gold-light/50 px-3 py-1 text-xs text-navy">{texts.annotateHint}</p>
      )}

      <div
        ref={containerRef}
        data-testid="plan-container"
        data-mode={mode}
        className={`relative ${heightClass} touch-none select-none overflow-hidden bg-slate-200 [:fullscreen_&]:h-auto [:fullscreen_&]:flex-1 ${mode === "navegar" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {status === "loading" && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">{texts.loading}</p>}
        {status === "error" && <p className="absolute inset-0 flex items-center justify-center text-sm text-red-700">{texts.error}</p>}
        <div
          ref={pageRef}
          data-testid="plan-page"
          data-page={page}
          className="absolute left-0 top-0 origin-top-left bg-white shadow-lg"
          style={{ width: content.width, height: content.height, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})` }}
        >
          {source.kind === "pdf" ? (
            <canvas ref={canvasRef} className="block h-full w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.url} alt="" draggable={false} className="block h-full w-full" />
          )}

          {pageAnnotations.map((a) =>
            a.kind === "rectangle" ? (
              <button key={a.id} type="button" data-annotation data-testid={`annotation-${a.id}`} title={a.title}
                onClick={() => onSelect?.(a.id)}
                className={`absolute rounded-sm border-solid ${TONE_RECT[a.tone]} ${selectedId === a.id ? "ring-2 ring-red-500" : ""}`}
                style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${(a.w ?? 0) * 100}%`, height: `${(a.h ?? 0) * 100}%`, borderWidth: 2 * inv }}>
                <span className={`absolute left-0 top-0 flex h-7 min-w-7 origin-top-left items-center justify-center rounded-full px-1 text-xs font-bold ring-2 ${TONE[a.tone]}`}
                  style={{ transform: `translate(-40%, -40%) scale(${inv})` }}>{a.label}</span>
              </button>
            ) : (
              <button key={a.id} type="button" data-annotation data-testid={`annotation-${a.id}`} title={a.title}
                onClick={() => onSelect?.(a.id)}
                className={`absolute flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold shadow-md ring-2 ${TONE[a.tone]} ${selectedId === a.id ? "outline outline-2 outline-red-500" : ""}`}
                style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, transform: `translate(-50%, -50%) scale(${inv})` }}>
                {a.label}
              </button>
            ),
          )}

          {draft && (
            <div data-testid="draft-rect" className="pointer-events-none absolute border-dashed border-red-500 bg-red-500/10"
              style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: `${draft.w * 100}%`, height: `${draft.h * 100}%`, borderWidth: 2 * inv }} />
          )}
        </div>
      </div>
    </div>
  );
}
