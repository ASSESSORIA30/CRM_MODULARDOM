"use client";
/** Documents d'un contracte i estat manual de la comissió (multiservei). */
import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { DOC_CATEGORY_LABEL, type CrmContract, type DocCategory } from "@/core/crm";
import { fmtDate } from "@/core/dates";
import { SERVICE_FAMILY, serviceOf, type ServiceFamily } from "@/core/multiservice";
import { COMMISSION_STATUSES, COMMISSION_STATUS_LABEL, type CommissionStatus } from "@/core/service-commissions";
import { useApp } from "@/data/store";
import { Button, Modal, Notice } from "../../../components/ui";
import { crmApi, uploadDocument } from "../api";
import type { Ctx } from "../ClientDetail";

/** Categories que tenen sentit per a cada servei (el contracte i «altres» sempre). */
const DOCS_FOR: Record<ServiceFamily, DocCategory[]> = {
  electricitat: ["contracte", "contracte_signat", "factura_llum", "dni_nie", "fiscal", "bancaria", "mandat", "proposta", "altres"],
  gas: ["contracte", "contracte_signat", "factura_gas", "dni_nie", "fiscal", "bancaria", "mandat", "proposta", "altres"],
  fibra: ["contracte", "contracte_signat", "portabilitat", "factura_servei", "dni_nie", "bancaria", "altres"],
  mobil: ["contracte", "contracte_signat", "portabilitat", "factura_servei", "dni_nie", "bancaria", "altres"],
  fibra_mobil: ["contracte", "contracte_signat", "portabilitat", "factura_servei", "dni_nie", "bancaria", "altres"],
  assegurances: ["polissa", "contracte_signat", "dni_nie", "bancaria", "altres"],
  alarmes: ["contracte", "contracte_signat", "certificat", "factura_servei", "dni_nie", "bancaria", "altres"],
  plaques_solars: ["pressupost", "contracte_signat", "projecte_tecnic", "certificat", "garantia", "factura_servei", "altres"],
  altres: ["contracte", "contracte_signat", "factura_servei", "altres"],
};

export function ContractDocsDialog({ ctx, contract, onClose }: { ctx: Ctx; contract: CrmContract; onClose: () => void }) {
  const { d } = ctx;
  const energy = d.supplies.find((s) => s.id === contract.supply_id)?.energy_type as "luz" | "gas" | undefined;
  const fam = SERVICE_FAMILY[serviceOf(contract, energy ?? null, d.client.kind)];
  const cats = DOCS_FOR[fam];
  const [cat, setCat] = useState<DocCategory>(cats[0]);
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const docs = d.documents.filter((x) => x.contract_id === contract.id);
  const upload = async () => {
    if (!file) return;
    setErr(null); setPct(0);
    try {
      await uploadDocument(file, { clientId: d.client.id, category: cat, contractId: contract.id, supplyId: contract.supply_id ?? null }, setPct);
      setUploaded((u) => [...u, file.name]); setFile(null);
      useApp.getState().toast({ title: "Document pujat", body: "Desat al magatzem privat del CRM i enllaçat amb el contracte.", tone: "ok" });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setPct(null); }
  };
  return (
    <Modal open onClose={onClose} title={`Documents · ${contract.retailer}${contract.product ? ` · ${contract.product}` : ""}`}
      footer={<Button variant="ghost" onClick={onClose}>Tanca</Button>}>
      <div className="space-y-3 text-[13px]">
        {docs.length === 0 && uploaded.length === 0 ? <p className="text-muted">Encara no hi ha documents enllaçats amb aquest contracte.</p> : (
          <ul className="space-y-1">
            {docs.map((x) => <li key={x.id} className="flex justify-between gap-2"><span>{x.title}</span><span className="text-muted">{DOC_CATEGORY_LABEL[x.category]} · {fmtDate(x.created_at?.slice(0, 10))}</span></li>)}
            {uploaded.map((n) => <li key={n} className="text-muted">{n} · acabat de pujar</li>)}
          </ul>
        )}
        {d.permissions.canEdit && (
          <div className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_auto]">
            <select className="input" aria-label="Tipus de document" value={cat} onChange={(e) => setCat(e.target.value as DocCategory)}>{cats.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</select>
            <input className="input" type="file" aria-label="Fitxer" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button variant="primary" disabled={!file || pct != null} onClick={upload}>{pct != null ? <><Loader2 size={14} className="animate-spin" /> {pct} %</> : <><FileUp size={14} /> Puja</>}</Button>
          </div>
        )}
        <p className="text-[12px] text-muted">Els documents es desen al magatzem privat del CRM amb els mateixos permisos que la resta de documents del client. Per veure&apos;ls o descarregar-los, ves a la pestanya Documents.</p>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

export function CommissionStatusDialog({ ctx, contract, onClose, onSaved }: { ctx: Ctx; contract: CrmContract; onClose: () => void; onSaved: () => void }) {
  const fin = contract.finance;
  const [status, setStatus] = useState<CommissionStatus>((fin?.commission_status as CommissionStatus) ?? "prevista");
  const [paidAt, setPaidAt] = useState(fin?.commission_paid_at ?? "");
  const [ref, setRef] = useState(fin?.settlement_ref ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await crmApi.action({ entity: "contract", action: "commission", clientId: ctx.d.client.id, id: contract.id, data: { commission_status: status, commission_paid_at: paidAt || null, settlement_ref: ref || null } });
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Comissió · ${contract.retailer}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button><Button variant="primary" disabled={busy} onClick={save}>{busy && <Loader2 size={14} className="animate-spin" />} Desa</Button></>}>
      <div className="space-y-3 text-[13px]">
        <p className="text-muted">Prevista pel CRM: <b>{fin?.commission_expected_eur != null ? `${fin.commission_expected_eur} €` : "sense regla aprovada"}</b>{fin?.clawback_until ? ` · retrocessió possible fins al ${fmtDate(fin.clawback_until)}` : ""}</p>
        <label className="block"><span className="label">Estat</span><select className="input" value={status} onChange={(e) => setStatus(e.target.value as CommissionStatus)}>{COMMISSION_STATUSES.map((s) => <option key={s} value={s}>{COMMISSION_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="label">Referència de la liquidació (obligatòria per a «Liquidada»)</span><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="block"><span className="label">Data de cobrament real (obligatòria per a «Cobrada»)</span><input className="input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></label>
        <Notice tone="blue">Un contracte actiu no vol dir comissió cobrada: només es marca com a cobrada amb la data real del cobrament.</Notice>
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}
