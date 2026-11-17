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

/** XLSX → text per fulls i files ("Full 1 · fila 3: A=… | B=…"), amb els valors tal com estan desats. */
export function xlsxText(bytes: Uint8Array): string | null {
  try {
    const files = unzipSync(bytes, { filter: (f) => f.name === "xl/workbook.xml" || f.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(f.name) });
    const dec = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    const shared: string[] = [];
    const ss = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(dec((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
    const wb = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
    const names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => dec(m[1]));
    const sheets = Object.keys(files).filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const out: string[] = [];
    sheets.forEach((name, si) => {
      const xml = strFromU8(files[name]);
      out.push(`=== Full ${si + 1}${names[si] ? ` (${names[si]})` : ""} ===`);
      for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
        const rn = row.match(/<row[^>]* r="(\d+)"/)?.[1] ?? "?";
        const cells: string[] = [];
        for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
          const ref = c.match(/ r="([A-Z]+)\d+"/)?.[1] ?? "?";
          const t = c.match(/ t="(\w+)"/)?.[1];
          const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          const inline = c.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
          const val = t === "s" && v != null ? shared[Number(v)] : t === "inlineStr" ? inline : v;
          if (val != null && String(val).trim() !== "") cells.push(`${ref}=${dec(String(val)).trim()}`);
        }
        if (cells.length) out.push(`fila ${rn}: ${cells.join(" | ")}`);
      }
    });
    return out.join("\n");
  } catch {
    return null;
  }
}
