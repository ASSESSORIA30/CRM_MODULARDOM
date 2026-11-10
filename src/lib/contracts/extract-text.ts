// Text de cada pàgina d'un contracte (PDF amb capa de text o DOCX). Serveix per verificar
// que els imports que proposa la IA hi són escrits. Un PDF escanejat no en té: es retorna null.
import { unzipSync, strFromU8 } from "fflate";

export async function pdfPageTexts(bytes: Uint8Array): Promise<{ pages: string[]; numPages: number } | null> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // Node: el worker s'executa al mateix procés
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true });
    const doc = await task.promise;
    try {
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        let out = "";
        for (const it of tc.items) {
          if (!("str" in it)) continue;
          out += it.str + (it.hasEOL ? "\n" : " ");
        }
        pages.push(out);
      }
      const chars = pages.reduce((s, t) => s + t.replace(/\s/g, "").length, 0);
      return { pages: chars > 50 * doc.numPages * 0.1 ? pages : [], numPages: doc.numPages };
    } finally {
      await task.destroy();
    }
  } catch {
    return null;
  }
}

/** DOCX → text (paràgrafs). Sense pàgines: el format no en té de fixes. */
export function docxText(bytes: Uint8Array): string | null {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
    const xml = files["word/document.xml"];
    if (!xml) return null;
    return strFromU8(xml)
      .replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return null;
  }
}
