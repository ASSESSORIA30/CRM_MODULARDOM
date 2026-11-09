"use client";
/**
 * TAULA DE REVISIÓ ABANS D'IMPORTAR (comuna a tots els lectors: Nufri, Iberdrola, Endesa, Naturgy, IA…).
 * Una fila per tarifa amb les dades del motor únic de normalització: comercialitzadora, nom exacte, subministrament,
 * tarifa d'accés, modalitat, preus per períodes, unitats originals, valors normalitzats, permanència, comissions,
 * vigència i incidències. Les condicions verificades automàticament es mostren com a tals (no demanen confirmació).
 */
import { CheckCircle2, ChevronDown } from "lucide-react";
import type { OfferVersion } from "@/comparator/types";
import { INCIDENT_LABEL, reviewRow, type Incident } from "@/comparator/tariff-engine";
import { nfmt } from "@/comparator/price-display";
import { cn } from "../../components/ui";

const TONE: Record<Incident["level"], string> = { error: "text-lost", falta: "text-lost", avis: "text-pend", info: "text-muted" };

export interface ReviewInput { offer: OfferVersion; commissions?: string[]; autoVerified?: string[]; extra?: Incident[] }

export function TariffReviewTable({ rows, showCommissions, open = false }: { rows: ReviewInput[]; showCommissions: boolean; open?: boolean }) {
  if (!rows.length) return null;
  const data = rows.map((r) => reviewRow(r.offer, { commissions: showCommissions ? r.commissions : undefined, autoVerified: r.autoVerified, extra: r.extra }));
  const blocking = data.filter((d) => d.blocking).length;
  return (
    <details open={open} className="rounded-xl border border-line bg-surface p-3" data-testid="taula-revisio">
      <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] font-semibold">
        <ChevronDown size={14} /> Taula de revisió ({data.length} tarifes)
        <span className={cn("font-normal", blocking ? "text-lost" : "text-muted")}>· {blocking ? `${blocking} amb errors o dades essencials absents` : "sense errors bloquejants"}</span>
      </summary>
      <div className="mt-2 max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1400px] text-[11.5px]">
          <thead className="sticky top-0 bg-elevated text-[10.5px] uppercase tracking-wide text-muted">
            <tr>{["Comercialitzadora", "Tarifa (nom exacte)", "Subministrament", "Accés", "Modalitat", "Preus per períodes", "Unitats originals", "Valors normalitzats", "Permanència", "Comissions", "Vigència", "Incidències"].map((h) => <th key={h} className="px-2 py-1.5 text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.map((d, k) => (
              <tr key={k} className={cn("border-t border-line align-top", d.blocking && "bg-red-500/[0.03]")}>
                <td className="px-2 py-1.5">{d.supplier}</td>
                <td className="px-2 py-1.5 font-medium">{d.product}</td>
                <td className="px-2 py-1.5">{d.supplyType}</td>
                <td className="px-2 py-1.5">{d.accessTariff}</td>
                <td className="px-2 py-1.5">{d.modality}</td>
                <td className="px-2 py-1.5 tnum">{d.prices.map((p) => <span key={p.label} className="block whitespace-nowrap">{p.label}: {p.value == null ? <span className="text-lost">—</span> : `${nfmt(p.value, 6)} ${p.unit}`}</span>)}</td>
                <td className="px-2 py-1.5">{d.originalUnits.map((u) => <span key={u} className="block">{u}</span>)}</td>
                <td className="px-2 py-1.5 text-muted">{d.normalized.length ? d.normalized.map((u) => <span key={u} className="block">{u}</span>) : "Sense conversió"}</td>
                <td className="px-2 py-1.5">{d.permanence}</td>
                <td className="px-2 py-1.5">{showCommissions ? (d.commissions.length ? d.commissions.map((c) => <span key={c} className="block">{c}</span>) : "Sense regla vinculada") : <span className="text-muted">Només Direcció</span>}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{d.validity}</td>
                <td className="px-2 py-1.5">
                  {d.autoVerified.map((a) => <span key={a} className="flex items-start gap-1 text-ren"><CheckCircle2 size={11} className="mt-0.5 shrink-0" />{a}</span>)}
                  {d.incidents.filter((i) => i.level !== "info").map((i) => <span key={i.text} className={cn("block", TONE[i.level])}><b>{INCIDENT_LABEL[i.level]}:</b> {i.text}</span>)}
                  {d.incidents.filter((i) => i.level === "info").map((i) => <span key={i.text} className="block text-muted">{i.text}</span>)}
                  {!d.incidents.length && !d.autoVerified.length && <span className="text-muted">Cap</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
