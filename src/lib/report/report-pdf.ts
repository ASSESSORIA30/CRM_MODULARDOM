// Generador del PDF de l'informe de revisió (pdf-lib). Funciona al navegador i a Node.
// Les imatges (captures del plànol amb el marcador i fotografies) arriben ja preparades.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { summarizeRound, type RoundReport } from "./round-report";

export type ReportImage = { bytes: Uint8Array; type: "png" | "jpg" };
export type ReportTexts = {
  title: string; project: string; round: string; submitted: string; generated: string; status: string; exception: string; closed: string; open: string;
  summary: string; requested: string; incorporated: string; partial: string; notViable: string; alternativesAccepted: string; pending: string; discarded: string;
  originalText: string; item: string; room: string; originalRequest: string; confirmedInterpretation: string; plan: string; photos: string;
  architect: string; alternative: string; clientConfirmations: string; comments: string; finalResolution: string; version: string;
  references: string; published: string; approved: string; page: string; of: string; none: string; economic: string;
  itemStatus: Record<string, string>; altStatus: Record<string, string>; resolutions: Record<string, string>; confirmationKinds: Record<string, string>;
  economicOptions: Record<string, string>;
};

const NAVY = rgb(0x1c / 255, 0x35 / 255, 0x4b / 255);
const GOLD = rgb(0xc9 / 255, 0xab / 255, 0x5d / 255);
const MUTED = rgb(0.42, 0.47, 0.52);
const INK = rgb(0.12, 0.16, 0.2);

// Helvetica estàndard = codificació WinAnsi: es conserven accents, ç, l·l, €, cometes…
const EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""));
export function pdfSafe(text: string): string {
  return [...(text ?? "").normalize("NFC")].map((c) => {
    if (c === "\t") return " ";
    if (c === "→") return "->";
    const code = c.codePointAt(0)!;
    if (c === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || EXTRA.has(c)) return c;
    return "";
  }).join("");
}

class Writer {
  page!: PDFPage;
  y = 0;
  readonly W = 595.28;
  readonly H = 841.89;
  readonly M = 50;
  constructor(public doc: PDFDocument, public font: PDFFont, public bold: PDFFont) { this.newPage(); }
  newPage() { this.page = this.doc.addPage([this.W, this.H]); this.y = this.H - this.M; }
  ensure(h: number) { if (this.y - h < this.M + 20) this.newPage(); }
  wrap(text: string, size: number, font: PDFFont, width: number): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) <= width) line = test;
        else {
          if (line) out.push(line);
          // paraules molt llargues (URL…) es tallen
          let w = word;
          while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
            let k = w.length;
            while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > width) k--;
            out.push(w.slice(0, k));
            w = w.slice(k);
          }
          line = w;
        }
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const x = this.M + (o.indent ?? 0);
    for (const line of this.wrap(text, size, font, this.W - x - this.M)) {
      this.ensure(size + 3);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK });
      this.y -= size + 3;
    }
    this.y -= o.gap ?? 2;
  }
  label(label: string, value: string | null | undefined, indent = 0) {
    if (!value) return;
    this.text(label, { size: 8, bold: true, color: MUTED, indent, gap: 0 });
    this.text(value, { size: 10, indent, gap: 6 });
  }
  rule(color = GOLD, thickness = 1.5) {
    this.ensure(8);
    this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness, color });
    this.y -= 10;
  }
  image(img: PDFImage, maxW: number, maxH: number, x?: number) {
    const s = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * s, h = img.height * s;
    this.ensure(h + 6);
    this.page.drawImage(img, { x: x ?? this.M, y: this.y - h, width: w, height: h });
    this.page.drawRectangle({ x: x ?? this.M, y: this.y - h, width: w, height: h, borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5 });
    return { w, h };
  }
}

export async function buildReportPdf(r: RoundReport, T: ReportTexts, images: Map<string, ReportImage>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${T.title} · ${r.project.title} · ${T.round} ${r.round.number}`));
  doc.setAuthor("ModularDom");
  doc.setCreator("ModularDom CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  const embed = async (key: string) => {
    const im = images.get(key);
    if (!im) return null;
    try { return im.type === "png" ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes); } catch { return null; }
  };

  // Capçalera
  w.page.drawRectangle({ x: 0, y: w.H - 70, width: w.W, height: 70, color: NAVY });
  w.page.drawText("MODULARDOM", { x: w.M, y: w.H - 42, size: 16, font: bold, color: rgb(1, 1, 1) });
  w.page.drawText(pdfSafe(T.title), { x: w.M, y: w.H - 60, size: 9, font, color: GOLD });
  w.y = w.H - 95;
  w.text(`${r.project.title}`, { size: 18, bold: true, color: NAVY, gap: 2 });
  w.text(`${r.project.code} · ${T.round} ${r.round.number}${r.round.isException ? ` (${T.exception})` : ""} · ${r.round.status === "tancada" ? T.closed : T.open}`, { size: 10, color: MUTED });
  w.text(`${T.submitted}: ${r.round.submittedAt} · ${r.round.submittedBy}`, { size: 9, color: MUTED });
  w.text(`${T.generated}: ${r.generatedAt}`, { size: 9, color: MUTED, gap: 8 });
  w.rule();

  // Resum
  const s = summarizeRound(r.items);
  w.text(T.summary, { size: 13, bold: true, color: NAVY, gap: 4 });
  const line = (label: string, refs: string[]) => w.text(`${label}: ${refs.length ? refs.join(", ") : T.none}`, { size: 10, gap: 2 });
  line(T.requested, s.requested);
  line(T.incorporated, s.incorporated);
  line(T.partial, s.partial);
  line(T.notViable, s.notViable);
  line(T.alternativesAccepted, s.alternativesAccepted);
  line(T.discarded, s.discarded);
  line(T.pending, s.pending);
  w.y -= 6;
  if (r.round.originalText) w.label(T.originalText, r.round.originalText);
  w.rule();

  // Punts
  for (const it of r.items) {
    w.ensure(80);
    w.text(`${it.ref} · ${it.title}`, { size: 12, bold: true, color: NAVY, gap: 1 });
    w.text(`${T.status}: ${T.itemStatus[it.status] ?? it.status}${it.room ? ` · ${T.room}: ${it.room}` : ""}`, { size: 9, color: MUTED, gap: 6 });
    w.label(T.originalRequest, it.sourceExcerpt);
    w.label(T.confirmedInterpretation, it.description);

    // Plànol amb marcadors
    for (const m of it.markers) {
      const img = await embed(`marker:${it.ref}:${m.label}`);
      w.text(`${T.plan}: ${m.documentTitle} · ${T.version} ${m.documentVersion} · p. ${m.page} · #${m.label}${m.comment ? ` — ${m.comment}` : ""}`, { size: 9, color: MUTED, gap: 2 });
      if (img) { const { h } = w.image(img, 300, 220); w.y -= h + 8; }
    }
    // Fotografies d'inspiració (fins a 3 per fila)
    if (it.photos.length) {
      w.text(T.photos, { size: 8, bold: true, color: MUTED, gap: 2 });
      let x = w.M; let rowH = 0;
      for (let k = 0; k < it.photos.length; k++) {
        const ph = it.photos[k];
        const img = ph.isImage ? await embed(`photo:${it.ref}:${k}`) : null;
        if (!img) { w.text(`- ${ph.title}${ph.description ? ` (${ph.description})` : ""}`, { size: 9 }); continue; }
        const s2 = Math.min(150 / img.width, 110 / img.height, 1);
        const pw = img.width * s2, ph2 = img.height * s2;
        if (x + pw > w.W - w.M) { w.y -= rowH + 18; x = w.M; rowH = 0; }
        w.ensure(ph2 + 18);
        w.page.drawImage(img, { x, y: w.y - ph2, width: pw, height: ph2 });
        w.page.drawText(pdfSafe(ph.title).slice(0, 40), { x, y: w.y - ph2 - 10, size: 7, font, color: MUTED });
        x += pw + 10; rowH = Math.max(rowH, ph2);
      }
      if (rowH) w.y -= rowH + 18;
    }
    w.label(T.architect, it.assessment);
    if (it.alternative) w.label(`${T.alternative} (${T.altStatus[it.alternativeStatus] ?? it.alternativeStatus})`, it.alternative);
    if (it.economic) w.label(T.economic, T.economicOptions[it.economic] ?? it.economic);
    if (it.confirmations.length) {
      w.label(T.clientConfirmations, it.confirmations.map((c) => `${T.confirmationKinds[c.kind] ?? c.kind} · ${c.who} · ${c.when}`).join("\n"));
    }
    if (it.comments.length) {
      w.label(T.comments, it.comments.map((c) => `${c.author} (${c.when}): ${c.body}`).join("\n"));
    }
    w.label(T.finalResolution, it.resolution
      ? `${T.resolutions[it.resolution.resolution] ?? it.resolution.resolution} · ${it.resolution.documentTitle} ${T.version} ${it.resolution.version}${it.resolution.note ? ` — ${it.resolution.note}` : ""}`
      : `${T.itemStatus[it.status] ?? it.status}`);
    w.rule(rgb(0.88, 0.88, 0.88), 0.5);
  }

  // Documents de referència
  if (r.versions.length) {
    w.text(T.references, { size: 13, bold: true, color: NAVY, gap: 4 });
    for (const v of r.versions) {
      w.text(`${v.title} · ${T.version} ${v.version}${v.publishedAt ? ` · ${T.published}: ${v.publishedAt}` : ""}${v.approvedAt ? ` · ${T.approved}: ${v.approvedAt}` : ""}`, { size: 10 });
    }
  }

  // Peu de pàgina
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(pdfSafe(`${r.project.code} · ${T.round} ${r.round.number} · ${T.page} ${i + 1} ${T.of} ${pages.length}`),
      { x: 50, y: 25, size: 8, font, color: MUTED });
  });
  return doc.save();
}
