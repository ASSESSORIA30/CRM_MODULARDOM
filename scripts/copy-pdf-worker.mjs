// Copia el worker de pdf.js a public/ perquè el visor de plànols el carregui
// del mateix domini (s'executa automàticament després de `npm install`).
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = join(root, "public", "pdfjs", "pdf.worker.min.mjs");
if (!existsSync(src)) {
  console.warn("[pdf-worker] pdfjs-dist no instal·lat; s'omet");
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log("[pdf-worker] copiat a public/pdfjs/");
