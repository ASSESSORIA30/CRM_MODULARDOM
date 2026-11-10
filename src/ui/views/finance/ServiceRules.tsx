"use client";
/**
 * Regles de comissió dels serveis que no són d'energia (fibra, mòbil, paquets, assegurances, alarmes, plaques, altres).
 * Les veu Direcció i l'Administració autoritzada; només Direcció les crea i les aprova. Una regla aprovada no es
 * modifica: s'arxiva i se'n crea una de nova.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react";
import { CONTRACT_SERVICE_LABEL, FIBRA_OPERATORS } from "@/core/multiservice";
import { MODALITY_LABEL, SERVICE_COMMISSION_MODALITIES, type ServiceCommissionModality, type ServiceCommissionRule } from "@/core/service-commissions";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice } from "../../components/ui";
import { fApi } from "./api";

const SERVICES = ["fibra", "mobil", "fibra_mobil", "assegurances", "alarmes", "plaques_solars", "altres"] as const;
type Row = ServiceCommissionRule & { notes: string | null };

export function ServiceRulesPanel() {
  const [d, setD] = useState<{ rules: Row[]; canApprove: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const load = useCallback(() => fApi.get<{ rules: Row[]; canApprove: boolean }>("service_rules").then((r) => { setD(r); setErr(null); }).catch((e) => setErr(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => { void load(); }, [load]);
  const status = async (r: Row, s: "aprovada" | "arxivada") => {
    try { await fApi.act("service_rule_status", { id: r.id, status: s }); useApp.getState().toast({ title: s === "aprovada" ? "Regla aprovada" : "Regla arxivada", tone: "ok" }); void load(); }
    catch (e) { useApp.getState().toast({ title: "Error", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const value = (r: Row) => r.modality === "pct_quota" ? `${r.pct} %${r.months ? ` × ${r.months} mesos` : ""}` : `${r.amount_eur} €${r.modality === "recurrent" ? `/mes × ${r.months ?? 12}` : r.modality === "per_linia" ? "/línia" : r.modality === "per_kwp" ? "/kWp" : ""}`;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h3 className="text-lg font-semibold">Comissions de fibra, mòbil, assegurances, alarmes i plaques</h3>
          <p className="text-[13px] text-muted">El CRM calcula la comissió prevista de cada contracte amb les regles aprovades. Mai la marca com a cobrada per si sola.</p></div>
        {d?.canApprove && <Button variant="primary" onClick={() => setEdit("new")}><Plus size={14} /> Nova regla de servei</Button>}
      </div>
      {err && <Notice tone="red">{err}</Notice>}
      {!d ? <div className="h-24 animate-pulse rounded-2xl bg-elevated" /> : !d.rules.length ? <p className="rounded-2xl border border-line bg-surface p-5 text-center text-[13px] text-muted">Encara no hi ha regles de serveis. Sense regla aprovada, el contracte queda «Sense regla aprovada».</p> : (
        <div className="overflow-auto rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted"><tr><th className="px-3 py-2">Proveïdor</th><th>Servei · producte</th><th>Modalitat</th><th>Valor</th><th>Condicions</th><th>Estat</th><th /></tr></thead>
            <tbody>{d.rules.map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-3 py-2 font-medium">{r.provider}</td>
                <td>{CONTRACT_SERVICE_LABEL[r.service]}{r.product ? ` · ${r.product}` : " · tots els productes"}</td>
                <td>{MODALITY_LABEL[r.modality]}</td>
                <td className="tnum font-medium">{value(r)}</td>
                <td className="text-[11.5px] text-muted">{r.requires_activation ? "Condicionada a activació" : "Des de la signatura"}{r.clawback_months ? ` · retrocessió ${r.clawback_pct ?? 100} % si baixa < ${r.clawback_months} mesos` : ""}{r.collaborator_pct ? ` · col·laborador ${r.collaborator_pct} %` : ""}</td>
                <td><Badge tone={r.status === "aprovada" ? "green" : r.status === "arxivada" ? "zinc" : "amber"}>{r.status}</Badge></td>
                <td className="px-3"><span className="flex justify-end gap-1">
                  {d.canApprove && r.status === "esborrany" && <><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edita</Button><Button size="sm" variant="primary" onClick={() => status(r, "aprovada")}><CheckCircle2 size={12} /> Aprova</Button></>}
                  {d.canApprove && r.status === "aprovada" && <Button size="sm" variant="ghost" onClick={() => status(r, "arxivada")} title="Arxiva"><Trash2 size={12} /></Button>}
                </span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {edit && <ServiceRuleForm r={edit === "new" ? null : edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); void load(); }} />}
    </section>
  );
}

function ServiceRuleForm({ r, onClose, onDone }: { r: Row | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    provider: r?.provider ?? "", service: r?.service ?? "fibra", product: r?.product ?? "", modality: (r?.modality ?? "fix_alta") as ServiceCommissionModality,
    amount_eur: r?.amount_eur?.toString() ?? "", pct: r?.pct?.toString() ?? "", months: r?.months?.toString() ?? "", requires_activation: r?.requires_activation ?? true,
    clawback_months: r?.clawback_months?.toString() ?? "", clawback_pct: r?.clawback_pct?.toString() ?? "", collaborator_pct: r?.collaborator_pct?.toString() ?? "",
    valid_from: r?.valid_from ?? "", valid_to: r?.valid_to ?? "", notes: r?.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === "" ? null : v.replace(",", "."));
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await fApi.act("service_rule_save", { id: r?.id, data: { ...f, product: f.product || null, amount_eur: num(f.amount_eur), pct: num(f.pct), months: num(f.months), clawback_months: num(f.clawback_months), clawback_pct: num(f.clawback_pct), collaborator_pct: num(f.collaborator_pct), valid_from: f.valid_from || null, valid_to: f.valid_to || null, notes: f.notes || null } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const L = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block"><span className="label">{label}</span>{children}</label>;
  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={r ? "Edita la regla de servei" : "Nova regla de servei"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa com a esborrany</Button></>}>
      <div className="grid gap-3 text-[13px] sm:grid-cols-2">
        <L label="Proveïdor *"><input className="input" list="ms-providers" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /><datalist id="ms-providers">{FIBRA_OPERATORS.filter((o) => o !== "Altres").map((o) => <option key={o} value={o} />)}<option value="SEGURMA" /></datalist></L>
        <L label="Servei *"><select className="input" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value as typeof f.service })}>{SERVICES.map((s) => <option key={s} value={s}>{CONTRACT_SERVICE_LABEL[s]}</option>)}</select></L>
        <L label="Producte (buit = tots)"><input className="input" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} /></L>
        <L label="Modalitat *"><select className="input" value={f.modality} onChange={(e) => setF({ ...f, modality: e.target.value as ServiceCommissionModality })}>{SERVICE_COMMISSION_MODALITIES.map((m) => <option key={m} value={m}>{MODALITY_LABEL[m]}</option>)}</select></L>
        {f.modality === "pct_quota" ? <L label="Percentatge (%) *"><input className="input tnum" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} /></L> : <L label="Import (€) *"><input className="input tnum" value={f.amount_eur} onChange={(e) => setF({ ...f, amount_eur: e.target.value })} /></L>}
        {(f.modality === "pct_quota" || f.modality === "recurrent") && <L label="Mesos"><input className="input tnum" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} /></L>}
        <L label="Retrocessió: mesos"><input className="input tnum" value={f.clawback_months} onChange={(e) => setF({ ...f, clawback_months: e.target.value })} /></L>
        <L label="Retrocessió: % a retornar"><input className="input tnum" placeholder="100" value={f.clawback_pct} onChange={(e) => setF({ ...f, clawback_pct: e.target.value })} /></L>
        <L label="Part del col·laborador (%)"><input className="input tnum" value={f.collaborator_pct} onChange={(e) => setF({ ...f, collaborator_pct: e.target.value })} /></L>
        <label className="flex items-end gap-2"><input type="checkbox" checked={f.requires_activation} onChange={(e) => setF({ ...f, requires_activation: e.target.checked })} /> Condicionada a l&apos;activació</label>
        <L label="Vigent des de"><input className="input" type="date" value={f.valid_from} onChange={(e) => setF({ ...f, valid_from: e.target.value })} /></L>
        <L label="Vigent fins a"><input className="input" type="date" value={f.valid_to} onChange={(e) => setF({ ...f, valid_to: e.target.value })} /></L>
        <label className="block sm:col-span-2"><span className="label">Notes</span><textarea className="input min-h-[50px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <div className="sm:col-span-2"><Notice tone="red">{err}</Notice></div>}
      </div>
    </Modal>
  );
}
