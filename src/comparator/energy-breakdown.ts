/**
 * ENERGIA DESGLOSSADA A LES FACTURES (lògica pura). Moltes comercialitzadores (sobretot indexades) separen el preu de
 * l'energia en conceptes: energia lliure, ATR (peatges i càrrecs), ajustos, descomptes… Aquí:
 *  1. es llegeixen els components per període, distingint PREUS (€/kWh) d'IMPORTS (€);
 *  2. es reconstrueix el preu unitari total de cada període sense comptar res dues vegades;
 *  3. si no es pot reconstruir amb certesa, el període queda «pendent de revisió».
 * Es conserven els valors originals de cada component (traçabilitat) i els calculats.
 */
import Decimal from "decimal.js-light";

export const ENERGY_CONCEPTS = ["lliure", "atr", "peatges", "carrecs", "ajust", "descompte", "altres", "energia", "inclos"] as const;
export type EnergyConcept = (typeof ENERGY_CONCEPTS)[number];
export const ENERGY_CONCEPT_LABEL: Record<EnergyConcept, string> = {
  lliure: "Energia lliure", atr: "Energia ATR (peatges i càrrecs)", peatges: "Peatges", carrecs: "Càrrecs", ajust: "Ajustos i serveis del sistema", descompte: "Descompte", altres: "Altres conceptes variables", energia: "Terme d'energia (total)",
  inclos: "Ja inclòs en un altre concepte (no se suma)",
};

/* ------------------------------------------------------------------ regles apreses (classificació de línies) */

/** Regla apresa i APROVADA: una denominació de línia d'una comercialitzadora (o de totes) correspon a un concepte. */
export interface LineRule { id: string; retailer: string | null; pattern: string; concept: EnergyConcept }
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Text d'una línia sense període, xifres, unitats ni signes: «Terme Energia Lliure P3 1.224 kWh × 0,19 €/kWh» → «terme energia lliure». */
export function lineKey(text: string): string {
  return fold(text)
    .replace(/\b(?:p|periodo|periode)\s*[1-6]\b/g, " ")
    .replace(/-?[\d.,]+/g, " ")
    .replace(/€|eur(?:os)?\b|\bkwh\b|\bkw\b|\bdias?\b|\bdies\b|\bx\b|×|=|\/|:|;|\(|\)/g, " ")
    .replace(/[^a-z' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const supplierKey = (s: string | null | undefined) => fold(s ?? "").replace(/\b(s\.?l\.?u?|s\.?a\.?u?|energia|energy|comercializadora|comercialitzadora)\b\.?/g, " ").replace(/[^a-z0-9]/g, "");
export function ruleApplies(r: LineRule, text: string, retailer: string | null | undefined): boolean {
  if (r.retailer) {
    const a = supplierKey(r.retailer), b = supplierKey(retailer);
    if (!a || !b || !(a === b || a.startsWith(b) || b.startsWith(a))) return false;
  }
  const k = lineKey(text), p = lineKey(r.pattern);
  return !!p && (k === p || ` ${k} `.includes(` ${p} `));
}
/** Concepte d'una línia: primer les regles aprovades (la de la comercialitzadora abans que la general), després el lector. */
export function classifyLine(text: string, opts: { rules?: LineRule[]; retailer?: string | null } = {}): { concept: EnergyConcept | null; rule: LineRule | null } {
  const rs = (opts.rules ?? []).filter((r) => ruleApplies(r, text, opts.retailer)).sort((a, b) => Number(!!b.retailer) - Number(!!a.retailer) || lineKey(b.pattern).length - lineKey(a.pattern).length);
  if (rs[0]) return { concept: rs[0].concept, rule: rs[0] };
  return { concept: conceptOf(text), rule: null };
}
/** Conceptes que SUMEN al preu de l'energia (el descompte resta; «energia» és un total, no un component). */
const ADDITIVE: EnergyConcept[] = ["lliure", "atr", "peatges", "carrecs", "ajust", "altres"];

export interface EnergyComponent {
  period: number; // 1..6
  concept: EnergyConcept;
  label: string;
  kwh: number | null;
  /** Preu unitari tal com consta a la factura (€/kWh) */
  unitPrice: number | null;
  /** Import tal com consta a la factura (€) */
  amount: number | null;
  page: number | null;
  method: "text" | "ia" | "manual";
  /** Valors originals llegits (no canvien quan l'usuari corregeix) */
  original?: { kwh: number | null; unitPrice: number | null; amount: number | null } | null;
  /** Regla apresa que ha classificat la línia (traçabilitat) */
  ruleId?: string | null;
  /** Concepte que havia detectat el lector abans d'una correcció manual o d'una regla */
  originalConcept?: EnergyConcept | null;
}

export interface PeriodBreakdown {
  period: number;
  total: number | null;
  status: "reconstruit" | "directe" | "pendent";
  parts: { concept: EnergyConcept; label: string; unitPrice: number | null; calculated: boolean; page?: number | null; duplicate?: boolean }[];
  note: string | null;
  /** Calculat només amb preus €/kWh explícits i comprovacions superades (sense res a confirmar) */
  verified?: boolean;
  /** Consum del període (el valor més precís de les línies) */
  kwh?: number | null;
  /** Comprovacions fetes: arrodoniments acceptats, línies repetides, imports quadrats… */
  checks?: string[];
}

const num = (s: string) => {
  let t = s.trim().replace(/[^\d,.\-]/g, "");
  if (!t) return null;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // 1.289 kWh = mil dos-cents…
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** Concepte d'un text (capçalera o línia). L'ordre importa: «energía libre» abans que «energía». */
export function conceptOf(text: string): EnergyConcept | null {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/descuento|bonificaci|descompte|dto\.?\s/.test(t)) return "descompte";
  if (/ajuste|servicios? de ajuste|ssaa|mecanismo de ajuste|\bsas\b|tope del gas|ajust/.test(t)) return "ajust";
  if (/energia\s+(libre|lliure)|termino\s+(de\s+)?energia\s+libre|coste\s+(de\s+(la\s+)?)?energia(\s+en)?\s+mercado|energia\s+(de\s+)?mercado|precio\s+mercado|omie|energia\s+(de\s+(la\s+)?)?comerciali(tzadora|zadora|zacion|tzacio)/.test(t)) return "lliure";
  if (/\batr\b|peajes?\s+(de\s+acceso\s+)?y\s+cargos|peatges\s+(d'acces\s+)?i\s+carrecs/.test(t)) return "atr";
  if (/\bpeajes?\b|\bpeatges?\b/.test(t)) return "peatges";
  if (/\bcargos?\b|\bcarrecs?\b/.test(t)) return "carrecs";
  if (/energia\s+(activa|consumida)|termino\s+(de\s+)?energia|terme\s+(d'|de\s+)?energia|t\.\s*energia|consumo de energia|consum d'energia/.test(t)) return "energia";
  return null;
}

/** Capçalera de secció més propera per sobre d'una línia (per mostrar «Terme Energia ATR · P3 …» com a origen). */
function sectionLabel(raw: string, line: string): string {
  const lines = raw.replace(/ /g, " ").split(/\n/).map((l) => l.trim());
  const at = lines.indexOf(line);
  for (let i = at - 1; i >= 0; i--) if (lines[i] && !/\b(?:P|Periodo\s*|Per[ií]ode\s*)[1-6]\b/i.test(lines[i])) return lines[i].slice(0, 60);
  return "";
}

const PRICE = String.raw`(\d+[.,]\d{3,6})\s*(?:€|eur|euros?)?\s*\/\s*kWh`;
const KWH = String.raw`([\d.]+(?:,\d+)?)\s*kWh`;
const AMOUNT = String.raw`(-?[\d.]+,\d{2})\s*€`;

/**
 * Llegeix els components d'energia del text de la factura. Formats habituals:
 *   «Término Energía ATR» + línies «P3: 1.289 kWh × 0,019279 €/kWh = 24,85 €»
 *   «Energía libre P3 1.289 kWh x 0,214655 €/kWh 276,69 €» (concepte i dades a la mateixa línia)
 *   «P3 Peajes 24,85 €» (només import: el preu es calcula si es coneix el consum)
 */
export function parseEnergyComponents(pages: string[], opts: { rules?: LineRule[]; retailer?: string | null } = {}): EnergyComponent[] {
  const out: EnergyComponent[] = [];
  const cls = (t: string) => classifyLine(t, opts);
  pages.forEach((raw, pi) => {
    let section: { concept: EnergyConcept; rule: LineRule | null } | null = null;
    for (const line0 of raw.replace(/ /g, " ").split(/\n/)) {
      const line = line0.trim();
      if (!line) continue;
      const pm = /\b(?:P|Periodo\s*|Per[ií]ode\s*)([1-6])\b/i.exec(line);
      if (!pm) {
        // capçalera de secció (sense dades de període): «Término Energía ATR», «Terme Energia Lliure»…
        const c = cls(line);
        if (c.concept) section = { concept: c.concept, rule: c.rule };
        else if (/potencia|impuesto|impost|iva|alquiler|lloguer|total|excedent/i.test(fold(line))) section = null;
        continue;
      }
      const head = line.slice(0, pm.index).trim();
      const ownC: { concept: EnergyConcept | null; rule: LineRule | null } = head ? cls(head) : { concept: null, rule: null };
      const whole = ownC.concept ? ownC : cls(line);
      const pick = whole.concept ? whole : section ?? { concept: null, rule: null };
      const concept = pick.concept;
      if (!concept) continue;
      const period = Number(pm[1]);
      const after = line.slice(pm.index);
      if ((/\bkW\b(?!h)|potencia/i.test(fold(after)) || /potencia/.test(fold(head))) && !/kWh/i.test(after)) continue; // línia de potència: va a part
      const p = new RegExp(PRICE, "i").exec(after);
      const k = new RegExp(KWH, "i").exec(after);
      // import: l'últim «xx,yy €» que no sigui el preu (€/kWh)
      const amounts = [...after.matchAll(new RegExp(AMOUNT + String.raw`(?!\s*\/)`, "gi"))].map((m) => num(m[1]));
      const amount = amounts.length ? amounts[amounts.length - 1] : null;
      const unitPrice = p ? num(p[1]) : null;
      const kwh = k ? num(k[1]) : null;
      if (unitPrice == null && amount == null) continue;
      const neg = concept === "descompte";
      const label = (section && !ownC.concept && !cls(line).concept ? `${sectionLabel(raw, line)} · ` : "") + line;
      const c: EnergyComponent = { period, concept, label: label.slice(0, 120), kwh, unitPrice: unitPrice != null && neg ? Math.abs(unitPrice) : unitPrice, amount: amount != null && neg ? Math.abs(amount) : amount, page: pi + 1, method: "text", ruleId: pick.rule?.id ?? null };
      c.original = { kwh: c.kwh, unitPrice: c.unitPrice, amount: c.amount };
      out.push(c);
    }
  });
  return out;
}

const r6 = (d: Decimal) => Number(d.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString());
const close = (a: number, b: number, tol = 0.000_05) => Math.abs(a - b) <= tol;

/** Preu unitari d'un component: el de la factura o, si només hi ha l'import, import ÷ consum (si es coneix). */
function unitOf(c: EnergyComponent, kwh: number | null): { v: number | null; calculated: boolean } {
  if (c.unitPrice != null) return { v: c.unitPrice, calculated: false };
  const base = c.kwh ?? kwh;
  if (c.amount != null && base != null && base > 0) return { v: r6(new Decimal(c.amount).div(base)), calculated: true };
  return { v: null, calculated: false };
}

/** Decimals amb què està escrit un consum (1223,843 → 3; 1224 → 0). */
const decimalsOf = (v: number) => { const t = String(v); const i = t.indexOf("."); return i < 0 ? 0 : t.length - i - 1; };
const fmtK = (v: number) => v.toLocaleString("ca-ES", { maximumFractionDigits: 6 });
/**
 * Dos consums de la mateixa línia són el mateix valor arrodonit? (1223,843 i 1224 · 884,004 i 884 · 52,5 i 52 · 2503,911 i 2504)
 * Es tolera, com a màxim, una unitat de l'últim decimal del valor menys precís (arrodoniment o truncament de la factura).
 */
export function roundingCompatible(a: number, b: number): boolean {
  const d = Math.min(decimalsOf(a), decimalsOf(b));
  return Math.abs(a - b) <= 10 ** -d + 1e-9;
}

/**
 * Reconstrueix el preu total de cada període amb els PREUS UNITARIS explícits (€/kWh) de cada component:
 *   Preu Px = ATR Px + Energia lliure Px (+ ajustos/altres) − descomptes
 * Mai es divideix la suma d'imports (€) per un consum que pot estar arrodonit. Regles:
 *  - Consums arrodonits entre línies (1223,843 / 1224 kWh): s'accepten, es conserva cada valor original i el
 *    consum del període és el més precís. Una diferència més gran és una discrepància real → pendent.
 *  - Una línia repetida (mateix concepte i mateix preu, p. ex. resum i detall) es compta una sola vegada.
 *  - Si hi ha ATR i també peatges/càrrecs, aquests són el detall de l'ATR: s'ignoren si en sumen el mateix; si no quadren → pendent.
 *  - Un «terme d'energia» total i components alhora: el total només s'accepta si coincideix amb la suma.
 *  - Línies classificades «ja inclòs» no se sumen.
 *  - Sense energia lliure (o total) no hi ha preu complet: pendent.
 *  - Import ≠ preu × consum més enllà de l'arrodoniment: discrepància real → pendent.
 *  - Un preu deduït d'un import (sense preu unitari a la factura) es fa servir però queda per revisar (no verificat).
 */
export function reconstructEnergyPrices(components: EnergyComponent[], kwhByPeriod: (number | null)[] = []): PeriodBreakdown[] {
  const periods = [...new Set(components.map((c) => c.period))].sort();
  return periods.map((period) => {
    const all = components.filter((c) => c.period === period);
    const parts: PeriodBreakdown["parts"] = [];
    const checks: string[] = [];
    const lineKwh = all.map((c) => c.kwh).filter((x): x is number => x != null);
    // consum del període: el valor més precís de les línies (o el de la factura)
    const kwh = lineKwh.length ? [...lineKwh].sort((x, y) => decimalsOf(y) - decimalsOf(x))[0] : kwhByPeriod[period - 1] ?? null;
    const pending = (note: string): PeriodBreakdown => ({ period, total: null, status: "pendent", parts, note, verified: false, kwh, checks });
    const distinct = [...new Set(lineKwh)];
    if (distinct.length > 1) {
      if (!distinct.every((v) => roundingCompatible(v, kwh!))) return pending(`Discrepància real de consum a P${period}: ${distinct.map(fmtK).join(" / ")} kWh (més que un arrodoniment). Revisa les línies.`);
      checks.push(`Consums ${distinct.map(fmtK).join(" / ")} kWh: diferència d'arrodoniment de la factura, acceptada (es fa servir ${fmtK(kwh!)} kWh i es conserven els valors originals).`);
    }
    // línies repetides (mateix concepte i preu, consum compatible): una sola vegada
    const cs: EnergyComponent[] = [];
    for (const c of all) {
      const twin = c.unitPrice != null && cs.find((x) => x.concept === c.concept && x.unitPrice === c.unitPrice && (x.kwh == null || c.kwh == null || roundingCompatible(x.kwh, c.kwh)));
      if (twin) { parts.push({ concept: c.concept, label: c.label, unitPrice: c.unitPrice, calculated: false, page: c.page, duplicate: true }); checks.push(`La línia «${ENERGY_CONCEPT_LABEL[c.concept]} P${period}» (${fmtK(c.unitPrice!)} €/kWh) apareix repetida${c.page !== twin.page ? ` (p.${twin.page} i p.${c.page})` : ""}: es compta una sola vegada.`); continue; }
      cs.push(c);
    }
    const total = cs.filter((c) => c.concept === "energia");
    const comps = cs.filter((c) => ADDITIVE.includes(c.concept));
    const discounts = cs.filter((c) => c.concept === "descompte");
    for (const c of cs.filter((x) => x.concept === "inclos")) { parts.push({ concept: c.concept, label: c.label, unitPrice: c.unitPrice, calculated: false, page: c.page }); checks.push(`«${c.label.slice(0, 50)}» està marcat com a ja inclòs: no se suma.`); }
    for (const c of [...comps, ...discounts, ...total]) { const u = unitOf(c, kwh); parts.push({ concept: c.concept, label: c.label, unitPrice: u.v, calculated: u.calculated, page: c.page }); }
    // import ≠ preu × consum (més enllà de l'arrodoniment del consum i del cèntim)
    for (const c of [...comps, ...discounts, ...total]) {
      if (c.unitPrice == null || c.amount == null || c.method === "manual") continue; // una correcció manual mana sobre l'import llegit
      const base = c.kwh ?? kwh;
      if (base == null) continue;
      const spread = Math.max(...[base, ...lineKwh].map((v) => Math.abs(v - base)), 10 ** -decimalsOf(base));
      const expected = Math.abs(c.unitPrice * base);
      if (Math.abs(expected - Math.abs(c.amount)) > 0.011 + Math.abs(c.unitPrice) * spread + 1e-9) return pending(`Discrepància real a P${period}: «${c.label.slice(0, 50)}» diu ${c.amount.toLocaleString("ca-ES")} €, però ${fmtK(c.unitPrice)} €/kWh × ${fmtK(base)} kWh = ${expected.toLocaleString("ca-ES", { maximumFractionDigits: 2 })} €. Revisa la línia.`);
    }
    const calculated = parts.some((p) => p.calculated && !p.duplicate);
    if (calculated) checks.push("Algun preu s'ha deduït de l'import (la factura no en dona el preu unitari): cal revisar-lo.");
    if (!comps.length) {
      if (total.length === 1) { const u = unitOf(total[0], kwh); return u.v != null ? { period, total: u.v, status: "directe", parts, note: null, verified: !u.calculated, kwh, checks } : pending(`P${period}: no es pot calcular el preu (falta el consum)`); }
      return pending(`P${period}: no s'ha trobat el preu de l'energia`);
    }
    // ATR + peatges/càrrecs: detall de l'ATR
    const atr = comps.filter((c) => c.concept === "atr");
    let used = comps;
    if (atr.length) {
      const detail = comps.filter((c) => c.concept === "peatges" || c.concept === "carrecs");
      if (detail.length) {
        const a = atr.reduce((s, c) => s + (unitOf(c, kwh).v ?? NaN), 0);
        const d = detail.reduce((s, c) => s + (unitOf(c, kwh).v ?? NaN), 0);
        if (!Number.isFinite(a) || !Number.isFinite(d) || !close(a, d)) return pending(`P${period}: l'ATR i els peatges/càrrecs no quadren (possible doble comptabilització)`);
        used = comps.filter((c) => c.concept !== "peatges" && c.concept !== "carrecs");
        checks.push("Els peatges i càrrecs són el detall de l'ATR: no es tornen a sumar.");
      }
    }
    if (!used.some((c) => c.concept === "lliure" || c.concept === "altres") && !total.length) return pending(`P${period}: només hi ha peatges/càrrecs; falta el preu de l'energia lliure`);
    let sum = new Decimal(0);
    for (const c of used) {
      const u = unitOf(c, kwh);
      if (u.v == null) return pending(`P${period}: «${c.label.slice(0, 40)}» només té import i no se'n coneix el consum`);
      sum = sum.plus(u.v);
    }
    for (const c of discounts) {
      if (c.unitPrice != null) sum = sum.minus(c.unitPrice);
      else if (c.amount != null && (c.kwh ?? kwh)) sum = sum.minus(new Decimal(c.amount).div((c.kwh ?? kwh)!));
      else return pending(`P${period}: descompte sense base de consum; revisa'l`);
    }
    const t = r6(sum);
    if (total.length) {
      const tv = unitOf(total[0], kwh).v;
      if (tv != null && !close(tv, t)) return pending(`P${period}: el terme d'energia (${tv}) no coincideix amb la suma dels components (${t})`);
      if (tv != null) checks.push("El terme d'energia total de la factura coincideix amb la suma dels components (no es compta dues vegades).");
    }
    return { period, total: t, status: "reconstruit", parts, note: null, verified: !calculated, kwh, checks };
  });
}

/* ------------------------------------------------------------------ excedents a la factura */

export interface InvoiceSurplus { kwh: number | null; priceEurKwh: number | null; compensationEur: number | null; battery: boolean; batteryBalanceEur: number | null; page: number | null }

/** Excedents, preu i import compensat, i bateria virtual (saldo), si la factura en parla. */
export function parseInvoiceSurplus(pages: string[]): InvoiceSurplus | null {
  let out: InvoiceSurplus | null = null;
  pages.forEach((raw, pi) => {
    for (const line of raw.replace(/ /g, " ").split(/\n/)) {
      const t = line.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const isSurplus = /excedent|energia\s+(vertida|exportada|excedentaria|autoconsumo\s+excedentaria)|compensacion\s+(simplificada|de\s+excedentes)/.test(t);
      const isBattery = /bateria\s+virtual|monedero\s+solar|hucha\s+solar|saldo\s+solar/.test(t);
      if (!isSurplus && !isBattery) continue;
      out ??= { kwh: null, priceEurKwh: null, compensationEur: null, battery: false, batteryBalanceEur: null, page: pi + 1 };
      if (isBattery) {
        out.battery = true;
        const a = new RegExp(AMOUNT, "i").exec(line);
        if (a && /saldo|acumulad|disponible/.test(t)) out.batteryBalanceEur = Math.abs(num(a[1]) ?? 0);
      }
      if (isSurplus) {
        const k = new RegExp(KWH, "i").exec(line);
        const p = new RegExp(PRICE, "i").exec(line);
        const amounts = [...line.matchAll(new RegExp(AMOUNT + String.raw`(?!\s*\/)`, "gi"))].map((m) => num(m[1]));
        if (k && out.kwh == null) out.kwh = Math.abs(num(k[1]) ?? 0);
        if (p && out.priceEurKwh == null) out.priceEurKwh = num(p[1]);
        if (amounts.length && out.compensationEur == null) out.compensationEur = Math.abs(amounts[amounts.length - 1] ?? 0);
      }
    }
  });
  return out;
}
