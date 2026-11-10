import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildReportPdf, pdfSafe } from "./report-pdf";
import { reportTexts } from "./report-texts";
import { summarizeRound, type ReportItem, type RoundReport } from "./round-report";

function tinyPng(): Uint8Array {
  // PNG 2x2 vàlid (sense dependències)
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(2, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const base: Omit<ReportItem, "ref" | "position" | "title" | "status"> = {
  description: "", room: null, sourceExcerpt: null, assessment: null, alternative: null, alternativeStatus: "cap", economic: null,
  confirmations: [], comments: [], markers: [], photos: [], resolution: null,
};
const items: ReportItem[] = [
  { ...base, ref: "R1.1", position: 1, title: "Ampliar la cuina", status: "no_viable", description: "Ampliar la cuina cap al menjador",
    sourceExcerpt: "Vull ampliar la cuina", assessment: "El mur és estructural", alternative: "Ampliar cap al rebost", alternativeStatus: "acceptada",
    economic: "pressupostar",
    confirmations: [{ kind: "alternativa_acceptada", who: "Client Prova", when: "08/11/2026 10:00" }],
    comments: [{ author: "Client Prova", when: "08/11/2026 09:00", body: "Quant espai guanyaríem?" }],
    markers: [{ label: "2", page: 1, kind: "rectangle", x: 0.1, y: 0.2, w: 0.3, h: 0.25, documentTitle: "Avantprojecte", documentVersion: 2, documentKind: "pdf", url: null, comment: "Zona de la cuina" }],
    photos: [{ title: "Cuina de referència", description: null, url: null, isImage: true }],
    resolution: { documentTitle: "Avantprojecte", version: 3, resolution: "alternativa", note: "Ampliació cap al rebost" } },
  { ...base, ref: "R1.2", position: 2, title: "Porta del bany", status: "incorporat", resolution: { documentTitle: "Avantprojecte", version: 3, resolution: "incorporat", note: null } },
  { ...base, ref: "R1.3", position: 3, title: "Finestra del menjador", status: "en_estudi" },
  { ...base, ref: "R1.4", position: 4, title: "Xemeneia", status: "descartat" },
];

describe("resum de ronda (només dades registrades)", () => {
  it("classifica els punts i cita les referències", () => {
    const s = summarizeRound(items);
    expect(s.requested).toEqual(["R1.1", "R1.2", "R1.3", "R1.4"]);
    expect(s.incorporated).toEqual(["R1.2"]);
    expect(s.notViable).toEqual(["R1.1"]);
    expect(s.alternativesAccepted).toEqual(["R1.1"]);
    expect(s.discarded).toEqual(["R1.4"]);
    expect(s.pending).toEqual(["R1.3"]);
  });
});

describe("PDF de l'informe", () => {
  it("text segur per a la font estàndard (accents, ç, l·l i €)", () => {
    expect(pdfSafe("Sol·licitud de façana: 300 € ✨ → fet")).toBe("Sol·licitud de façana: 300 €  -> fet");
  });

  it("conté les referències de punts, versions, estats i confirmacions", async () => {
    const report: RoundReport = {
      project: { title: "Habitatge de prova", code: "MD-2026-0001" },
      round: { number: 1, submittedAt: "07/11/2026 20:00", submittedBy: "Client Prova", status: "tancada", closedAt: null, isException: false,
        originalText: "Vull ampliar la cuina, canviar la porta del bany i fer la finestra del menjador més gran." },
      generatedAt: "08/11/2026 10:30",
      items,
      versions: [{ title: "Avantprojecte", version: 3, publishedAt: "08/11/2026", approvedAt: null }],
    };
    const png = tinyPng();
    const bytes = await buildReportPdf(report, reportTexts("ca"), new Map([
      ["marker:R1.1:2", { bytes: png, type: "png" as const }],
      ["photo:R1.1:0", { bytes: png, type: "png" as const }],
    ]));
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const dir = mkdtempSync(join(tmpdir(), "informe-"));
    const file = join(dir, "informe.pdf");
    writeFileSync(file, bytes);
    const text = execFileSync("pdftotext", ["-layout", file, "-"]).toString(); // poppler-utils
    for (const needle of ["Habitatge de prova", "Ronda 1", "R1.1 · Ampliar la cuina", "R1.2 · Porta del bany",
      "Modificacions incorporades: R1.2", "Peticions no viables: R1.1", "Alternatives acceptades: R1.1", "Punts pendents: R1.3",
      "Descartats: R1.4", "El mur és estructural", "Alternativa acceptada · Client Prova", "Substituït per alternativa",
      "Avantprojecte versió 3", "versió 2", "Quant espai guanyaríem?"]) {
      expect(text).toContain(needle);
    }
    const imgs = execFileSync("pdfimages", ["-list", file]).toString().trim().split("\n").length - 2;
    expect(imgs).toBe(2); // captura del plànol + fotografia
  });
});
