"use client";

// Genera el PDF de l'informe al navegador: captura cada marcador sobre la pàgina exacta
// del plànol (pdf.js), prepara les fotografies i ho passa a pdf-lib. L'equip el pot arxivar
// a la documentació (intern; després es pot enviar a publicar com qualsevol document).
import { useState } from "react";
import { buildReportPdf, type ReportImage, type ReportTexts } from "@/lib/report/report-pdf";
import type { ReportMarker, RoundReport } from "@/lib/report/round-report";
import { uploadFile } from "@/lib/upload-client";

const MAX_W = 1100;
const GOLD = "#c9ab5d";
const NAVY = "#1c354b";

function canvasJpeg(canvas: HTMLCanvasElement): Promise<ReportImage> {
  return new Promise((resolve, reject) => canvas.toBlob(async (b) => {
    if (!b) return reject(new Error("canvas"));
    resolve({ bytes: new Uint8Array(await b.arrayBuffer()), type: "jpg" });
  }, "image/jpeg", 0.85));
}

async function fetchBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch");
  return createImageBitmap(await res.blob());
}

function whiteCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
}

function drawMarker(ctx: CanvasRenderingContext2D, m: ReportMarker, W: number, H: number) {
  const r = Math.max(12, W / 60);
  ctx.lineWidth = Math.max(3, W / 300);
  // Punt: centrat a la coordenada · Zona: rectangle i etiqueta a la cantonada
  const cx = m.x * W, cy = m.y * H;
  if (m.kind === "rectangle" && m.w && m.h) {
    ctx.fillStyle = "rgba(201,171,93,0.22)";
    ctx.strokeStyle = GOLD;
    ctx.fillRect(m.x * W, m.y * H, m.w * W, m.h * H);
    ctx.strokeRect(m.x * W, m.y * H, m.w * W, m.h * H);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.stroke();
  ctx.fillStyle = NAVY;
  ctx.font = `bold ${Math.round(r * 1.1)}px Helvetica, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(m.label, cx, cy + 1);
}

async function captureMarker(m: ReportMarker): Promise<ReportImage | null> {
  if (!m.url) return null;
  if (m.documentKind === "image") {
    const bmp = await fetchBitmap(m.url);
    const s = Math.min(1, MAX_W / bmp.width);
    const { c, ctx } = whiteCanvas(bmp.width * s, bmp.height * s);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    drawMarker(ctx, m, c.width, c.height);
    return canvasJpeg(c);
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ url: m.url });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(Math.min(m.page, doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: MAX_W / base.width });
    const { c, ctx } = whiteCanvas(vp.width, vp.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
    drawMarker(ctx, m, c.width, c.height);
    return canvasJpeg(c);
  } finally {
    await task.destroy();
  }
}

async function preparePhoto(url: string): Promise<ReportImage> {
  // Qualsevol format que el navegador sàpiga obrir (també WEBP) → JPEG
  const bmp = await fetchBitmap(url);
  const s = Math.min(1, 900 / bmp.width);
  const { c, ctx } = whiteCanvas(bmp.width * s, bmp.height * s);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return canvasJpeg(c);
}

async function collectImages(report: RoundReport, onProgress: (done: number, total: number) => void) {
  const jobs: [string, () => Promise<ReportImage | null>][] = [];
  for (const it of report.items) {
    for (const m of it.markers) jobs.push([`marker:${it.ref}:${m.label}`, () => captureMarker(m)]);
    it.photos.forEach((p, k) => { if (p.isImage && p.url) jobs.push([`photo:${it.ref}:${k}`, () => preparePhoto(p.url!)]); });
  }
  const images = new Map<string, ReportImage>();
  let done = 0;
  for (const [key, job] of jobs) {
    // Una imatge que no es pot obtenir no atura l'informe: el text i les referències hi són igualment
    try { const img = await job(); if (img) images.set(key, img); } catch { /* sense imatge */ }
    onProgress(++done, jobs.length);
  }
  return images;
}

export function ReportActions({ report, texts, projectId, canArchive, previousVersionId, labels, errors }: {
  report: RoundReport; texts: ReportTexts; projectId: string; canArchive: boolean; previousVersionId: string | null;
  labels: { download: string; archive: string; archived: string; preparing: string; print: string };
  errors: Record<string, string>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileName = `${report.project.code}-informe-ronda-${report.round.number}.pdf`;

  async function build() {
    setBusy(labels.preparing);
    const images = await collectImages(report, (d, t) => setBusy(`${labels.preparing} ${d}/${t}`));
    return buildReportPdf(report, texts, images);
  }

  async function download() {
    setMsg(null);
    try {
      const bytes = await build();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setMsg({ ok: false, text: errors.genericError });
    } finally { setBusy(null); }
  }

  async function archive() {
    setMsg(null);
    try {
      const bytes = await build();
      const file = new File([bytes as BlobPart], fileName, { type: "application/pdf" });
      const res = await uploadFile(projectId, file, "application/pdf", {
        title: `${texts.title} · ${texts.round} ${report.round.number}`, category: "memoria", visibility: "intern",
        description: null, roomTag: null, previousVersionId, bucket: "avantprojecte",
      });
      setMsg(res.ok ? { ok: true, text: labels.archived } : { ok: false, text: errors[res.error] ?? errors.genericError });
    } catch {
      setMsg({ ok: false, text: errors.genericError });
    } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" onClick={download} disabled={!!busy} data-testid="report-download"
        className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">⬇ {labels.download}</button>
      <button type="button" onClick={() => window.print()} disabled={!!busy}
        className="rounded-md border border-navy/20 bg-white px-4 py-2 text-sm text-navy">🖨 {labels.print}</button>
      {canArchive && (
        <button type="button" onClick={archive} disabled={!!busy} data-testid="report-archive"
          className="rounded-md border border-gold bg-gold-light px-4 py-2 text-sm font-semibold text-navy disabled:opacity-50">🗄 {labels.archive}</button>
      )}
      {busy && <span role="status" className="text-sm text-muted">{busy}</span>}
      {msg && <span role="status" className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.ok ? "✓ " : ""}{msg.text}</span>}
    </div>
  );
}
