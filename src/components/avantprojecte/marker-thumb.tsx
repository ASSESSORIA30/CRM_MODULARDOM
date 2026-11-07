"use client";

// Miniatura d'una pàgina del plànol amb el marcador dibuixat a sobre
// (pantalla de confirmació i informes). Coordenades normalitzades.
import { useEffect, useRef, useState } from "react";

export function MarkerThumb({ url, kind, page, x, y, w, h, label, width = 220 }: {
  url: string; kind: "pdf" | "image"; page: number; x: number; y: number; w?: number | null; h?: number | null;
  label: string; width?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (kind === "image") {
      const img = new Image();
      img.onload = () => { if (!cancelled) setAspect(img.naturalHeight / img.naturalWidth); };
      img.onerror = () => { if (!cancelled) setFailed(true); };
      img.src = url;
      return () => { cancelled = true; };
    }
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ url }).promise;
        const p = await doc.getPage(Math.min(page, doc.numPages));
        const base = p.getViewport({ scale: 1 });
        if (cancelled) return;
        setAspect(base.height / base.width);
        const vp = p.getViewport({ scale: (width * 2) / base.width });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await p.render({ canvas, viewport: vp }).promise;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [url, kind, page, width]);

  if (failed) return null;
  return (
    <div className="relative overflow-hidden rounded-md border border-navy/15 bg-white" style={{ width, height: aspect ? width * aspect : width * 0.7 }}>
      {kind === "image"
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt="" className="block h-full w-full" />
        : <canvas ref={canvasRef} className="block h-full w-full" />}
      {kind === "pdf" || aspect ? (
        w && h ? (
          <span className="absolute rounded-sm border-2 border-gold bg-gold/20"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}>
            <span className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-navy-dark">{label}</span>
          </span>
        ) : (
          <span className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-navy-dark ring-2 ring-white"
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}>{label}</span>
        )
      ) : null}
    </div>
  );
}
