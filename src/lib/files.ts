// Validació de fitxers: nom, extensió i TIPUS REAL segons la signatura binària.
// No ens fiem del tipus MIME que declara el navegador. Funcions pures (Vitest).

export function extensionOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/);
  return m ? m[1] : "";
}

/** Nom segur per a la ruta de Storage (sense accents, espais ni caràcters especials). */
export function safeFileName(name: string): string {
  const ext = extensionOf(name);
  const base = name.slice(0, ext ? -(ext.length + 1) : undefined)
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80) || "fitxer";
  return ext ? `${base}.${ext}` : base;
}

type Sig = "pdf" | "png" | "jpeg" | "webp" | "zip" | "dwg" | "dxf";

export function detectSignature(b: Uint8Array): Sig | null {
  const ascii = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len));
  if (b.length >= 5 && ascii(0, 5) === "%PDF-") return "pdf";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 3) === "PNG" && b[4] === 0x0d && b[5] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "zip";
  if (b.length >= 6 && /^AC10\d\d$/.test(ascii(0, 6))) return "dwg";
  // DXF ASCII: comença amb el codi de grup 0 i la secció SECTION
  if (/^\s*0\s*\r?\n\s*SECTION/.test(ascii(0, Math.min(b.length, 64)))) return "dxf";
  return null;
}

const EXPECTED: Record<string, Sig> = {
  pdf: "pdf", png: "png", jpg: "jpeg", jpeg: "jpeg", webp: "webp",
  docx: "zip", xlsx: "zip", dwg: "dwg", dxf: "dxf",
};

/** El contingut correspon a l'extensió? (un .pdf que és un executable, no) */
export function contentMatchesExtension(ext: string, head: Uint8Array): boolean {
  const expected = EXPECTED[ext];
  return !!expected && detectSignature(head) === expected;
}

export const PREVIEWABLE = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);
export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp"]);
