"use client";
/** Estat de l'assistent de comparatives (5 passos). */
import { create } from "zustand";
import type { MarketInput } from "@/comparator/market";
import type { Provenance } from "@/comparator/provenance";
import type { InvoiceData } from "@/comparator/invoice";
import type { PriceReviewState } from "@/comparator/price-review";
import type { Adjustments } from "@/comparator/catalog";
import type { ClientInfo, Snapshot } from "@/comparator/snapshot";
import { emptySheet, type OfferVersion, type PriceSheet, type SupplyInput, type ValueSource } from "@/comparator/types";

export type Mode = "factura" | "cups" | "cups_preus" | "manual";

export interface WizardState {
  step: 1 | 2 | 3 | 4 | 5;
  entryKey: string | null;
  mode: Mode | null;
  contractId: string | null;
  /** Client i subministrament del CRM (Clients 360°) als quals queda vinculada la comparativa */
  crmClientId: string | null;
  crmSupplyId: string | null;
  crmClientName: string | null;
  crmOpportunityId: string | null;
  client: ClientInfo;
  cups: string;
  supply: SupplyInput;
  current: PriceSheet | null;
  currentRetailer: string;
  sources: Record<string, ValueSource>;
  /** Procedència de cada camp de consum i potència (SIPS, factura, corba horària, manual), amb l'original si s'ha editat */
  provenance: Provenance;
  invoice: { data: InvoiceData; warnings: string[]; method: string; pages: number } | null;
  dataNotes: string[];
  selected: string[];
  /** Catàleg carregat (còpia completa de les ofertes; les seleccionades es congelen al snapshot en desar). */
  catalog: OfferVersion[];
  observations: string;
  lang: "ca" | "es";
  kind: "resum" | "detallada";
  savedId: string | null;
  savedStatus: string | null;
  savedSnapshot: Snapshot | null;
  recommendation: string;
  /** Hipòtesis de mercat per comparar fixes amb indexades (null = no s'ha activat). */
  market: MarketInput | null;
  /** Ajustos puntuals d'aquesta comparativa (descomptes desactivats, SAS): mai modifiquen la tarifa del catàleg. */
  adjustments: Adjustments;
  /** Confirmació dels preus del contracte actual (estat de cada preu, valors confirmats i editats a mà). Es desa a l'esborrany. */
  priceReview: PriceReviewState | null;
  set: (p: Partial<WizardState>) => void;
  setSupply: (p: Partial<SupplyInput>) => void;
  setCurrent: (p: Partial<PriceSheet> | null) => void;
  reset: (p?: Partial<WizardState>) => void;
}

export const emptySupply = (): SupplyInput => ({
  energyType: "luz",
  accessTariff: "2.0TD",
  territory: "peninsula",
  segment: null,
  days: 365,
  basis: "anual",
  kwh: Array(6).fill(null),
  kwhTotal: null,
  kw: Array(6).fill(null),
  meterRentEurMonth: null,
  residentialLowPower: false,
});

const initial = () => ({
  step: 1 as const,
  entryKey: null as string | null,
  mode: null,
  contractId: null,
  crmClientId: null,
  crmSupplyId: null,
  crmClientName: null,
  crmOpportunityId: null,
  client: { name: null, taxId: null, address: null, email: null, phone: null },
  cups: "",
  supply: emptySupply(),
  current: null,
  currentRetailer: "",
  sources: {},
  provenance: {} as Provenance,
  invoice: null,
  dataNotes: [],
  selected: [],
  catalog: [],
  observations: "",
  lang: "ca" as const,
  kind: "resum" as const,
  savedId: null,
  savedStatus: null,
  savedSnapshot: null,
  recommendation: "",
  market: null as MarketInput | null,
  adjustments: {} as Adjustments,
  priceReview: null as PriceReviewState | null,
});

export const useWizard = create<WizardState>((set, get) => ({
  ...initial(),
  set: (p) => set(p),
  setSupply: (p) => set({ supply: { ...get().supply, ...p }, savedSnapshot: get().savedStatus === "esborrany" ? null : get().savedSnapshot }),
  setCurrent: (p) => set({ current: p === null ? null : { ...(get().current ?? emptySheet()), ...p } }),
  reset: (p) => set({ ...initial(), ...p }),
}));

/** Ofertes seleccionades (còpies completes del catàleg) en l'ordre de selecció. */
export function selectedOffers(w: Pick<WizardState, "selected" | "catalog">): OfferVersion[] {
  return w.selected.map((id) => w.catalog.find((o) => o.id === id)).filter((o): o is OfferVersion => !!o);
}

/** Camps de l'assistent que es desen a l'esborrany (i es recuperen en recarregar la pàgina). */
const KEEP: (keyof WizardState)[] = ["step", "mode", "contractId", "crmClientId", "crmSupplyId", "crmClientName", "crmOpportunityId", "client", "cups", "supply", "current", "currentRetailer", "sources", "provenance", "invoice", "dataNotes", "selected", "observations", "lang", "kind", "savedId", "savedStatus", "recommendation", "market", "priceReview"];
export function draftPayload(w: WizardState): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of KEEP) o[k] = w[k];
  return o;
}
