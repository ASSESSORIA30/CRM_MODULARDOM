import { describe, expect, it } from "vitest";
import { contentMatchesExtension, detectSignature, extensionOf, safeFileName } from "./files";

const bytes = (...xs: (number | string)[]) =>
  new Uint8Array(xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe("noms de fitxer", () => {
  it("extensió en minúscules", () => {
    expect(extensionOf("Plànol FINAL.PDF")).toBe("pdf");
    expect(extensionOf("sense-extensio")).toBe("");
  });
  it("nom segur", () => {
    expect(safeFileName("Cuina d'en Joan (v2).JPG")).toBe("Cuina-d-en-Joan-v2.jpg");
    expect(safeFileName("../../etc/passwd")).toBe("etc-passwd");
    expect(safeFileName("àèò.pdf")).toBe("aeo.pdf");
  });
});

describe("tipus real per signatura binària", () => {
  it("reconeix els formats admesos", () => {
    expect(detectSignature(bytes("%PDF-1.7"))).toBe("pdf");
    expect(detectSignature(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(detectSignature(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpeg");
    expect(detectSignature(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 "))).toBe("webp");
    expect(detectSignature(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("zip");
    expect(detectSignature(bytes("AC1032"))).toBe("dwg");
    expect(detectSignature(bytes("  0\r\nSECTION\r\n"))).toBe("dxf");
  });
  it("rebutja fitxers disfressats", () => {
    expect(contentMatchesExtension("pdf", bytes("MZ", 0x90, 0))).toBe(false);          // executable de Windows
    expect(contentMatchesExtension("jpg", bytes("<html><script>"))).toBe(false);
    expect(contentMatchesExtension("png", bytes(0xff, 0xd8, 0xff))).toBe(false);       // JPEG amb extensió .png
    expect(contentMatchesExtension("exe", bytes("MZ"))).toBe(false);
  });
  it("accepta fitxers correctes", () => {
    expect(contentMatchesExtension("pdf", bytes("%PDF-1.4"))).toBe(true);
    expect(contentMatchesExtension("docx", bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true);
    expect(contentMatchesExtension("jpeg", bytes(0xff, 0xd8, 0xff, 0xdb))).toBe(true);
  });
});
