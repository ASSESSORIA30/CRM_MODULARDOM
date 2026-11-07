// Geometria del visor de plànols. Funcions pures (provades amb Vitest).
// Totes les anotacions es guarden en coordenades normalitzades [0, 1] relatives
// a la pàgina sencera, independents del zoom, la mida de pantalla o el dispositiu.

export type Box = { left: number; top: number; width: number; height: number };
export type NPoint = { x: number; y: number };
export type NRect = { x: number; y: number; w: number; h: number };

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
/** Moviment màxim (px de pantalla) perquè un gest compti com a "toc" i no com a arrossegament. */
export const TAP_TOLERANCE_PX = 8;
/** Mida mínima d'un rectangle (fracció de la pàgina) per evitar zones accidentals. */
export const MIN_RECT = 0.01;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round8 = (v: number) => Math.round(v * 1e8) / 1e8;

/**
 * Punt de pantalla → coordenades normalitzades de la pàgina.
 * `page` és el getBoundingClientRect() de l'element de la pàgina, que ja inclou
 * el zoom i el desplaçament aplicats amb transformacions CSS.
 */
export function toNormalized(clientX: number, clientY: number, page: Box): NPoint {
  return {
    x: round8(clamp((clientX - page.left) / page.width, 0, 1)),
    y: round8(clamp((clientY - page.top) / page.height, 0, 1)),
  };
}

/** Coordenades normalitzades → punt de pantalla. */
export function toScreen(p: NPoint, page: Box): { x: number; y: number } {
  return { x: page.left + p.x * page.width, y: page.top + p.y * page.height };
}

/** Rectangle normalitzat a partir de dos punts (en qualsevol ordre), retallat a la pàgina. */
export function rectFromPoints(a: NPoint, b: NPoint): NRect | null {
  const x1 = clamp(Math.min(a.x, b.x), 0, 1);
  const y1 = clamp(Math.min(a.y, b.y), 0, 1);
  const x2 = clamp(Math.max(a.x, b.x), 0, 1);
  const y2 = clamp(Math.max(a.y, b.y), 0, 1);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < MIN_RECT || h < MIN_RECT) return null;
  return { x: round8(x1), y: round8(y1), w: round8(Math.min(w, 1 - x1)), h: round8(Math.min(h, 1 - y1)) };
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export type View = { zoom: number; tx: number; ty: number };

/**
 * Zoom mantenint fix el punt de pantalla (cx, cy) relatiu a l'origen del contenidor.
 * El contingut es transforma com `translate(tx, ty) scale(zoom)` amb origen a (0,0).
 */
export function zoomAt(view: View, nextZoom: number, cx: number, cy: number): View {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const k = zoom / view.zoom;
  return { zoom, tx: cx - (cx - view.tx) * k, ty: cy - (cy - view.ty) * k };
}

/** Limita el desplaçament perquè la pàgina no surti completament de la vista. */
export function clampView(view: View, container: { width: number; height: number }, content: { width: number; height: number }): View {
  const w = content.width * view.zoom;
  const h = content.height * view.zoom;
  const minTx = Math.min(0, container.width - w);
  const minTy = Math.min(0, container.height - h);
  const maxTy = Math.max(0, container.height - h);
  return {
    zoom: view.zoom,
    tx: w <= container.width ? (container.width - w) / 2 : clamp(view.tx, minTx, 0),
    ty: h <= container.height ? clamp(view.ty, 0, maxTy) : clamp(view.ty, minTy, 0),
  };
}

/** Vista centrada en un punt normalitzat de la pàgina amb un zoom donat ("Veure al plànol"). */
export function centerOn(p: NPoint, zoom: number, container: { width: number; height: number }, content: { width: number; height: number }): View {
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return clampView(
    { zoom: z, tx: container.width / 2 - p.x * content.width * z, ty: container.height / 2 - p.y * content.height * z },
    container, content,
  );
}
