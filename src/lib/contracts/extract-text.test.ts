import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { strToU8, zipSync } from "fflate";
import { docxText, pdfPageTexts } from "./extract-text";
import { amountOnPage } from "./reading";

describe("text del contracte", () => {
  it("extreu el text de cada pàgina d'un PDF", async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    for (const t of ["Contracte de prova pàgina u", "F1.01 Inici del projecte 17.800,00 €"]) {
      const p = doc.addPage([400, 400]);
      p.drawText(t, { x: 20, y: 300, size: 12, font: f });
    }
    const r = await pdfPageTexts(await doc.save());
    expect(r?.numPages).toBe(2);
    expect(r?.pages[1]).toContain("17.800,00");
    expect(amountOnPage(1780000, r!.pages[1])).toBe(true);
    expect(amountOnPage(1780000, r!.pages[0])).toBe(false);
  });
  it("PDF il·legible → null", async () => {
    expect(await pdfPageTexts(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("extreu el text d'un DOCX", () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Preu: 35.600,00 €</w:t></w:r></w:p><w:p><w:r><w:t>Fita &amp; condició</w:t></w:r></w:p></w:body></w:document>';
    const t = docxText(zipSync({ "word/document.xml": strToU8(xml) }));
    expect(t).toBe("Preu: 35.600,00 €\nFita & condició");
  });
});

describe("text d'un Excel", () => {
  it("llegeix fulls, files i cel·les (cadenes compartides i números)", async () => {
    const { xlsxText } = await import("./extract-text");
    const wb = '<workbook><sheets><sheet name="Pressupost" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const ss = '<sst><si><t>Construcción</t></si><si><t>m²</t></si></sst>';
    const sh = '<worksheet><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2"><v>150</v></c><c r="C2" t="s"><v>1</v></c><c r="D2"><v>993</v></c><c r="E2"><v>148950</v></c></row></sheetData></worksheet>';
    const t = xlsxText(zipSync({ "xl/workbook.xml": strToU8(wb), "xl/sharedStrings.xml": strToU8(ss), "xl/worksheets/sheet1.xml": strToU8(sh) }));
    expect(t).toBe("=== Full 1 (Pressupost) ===\nfila 2: A=Construcción | B=150 | C=m² | D=993 | E=148950");
  });
});
