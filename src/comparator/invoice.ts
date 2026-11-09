/**
 * LECTURA DE FACTURES · model de dades i extracció determinista del text (sense IA).
 * La IA (servidor) completa els camps que el text no permet llegir; el resultat sempre es valida amb zod
 * i el comercial el revisa abans de calcular. Cada valor porta la pàgina d'origen i si cal confirmar-lo.
 */
import { z } from "zod";
import { normalizeTariff, periodsOf } from "./engine";
import { pdfHeaderOffset } from "@/core/pdf-sniff";
import { ENERGY_CONCEPTS, parseEnergyComponents, parseInvoiceSurplus, reconstructEnergyPrices, roundingCompatible, classifyLine, type EnergyComponent, type LineRule, type PeriodBreakdown } from "./energy-breakdown";
import { toInternal } from "./units";
import { emptySurplus, type SupplySurplus, type SurplusConfig } from "./types";

export const fieldSchema = <T extends z.ZodTypeAny>(t: T) =>
  z.object({ value: t.nullable(), page: z.number().int().min(1).nullable(), confirm: z.boolean(), method: z.enum(["text", "ia", "manual"]) });

const n = z.number().finite();
export const invoiceSchema = z.object({
  holder: fieldSchema(z.string().max(200)),
  taxId: fieldSchema(z.string().max(20)),
  address: fieldSchema(z.string().max(300)),
  cups: fieldSchema(z.string().max(26)),
  accessTariff: fieldSchema(z.string().max(12)),
  retailer: fieldSchema(z.string().max(120)),
  energyType: fieldSchema(z.enum(["luz", "gas"])),
  periodFrom: fieldSchema(z.string().max(10)),
  periodTo: fieldSchema(z.string().max(10)),
  days: fieldSchema(n.int().min(1).max(400)),
  kwh: z.array(fieldSchema(n.min(0))).length(6),
  kw: z.array(fieldSchema(n.min(0))).length(6),
  energyPrice: z.array(fieldSchema(n.min(0).max(5))).length(6),
  powerPrice: z.array(fieldSchema(n.min(0).max(5))).length(6), // €/kW·dia
  gasFixedEurDay: fieldSchema(n.min(0)),
  discounts: fieldSchema(z.string().max(500)),
  services: fieldSchema(z.string().max(500)),
  permanence: fieldSchema(z.string().max(300)),
  sasEurKwh: fieldSchema(n.min(0).max(1)),
  meterRentEur: fieldSchema(n.min(0)),
  ieeEur: fieldSchema(n),
  vatEur: fieldSchema(n),
  total: fieldSchema(n),
  /** Fase 2 · excedents fotovoltaics i bateria virtual */
  surplusKwh: fieldSchema(n.min(0)).optional(),
  surplusPrice: fieldSchema(n.min(0).max(1)).optional(),
  surplusCompensationEur: fieldSchema(n.min(0)).optional(),
  virtualBattery: fieldSchema(z.boolean()).optional(),
  batteryBalanceEur: fieldSchema(n.min(0)).optional(),
  /** Fase 2 · energia desglossada (ATR, energia lliure, ajustos…) amb valors originals, i preus reconstruïts */
  energyComponents: z.array(z.object({
    period: z.number().int().min(1).max(6), concept: z.enum(ENERGY_CONCEPTS), label: z.string().max(200), kwh: n.min(0).nullable(), unitPrice: n.min(-1).max(5).nullable(), amount: n.nullable(),
    page: z.number().int().min(1).nullable(), method: z.enum(["text", "ia", "manual"]), original: z.object({ kwh: n.nullable(), unitPrice: n.nullable(), amount: n.nullable() }).nullable().optional(),
    ruleId: z.string().max(80).nullable().optional(), originalConcept: z.enum(ENERGY_CONCEPTS).nullable().optional(),
  })).max(60).optional(),
  energyBreakdown: z.array(z.object({
    period: z.number().int().min(1).max(6), total: n.nullable(), status: z.enum(["reconstruit", "directe", "pendent"]),
    parts: z.array(z.object({ concept: z.enum(ENERGY_CONCEPTS), label: z.string().max(200), unitPrice: n.nullable(), calculated: z.boolean(), page: z.number().int().nullable().optional(), duplicate: z.boolean().optional() })).max(30), note: z.string().max(400).nullable(),
    verified: z.boolean().optional(), kwh: n.nullable().optional(), checks: z.array(z.string().max(400)).max(20).optional(),
  })).max(6).optional(),
  /** Preu de potència tal com el dona la factura (abans de passar-lo a €/kW·dia), per període */
  powerPriceOriginal: z.array(z.object({ value: n, unit: z.string().max(30), formula: z.string().max(200) }).nullable()).length(6).optional(),
});
export type InvoiceData = z.infer<typeof invoiceSchema>;
export type Field<T> = { value: T | null; page: number | null; confirm: boolean; method: "text" | "ia" | "manual" };

const empty = <T>(): Field<T> => ({ value: null, page: null, confirm: true, method: "text" });
export function emptyInvoice(): InvoiceData {
  return {
    holder: empty(), taxId: empty(), address: empty(), cups: empty(), accessTariff: empty(), retailer: empty(), energyType: empty(),
    periodFrom: empty(), periodTo: empty(), days: empty(),
    kwh: Array.from({ length: 6 }, () => empty<number>()), kw: Array.from({ length: 6 }, () => empty<number>()),
    energyPrice: Array.from({ length: 6 }, () => empty<number>()), powerPrice: Array.from({ length: 6 }, () => empty<number>()),
    gasFixedEurDay: empty(), discounts: empty(), services: empty(), permanence: empty(), sasEurKwh: empty(), meterRentEur: empty(), ieeEur: empty(), vatEur: empty(), total: empty(),
  } as InvoiceData;
}

export const esNum = (s: string): number | null => {
  let t = s.trim().replace(/[^\d,.\-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
const isoDate = (d: string) => {
  const m = /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(d);
  if (!m) return null;
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

/** Valida la lletra de control d'un DNI/NIE (els CIF es retornen sense validar la lletra). */
export function validTaxId(id: string): boolean {
  const s = id.toUpperCase().replace(/[\s\-.]/g, "");
  const L = "TRWAGMYFPDXBNJZSQVHLCKE";
  if (/^\d{8}[A-Z]$/.test(s)) return L[Number(s.slice(0, 8)) % 23] === s[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(s)) return L[Number("XYZ".indexOf(s[0]) + s.slice(1, 8)) % 23] === s[8];
  return /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s);
}

/**
 * Extracció per patrons del text de cada pàgina. Només omple el que reconeix amb seguretat raonable;
 * tot el que s'extreu queda per confirmar si el patró és ambigu.
 */
export function extractFromText(pages: string[], opts: { rules?: LineRule[] } = {}): InvoiceData {
  const out = emptyInvoice();
  const powerOriginal: InvoiceData["powerPriceOriginal"] = Array(6).fill(null);
  const all = pages.join("\n");
  const set = <T>(f: Field<T>, value: T | null, page: number, confirm = false) => {
    if (value == null || f.value != null) return;
    f.value = value;
    f.page = page;
    f.confirm = confirm;
    f.method = "text";
  };
  pages.forEach((raw, i) => {
    const page = i + 1;
    const t = raw.replace(/ /g, " ");
    const flat = t.replace(/\s+/g, " ");
    // CUPS (llum o gas): ES + 16 xifres + 2 lletres [+2]
    const cups = /\bES\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?[A-Z]{2}(?:\s?[0-9A-Z][FPRCX])?\b/i.exec(flat);
    if (cups) set(out.cups, cups[0].toUpperCase().replace(/\s/g, ""), page);
    // NIF/CIF/NIE amb etiqueta
    const nif = /\b(?:N\.?I\.?F|C\.?I\.?F|DNI|NIE|NIF\/CIF)[:.\s]*([A-Z]?\d{7,8}[A-Z0-9])\b/i.exec(flat);
    if (nif) set(out.taxId, nif[1].toUpperCase(), page, !validTaxId(nif[1]));
    // Titular
    const holder = /\b(?:Titular(?: del contrato)?|Nombre del titular|Cliente)[:\s]+([A-ZÁÉÍÓÚÑÇ0-9 .,'&-]{3,80}?)(?=\s{2,}|\s(?:NIF|CIF|DNI|Direcci|Dirección|CUPS)\b|$)/i.exec(t.replace(/\n/g, "  "));
    if (holder) set(out.holder, holder[1].trim(), page, true);
    // Peatge d'accés
    const tar = /\b(?:Peaje(?: de acceso)?|Tarifa(?: de acceso| ATR| de peaje)?|Peatge)[:\s]*((?:[236][.,]\s?[0-4]\s?TD)|RL\.?\s?\d{1,2})\b/i.exec(flat) ?? /\b([236][.,][0-4]\s?TD|RL\.?\d{1,2})\b/i.exec(flat);
    if (tar) set(out.accessTariff, normalizeTariff(tar[1]), page, !/peaje|tarifa|peatge/i.test(tar[0]));
    if (/\bgas natural\b|\bRL\.?\d/i.test(flat)) set(out.energyType, "gas" as const, page, true);
    else if (/kWh/i.test(flat) && /potencia/i.test(flat)) set(out.energyType, "luz" as const, page, true);
    // Període de facturació
    const per = /(?:Periodo de facturaci[oó]n|Per[ií]ode de facturaci[oó]|Periodo facturado|Del)[:\s]*(?:del\s)?(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\s*(?:al|a|-|hasta)\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i.exec(flat);
    if (per) {
      set(out.periodFrom, isoDate(per[1]), page);
      set(out.periodTo, isoDate(per[2]), page);
    }
    const days = /\b(\d{1,3})\s*d[ií]as?\b(?! de)/i.exec(flat);
    if (days && Number(days[1]) >= 1 && Number(days[1]) <= 400) set(out.days, Number(days[1]), page, !per);
    // Consum i potència per període: «P1 … 1.234 kWh», «Potencia P1 … 4,6 kW»
    for (let p = 1; p <= 6; p++) {
      const k = new RegExp(`\\b(?:P${p}|Periodo ${p})\\b[^\\n]{0,40}?([\\d.]+(?:,\\d+)?)\\s*kWh(?!\\s*\\/)`, "i").exec(t);
      // «1.224 kWh» és mil dos-cents vint-i-quatre (separador de milers), no 1,224
      if (k) set(out.kwh[p - 1], /^\d{1,3}(\.\d{3})+$/.test(k[1].trim()) ? Number(k[1].replace(/\./g, "")) : esNum(k[1]), page, true);
      const w = new RegExp(`Potencia[^\\n]{0,30}?P${p}\\b[^\\n]{0,25}?([\\d.]+(?:,\\d+)?)\\s*kW(?!h)`, "i").exec(t) ?? new RegExp(`\\bP${p}\\b[^\\n]{0,25}?([\\d.]+(?:,\\d+)?)\\s*kW(?!h)`, "i").exec(t);
      if (w) set(out.kw[p - 1], esNum(w[1]), page, true);
      // preu únic i explícit en €/kWh per a aquest període → no cal confirmar-lo; si n'hi ha més d'un, sí
      const EP = `\\bP${p}\\b[^\\n]{0,60}?([0-9]+,[0-9]{3,6})\\s*(?:€|eur)\\s*\\/\\s*kWh`;
      const ep = new RegExp(EP, "i").exec(t);
      if (ep) set(out.energyPrice[p - 1], esNum(ep[1]), page, new Set([...all.matchAll(new RegExp(EP, "gi"))].map((m) => m[1])).size > 1);
      // potència: €/kW·dia, €/kW·mes o €/kW·any (es passa a €/kW·dia i es conserva l'original). Mai es barreja amb l'energia.
      const PP = `\\bP${p}\\b[^\\n]{0,80}?([0-9]+,[0-9]{2,6})\\s*((?:€|eur)\\s*\\/\\s*kW\\s*(?:y\\s*|·\\s*|\\.\\s*|\\/\\s*|x\\s*)?(?:d[ií]as?|dies|dia|mes(?:os)?|a[ñn]o|any))(?![a-z])`;
      const pp = new RegExp(PP, "i").exec(t);
      if (pp && out.powerPrice[p - 1].value == null) {
        const raw = esNum(pp[1]);
        const c = toInternal(raw, pp[2], "potencia");
        if (c.ok && c.value != null) {
          const several = new Set([...all.matchAll(new RegExp(PP, "gi"))].map((m) => `${m[1]}|${m[2]}`)).size > 1;
          set(out.powerPrice[p - 1], Number(c.value.toFixed(9)), page, several);
          if (c.factor !== "1") powerOriginal[p - 1] = { value: raw!, unit: pp[2].replace(/\s+/g, " "), formula: c.formula.slice(0, 200) };
        }
      }
    }
    // Imports
    const total = /\b(?:Total (?:a pagar|factura|importe)|Importe total|TOTAL FACTURA|Total a pagar)[:\s]*([\d.]+,\d{2})\s*€?/i.exec(flat);
    if (total) set(out.total, esNum(total[1]), page);
    const iee = /Impuesto (?:sobre la )?electricidad[^€\d]{0,60}?([\d.]+,\d{2})\s*€/i.exec(flat);
    if (iee) set(out.ieeEur, esNum(iee[1]), page, true);
    const iva = /\bIVA[^€\d]{0,40}?([\d.]+,\d{2})\s*€/i.exec(flat);
    if (iva) set(out.vatEur, esNum(iva[1]), page, true);
    const rent = /Alquiler (?:de )?(?:equipos?|contador)[^€\d]{0,60}?([\d.]+,\d{2})\s*€/i.exec(flat);
    if (rent) set(out.meterRentEur, esNum(rent[1]), page, true);
    const perm = /permanencia[^.]{0,120}/i.exec(flat);
    if (perm) set(out.permanence, perm[0].slice(0, 300), page, true);
    const ret = /\b(Iberdrola|Endesa|Naturgy|Repsol|TotalEnergies|Holaluz|Octopus|Factor Energ[ií]a|Gana Energ[ií]a|Audax|Nexus|Aldro|Podo|Lucera|Fenie|Visalia|NIBA|EDP|Plenitude|Curenergía|Som Energia|Nufri)\b/i.exec(flat);
    if (ret) set(out.retailer, ret[1], page, true);
  });
  if (powerOriginal.some(Boolean)) out.powerPriceOriginal = powerOriginal;
  return applyEnergyBreakdown(applySurplus(out, pages), parseEnergyComponents(pages, { rules: opts.rules, retailer: out.retailer.value }));
}

/**
 * Energia desglossada: substitueix el preu d'energia de cada període pel preu total reconstruït (ATR + lliure + …).
 * Si no es pot reconstruir, el preu queda BUIT i per revisar (mai s'agafa un sol component com si fos el total).
 * Si s'ha calculat amb preus explícits i totes les comprovacions quadren, queda VERIFICAT (no cal confirmar-lo).
 * Consum per període: el més precís de les línies. Una diferència d'arrodoniment amb el resum de la factura no es
 * considera discrepància; una diferència més gran sí (el camp queda per confirmar).
 */
export function applyEnergyBreakdown(out: InvoiceData, comps: EnergyComponent[]): InvoiceData {
  if (!comps.length) return out;
  const br = reconstructEnergyPrices(comps, out.kwh.map((f) => f.value));
  for (const b of br) {
    const f = out.kwh[b.period - 1];
    const first = comps.find((c) => c.period === b.period && c.kwh === b.kwh);
    if (b.kwh != null) {
      const summary = f.value;
      const compatible = summary == null || roundingCompatible(summary, b.kwh);
      if (!compatible) b.checks = [...(b.checks ?? []), `Discrepància real de consum a P${b.period}: el resum de la factura diu ${summary} kWh i les línies ${b.kwh} kWh. Cal revisar-ho.`];
      else if (summary != null && summary !== b.kwh) b.checks = [...(b.checks ?? []), `El resum de la factura (${summary} kWh) és el mateix consum arrodonit.`];
      Object.assign(f, { value: b.kwh, page: first?.page ?? f.page, confirm: !compatible || b.status === "pendent", method: first?.method ?? f.method });
    }
    const p = out.energyPrice[b.period - 1];
    const page = comps.find((c) => c.period === b.period)?.page ?? null;
    Object.assign(p, { value: b.status === "pendent" ? null : b.total, page, confirm: !b.verified, method: comps.find((c) => c.period === b.period)?.method ?? "text" });
  }
  // factura desglossada per períodes: els períodes del peatge sense cap línia d'energia ni consum no s'han facturat
  // (0 kWh en aquest període). El PREU no s'inventa: queda buit. El consum 0 queda marcat per confirmar.
  const n = periodsOf(out.accessTariff.value, out.energyType.value === "gas" ? "gas" : "luz");
  if (n.known && n.energy > 1 && br.length && br.every((b) => b.status !== "pendent")) {
    for (let i = 0; i < n.energy; i++) {
      if (br.some((b) => b.period === i + 1) || out.kwh[i].value != null || out.energyPrice[i].value != null) continue;
      Object.assign(out.kwh[i], { value: 0, page: null, confirm: true, method: "text" });
    }
  }
  out.energyComponents = comps;
  out.energyBreakdown = br;
  return out;
}

/** Torna a classificar els components amb les regles apreses (lectura IA o factura ja llegida). La correcció manual mana. */
export function classifyComponents(comps: EnergyComponent[], rules: LineRule[], retailer: string | null | undefined): EnergyComponent[] {
  if (!rules.length) return comps;
  return comps.map((c) => {
    if (c.method === "manual") return c;
    const r = classifyLine(c.label, { rules, retailer });
    return r.rule && r.concept && r.concept !== c.concept ? { ...c, originalConcept: c.originalConcept ?? c.concept, concept: r.concept, ruleId: r.rule.id } : c;
  });
}

function applySurplus(out: InvoiceData, pages: string[]): InvoiceData {
  const s = parseInvoiceSurplus(pages);
  if (!s) return out;
  const f = <T,>(value: T | null) => ({ value, page: s.page, confirm: true, method: "text" as const });
  out.surplusKwh = f(s.kwh);
  out.surplusPrice = f(s.priceEurKwh);
  out.surplusCompensationEur = f(s.compensationEur);
  out.virtualBattery = f(s.battery);
  out.batteryBalanceEur = f(s.batteryBalanceEur);
  return out;
}

/** Recalcula els preus quan l'usuari corregeix un component (es conserven els valors originals de cada component). */
export function recomputeBreakdown(d: InvoiceData, comps: EnergyComponent[]): { breakdown: PeriodBreakdown[]; prices: (number | null)[] } {
  const br = reconstructEnergyPrices(comps, d.kwh.map((f) => f.value));
  const prices = d.energyPrice.map((f) => f.value);
  for (const b of br) prices[b.period - 1] = b.status === "pendent" ? null : b.total;
  return { breakdown: br, prices };
}

/** Camps omplerts i camps pendents de confirmar (per a la pantalla de revisió). */
export function invoiceSummary(d: InvoiceData) {
  const flat: [string, Field<unknown>][] = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === "energyComponents" || k === "energyBreakdown" || v == null) continue;
    if (Array.isArray(v)) v.forEach((f, i) => flat.push([`${k}.P${i + 1}`, f as Field<unknown>]));
    else flat.push([k, v as Field<unknown>]);
  }
  return { filled: flat.filter(([, f]) => f.value != null).length, toConfirm: flat.filter(([, f]) => f.value != null && f.confirm).map(([k]) => k) };
}

/**
 * Comprovació de contingut real del fitxer (no ens fiem de l'extensió ni del tipus MIME declarat).
 * Els PDF poden portar bytes addicionals abans de «%PDF-» (fins a 1024, com admeten pdf.js i Acrobat): el servidor
 * els normalitza abans de llegir-los (`preparePdf`). Les imatges s'han de reconèixer a la posició zero.
 */
export function sniffMime(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | "image/heic" | "image/tiff" | "image/webp" | null {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return "image/tiff";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  const ftyp = String.fromCharCode(...b.slice(4, 12));
  if (/^ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(ftyp)) return "image/heic";
  if (pdfHeaderOffset(b) > 0) return "application/pdf"; // PDF amb bytes previs admesos
  return null;
}

/** Excedents llegits de la factura → excedents del subministrament i compensació del contracte actual.
 *  Mai s'inventa un preu: si la factura no el porta, el contracte actual queda «no informada» i
 *  el motor fa servir l'import compensat de la factura (si n'hi ha). */
export function invoiceSurplus(d: InvoiceData): { surplus: SupplySurplus | null; currentSurplus: SurplusConfig | undefined } {
  const kwh = d.surplusKwh?.value ?? null;
  const comp = d.surplusCompensationEur?.value ?? null;
  const battery = d.virtualBattery?.value === true;
  if (kwh == null && comp == null && !battery) return { surplus: null, currentSurplus: undefined };
  const price = d.surplusPrice?.value ?? null;
  const mode = battery ? "bateria" : price != null ? "fix" : "no_informada";
  const currentSurplus: SurplusConfig = { ...emptySurplus(mode), eurKwh: price, source: "document", battery: battery ? { enabled: true, feeEurMonth: null, accumulation: null, usage: null, expiry: null } : null };
  return {
    surplus: { kwhTotal: kwh, monthly: null, byPeriod: null, currentCompensationEur: comp, currentMode: mode, battery, batteryBalanceEur: d.batteryBalanceEur?.value ?? null, estimated: false },
    currentSurplus,
  };
}

