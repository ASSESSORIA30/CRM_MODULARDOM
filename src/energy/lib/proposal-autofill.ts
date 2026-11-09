/** Dades compartides per totes les entrades a Comparatives IA. No inventa preus. */
import type { SipsSummary } from "./sips-record";
import type { SupplyInput, ValueSource } from "@/comparator/types";
import { canAutofillConsumption, comparatorConsumption } from "./sips-consumption";
import { kwhKey, kwKey, stamp, type Provenance } from "@/comparator/provenance";

function normalizeAccess(value: string | null): string | null {
  const t = (value ?? "").toUpperCase().replace(/\s/g, "");
  const g = /^RL\.?(\d{1,2})$/.exec(t);
  if (g && Number(g[1]) >= 1 && Number(g[1]) <= 11) return `RL.${Number(g[1])}`;
  return /^(2\.0|3\.0|6\.[1-4])TD$/.test(t) ? t : null;
}

/**
 * Omple la comparativa amb les dades SIPS (una sola funció per a totes les entrades «Generar proposta»).
 *
 * CAUSA DE LA PÈRDUA DELS CONSUMS (corregida): abans, els períodes SIPS només s'omplien si el consum total ja present
 * era «substituïble» o coincidia (±1 kWh) amb la suma SIPS. Des de la fitxa 360 el total del CRM arribava marcat com a
 * «manual» i, com que la xifra anual del CRM i la finestra de 12 mesos del resum SIPS gairebé mai coincideixen, els
 * P1–P6 es descartaven en silenci: només arribaven el total i les potències.
 * Ara: els períodes SIPS s'omplen sempre que els camps de període són buits o no s'han editat a mà; el total s'alinea
 * amb la suma dels mateixos períodes (mateixa finestra temporal). Un total editat a mà o d'una factura no es trepitja:
 * es conserva i la validació avisa de la diferència.
 */
export function proposalAutofill(entry: SipsSummary, current: SupplyInput, currentSources: Record<string, ValueSource>, currentProv: Provenance = {}) {
  const supply = { ...current };
  const sources = { ...currentSources };
  let provenance: Provenance = { ...currentProv };
  if (entry.status !== "found") return { supply, sources, provenance, notes: [entry.error ?? "No hi ha dades SIPS per a aquest CUPS."] };
  const meta = { origin: "sips" as const, at: entry.consulted_at ?? null, source: entry.source === "excel" ? `SIPS (fitxer ${entry.source_detail ?? "importat"})` : "SIPS · CNMC/distribuïdora" };
  const tariff = normalizeAccess(entry.tariff);
  if (tariff && !["manual", "factura"].includes(sources.tariff ?? "")) {
    supply.accessTariff = tariff;
    supply.energyType = entry.energy_type === "gas" || /^RL/.test(tariff) ? "gas" : "luz";
    sources.tariff = "sips";
  }
  const count = supply.energyType === "gas" ? 0 : supply.accessTariff === "2.0TD" ? 2 : 6;
  if (entry.contracted_power_kw?.some(v => v != null) && canAutofillConsumption(supply.kw, sources.kw)) {
    supply.kw = Array.from({ length: 6 }, (_, i) => i < count ? entry.contracted_power_kw?.[i] ?? null : null);
    sources.kw = "sips";
    provenance = stamp(provenance, Object.fromEntries(supply.kw.map((v, i) => [kwKey(i), v])), meta);
  }
  const detail = comparatorConsumption(entry.annual_consumption, supply.accessTariff);
  const canPeriods = canAutofillConsumption(supply.kwh, sources.kwh);
  const canTotal = canAutofillConsumption([supply.kwhTotal], sources.kwhTotal);
  const notes: string[] = [];
  if (detail && canPeriods) {
    const keepTotal = !canTotal && supply.kwhTotal != null;
    Object.assign(supply, detail, { basis: "anual", kwhTotal: keepTotal ? current.kwhTotal : detail.kwhTotal });
    sources.kwh = "sips";
    if (!keepTotal) sources.kwhTotal = "sips";
    const window = `consum dels 12 mesos del ${detail.periodFrom} al ${detail.periodTo}`;
    provenance = stamp(provenance, Object.fromEntries(detail.kwh.map((v, i) => [kwhKey(i), v])), { ...meta, source: `${meta.source} · ${window}` });
    if (!keepTotal) provenance = stamp(provenance, { kwhTotal: detail.kwhTotal }, { ...meta, source: `${meta.source} · suma dels períodes (${window})` });
    notes.push(`Consum SIPS per períodes del ${detail.periodFrom} al ${detail.periodTo}.`);
    if (keepTotal && Math.abs((current.kwhTotal ?? 0) - detail.kwhTotal) > 1) notes.push(`El consum total (${sources.kwhTotal === "factura" ? "factura" : "introduït a mà"}) no coincideix amb la suma dels períodes SIPS: revisa'l.`);
  } else if (canTotal && entry.annual_kwh != null && canPeriods) {
    supply.kwhTotal = entry.annual_kwh; sources.kwhTotal = "sips";
    provenance = stamp(provenance, { kwhTotal: entry.annual_kwh }, { ...meta, source: `${meta.source} · consum anual del llistat` });
    if (supply.energyType === "gas") { supply.kwh = [entry.annual_kwh, null, null, null, null, null]; sources.kwh = "sips"; provenance = stamp(provenance, { kwh1: entry.annual_kwh }, meta); }
  }
  if (entry.annual_consumption?.warning) notes.push(entry.annual_consumption.warning);
  if (!detail && supply.energyType === "luz") notes.push(entry.annual_consumption ? "El SIPS no retorna un desglossament per períodes complet: no s'inventa cap repartiment. Completa'l amb una factura o la corba horària." : "El SIPS d'aquest CUPS encara no té el desglossament per períodes: no s'inventa cap repartiment. Completa'l amb una factura o la corba horària.");
  return { supply, sources, provenance, notes };
}

/** Identifica l'entrada; tornar de SIPS a la mateixa comparativa no esborra el formulari. */
export function proposalEntryKey(params: Record<string, string>): string {
  return JSON.stringify([params.contract, params.client, params.supply, params.cups, params.opportunity, params.capture, params.reading, params.launch]);
}

export interface ProposalContext {
  contractId?: string | null; clientId?: string | null; supplyId?: string | null;
  cups?: string | null; captureId?: string | null; readingId?: string | null;
}
/** Manté el CUPS complet, inclòs el sufix, en totes les entrades. */
export function proposalRoute(context: ProposalContext, launch: string): Record<string, string> {
  const params: Record<string, string> = { autofill: "1", launch };
  if (context.contractId) params.contract = context.contractId;
  if (context.clientId) params.client = context.clientId;
  if (context.supplyId) params.supply = context.supplyId;
  if (context.cups) params.cups = context.cups.toUpperCase().replace(/[\s.\-]/g, "");
  if (context.captureId) params.capture = context.captureId;
  if (context.readingId) params.reading = context.readingId;
  return params;
}
