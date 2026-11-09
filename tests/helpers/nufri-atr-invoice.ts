/**
 * Factura FICTÍCIA amb el format d'una factura 3.0TD d'Energia Nufri que separa l'energia en «Terme Energia ATR» i
 * «Terme Energia Lliure». Titular, NIF, CUPS i adreça són inventats. Els preus finals P3–P6 són els del cas de prova
 * (0,210297 · 0,197793 · 0,246635 · 0,224240 €/kWh); el repartiment ATR/lliure de P4–P6 és fictici.
 * P1 i P2 no es facturen. Els consums de les línies d'ATR tenen decimals i els de l'energia lliure estan arrodonits
 * (1.223,843 / 1.224 kWh…), com a la factura real.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";

export const NUFRI_ATR_CASE = {
  final: { 3: 0.210297, 4: 0.197793, 5: 0.246635, 6: 0.22424 } as Record<number, number>,
  atr: { 3: 0.019279, 4: 0.011236, 5: 0.059713, 6: 0.000924 } as Record<number, number>,
  lliure: { 3: 0.191018, 4: 0.186557, 5: 0.186922, 6: 0.223316 } as Record<number, number>,
  kwhPrecise: { 3: 1223.843, 4: 884.004, 5: 52.5, 6: 2503.911 } as Record<number, number>,
  kwhRounded: { 3: 1224, 4: 884, 5: 52, 6: 2504 } as Record<number, number>,
  kw: [50, 50, 50, 50, 50, 60],
  powerDay: [0.073782, 0.038093, 0.016241, 0.014203, 0.009087, 0.005302],
};

const es = (n: number, d: number) => n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true });
const kwhTxt = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 3, useGrouping: true });

export function nufriAtrPages(opts: { powerUnit?: "dia" | "any"; repeatSummary?: boolean } = {}): string[] {
  const C = NUFRI_ATR_CASE;
  const P = [3, 4, 5, 6];
  const amt = (k: number, p: number) => Math.round(k * p * 100) / 100;
  const power = C.kw.map((kw, i) => {
    const day = C.powerDay[i];
    return opts.powerUnit === "any"
      ? `P${i + 1} ${es(kw, 3)} kW x ${es(day * 365, 6)} €/kW año x 30/365 = ${es(Math.round(kw * day * 30 * 100) / 100, 2)} €`
      : `P${i + 1} ${es(kw, 3)} kW x 30 dies x ${es(day, 6)} €/kW dia = ${es(Math.round(kw * day * 30 * 100) / 100, 2)} €`;
  });
  const page1 = [
    "Energia Nufri, S.L.U. - Factura d'electricitat (FICTÍCIA)",
    "Titular: COMERCIAL FICTICIA PROVA SL",
    "NIF: B99999998",
    "CUPS: ES0031405000000002AB",
    "Peatge d'accés: 3.0TD",
    "Periodo de facturación: del 01/10/2026 al 30/10/2026 (30 días)",
    ...C.kw.map((k, i) => `Potència contractada P${i + 1}: ${es(k, 3)} kW`),
    ...P.map((p) => `Consum P${p}: ${kwhTxt(C.kwhRounded[p])} kWh`),
    "Total a pagar: 1.402,37 €",
  ];
  const detail = [
    "Detall de la factura",
    "Terme Potència",
    ...power,
    "Terme Energia ATR",
    ...P.map((p) => `P${p} ${kwhTxt(C.kwhPrecise[p])} kWh x ${es(C.atr[p], 6)} €/kWh = ${es(amt(C.kwhPrecise[p], C.atr[p]), 2)} €`),
    "Terme Energia Lliure",
    ...P.map((p) => `P${p} ${kwhTxt(C.kwhRounded[p])} kWh x ${es(C.lliure[p], 6)} €/kWh = ${es(amt(C.kwhRounded[p], C.lliure[p]), 2)} €`),
    "Servei d'ajust del sistema (SAS) 12,40 €",
    "Impost elèctric 5,11% 45,10 €",
    "Lloguer de comptador 1,08 €",
    "IVA 21% 243,37 €",
  ];
  // resum repetit (mateixes línies de l'ATR en una pàgina de resum): no s'ha de sumar dues vegades
  const summary = opts.repeatSummary ? ["Resum energia", "Terme Energia ATR", ...P.map((p) => `P${p} ${kwhTxt(C.kwhPrecise[p])} kWh x ${es(C.atr[p], 6)} €/kWh = ${es(amt(C.kwhPrecise[p], C.atr[p]), 2)} €`)] : [];
  return [page1.join("\n"), detail.join("\n"), ...(summary.length ? [summary.join("\n")] : [])];
}

export async function nufriAtrPdf(opts: Parameters<typeof nufriAtrPages>[0] = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of nufriAtrPages(opts)) {
    const page = doc.addPage([595, 842]);
    text.split("\n").forEach((l, i) => page.drawText(l.replace(/[^\x20-\xff€]/g, " "), { x: 40, y: 800 - i * 16, size: 9, font }));
  }
  return doc.save();
}
