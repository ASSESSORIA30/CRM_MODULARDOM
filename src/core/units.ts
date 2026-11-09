/**
 * REGISTRE ÚNIC D'UNITATS DEL CRM (tarifes, comissions, decomissions i retrocessions). Una sola font per mostrar-les.
 *  - Cap import es mostra sense la seva unitat: una comissió per energia és «€/MWh», mai «€».
 *  - Cada unitat té una BASE: per subministrament (fix), per potència (kW), per consum (kWh/MWh), percentatge o temps.
 *    Així no es confonen els imports fixos per subministrament amb els que depenen de la potència o del consum.
 *  - Els codis d'aquest registre són els que es desen a Supabase (regles, condicions) i als models de tarifes.
 */
export type UnitBasis = "subministrament" | "contracte" | "potencia" | "consum" | "percentatge" | "temps" | "import";
export interface UnitDef { code: string; label: string; es: string; basis: UnitBasis; time: "dia" | "mes" | "any" | null }

export const UNITS: Record<string, UnitDef> = {
  eur: { code: "eur", label: "€", es: "€", basis: "import", time: null },
  eur_contracte: { code: "eur_contracte", label: "€/contracte", es: "€/contrato", basis: "contracte", time: null },
  eur_mwh: { code: "eur_mwh", label: "€/MWh", es: "€/MWh", basis: "consum", time: null },
  eur_kwh: { code: "eur_kwh", label: "€/kWh", es: "€/kWh", basis: "consum", time: null },
  cent_kwh: { code: "cent_kwh", label: "c€/kWh", es: "c€/kWh", basis: "consum", time: null },
  eur_kw: { code: "eur_kw", label: "€/kW", es: "€/kW", basis: "potencia", time: null },
  eur_kw_dia: { code: "eur_kw_dia", label: "€/kW·dia", es: "€/kW·día", basis: "potencia", time: "dia" },
  eur_kw_mes: { code: "eur_kw_mes", label: "€/kW·mes", es: "€/kW·mes", basis: "potencia", time: "mes" },
  eur_kw_any: { code: "eur_kw_any", label: "€/kW·any", es: "€/kW·año", basis: "potencia", time: "any" },
  eur_dia: { code: "eur_dia", label: "€/client·dia", es: "€/cliente·día", basis: "subministrament", time: "dia" },
  eur_mes: { code: "eur_mes", label: "€/client·mes", es: "€/cliente·mes", basis: "subministrament", time: "mes" },
  eur_any: { code: "eur_any", label: "€/client·any", es: "€/cliente·año", basis: "subministrament", time: "any" },
  pct: { code: "pct", label: "%", es: "%", basis: "percentatge", time: null },
  mesos: { code: "mesos", label: "mesos", es: "meses", basis: "temps", time: null },
  dies: { code: "dies", label: "dies", es: "días", basis: "temps", time: null },
};
export const UNIT_TEXT: Record<string, string> = Object.fromEntries(Object.values(UNITS).map((u) => [u.code, u.label]));
export const BASIS_LABEL: Record<UnitBasis, string> = {
  subministrament: "Import fix per subministrament", contracte: "Import fix per contracte", potencia: "Depèn de la potència (kW)", consum: "Depèn del consum (kWh/MWh)",
  percentatge: "Percentatge", temps: "Durada", import: "Import",
};
/** Base d'una unitat: fixa per subministrament, per potència, per consum… (null si no es coneix). */
export const unitBasis = (unit: string | null | undefined): UnitBasis | null => (unit ? UNITS[unit]?.basis ?? null : null);

/**
 * Unitat que s'ha de MOSTRAR per a una comissió segons el seu tipus. A Supabase els imports fixos es desen com a «eur»
 * (restricció de la taula), però per contracte s'han de mostrar com a «€/contracte».
 */
export function commissionUnit(kindOrField: string | null | undefined, unit: string | null | undefined): string | null {
  if ((kindOrField === "fix_contracte" || kindOrField === "bonificacio") && (unit === "eur" || unit == null)) return "eur_contracte";
  if (kindOrField === "per_kw" && (unit === "eur" || unit == null)) return "eur_kw";
  return unit ?? null;
}

/** Etiqueta llegible d'una unitat interna (si no es coneix, es retorna tal qual). */
export const unitLabel = (unit: string | null | undefined) => (unit ? UNIT_TEXT[unit] ?? unit : "");

/** Valor amb la seva unitat, en format català: «8 €/MWh», «0,008 €/kWh», «12,5 %», «50 €/contracte». */
export function formatUnitValue(value: number | string | null | undefined, unit: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const digits = unit === "eur_kwh" ? 6 : unit === "pct" ? 2 : 4;
  const txt = n.toLocaleString("ca-ES", { maximumFractionDigits: digits, useGrouping: "always" } as Intl.NumberFormatOptions);
  const u = unitLabel(unit);
  return u ? `${txt} ${u}` : txt;
}

/** Substitueix codis interns d'unitat dins d'un text ja desat (p. ex. avisos antics: «8 eur_mwh vs 10 eur_mwh»). */
export function humanizeUnits(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\b(eur_contracte|eur_mwh|eur_kwh|cent_kwh|eur_kw_any|eur_kw_mes|eur_kw_dia|eur_kw|eur_dia|eur_mes|eur_any|eur|pct|mesos|dies)\b/g, (m, _u, off: number, s: string) => {
    // «eur», «pct», «mesos» i «dies» només quan van just després d'un número (no es toquen paraules del text)
    if (["eur", "pct", "mesos", "dies"].includes(m) && !/\d\s*$/.test(s.slice(Math.max(0, off - 12), off))) return m;
    return UNIT_TEXT[m];
  });
}
