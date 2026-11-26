// Sol·licituds rebudes de la web pública per a un projecte: origen, tipus, referència i la configuració
// sencera de l'habitatge, perquè el comercial no hagi de tornar a demanar ni introduir res.
import { Badge, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { KITCHEN_LABEL, SUITE_LABEL, type ConfigInput } from "@/lib/configurator/engine";
import { formatCents } from "@/lib/money";
import { reviewWebVisitAction } from "@/app/(app)/projectes/actions";

type Locale = "ca" | "es";
type Visual = { floors: 1 | 2; system: "cellular" | "timber"; facade: "mineral" | "wood"; roof: "flat" | "green"; volume: "compact" | "L" };
export type WebRequest = {
  id: string; reference: string; kind: "info" | "quote" | "visit" | "mineral"; source: "web" | "configurador";
  outcome: "client_nou" | "client_existent" | "revisio_duplicats"; visit_status: "pendent_confirmacio" | "confirmada" | "descartada" | null;
  configurator_input: ConfigInput | null; configurator_visual: Visual | null; tariff_number: string | null; total_cents: number | null;
  page: string | null; captured_at: string; payload: { notes?: string; project?: { plot_address?: string | null; municipality?: string | null } };
};
type OptionNames = Record<string, { ca: string; es: string }>;

const TX = {
  ca: {
    title: "Sol·licituds de la web", kind: { info: "Informació", quote: "Pressupost", visit: "Visita a la casa pilot", mineral: "MINERAL" },
    source: { web: "Web", configurador: "Configurador web" },
    visit: { pendent_confirmacio: "Visita pendent de confirmar", confirmada: "Visita confirmada", descartada: "Visita descartada" },
    confirm: "Confirmar visita", discard: "Descartar", reopen: "Tornar a pendent", dup: "Possible client duplicat: reviseu-lo abans de fusionar res",
    existing: "Afegida a un client existent", config: "Configuració de l'habitatge", m2: "Superfície", rooms: "Habitacions", baths: "Banys",
    vehicles: "Garatge (vehicles)", laundry: "Safareig", yes: "Sí", no: "No", inst: "Instal·lacions", extras: "Extres", none: "Cap",
    floors: "Plantes", system: "Sistema", facade: "Façana", roof: "Coberta", volume: "Volum",
    systemV: { cellular: "Formigó cel·lular", timber: "Entramat de fusta" }, facadeV: { mineral: "Mineral", wood: "Fusta" },
    roofV: { flat: "Plana", green: "Vegetal" }, volumeV: { compact: "Compacte", L: "En L" },
    total: "Pressupost orientatiu mostrat a la web", tariff: "tarifa núm.", noTotal: "La web no va mostrar cap import",
    indicative: "Import orientatiu calculat per la web. No és un pressupost: cal preparar-lo des de Pressupostos.",
    notes: "Notes del client", plot: "Terreny", page: "Pàgina", ref: "Ref.",
  },
  es: {
    title: "Solicitudes de la web", kind: { info: "Información", quote: "Presupuesto", visit: "Visita a la casa piloto", mineral: "MINERAL" },
    source: { web: "Web", configurador: "Configurador web" },
    visit: { pendent_confirmacio: "Visita pendiente de confirmar", confirmada: "Visita confirmada", descartada: "Visita descartada" },
    confirm: "Confirmar visita", discard: "Descartar", reopen: "Volver a pendiente", dup: "Posible cliente duplicado: revísalo antes de fusionar nada",
    existing: "Añadida a un cliente existente", config: "Configuración de la vivienda", m2: "Superficie", rooms: "Habitaciones", baths: "Baños",
    vehicles: "Garaje (vehículos)", laundry: "Lavadero", yes: "Sí", no: "No", inst: "Instalaciones", extras: "Extras", none: "Ninguno",
    floors: "Plantas", system: "Sistema", facade: "Fachada", roof: "Cubierta", volume: "Volumen",
    systemV: { cellular: "Hormigón celular", timber: "Entramado de madera" }, facadeV: { mineral: "Mineral", wood: "Madera" },
    roofV: { flat: "Plana", green: "Vegetal" }, volumeV: { compact: "Compacto", L: "En L" },
    total: "Presupuesto orientativo mostrado en la web", tariff: "tarifa n.º", noTotal: "La web no mostró ningún importe",
    indicative: "Importe orientativo calculado por la web. No es un presupuesto: hay que prepararlo desde Presupuestos.",
    notes: "Notas del cliente", plot: "Terreno", page: "Página", ref: "Ref.",
  },
} as const;

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex justify-between gap-3 border-b border-navy/5 py-1"><dt className="text-muted">{k}</dt><dd className="text-right text-ink">{v}</dd></div>
);

export function WebRequestsBlock({ locale: L, projectId, items, canReview, showMoney, names }: {
  locale: Locale; projectId: string; items: WebRequest[]; canReview: boolean; showMoney: boolean;
  names: { installacions: OptionNames; extres: OptionNames };
}) {
  if (!items.length) return null;
  const x = TX[L];
  const list = (keys: string[], dict: OptionNames) => (keys.length ? keys.map((k) => dict[k]?.[L] ?? k).join(", ") : x.none);
  return (
    <Card title={x.title}>
      <ul className="space-y-5">
        {items.map((r) => {
          const c = r.configurator_input, v = r.configurator_visual;
          return (
            <li key={r.id} className="text-sm" data-web-request={r.reference}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-gold-light text-navy-dark">🌐 {x.source[r.source]}</Badge>
                <Badge className="bg-navy text-white">{x.kind[r.kind]}</Badge>
                {r.visit_status && <Badge className={r.visit_status === "pendent_confirmacio" ? "bg-amber-100 text-amber-900" : r.visit_status === "confirmada" ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}>{x.visit[r.visit_status]}</Badge>}
                {r.outcome === "revisio_duplicats" && <Badge className="bg-red-100 text-red-800">{x.dup}</Badge>}
                {r.outcome === "client_existent" && <Badge>{x.existing}</Badge>}
                <span className="text-xs text-muted">{x.ref} <span className="font-mono">{r.reference}</span> · {formatDateTime(r.captured_at, L)}{r.page ? ` · ${r.page}` : ""}</span>
              </div>
              {canReview && r.kind === "visit" && (
                <form action={reviewWebVisitAction} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={r.id} /><input type="hidden" name="project_id" value={projectId} />
                  {r.visit_status === "pendent_confirmacio" ? (<>
                    <button name="status" value="confirmada" className="rounded-md bg-navy px-3 py-1 text-xs font-semibold text-white">{x.confirm}</button>
                    <button name="status" value="descartada" className="rounded-md border border-navy/20 px-3 py-1 text-xs text-navy">{x.discard}</button>
                  </>) : <button name="status" value="pendent_confirmacio" className="text-xs text-muted underline">{x.reopen}</button>}
                </form>
              )}
              {r.payload.notes && <p className="mt-2 whitespace-pre-line rounded-md bg-slate-50 p-2 text-ink"><span className="block text-xs text-muted">{x.notes}</span>{r.payload.notes}</p>}
              {c && (
                <div className="mt-3">
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{x.config}</h3>
                  <dl className="grid gap-x-6 sm:grid-cols-2">
                    <Row k={x.m2} v={`${c.metres} m²`} />
                    <Row k={x.rooms} v={c.habitacions} />
                    <Row k={x.baths} v={c.banys} />
                    <Row k="Suite" v={SUITE_LABEL[c.suite]?.[L] ?? c.suite} />
                    <Row k={L === "es" ? "Cocina" : "Cuina"} v={KITCHEN_LABEL[c.cuina]?.[L] ?? c.cuina} />
                    <Row k={x.vehicles} v={c.vehicles} />
                    <Row k={x.laundry} v={c.safareig ? x.yes : x.no} />
                    <Row k={x.inst} v={list(c.installacions, names.installacions)} />
                    <Row k={x.extras} v={list(c.extres, names.extres)} />
                    {v && (<>
                      <Row k={x.floors} v={v.floors} />
                      <Row k={x.system} v={x.systemV[v.system] ?? v.system} />
                      <Row k={x.facade} v={x.facadeV[v.facade] ?? v.facade} />
                      <Row k={x.roof} v={x.roofV[v.roof] ?? v.roof} />
                      <Row k={x.volume} v={x.volumeV[v.volume] ?? v.volume} />
                    </>)}
                  </dl>
                  {showMoney && (
                    <p className="mt-2 text-xs text-muted">
                      {r.total_cents != null
                        ? <><strong className="text-ink">{x.total}: {formatCents(r.total_cents, { decimals: false })}</strong>{r.tariff_number ? ` (${x.tariff} ${r.tariff_number})` : ""}. {x.indicative}</>
                        : x.noTotal}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
