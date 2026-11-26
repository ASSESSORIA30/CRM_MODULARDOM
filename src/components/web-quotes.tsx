// Historial de pressupostos orientatius descarregats des del configurador de la web.
// Cada fila és una versió tal com es va lliurar al client: no es recalcula quan canvien les tarifes.
import { Badge, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { revokeWebQuoteLinksAction, setWebQuoteStatusAction } from "@/app/(app)/projectes/actions";

type Locale = "ca" | "es";
export const WEB_QUOTE_SELECT = "id, reference, version, created_at, tariff_number, total_cents, subtotal_cents, vat_works_cents, vat_architect_cents, vat_works_pct, vat_architect_pct, has_pending, breakdown, roof, plot, municipality, status, pdf_path, downloads, last_download_at, visit_requested_at, configurator_input";
export type WebQuote = {
  id: string; reference: string; version: number; created_at: string; tariff_number: string; total_cents: number; subtotal_cents: number;
  vat_works_cents: number; vat_architect_cents: number; vat_works_pct: number | null; vat_architect_pct: number | null; has_pending: boolean;
  breakdown: { key: string; label: { ca: string; es: string }; detail?: { ca: string; es: string }; amountCents: number; pending?: boolean }[];
  roof: { type: string; areaM2: number; estimated: boolean; priced: boolean } | null;
  plot: "yes" | "no" | "searching" | null; municipality: string | null; status: string; pdf_path: string | null; downloads: number;
  last_download_at: string | null; visit_requested_at: string | null; configurator_input: { metres?: number; plantes?: number };
};

const STATUSES = ["nou", "contactat", "en_negociacio", "acceptat", "descartat"] as const;
const TX = {
  ca: {
    title: "Pressupostos del configurador web", origin: "Configurador web", tariff: "Tarifa", total: "Total amb IVA", base: "Base imposable", vatW: "IVA obra", vatA: "IVA honoraris",
    plot: { yes: "Té terreny", no: "Sense terreny", searching: "Busca terreny" }, noPlot: "Terreny: no indicat", visit: "Ha demanat visita", downloads: "descàrregues",
    pdf: "Descarregar PDF", noPdf: "PDF no desat", detail: "Desglossament", pending: "pendent de valorar", hasPending: "Amb partides pendents de valorar",
    revoke: "Revocar enllaços del client", save: "Desar estat", roofEst: "coberta estimada", roofMeas: "coberta mesurada",
    status: { nou: "Nou", contactat: "Contactat", en_negociacio: "En negociació", acceptat: "Acceptat", descartat: "Descartat" },
    note: "Imports orientatius lliurats al client amb la tarifa indicada. No es recalculen. El pressupost definitiu es prepara a Pressupostos.",
  },
  es: {
    title: "Presupuestos del configurador web", origin: "Configurador web", tariff: "Tarifa", total: "Total con IVA", base: "Base imponible", vatW: "IVA obra", vatA: "IVA honorarios",
    plot: { yes: "Tiene terreno", no: "Sin terreno", searching: "Busca terreno" }, noPlot: "Terreno: no indicado", visit: "Ha pedido visita", downloads: "descargas",
    pdf: "Descargar PDF", noPdf: "PDF no guardado", detail: "Desglose", pending: "pendiente de valorar", hasPending: "Con partidas pendientes de valorar",
    revoke: "Revocar enlaces del cliente", save: "Guardar estado", roofEst: "cubierta estimada", roofMeas: "cubierta medida",
    status: { nou: "Nuevo", contactat: "Contactado", en_negociacio: "En negociación", acceptat: "Aceptado", descartat: "Descartado" },
    note: "Importes orientativos entregados al cliente con la tarifa indicada. No se recalculan. El presupuesto definitivo se prepara en Presupuestos.",
  },
} as const;

export function WebQuotesBlock({ locale: L, items, backPath }: { locale: Locale; items: WebQuote[]; backPath: string }) {
  if (!items.length) return null;
  const x = TX[L];
  return (
    <Card title={x.title}>
      <ul className="space-y-4">
        {items.map((q) => (
          <li key={q.id} className="rounded-lg border border-navy/10 p-3 text-sm" data-web-quote={q.reference}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-gold-light text-navy-dark">🌐 {x.origin}</Badge>
              <span className="font-mono text-xs">{q.reference}</span>
              <Badge>v{q.version}</Badge>
              <Badge className={q.plot === "yes" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}>{q.plot ? x.plot[q.plot] : x.noPlot}</Badge>
              {q.visit_requested_at && <Badge className="bg-amber-100 text-amber-900">{x.visit}</Badge>}
              {q.has_pending && <Badge className="bg-red-100 text-red-800">{x.hasPending}</Badge>}
              <span className="ml-auto text-base font-semibold text-navy" data-testid="web-quote-total">{formatCents(q.total_cents)}</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {formatDateTime(q.created_at, L)} · {x.tariff} {q.tariff_number}
              {q.configurator_input?.metres ? ` · ${q.configurator_input.metres} m²` : ""}{q.municipality ? ` · ${q.municipality}` : ""}
              {" · "}{q.downloads} {x.downloads}{q.last_download_at && q.downloads > 1 ? ` (${formatDateTime(q.last_download_at, L)})` : ""}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-navy">{x.detail}</summary>
              <dl className="mt-2 space-y-1">
                {q.breakdown.map((l) => (
                  <div key={l.key} className="flex justify-between gap-3 border-b border-navy/5 py-0.5">
                    <dt className="text-muted">{l.label[L]}{l.detail ? ` — ${l.detail[L]}` : ""}</dt>
                    <dd className="text-right tabular-nums">{l.pending ? x.pending : formatCents(l.amountCents)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 py-0.5 font-medium"><dt>{x.base}</dt><dd className="tabular-nums">{formatCents(q.subtotal_cents)}</dd></div>
                <div className="flex justify-between gap-3 py-0.5 text-muted"><dt>{x.vatW}{q.vat_works_pct != null ? ` (${q.vat_works_pct} %)` : ""}</dt><dd className="tabular-nums">{formatCents(q.vat_works_cents)}</dd></div>
                <div className="flex justify-between gap-3 py-0.5 text-muted"><dt>{x.vatA}{q.vat_architect_pct != null ? ` (${q.vat_architect_pct} %)` : ""}</dt><dd className="tabular-nums">{formatCents(q.vat_architect_cents)}</dd></div>
                <div className="flex justify-between gap-3 py-0.5 font-semibold"><dt>{x.total}</dt><dd className="tabular-nums">{formatCents(q.total_cents)}</dd></div>
              </dl>
            </details>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {q.pdf_path
                ? <a href={`/api/pressupostos-web/${q.id}/pdf`} className="rounded-md bg-navy px-3 py-1 text-xs font-semibold text-white">{x.pdf}</a>
                : <span className="text-xs text-muted">{x.noPdf}</span>}
              <form action={setWebQuoteStatusAction} className="flex items-center gap-1">
                <input type="hidden" name="id" value={q.id} /><input type="hidden" name="back" value={backPath} />
                <select name="status" defaultValue={q.status} className="rounded-md border border-navy/20 px-2 py-1 text-xs" aria-label="estat">
                  {STATUSES.map((s) => <option key={s} value={s}>{x.status[s]}</option>)}
                </select>
                <button className="rounded-md border border-navy/20 px-2 py-1 text-xs text-navy">{x.save}</button>
              </form>
              <form action={revokeWebQuoteLinksAction} className="ml-auto">
                <input type="hidden" name="id" value={q.id} /><input type="hidden" name="back" value={backPath} />
                <button className="text-xs text-red-700 underline">{x.revoke}</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">{x.note}</p>
    </Card>
  );
}
