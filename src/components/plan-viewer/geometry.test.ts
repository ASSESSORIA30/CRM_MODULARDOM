import { describe, expect, it } from "vitest";
import { centerOn, clampView, rectFromPoints, toNormalized, toScreen, zoomAt } from "./geometry";

const page = { left: 100, top: 50, width: 800, height: 600 };

describe("coordenades normalitzades", () => {
  it("anada i tornada a qualsevol zoom i mida", () => {
    const p = toNormalized(430, 488.6, page);
    expect(p).toEqual({ x: 0.4125, y: 0.731 });
    for (const box of [page, { left: -900, top: -300, width: 3200, height: 2400 }, { left: 0, top: 0, width: 375, height: 281.25 }]) {
      const s = toScreen(p, box);
      expect(toNormalized(s.x, s.y, box)).toEqual(p);
    }
  });
  it("es retallen a la pàgina", () => {
    expect(toNormalized(0, 0, page)).toEqual({ x: 0, y: 0 });
    expect(toNormalized(5000, 5000, page)).toEqual({ x: 1, y: 1 });
  });
});

describe("rectangles", () => {
  it("normalitza l'ordre dels punts", () => {
    expect(rectFromPoints({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, w: 0.3, h: 0.5 });
  });
  it("descarta zones massa petites (toc accidental)", () => {
    expect(rectFromPoints({ x: 0.5, y: 0.5 }, { x: 0.503, y: 0.6 })).toBeNull();
  });
  it("mai surt de la pàgina", () => {
    const r = rectFromPoints({ x: 0.9, y: 0.9 }, { x: 1.4, y: 1.2 })!;
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });
});

describe("zoom i desplaçament", () => {
  it("el punt sota el cursor no es mou en fer zoom", () => {
    const v0 = { zoom: 1, tx: 0, ty: 0 };
    const cx = 300, cy = 200;
    const before = { x: (cx - v0.tx) / v0.zoom, y: (cy - v0.ty) / v0.zoom };
    const v1 = zoomAt(v0, 3, cx, cy);
    expect((cx - v1.tx) / v1.zoom).toBeCloseTo(before.x, 9);
    expect((cy - v1.ty) / v1.zoom).toBeCloseTo(before.y, 9);
  });
  it("limita el zoom", () => {
    expect(zoomAt({ zoom: 1, tx: 0, ty: 0 }, 50, 0, 0).zoom).toBe(8);
    expect(zoomAt({ zoom: 2, tx: 0, ty: 0 }, 0.1, 0, 0).zoom).toBe(1);
  });
  it("centra un marcador", () => {
    const c = { width: 400, height: 300 }, content = { width: 400, height: 300 };
    const v = centerOn({ x: 0.75, y: 0.5 }, 2, c, content);
    expect(v.tx + 0.75 * 400 * 2).toBeCloseTo(200, 6);
  });
  it("no deixa perdre la pàgina", () => {
    const v = clampView({ zoom: 2, tx: 500, ty: -5000 }, { width: 400, height: 300 }, { width: 400, height: 300 });
    expect(v.tx).toBe(0);
    expect(v.ty).toBe(-300);
  });
});
