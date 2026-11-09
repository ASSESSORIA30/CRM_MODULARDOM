/**
 * ADAPTADORS PER COMERCIALITZADORA.
 *
 * Hi ha UN sol motor de normalització i validació (`tariff-engine.ts`). Cada comercialitzadora només aporta un
 * adaptador amb el que és específic seu: com es reconeix, quins lectors interpreten el seu format i el coneixement
 * comercial confirmat per Direcció (p. ex. la unitat del terme fix del gas de Nufri o la permanència de les seves
 * tarifes 3.0TD a preu fix). Una comercialitzadora nova entra amb l'adaptador genèric: no s'hi suposa res.
 */
import { normalizeTariff } from "./engine";
import type { OfferVersion, PermanenceInfo } from "./types";

export interface SupplierAdapter {
  id: string;
  supplier: string;
  /** Com s'identifica pel nom de la comercialitzadora (també marques comercials) */
  match: RegExp;
  /** Lectors que interpreten el format dels seus documents */
  readers: string[];
  /** Unitat del terme fix del gas quan el document no la indica (només si Direcció l'ha confirmada) */
  gasFixedUnit?: { unit: string; source: string } | null;
  /** Regla comercial de permanència (reconeguda automàticament, sense confirmació manual) */
  permanence?: ((o: Pick<OfferVersion, "accessTariff" | "contractType" | "energyType">) => PermanenceInfo | null) | null;
  notes: string[];
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const NUFRI_PERMANENCE_SOURCE = "Regla comercial d'Assessoria 3.0: Nufri 3.0TD a preu fix té permanència (reconeguda automàticament)";
export const NUFRI_GAS_FIXED_SOURCE = "Regla comercial confirmada per Direcció: el terme fix del gas de Nufri és en €/mes per subministrament";

export const ADAPTERS: SupplierAdapter[] = [
  {
    id: "nufri", supplier: "Nufri", match: /\bnufri\b/, readers: ["Lector local d'annexos Nufri (PDF)"],
    gasFixedUnit: { unit: "€/cliente/mes", source: NUFRI_GAS_FIXED_SOURCE },
    permanence: (o) => (o.energyType === "luz" && normalizeTariff(o.accessTariff) === "3.0TD" && (o.contractType === "periodes" || o.contractType === "fix24h")
      ? { status: "amb", months: null, startNote: null, cancellation: null, penalty: null, source: NUFRI_PERMANENCE_SOURCE, exception: null } : null),
    notes: ["2.0TD: tres preus (P1–P3) o preu únic. 3.0TD: sis preus (P1–P6) o preu únic; mai «tres preus».", "Comissió de potència: suma dels kW de tots els períodes × marge BOE (només Nufri)."],
  },
  { id: "iberdrola", supplier: "Iberdrola", match: /\biberdrola\b/, readers: ["Lector universal de taules (Excel «Hoja de Precios», pestanya «Energía»)"], notes: ["Potència del full en €/kW·any.", "Els Plan OMIE són indexats: el valor és el marge."] },
  { id: "endesa", supplier: "Endesa", match: /\bendesa\b/, readers: ["Lector local de tarifes Open (PDF)"], notes: ["Tarifes Open: preus Open / No Open ponderats per calendari."] },
  { id: "naturgy", supplier: "Naturgy", match: /\bnaturgy\b/, readers: ["Lector de plantilles per blocs (Excel «Productos Captación PYMES»)"], notes: ["«Variable» no vol dir indexada: queda pendent fins que es confirma."] },
  { id: "gana", supplier: "Gana Energía", match: /\bgana\b/, readers: ["Lector amb IA (quan hi ha garanties de confidencialitat)"], notes: [] },
  { id: "niba", supplier: "NIBA", match: /\bniba\b/, readers: ["Lector amb IA (quan hi ha garanties de confidencialitat)"], notes: [] },
  { id: "novaluz", supplier: "Novaluz", match: /\bnovaluz\b|\bnova luz\b/, readers: ["Lector amb IA (quan hi ha garanties de confidencialitat)"], notes: [] },
];

export const GENERIC_ADAPTER: SupplierAdapter = { id: "generic", supplier: "Altres", match: /$^/, readers: ["Lector amb IA", "Lector universal de taules"], notes: ["Sense coneixement específic: no se suposa cap unitat ni cap permanència."] };

/** Adaptador d'una comercialitzadora pel nom (o el genèric si no n'hi ha cap d'específic). */
export function adapterFor(supplierName: string | null | undefined): SupplierAdapter {
  const n = fold(supplierName ?? "");
  return ADAPTERS.find((a) => a.match.test(n)) ?? GENERIC_ADAPTER;
}
