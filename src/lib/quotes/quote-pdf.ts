// PDF corporatiu del pressupost (pdf-lib, servidor). Estructura del model de referència:
// titulars i empresa, resum del pressupost base, extres, totals amb IVA per tipus, acceptació i signatures.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatCents } from "@/lib/money";
import type { QuotePdfTexts } from "@/lib/i18n-pressupostos";
import { GOLD, INK, MUTED, NAVY, pdfSafe, Writer } from "@/lib/report/report-pdf";
import { formatQuantity, formatRate, lineAmountCents, quoteTotals, type CalcLine, type LineKind } from "./calc";

export type QuotePdfLine = CalcLine & { chapter: string; description: string; unit: string };
export type QuotePdfData = {
  company: { legalName: string; taxId: string | null; address: string | null; phone: string | null; email: string | null; website: string | null };
  holders: { name: string; taxId: string | null; address: string | null }[];
  project: { title: string; code: string; address: string | null };
  quote: { code: string; version: number; issueDate: string | null; validUntil: string | null; intro: string | null; notes: string | null; conditions: string | null; draft: boolean };
  lines: QuotePdfLine[];
};

const LIGHT = rgb(0.96, 0.95, 0.92);

export async function buildQuotePdf(d: QuotePdfData, T: QuotePdfTexts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${T.docTitle} ${d.quote.code} v${d.quote.version}`));
  doc.setAuthor(pdfSafe(d.company.legalName));
  doc.setCreator("ModularDom CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);
  const right = w.W - w.M;
  const amt = (c: number) => formatCents(c);

  // Capçalera
  w.page.drawRectangle({ x: 0, y: w.H - 92, width: w.W, height: 92, color: NAVY });
  w.page.drawText("MODULARDOM", { x: w.M, y: w.H - 44, size: 20, font: bold, color: rgb(1, 1, 1) });
  w.page.drawText(pdfSafe(T.docTitle), { x: w.M, y: w.H - 64, size: 10, font: bold, color: GOLD });
  w.page.drawText(pdfSafe(T.subtitle), { x: w.M, y: w.H - 78, size: 8.5, font, color: rgb(0.85, 0.88, 0.92) });
  const meta = [
    `${T.number}: ${d.quote.code}`, `${T.version}: ${d.quote.version}`,
    d.quote.issueDate ? `${T.date}: ${d.quote.issueDate}` : "", d.quote.validUntil ? `${T.validUntil}: ${d.quote.validUntil}` : "",
  ].filter(Boolean);
  meta.forEach((m, i) => {
    const t = pdfSafe(m);
    w.page.drawText(t, { x: right - font.widthOfTextAtSize(t, 8.5), y: w.H - 34 - i * 12, size: 8.5, font, color: rgb(1, 1, 1) });
  });
  if (d.quote.draft) {
    const t = "ESBORRANY / BORRADOR";
    w.page.drawText(t, { x: right - bold.widthOfTextAtSize(t, 9), y: w.H - 84, size: 9, font: bold, color: GOLD });
  }
  w.y = w.H - 112;

  // Titulars i empresa
  const colW = (w.W - 2 * w.M - 20) / 2;
  const block = (x: number, title: string, lines: string[]) => {
    let y = w.y;
    w.page.drawText(pdfSafe(title), { x, y: y - 8, size: 8, font: bold, color: MUTED });
    y -= 20;
    for (const l of lines.filter(Boolean)) {
      for (const part of w.wrap(l, 9.5, font, colW)) {
        w.page.drawText(part, { x, y, size: 9.5, font, color: INK });
        y -= 12;
      }
    }
    return y;
  };
  const holders = d.holders.length ? d.holders : [{ name: "—", taxId: null, address: null }];
  let yMin = w.y;
  holders.forEach((h, i) => {
    const x = i % 2 === 0 ? w.M : w.M + colW + 20;
    const y = block(x, `${T.client} ${holders.length > 1 ? i + 1 : ""}`.trim(), [h.name, h.taxId ? `${T.taxId} ${h.taxId}` : "", h.address ?? ""]);
    yMin = Math.min(yMin, y);
    if (i % 2 === 1 || i === holders.length - 1) { w.y = yMin - 8; yMin = w.y; }
  });
  const c = d.company;
  const yCompany = block(w.M, T.company, [c.legalName, c.taxId ? `NIF ${c.taxId}` : "", c.address ?? "", [c.phone, c.email].filter(Boolean).join(" · ")]);
  const yProject = block(w.M + colW + 20, T.project, [`${d.project.title} (${d.project.code})`, d.project.address ?? ""]);
  w.y = Math.min(yCompany, yProject) - 10;

  if (d.quote.intro) w.text(d.quote.intro, { size: 9.5, gap: 8 });

  // Taules per tipus de partida
  const section = (title: string, kind: LineKind, totalLabel: string) => {
    const lines = d.lines.filter((l) => l.kind === kind);
    if (!lines.length) return 0;
    w.ensure(60);
    w.text(title, { size: 11.5, bold: true, color: NAVY, gap: 4 });
    const head = w.y;
    w.page.drawRectangle({ x: w.M, y: head - 16, width: w.W - 2 * w.M, height: 16, color: LIGHT });
    w.page.drawText(pdfSafe(T.concept), { x: w.M + 6, y: head - 11.5, size: 8.5, font: bold, color: NAVY });
    const ah = pdfSafe(T.amount);
    w.page.drawText(ah, { x: right - 6 - bold.widthOfTextAtSize(ah, 8.5), y: head - 11.5, size: 8.5, font: bold, color: NAVY });
    w.y -= 22;
    let chapter = "";
    let sum = 0;
    for (const l of lines) {
      const a = lineAmountCents(l);
      sum += a;
      if (l.chapter && l.chapter !== chapter && kind === "base" && lines.some((x) => x.chapter !== l.chapter)) {
        chapter = l.chapter;
        w.text(l.chapter, { size: 8.5, bold: true, color: MUTED, indent: 6, gap: 1 });
      }
      const qty = l.quantityMilli !== 1000 || l.unit !== "u"
        ? ` (${formatQuantity(l.quantityMilli)} ${l.unit} x ${formatCents(l.unitPriceCents)}${l.discountBp ? `, -${formatRate(l.discountBp)}` : ""})` : (l.discountBp ? ` (-${formatRate(l.discountBp)})` : "");
      const txt = `${l.description}${qty}${l.vatRateBp !== 1000 ? `  · IVA ${formatRate(l.vatRateBp)}` : ""}`;
      const am = pdfSafe(amt(a));
      const descLines = w.wrap(txt, 9.5, font, w.W - 2 * w.M - 110);
      w.ensure(descLines.length * 12 + 6);
      const top = w.y;
      descLines.forEach((dl, k) => w.page.drawText(dl, { x: w.M + 6, y: top - 10 - k * 12, size: 9.5, font, color: INK }));
      w.page.drawText(am, { x: right - 6 - font.widthOfTextAtSize(am, 9.5), y: top - 10, size: 9.5, font, color: INK });
      w.y = top - descLines.length * 12 - 6;
      w.page.drawLine({ start: { x: w.M, y: w.y + 2 }, end: { x: right, y: w.y + 2 }, thickness: 0.4, color: rgb(0.88, 0.88, 0.88) });
    }
    w.ensure(22);
    const tl = pdfSafe(totalLabel);
    const tv = pdfSafe(`${amt(sum)} ${T.plusVat}`);
    w.page.drawText(tl, { x: w.M + 6, y: w.y - 12, size: 10, font: bold, color: NAVY });
    w.page.drawText(tv, { x: right - 6 - bold.widthOfTextAtSize(tv, 10), y: w.y - 12, size: 10, font: bold, color: NAVY });
    w.y -= 30;
    return sum;
  };
  section(T.baseSummary, "base", T.totalBase);
  section(T.extrasInitial, "extra_inicial", T.totalExtras);
  section(T.extrasLater, "extra_posterior", T.totalLater);
  section(T.discounts, "descompte", T.totalDiscounts);

  // Totals
  const t = quoteTotals(d.lines);
  w.ensure(40 + t.vatBreakdown.length * 14);
  w.rule();
  const row = (label: string, value: string, strong = false, size = 10) => {
    const l = pdfSafe(label), v = pdfSafe(value), f = strong ? bold : font;
    w.page.drawText(l, { x: right - 260, y: w.y - size, size, font: f, color: strong ? NAVY : INK });
    w.page.drawText(v, { x: right - 6 - f.widthOfTextAtSize(v, size), y: w.y - size, size, font: f, color: strong ? NAVY : INK });
    w.y -= size + 6;
  };
  row(T.taxable, amt(t.taxableCents), true);
  for (const r of t.vatBreakdown) row(`${T.vat} ${formatRate(r.rateBp)} (${amt(r.baseCents)})`, amt(r.vatCents));
  row(T.total, amt(t.totalCents), true, 12);
  if (t.extrasInitialCents > 0) {
    w.y -= 4;
    const msg = pdfSafe(`${T.turnkey}: ${amt(t.taxableCents)} ${T.plusVat}`);
    w.ensure(26);
    w.page.drawRectangle({ x: w.M, y: w.y - 22, width: w.W - 2 * w.M, height: 22, color: NAVY });
    w.page.drawText(msg, { x: (w.W - bold.widthOfTextAtSize(msg, 11)) / 2, y: w.y - 15, size: 11, font: bold, color: GOLD });
    w.y -= 34;
  }
  if (d.quote.conditions) w.text(d.quote.conditions, { size: 8.5, color: MUTED, gap: 4 });
  if (d.quote.notes) w.text(d.quote.notes, { size: 9.5, gap: 8 });

  // Acceptació i signatures
  w.ensure(200);
  w.text(T.acceptance, { size: 11.5, bold: true, color: NAVY, gap: 4 });
  w.text(T.acceptanceText, { size: 9.5, gap: 30 });
  const sig = (x: number, y: number, a: string, b: string) => {
    w.page.drawLine({ start: { x, y }, end: { x: x + colW - 20, y }, thickness: 0.7, color: INK });
    w.page.drawText(pdfSafe(a), { x, y: y - 12, size: 9, font: bold, color: INK });
    w.page.drawText(pdfSafe(b), { x, y: y - 24, size: 8.5, font, color: MUTED });
  };
  const signers = [...holders.map((h) => [h.name, T.signature]), [T.forCompany, T.stamp], ["", T.dateLabel]];
  for (let i = 0; i < signers.length; i += 2) {
    w.ensure(70);
    sig(w.M, w.y - 30, signers[i][0], signers[i][1]);
    if (signers[i + 1]) sig(w.M + colW + 20, w.y - 30, signers[i + 1][0], signers[i + 1][1]);
    w.y -= 70;
  }
  if (d.quote.validUntil) w.text(`${T.validity} ${d.quote.validUntil}.`, { size: 9, gap: 2 });
  w.text(`${T.issuedBy} ${c.legalName}.`, { size: 8.5, color: MUTED });

  // Peu
  const pages = doc.getPages();
  const contact = pdfSafe([c.phone, c.email, c.website].filter(Boolean).join(" · "));
  pages.forEach((p, i) => {
    p.drawText(contact, { x: w.M, y: 24, size: 7.5, font, color: MUTED });
    const n = pdfSafe(`${d.quote.code} v${d.quote.version} · ${T.page} ${i + 1} ${T.of} ${pages.length}`);
    p.drawText(n, { x: right - font.widthOfTextAtSize(n, 7.5), y: 24, size: 7.5, font, color: MUTED });
  });
  return doc.save();
}
