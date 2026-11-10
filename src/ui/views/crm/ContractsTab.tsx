"use client";
/** Pestanya CONTRACTES: vigents, renovació pendent, en tramitació i anteriors; historial per subministrament i renovacions. */
import { AgendaQuickActions, CONTRACT_ACTIONS } from "../agenda/Linked";
import { RetailerInput } from "../retailers/options";
import { CupsLink } from "../../components/Navigation";
import { useState } from "react";
import { AlertTriangle, ArrowRight, BellRing, Calculator, Euro, FileSignature, FolderOpen, History, KanbanSquare, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import {
  FAMILY_LABEL, LINE_STATUS_LABEL, SERVICE_CARDS, SERVICE_FAMILY, STATUS_FLOW, contractAlerts, isEnergyService, serviceOf, serviceTotals, statusLabelFor, type ServiceFamily,
} from "@/core/multiservice";
import { COMMISSION_STATUS_LABEL, type CommissionStatus } from "@/core/service-commissions";
import { FamilyIcon } from "./multiservice/icons";
import { NewContractPicker, ServiceContractForm } from "./multiservice/ServiceForm";
import { CommissionStatusDialog, ContractDocsDialog } from "./multiservice/ContractDialogs";
import {
  CONTRACT_GROUP, CONTRACT_STATUSES, CONTRACT_STATUS_LABEL, CONTRACT_STATUS_TONE, PRICE_TYPES, PRICE_TYPE_LABEL, contractInput,
  type ContractLineRow, type ContractStatus, type CrmContract,
} from "@/core/crm";
import { daysUntil, fmtDate } from "@/core/dates";
import { useApp } from "@/data/store";
import { Badge, Button, Empty, Modal, Notice, SupplierMark, cn } from "../../components/ui";
import { crmApi } from "./api";
import type { Ctx } from "./ClientDetail";
import { ContractEconomicsDialog } from "../finance/ContractEconomics";
import { ExportButton } from "../../components/ExportButton";

const GROUPS = [
  { id: "vigent", label: "Vigents" },
  { id: "renovacio", label: "Renovació pendent" },
  { id: "tramitacio", label: "En tramitació" },
  { id: "anterior", label: "Anteriors" },
] as const;

export function ContractsTab({ ctx }: { ctx: Ctx }) {
  const { d, reload } = ctx;
  const [edit, setEdit] = useState<{ contract: CrmContract | null; renewOf?: CrmContract } | null>(null);
  const [picker, setPicker] = useState(false);
  const [finance, setFinance] = useState<CrmContract | null>(null);
  const [econ, setEcon] = useState<string | null>(null);
  const [docsOf, setDocsOf] = useState<CrmContract | null>(null);
  const [commission, setCommission] = useState<CrmContract | null>(null);
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [flt, setFlt] = useState<{ family: ServiceFamily | ""; provider: string; status: ContractStatus | ""; expiry: "" | "30" | "60" | "90" }>({ family: "", provider: "", status: "", expiry: "" });
  const cupsOf = (id: string | null) => d.supplies.find((s) => s.id === id)?.cups ?? null;
  const energyOf = (id: string | null) => d.supplies.find((s) => s.id === id)?.energy_type ?? null;
  const byId = new Map(d.contracts.map((k) => [k.id, k]));
  const svc = (k: CrmContract) => serviceOf(k, energyOf(k.supply_id) as "luz" | "gas" | null, d.client.kind);
  const today = new Date().toISOString().slice(0, 10);
  const families = SERVICE_CARDS.map((c) => c.family).filter((f) => d.contracts.some((k) => SERVICE_FAMILY[svc(k)] === f));
  const keyDate = (k: CrmContract) => [k.end_date, k.permanence_end].filter(Boolean).sort()[0] ?? null;
  const shown = d.contracts.filter((k) => {
    if (flt.family && SERVICE_FAMILY[svc(k)] !== flt.family) return false;
    if (flt.provider && !k.retailer.toLowerCase().includes(flt.provider.toLowerCase())) return false;
    if (flt.status && k.status !== flt.status) return false;
    if (flt.expiry) { const kd = keyDate(k); const n = kd ? daysUntil(kd) : null; if (n == null || n < 0 || n > Number(flt.expiry)) return false; }
    return true;
  });
  const openEdit = (k: CrmContract | null, renewOf?: CrmContract) => {
    const ref = k ?? renewOf;
    if (!ref) { setPicker(true); return; }
    setEdit({ contract: k, renewOf });
  };
  const filtered = flt.family || flt.provider || flt.status || flt.expiry;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">Cada servei és un contracte propi i cada renovació en crea un de nou enllaçat amb l&apos;anterior: l&apos;historial no es sobreescriu mai.</p>
        <div className="flex gap-2">
          {d.contracts.length > 0 && <ExportButton size="md" set="contractes" params={{ l_client_id: d.client.id }} label="Contractes a Excel" />}
          {d.permissions.canEdit && <Button variant="primary" onClick={() => setPicker(true)}><Plus size={15} /> Nou contracte</Button>}
        </div>
      </div>
      {families.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {families.map((f) => {
            const n = d.contracts.filter((k) => SERVICE_FAMILY[svc(k)] === f && CONTRACT_GROUP[k.status] !== "anterior").length;
            return (
              <button key={f} type="button" onClick={() => setFlt({ ...flt, family: flt.family === f ? "" : f })}
                className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", flt.family === f ? "border-accent bg-accent/10 font-semibold" : "border-line")}>
                <FamilyIcon family={f} size={13} /> {FAMILY_LABEL[f]} · {n}
              </button>
            );
          })}
        </div>
      )}
      {d.contracts.length > 2 && (
        <div className="grid gap-2 text-[12.5px] sm:grid-cols-4">
          <select className="input" aria-label="Servei" value={flt.family} onChange={(e) => setFlt({ ...flt, family: e.target.value as ServiceFamily | "" })}><option value="">Tots els serveis</option>{SERVICE_CARDS.map((c) => <option key={c.family} value={c.family}>{FAMILY_LABEL[c.family]}</option>)}</select>
          <input className="input" aria-label="Proveïdor" placeholder="Proveïdor…" value={flt.provider} onChange={(e) => setFlt({ ...flt, provider: e.target.value })} />
          <select className="input" aria-label="Estat" value={flt.status} onChange={(e) => setFlt({ ...flt, status: e.target.value as ContractStatus | "" })}><option value="">Tots els estats</option>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>)}</select>
          <select className="input" aria-label="Venciment" value={flt.expiry} onChange={(e) => setFlt({ ...flt, expiry: e.target.value as "" })}><option value="">Qualsevol venciment</option><option value="30">Venç o acaba permanència en 30 dies</option><option value="60">… en 60 dies</option><option value="90">… en 90 dies</option></select>
        </div>
      )}
      {d.contracts.length === 0 ? (
        <Empty icon={<FileSignature size={24} />} title="Encara no hi ha contractes" body="Tria el servei: electricitat, gas, fibra, mòbil, assegurances, alarmes, plaques solars… Els d'energia actius amb data de renovació apareixen també a Renovacions." action={d.permissions.canEdit ? <Button variant="primary" size="sm" onClick={() => setPicker(true)}><Plus size={13} /> Nou contracte</Button> : undefined} />
      ) : shown.length === 0 && filtered ? (
        <p className="text-[13px] text-muted">Cap contracte amb aquests filtres. <button className="underline" onClick={() => setFlt({ family: "", provider: "", status: "", expiry: "" })}>Treu els filtres</button></p>
      ) : GROUPS.map((g) => {
        const list = shown.filter((k) => CONTRACT_GROUP[k.status] === g.id);
        if (!list.length) return null;
        return (
          <section key={g.id}>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{g.label} · {list.length}</h3>
            <div className="space-y-2">
              {list.map((k) => {
                const service = svc(k);
                const fam = SERVICE_FAMILY[service];
                const energy = isEnergyService(service);
                const days = k.end_date ? daysUntil(k.end_date) : null;
                const prev = k.previous_contract_id ? byId.get(k.previous_contract_id) : null;
                const docs = d.documents.filter((x) => x.contract_id === k.id).length;
                const lines = (k.lines ?? []) as ContractLineRow[];
                const totals = energy ? null : serviceTotals(service, (k.details ?? {}) as Record<string, unknown>, lines);
                const alerts = energy ? [] : contractAlerts({ service, status: k.status, start_date: k.start_date, end_date: k.end_date, permanence_end: k.permanence_end, details: k.details as Record<string, unknown>, lines }, today);
                const events = (d.contractEvents ?? []).filter((e) => e.contract_id === k.id);
                const live = g.id === "vigent" || g.id === "renovacio";
                return (
                  <article key={k.id} className="rounded-2xl border border-line bg-surface p-3.5">
                    <div className="flex flex-wrap items-start gap-3">
                      {energy ? <SupplierMark name={k.retailer} size={34} /> : <span className="grid h-[34px] w-[34px] place-items-center rounded-xl bg-zinc-100"><FamilyIcon family={fam} size={18} /></span>}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold"><span className="mr-1.5 inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 align-middle text-[11px] font-medium text-muted">{energy && <FamilyIcon family={fam} size={11} />}{FAMILY_LABEL[fam]}</span>{k.retailer}{k.product ? <span className="font-normal text-muted"> · {k.product}</span> : null}</p>
                        <p className="text-[12px] text-muted">
                          {energy
                            ? <>{cupsOf(k.supply_id) ? <CupsLink cups={cupsOf(k.supply_id)} /> : "Sense subministrament"}{k.access_tariff ? ` · ${k.access_tariff}` : ""}{k.price_type ? ` · ${PRICE_TYPE_LABEL[k.price_type]}` : ""}</>
                            : <>{k.provider_ref ? `Ref. ${k.provider_ref}` : "Sense referència"}{totals && totals.monthly_eur > 0 ? ` · ${eur(totals.monthly_eur)}/mes` : ""}{totals && totals.one_off_eur > 0 ? ` · ${fam === "plaques_solars" ? "pressupost" : "pagament únic"} ${eur(totals.one_off_eur)}` : ""}{totals && totals.active_lines ? ` · ${totals.active_lines} línies` : ""}</>}
                        </p>
                      </div>
                      <Badge tone={CONTRACT_STATUS_TONE[k.status]}>{statusLabelFor(service, k.status, CONTRACT_STATUS_LABEL)}</Badge>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
                      <div><p className="text-[11px] text-muted">Signatura</p><p>{fmtDate(k.signed_at)}</p></div>
                      <div><p className="text-[11px] text-muted">Inici</p><p>{fmtDate(k.start_date)}</p></div>
                      {energy || k.end_date ? (
                        <div><p className="text-[11px] text-muted">{fam === "assegurances" ? "Venciment de la pòlissa" : "Finalització / renovació"}</p><p className={cn(days != null && days <= 30 && live && "font-medium text-lost")}>{fmtDate(k.end_date)}{days != null && days >= 0 && live ? ` · ${days} dies` : ""}</p></div>
                      ) : (
                        <div><p className="text-[11px] text-muted">Fi de permanència</p><p>{k.permanence_end ? fmtDate(k.permanence_end) : fam === "plaques_solars" ? "No aplica" : "—"}</p></div>
                      )}
                      <div><p className="text-[11px] text-muted">Documents</p><p>{docs}</p></div>
                    </div>
                    {lines.length > 0 && (
                      <div className="mt-2.5 overflow-x-auto">
                        <table className="w-full text-[12px]"><thead><tr className="text-left text-[11px] text-muted"><th className="pr-2 font-normal">Línia</th><th className="pr-2 font-normal">Número</th><th className="pr-2 font-normal">Tarifa</th><th className="pr-2 font-normal">Preu</th><th className="font-normal">Estat</th></tr></thead>
                          <tbody>{lines.map((l) => (
                            <tr key={l.id} className={cn(l.status === "baixa" && "text-muted line-through")}>
                              <td className="pr-2">{l.position}{l.line_type === "portabilitat" ? " · porta" : ""}</td><td className="pr-2 tnum">{l.phone_number ?? "nou"}</td><td className="pr-2">{l.tariff ?? "—"}</td>
                              <td className="pr-2 tnum">{l.included_in_package ? "inclosa" : eur(l.price_monthly_eur)}</td><td>{LINE_STATUS_LABEL[l.status as keyof typeof LINE_STATUS_LABEL] ?? l.status}</td>
                            </tr>
                          ))}</tbody></table>
                        {totals?.package_saving_eur != null && <p className="mt-1 text-[11.5px] text-muted">Paquet: {eur(totals.monthly_eur)}/mes · per separat serien {eur(totals.individual_sum_eur)}</p>}
                      </div>
                    )}
                    {alerts.length > 0 && <ul className="mt-2 space-y-0.5">{alerts.map((a, i) => <li key={i} className={cn("flex items-center gap-1 text-[12px]", a.level === "urgent" ? "text-lost" : "text-amber-700")}><BellRing size={12} /> {a.message}</li>)}</ul>}
                    {k.notes && <p className="mt-2 whitespace-pre-wrap text-[12px] text-muted">{k.notes}</p>}
                    {prev && <p className="mt-2 flex items-center gap-1 text-[11.5px] text-muted"><History size={12} /> Renovació de: {prev.retailer}{prev.product ? ` · ${prev.product}` : ""} ({fmtDate(prev.start_date ?? prev.signed_at)} <ArrowRight size={10} /> {fmtDate(prev.end_date)})</p>}
                    {k.finance && (
                      <p className="mt-2 flex flex-wrap items-center gap-1 text-[11.5px] text-muted"><Euro size={12} />
                        {!energy && k.finance.commission_status ? <Badge tone={k.finance.commission_status === "cobrada" ? "green" : k.finance.commission_status === "retrocedida" ? "red" : "zinc"}>{COMMISSION_STATUS_LABEL[k.finance.commission_status as CommissionStatus] ?? k.finance.commission_status}</Badge> : null}
                        {!energy && k.finance.commission_expected_eur != null ? ` Prevista ${eur(k.finance.commission_expected_eur)}` : ""}
                        {!energy && k.finance.collaborator_eur ? ` · col·laborador ${eur(k.finance.collaborator_eur)}` : ""}
                        {k.finance.commission_eur != null ? ` · Comissió ${eur(k.finance.commission_eur)}` : ""}{k.finance.commission_pct != null ? ` · ${k.finance.commission_pct} %` : ""}{k.finance.annual_amount_eur != null ? ` · Import anual ${eur(k.finance.annual_amount_eur)}` : ""}
                        {k.finance.settlement_ref ? ` · Liquidació ${k.finance.settlement_ref}` : ""}{k.finance.commission_paid_at ? ` · Cobrada el ${fmtDate(k.finance.commission_paid_at)}` : ""}
                      </p>
                    )}
                    <div className="mt-2"><AgendaQuickActions compact actions={CONTRACT_ACTIONS(`${d.client.name} · ${k.retailer}`)} base={{ client: { id: d.client.id, name: d.client.name }, contract_id: k.id, renewal_id: k.legacy_contract_id ?? null, context: `${k.retailer}${k.product ? ` · ${k.product}` : ""}` }} /></div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {d.permissions.canEdit && <Button size="sm" variant="ghost" onClick={() => openEdit(k)}><Pencil size={13} /> Edita</Button>}
                      {d.permissions.canEdit && live && fam !== "plaques_solars" && <Button size="sm" onClick={() => openEdit(null, k)}><RefreshCw size={13} /> Renova</Button>}
                      <Button size="sm" variant="ghost" onClick={() => setDocsOf(k)}><FolderOpen size={13} /> Documents</Button>
                      {d.permissions.canEdit && <Button size="sm" variant="ghost" onClick={() => useApp.getState().navigate("client", { id: d.client.id, tab: "incidencies" })}><AlertTriangle size={13} /> Incidència</Button>}
                      {events.length > 0 && <Button size="sm" variant="ghost" onClick={() => setHistoryOf(historyOf === k.id ? null : k.id)}><History size={13} /> Historial ({events.length})</Button>}
                      {d.permissions.isStaff && <Button size="sm" variant="ghost" onClick={() => setFinance(k)}><Euro size={13} /> Dades econòmiques</Button>}
                      {d.permissions.isStaff && !energy && <Button size="sm" variant="ghost" onClick={() => setCommission(k)}><Euro size={13} /> Estat de la comissió</Button>}
                      {energy && (d.permissions.isStaff || d.permissions.canEdit) && <Button size="sm" variant="ghost" onClick={() => setEcon(k.id)}><Calculator size={13} /> Economia i comissions</Button>}
                      {energy && (k.legacy_contract_id || (live && k.end_date)) && (
                        <Button size="sm" variant="ghost" onClick={() => { const id = k.legacy_contract_id ?? `crm:${k.id}`; if (useApp.getState().byId[id]) { useApp.getState().navigate("kanban"); useApp.getState().open(id); } else useApp.getState().toast({ title: "Encara no és a Renovacions", body: "Apareixerà després de la propera càrrega de dades (recarrega la pàgina).", tone: "info" }); }}><KanbanSquare size={13} /> Veure a Renovacions</Button>
                      )}
                    </div>
                    {historyOf === k.id && (
                      <ol className="mt-2 space-y-0.5 border-l border-line pl-3 text-[12px] text-muted">
                        {events.map((e) => <li key={e.id}>{fmtDate(e.at.slice(0, 10))} · {e.kind === "creacio" ? `Creat (${CONTRACT_STATUS_LABEL[e.to_status as ContractStatus] ?? e.to_status})` : e.kind === "linia" ? `Línia ${e.note}: ${e.from_status} → ${e.to_status}` : `${CONTRACT_STATUS_LABEL[e.from_status as ContractStatus] ?? e.from_status} → ${CONTRACT_STATUS_LABEL[e.to_status as ContractStatus] ?? e.to_status}`}{e.by_name ? ` · ${e.by_name}` : ""}</li>)}
                      </ol>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {picker && <NewContractPicker ctx={ctx} onClose={() => setPicker(false)} onSaved={() => { setPicker(false); void reload(); }} />}
      {edit && (() => {
        const ref = (edit.contract ?? edit.renewOf)!;
        const service = svc(ref);
        return isEnergyService(service)
          ? <ContractForm ctx={ctx} contract={edit.contract} renewOf={edit.renewOf} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />
          : <ServiceContractForm ctx={ctx} service={service} contract={edit.contract} renewOf={edit.renewOf} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />;
      })()}
      {docsOf && <ContractDocsDialog ctx={ctx} contract={docsOf} onClose={() => { setDocsOf(null); void reload(); }} />}
      {commission && <CommissionStatusDialog ctx={ctx} contract={commission} onClose={() => setCommission(null)} onSaved={() => { setCommission(null); void reload(); }} />}
      {econ && <ContractEconomicsDialog contractId={econ} onClose={() => { setEcon(null); void reload(); }} />}
      {finance && <FinanceForm ctx={ctx} contract={finance} onClose={() => setFinance(null)} onSaved={() => { setFinance(null); void reload(); }} />}
    </div>
  );
}
const eur = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));

export function ContractForm({ ctx, contract, renewOf, supplyId, initial, onClose, onSaved }: { ctx: Ctx; contract: CrmContract | null; renewOf?: CrmContract; supplyId?: string; initial?: { status?: ContractStatus; notes?: string; retailer?: string; product?: string }; onClose: () => void; onSaved: (id?: string) => void }) {
  const { d, facets } = ctx;
  const base = contract ?? renewOf ?? null;
  const supply = d.supplies.find((s) => s.id === (supplyId ?? base?.supply_id));
  const [f, setF] = useState({
    supply_id: supplyId ?? base?.supply_id ?? "",
    retailer: contract?.retailer ?? renewOf?.retailer ?? initial?.retailer ?? supply?.current_retailer ?? "",
    product: contract?.product ?? initial?.product ?? "",
    price_type: contract?.price_type ?? "",
    access_tariff: contract?.access_tariff ?? renewOf?.access_tariff ?? supply?.access_tariff ?? "",
    signed_at: contract?.signed_at ?? "",
    start_date: contract?.start_date ?? (renewOf?.end_date ?? ""),
    end_date: contract?.end_date ?? "",
    status: (contract?.status ?? initial?.status ?? (renewOf ? "actiu" : "esborrany")) as ContractStatus,
    owner_id: contract?.owner_id ?? renewOf?.owner_id ?? d.client.owner_id ?? "",
    notes: contract?.notes ?? initial?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const closed = contract && (contract.status === "finalitzat" || contract.status === "anullat") && !d.permissions.isStaff;
  const save = async () => {
    const data = { ...f, supply_id: f.supply_id || null, price_type: f.price_type || null, owner_id: f.owner_id || null, signed_at: f.signed_at || null, start_date: f.start_date || null, end_date: f.end_date || null };
    const v = contractInput.safeParse(data);
    if (!v.success) { setErr([...new Set(v.error.issues.map((i) => i.message))].join(" · ")); return; }
    setBusy(true); setErr(null);
    try {
      const r = await crmApi.action({ entity: "contract", action: contract ? "update" : renewOf ? "renew" : "create", clientId: d.client.id, id: contract?.id ?? renewOf?.id, data });
      useApp.getState().toast({ title: contract ? "Contracte actualitzat" : renewOf ? "Renovació registrada" : "Contracte creat", body: (f.status === "actiu" || f.status === "renovacio_pendent") && f.end_date ? "Apareixerà a Renovacions amb la data de venciment." : undefined, tone: "ok" });
      onSaved(r.id);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const owners = (facets?.users ?? []).filter((u) => u.role === "comercial" || ["admin", "cap_administrativa", "administrativa"].includes(u.role));
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={contract ? `Contracte · ${contract.retailer}` : renewOf ? `Renovació de ${renewOf.retailer}` : "Nou contracte"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy || !!closed} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        {renewOf && <div className="sm:col-span-2"><Notice tone="blue">Es crearà un contracte nou. L&apos;anterior ({renewOf.retailer}, fins al {fmtDate(renewOf.end_date)}) passarà a «Finalitzat» si el nou és actiu, i es conserva a l&apos;historial.</Notice></div>}
        {closed && <div className="sm:col-span-2"><Notice>Contracte tancat: només Administració o Direcció el poden corregir. Per a una renovació, crea&apos;n un de nou.</Notice></div>}
        <label className="block sm:col-span-2"><span className="label">Subministrament</span>
          <select className="input" value={f.supply_id} onChange={(e) => { const s = d.supplies.find((x) => x.id === e.target.value); set({ supply_id: e.target.value, access_tariff: f.access_tariff || s?.access_tariff || "" }); }}>
            <option value="">Sense subministrament</option>
            {d.supplies.filter((s) => !s.archived_at).map((s) => <option key={s.id} value={s.id}>{s.cups} · {s.energy_type === "gas" ? "Gas" : "Llum"}{s.address ? ` · ${s.address}` : ""}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Comercialitzadora *</span><RetailerInput value={f.retailer} onChange={(v) => set({ retailer: v })} /></label>
        <label className="block"><span className="label">Producte</span><input className="input" value={f.product} onChange={(e) => set({ product: e.target.value })} /></label>
        <label className="block"><span className="label">Tipus de tarifa</span><select className="input" value={f.price_type} onChange={(e) => set({ price_type: e.target.value })}><option value="">—</option>{PRICE_TYPES.map((p) => <option key={p} value={p}>{PRICE_TYPE_LABEL[p]}</option>)}</select></label>
        <label className="block"><span className="label">Tarifa d&apos;accés</span><input className="input" value={f.access_tariff} onChange={(e) => set({ access_tariff: e.target.value })} placeholder="2.0TD" /></label>
        <label className="block"><span className="label">Data de signatura</span><input type="date" className="input" value={f.signed_at} onChange={(e) => set({ signed_at: e.target.value })} /></label>
        <label className="block"><span className="label">Inici del subministrament</span><input type="date" className="input" value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} /></label>
        <label className="block"><span className="label">Finalització o renovació{f.status === "actiu" || f.status === "renovacio_pendent" ? " *" : ""}</span><input type="date" className="input" value={f.end_date} onChange={(e) => set({ end_date: e.target.value })} /></label>
        <label className="block"><span className="label">Estat</span><select className="input" value={f.status} onChange={(e) => set({ status: e.target.value as ContractStatus })}>{STATUS_FLOW.electricitat.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="label">Comercial responsable</span>
          {d.permissions.isStaff ? <select className="input" value={f.owner_id} onChange={(e) => set({ owner_id: e.target.value })}><option value="">—</option>{owners.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            : <input className="input" disabled value={owners.find((u) => u.id === f.owner_id)?.name ?? "—"} />}
        </label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><textarea className="input min-h-[70px]" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        {err && <p className="rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}

function FinanceForm({ ctx, contract, onClose, onSaved }: { ctx: Ctx; contract: CrmContract; onClose: () => void; onSaved: () => void }) {
  const fin = contract.finance;
  const [f, setF] = useState({ annual_amount_eur: fin?.annual_amount_eur?.toString() ?? "", commission_eur: fin?.commission_eur?.toString() ?? "", commission_pct: fin?.commission_pct?.toString() ?? "", commission_paid_at: fin?.commission_paid_at ?? "", notes: fin?.notes ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await crmApi.action({ entity: "contract", action: "finance", clientId: ctx.d.client.id, id: contract.id, data: { ...f, commission_paid_at: f.commission_paid_at || null } }); onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Dades econòmiques · ${contract.retailer}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>Desa</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <p className="text-[12px] text-muted sm:col-span-2">Només ho veuen Administració, Direcció i el comercial responsable del contracte. No surt mai a les propostes del client.</p>
        <label className="block"><span className="label">Import anual estimat (€)</span><input className="input tnum" inputMode="decimal" value={f.annual_amount_eur} onChange={(e) => setF({ ...f, annual_amount_eur: e.target.value })} /></label>
        <label className="block"><span className="label">Comissió (€)</span><input className="input tnum" inputMode="decimal" value={f.commission_eur} onChange={(e) => setF({ ...f, commission_eur: e.target.value })} /></label>
        <label className="block"><span className="label">Comissió (%)</span><input className="input tnum" inputMode="decimal" value={f.commission_pct} onChange={(e) => setF({ ...f, commission_pct: e.target.value })} /></label>
        <label className="block"><span className="label">Data de cobrament</span><input type="date" className="input" value={f.commission_paid_at} onChange={(e) => setF({ ...f, commission_paid_at: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="label">Notes</span><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <p className="text-[12.5px] text-lost sm:col-span-2">{err}</p>}
      </div>
    </Modal>
  );
}
