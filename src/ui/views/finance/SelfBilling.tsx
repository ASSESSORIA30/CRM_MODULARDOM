"use client";
/**
 * Migració 033 · «Registrar cobrament / autofactura» i estat de facturació d'una liquidació.
 * L'autofactura és el document fiscal de la comercialitzadora: es registra (amb el PDF), es vincula a una o diverses
 * liquidacions i NO marca res com a cobrat. El cobrament real (total o parcial) es registra en el mateix formulari o després.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Ban, Banknote, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import {
  BILLING_SYSTEM_LABEL, COLLECTION_STATE_LABEL, RECEIPT_DOC_LABEL, RECEIPT_DOC_TYPES, SETTLEMENT_STATE_LABEL,
  type BillingSystem, type CollectionState, type ReceiptDocType, type SettlementState,
} from "@/core/self-billing";
import { useApp } from "@/data/store";
import { Badge, Button, Modal, Notice, cn } from "../../components/ui";
import { DropArea } from "../../components/DropZone";
import { eur, fApi, fmtD } from "./api";

const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toB64 = async (file: File) => { const buf = new Uint8Array(await file.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(bin); };
const dec = (s: string) => s.trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");

export const SETTLEMENT_TONE: Record<SettlementState, "zinc" | "green" | "amber"> = { pendent: "zinc", liquidada: "green", discrepancies: "amber" };
export const COLLECTION_TONE: Record<CollectionState, "zinc" | "blue" | "green"> = { pendent: "zinc", parcial: "blue", total: "green" };

export type StateRow = { id: string; mode: BillingSystem; settlementState: SettlementState; collectionState: CollectionState; selfInvoiced: string; pendingCollection: string };
/** Estats de liquidació i de cobrament de les liquidacions (si la migració 033 no està aplicada, no es mostren). */
export function useStatementStates(deps: unknown) {
  const [m, setM] = useState<Map<string, StateRow> | null>(null);
  useEffect(() => { fApi.get<{ rows: StateRow[] }>("statement_states").then((r) => setM(new Map(r.rows.map((x) => [x.id, x])))).catch(() => setM(null)); }, [deps]);
  return m;
}

type StOption = { id: string; retailer: string; reference: string; received_at: string; period_to: string | null; conciliated: string; collected: string; total: string };
type Proposal = { statementId: string; label: string; score: number; reasons: string[]; amount: string; discrepancies: string[]; blocked: string | null };
type ReadF = { value: string | null; evidence: string | null };
type Preview = { read: { isSelfInvoice: boolean; signals: string[]; number: ReadF; issueDate: ReadF; base: ReadF; vatRate: ReadF; vat: ReadF; withholding: ReadF; total: ReadF; periodFrom: ReadF; periodTo: ReadF; references: string[]; warnings: string[] }; retailer: string | null; proposals: Proposal[]; duplicate: { id: string; number: string; retailer: string } | null };
type Result = { needsConfirmation: true; warnings: string[] } | { needsConfirmation: false; selfInvoiceId: string | null; receipts: { statementId: string; allocated: string; unallocated: string }[]; warnings: string[]; states: { reference: string; settlementState: SettlementState; collectionState: CollectionState; pendingCollection: string }[] };

/**
 * Formulari «Registrar cobrament / autofactura».
 * `statement`: liquidació de partida (des de la fitxa); `statements`: llista per triar-ne una o diverses.
 */
export function CollectionDialog({ statements, initial, onClose, onDone }: { statements: StOption[]; initial?: { statementId?: string; retailer?: string }; onClose: () => void; onDone: () => void }) {
  const first = statements.find((s) => s.id === initial?.statementId);
  const [retailer, setRetailer] = useState(initial?.retailer ?? first?.retailer ?? "");
  const [docType, setDocType] = useState<ReceiptDocType>("autofactura");
  const [f, setF] = useState({ number: "", issueDate: "", base: "", vatRate: "21", vat: "", withholding: "", total: "", periodFrom: "", periodTo: "", liquidated: "", collected: "", collectedAt: new Date().toISOString().slice(0, 10), notes: "" });
  const [links, setLinks] = useState<Record<string, string>>(first ? { [first.id]: Number(first.conciliated) > 0 ? Number(first.conciliated).toFixed(2) : Number(first.total).toFixed(2) } : {});
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [net, setNet] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const retailers = useMemo(() => [...new Set(statements.map((s) => s.retailer))].sort(), [statements]);
  const sameR = (s: StOption) => !retailer || s.retailer.toLowerCase() === retailer.toLowerCase();
  const options = statements.filter(sameR);
  const isSelf = docType === "autofactura";
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setWarnings(null); };

  // IVA i total calculats si falten (el total sempre es pot corregir a mà)
  useEffect(() => {
    if (!isSelf || !f.base) return;
    const b = Number(dec(f.base)), r = Number(dec(f.vatRate || "0")), w = Number(dec(f.withholding || "0"));
    if (!Number.isFinite(b)) return;
    setF((x) => ({ ...x, vat: x.vat || (Number.isFinite(r) ? (Math.round(b * r) / 100).toFixed(2) : x.vat), total: x.total || (Number.isFinite(r) ? (Math.round((b + (b * r) / 100 - (Number.isFinite(w) ? w : 0)) * 100) / 100).toFixed(2) : x.total) }));
  }, [f.base, f.vatRate, f.withholding, isSelf]);

  const read = async (fl: File | null) => {
    setFile(fl); setPv(null); setErr(null); setWarnings(null);
    if (!fl) return;
    setBusy("Llegint l'autofactura…");
    try {
      const r = await fApi.act<Preview>("self_invoice_preview", { data: { retailer: retailer || undefined }, file: { name: fl.name, base64: await toB64(fl) } });
      setPv(r);
      const v = (x: ReadF) => x.value ?? "";
      setF((x) => ({ ...x, number: x.number || v(r.read.number), issueDate: x.issueDate || v(r.read.issueDate), base: x.base || v(r.read.base), vatRate: r.read.vatRate.value ?? x.vatRate, vat: x.vat || v(r.read.vat), withholding: x.withholding || v(r.read.withholding), total: x.total || v(r.read.total), periodFrom: x.periodFrom || v(r.read.periodFrom), periodTo: x.periodTo || v(r.read.periodTo) }));
      if (!retailer && r.retailer) setRetailer(r.retailer);
      // proposta: les millors correspondències que no estan bloquejades (l'administrador les pot treure)
      const best = r.proposals.filter((p) => !p.blocked && p.score >= 60);
      if (best.length && !Object.keys(links).length) setLinks(Object.fromEntries(best.slice(0, 1).map((p) => [p.statementId, p.amount])));
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const submit = async (confirm: boolean) => {
    setErr(null); setBusy("Desant…");
    try {
      const data = {
        retailer, docType, docNumber: f.number,
        statements: Object.entries(links).map(([id, amount]) => ({ id, amount: dec(amount || "0") })),
        selfInvoice: isSelf ? { issueDate: f.issueDate || null, base: dec(f.base), vatRate: dec(f.vatRate), vat: dec(f.vat || "0"), withholding: dec(f.withholding || "0"), total: dec(f.total), periodFrom: f.periodFrom || null, periodTo: f.periodTo || null, source: pv ? "lector" : "manual", readSummary: pv ? { signals: pv.read.signals, evidence: Object.fromEntries(Object.entries(pv.read).filter(([, x]) => x && typeof x === "object" && "evidence" in (x as object)).map(([k, x]) => [k, (x as ReadF).evidence])) } : undefined } : null,
        liquidated: f.liquidated ? dec(f.liquidated) : null,
        collected: f.collected ? dec(f.collected) : null,
        collectedAt: f.collected ? f.collectedAt : null,
        net, notes: f.notes || null, confirm,
      };
      const r = await fApi.act<Result>("collection_register", { data, file: isSelf && file ? { name: file.name, base64: await toB64(file) } : undefined });
      if (r.needsConfirmation) { setWarnings(r.warnings); return; }
      const st = r.states.map((s) => `${s.reference}: ${SETTLEMENT_STATE_LABEL[s.settlementState]} · ${COLLECTION_STATE_LABEL[s.collectionState]}${Number(s.pendingCollection) > 0 ? ` (pendent ${eur(s.pendingCollection)})` : ""}`).join(" · ");
      toast(r.receipts.length ? "Cobrament registrat" : "Autofactura registrada (sense cobrament)", st);
      onDone();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };

  const linkedTotal = Object.values(links).reduce((a, v) => a + (Number(dec(v || "0")) || 0), 0);
  const canSave = !!retailer.trim() && !!f.number.trim() && Object.keys(links).length > 0 && (isSelf ? !!f.issueDate && !!f.base && !!f.total : !!f.collected);
  return (
    <Modal open onClose={onClose} width="max-w-4xl" title="Registrar cobrament / autofactura"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel·la</Button>
        {warnings ? <Button variant="primary" disabled={!!busy} onClick={() => void submit(true)} data-testid="confirma-discrepancies">{busy ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />} He revisat les diferències: registra</Button>
          : <Button variant="primary" disabled={!!busy || !canSave} onClick={() => void submit(false)}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Banknote size={14} />} {isSelf && !f.collected ? "Registra l'autofactura" : "Registra"}</Button>}</>}>
      <div className="space-y-3 text-[13px]" data-testid="registrar-cobrament-autofactura">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block"><span className="label">Comercialitzadora *</span>
            <input className="input" list="af-retailers" value={retailer} onChange={(e) => { setRetailer(e.target.value); setLinks({}); setWarnings(null); }} />
            <datalist id="af-retailers">{retailers.map((r) => <option key={r} value={r} />)}</datalist>
          </label>
          <label className="block"><span className="label">Tipus de document *</span>
            <select className="input" value={docType} onChange={(e) => { setDocType(e.target.value as ReceiptDocType); setWarnings(null); }}>{RECEIPT_DOC_TYPES.map((k) => <option key={k} value={k}>{RECEIPT_DOC_LABEL[k]}</option>)}</select>
          </label>
          <label className="block"><span className="label">Número de document *</span><input className="input font-mono" value={f.number} onChange={(e) => set("number", e.target.value)} placeholder={isSelf ? "Núm. de l'autofactura" : "Referència bancària"} /></label>
        </div>

        {isSelf && (
          <section className="space-y-2 rounded-xl border border-line p-3">
            <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={(e) => void read(e.target.files?.[0] ?? null)} />
            <DropArea accept=".pdf" onFiles={([x]) => void read(x)} label="Autofactura (PDF)">
              <button type="button" onClick={() => ref.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-muted hover:border-brand/50">
                <Upload size={16} /> {file ? <b className="text-ink">{file.name}</b> : "Document adjunt: PDF de l'autofactura rebuda (o arrossega'l aquí). El lector en proposa les dades i les liquidacions."}
              </button>
            </DropArea>
            {pv && (
              <div className="space-y-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[12px]"><Sparkles size={13} className="text-brand" /> Lector local (sense IA):{pv.read.isSelfInvoice ? <Badge tone="green">autofactura detectada</Badge> : <Badge tone="amber">no consta com a autofactura</Badge>}{pv.read.signals.map((s) => <span key={s} className="text-muted">«{s}»</span>)}</p>
                {pv.duplicate && <Notice tone="red">Aquesta autofactura ja està registrada ({pv.duplicate.retailer} · {pv.duplicate.number}). No es tornarà a registrar.</Notice>}
                {pv.read.warnings.map((w) => <Notice key={w} tone="amber">{w}</Notice>)}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="Data de l'autofactura *" type="date" value={f.issueDate} onChange={(v) => set("issueDate", v)} ev={pv?.read.issueDate.evidence} />
              <Field label="Base imposable (€) *" value={f.base} onChange={(v) => set("base", v)} ev={pv?.read.base.evidence} />
              <Field label="IVA (%)" value={f.vatRate} onChange={(v) => set("vatRate", v)} ev={pv?.read.vatRate.evidence} />
              <Field label="Quota d'IVA (€)" value={f.vat} onChange={(v) => set("vat", v)} ev={pv?.read.vat.evidence} />
              <Field label="Retenció (€)" value={f.withholding} onChange={(v) => set("withholding", v)} ev={pv?.read.withholding.evidence} />
              <Field label="Total (€) *" value={f.total} onChange={(v) => set("total", v)} ev={pv?.read.total.evidence} />
              <Field label="Període des de" type="date" value={f.periodFrom} onChange={(v) => set("periodFrom", v)} />
              <Field label="Període fins a" type="date" value={f.periodTo} onChange={(v) => set("periodTo", v)} />
            </div>
          </section>
        )}

        <section className="space-y-1.5">
          <p className="text-[12.5px] font-semibold">Liquidació relacionada{isSelf ? " (una o diverses)" : ""} *</p>
          {pv && pv.proposals.length > 0 && (
            <div className="rounded-xl border border-brand/30 bg-brand/[0.03] p-2 text-[12px]">
              <p className="mb-1 font-medium">Correspondències proposades pel lector (confirma-les):</p>
              <ul className="space-y-1">{pv.proposals.map((p) => (
                <li key={p.statementId} className="flex flex-wrap items-start gap-2">
                  <input type="checkbox" className="mt-0.5" disabled={!!p.blocked} checked={p.statementId in links} onChange={(e) => { const n = { ...links }; if (e.target.checked) n[p.statementId] = p.amount; else delete n[p.statementId]; setLinks(n); setWarnings(null); }} aria-label={`Vincula ${p.label}`} />
                  <span className="min-w-0 flex-1"><b>{p.label}</b> <span className="text-muted">· {p.reasons.join(" · ")}</span>{p.blocked && <span className="block text-lost">{p.blocked}</span>}{p.discrepancies.map((d) => <span key={d} className="block text-pend">{d}</span>)}</span>
                  <Badge tone={p.score >= 60 ? "green" : p.score >= 35 ? "amber" : "zinc"}>{p.score}</Badge>
                </li>
              ))}</ul>
            </div>
          )}
          <div className="max-h-52 overflow-auto rounded-xl border border-line">
            <table className="w-full text-[12px]">
              <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="px-2 py-1" /><th>Liquidació</th><th>Rebuda</th><th className="text-right">Liquidat</th><th className="text-right">Conciliat</th><th className="text-right">Cobrat</th><th className="px-2 text-right">{isSelf ? "Base vinculada" : ""}</th></tr></thead>
              <tbody>{options.length === 0 ? <tr><td colSpan={7} className="px-2 py-2 text-muted">{retailer ? "Cap liquidació d'aquesta comercialitzadora." : "Indica la comercialitzadora."}</td></tr> : options.map((s) => {
                const on = s.id in links;
                return (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-2"><input type={isSelf ? "checkbox" : "radio"} name="af-st" checked={on} onChange={(e) => { const n = isSelf ? { ...links } : {}; if (e.target.checked) n[s.id] = (Number(s.conciliated) > 0 ? Number(s.conciliated) : Number(s.total)).toFixed(2); else delete n[s.id]; setLinks(n); setWarnings(null); }} aria-label={`Liquidació ${s.reference}`} /></td>
                    <td className="font-mono">{s.reference}</td><td>{fmtD(s.received_at)}</td>
                    <td className="text-right tnum">{eur(s.total)}</td><td className="text-right tnum">{eur(s.conciliated)}</td><td className="text-right tnum text-ren">{eur(s.collected)}</td>
                    <td className="px-2 text-right">{isSelf && on && <input className="input h-7 w-28 py-0 text-right text-[12px] tnum" value={links[s.id]} onChange={(e) => { setLinks({ ...links, [s.id]: e.target.value }); setWarnings(null); }} aria-label={`Base vinculada a ${s.reference}`} />}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {isSelf && Object.keys(links).length > 0 && f.base && Math.abs(linkedTotal - Number(dec(f.base))) > 0.01 && <p className="text-[11.5px] text-pend">La suma vinculada ({eur(linkedTotal)}) no coincideix amb la base ({eur(dec(f.base))}).</p>}
        </section>

        <section className="grid gap-2 sm:grid-cols-3">
          <Field label="Import liquidat (€)" value={f.liquidated} onChange={(v) => set("liquidated", v)} hint="Per comprovar-lo amb la conciliació" />
          <Field label={isSelf ? "Import cobrat (€) · opcional" : "Import cobrat (€) *"} value={f.collected} onChange={(v) => set("collected", v)} hint={isSelf ? "Buit = només es registra l'autofactura; res no queda cobrat" : "Es permeten cobraments parcials"} />
          <Field label="Data de cobrament" type="date" value={f.collectedAt} onChange={(v) => set("collectedAt", v)} max={new Date().toISOString().slice(0, 10)} />
          <label className="block sm:col-span-3"><span className="label">Observacions</span><textarea className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></label>
          {!!f.collected && <label className="flex items-start gap-2 text-[12px] sm:col-span-3"><input type="checkbox" className="mt-0.5" checked={net} onChange={(e) => setNet(e.target.checked)} /><span>Cobrament <b>net</b>: les retrocomissions conciliades s&apos;han descomptat del pagament.</span></label>}
        </section>
        <p className="text-[11.5px] text-muted">Una autofactura és el document fiscal emès per la comercialitzadora: no es crea cap factura d&apos;Assessoria 3.0 i no compta com a cobrament. El cobrament només s&apos;assigna a comissions conciliades; si sobra import, queda sense assignar.</p>
        {warnings && (
          <div className="space-y-1" data-testid="discrepancies">
            <Notice tone="amber"><b>Revisa aquestes diferències abans de confirmar:</b></Notice>
            <ul className="list-disc pl-5 text-[12px]">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
        )}
        {busy && <p className="flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> {busy}</p>}
        {err && <Notice tone="red">{err}</Notice>}
      </div>
    </Modal>
  );
}

function Field({ label, value, onChange, type = "text", ev, hint, max }: { label: string; value: string; onChange: (v: string) => void; type?: string; ev?: string | null; hint?: string; max?: string }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <input className={cn("input", type !== "date" && "tnum")} type={type} inputMode={type === "text" ? "decimal" : undefined} value={value} max={max} onChange={(e) => onChange(e.target.value)} />
      {ev && <span className="block truncate text-[10.5px] text-muted" title={ev}>Llegit: {ev}</span>}
      {hint && <span className="block text-[10.5px] text-muted">{hint}</span>}
    </label>
  );
}

type Billing = {
  mode: BillingSystem; hasOwnInvoice: boolean; settlementState: SettlementState; collectionState: CollectionState;
  reconcile: { expected: string | null; liquidated: string; conciliated: string; selfInvoiced: string; collected: string; pendingCollection: string; discrepancies: string[] };
  selfInvoices: { id: string; number: string; issue_date: string; base: string; vat: string; withholding: string; total: string; status: string; file_name: string | null; hasFile: boolean; linked: string; source: string; annulled_reason: string | null }[];
  receipts: { id: string; amount: string; received_at: string; bank_reference: string; allocated: string; doc_type?: string; self_invoice_id?: string | null }[];
};

/** Fitxa de la liquidació: estats independents, imports esperat/liquidat/autofacturat/cobrat i autofactures vinculades. */
export function StatementBillingPanel({ id, version, onChanged }: { id: string; version: number; onChanged: () => void }) {
  const [d, setD] = useState<Billing | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [annul, setAnnul] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const load = useCallback(() => fApi.get<Billing>("statement_billing", { id }).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(errMsg(e))), [id]);
  useEffect(() => { void load(); }, [load, version]);
  if (err) return /migració/.test(err) ? <Notice tone="amber">{err}</Notice> : null;
  if (!d) return null;
  const r = d.reconcile;
  const open = async (sid: string) => { try { const x = await fApi.get<{ url: string }>("self_invoice_file", { id: sid }); window.open(x.url, "_blank", "noopener"); } catch (e) { toast("No s'ha pogut obrir el PDF", errMsg(e), "err"); } };
  const setMode = async (mode: "factura_propia" | "autofactura" | null) => { try { await fApi.act("statement_billing_mode", { id, data: { mode } }); await load(); onChanged(); } catch (e) { toast("No s'ha pogut canviar", errMsg(e), "err"); } };
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-[12.5px]" data-testid="estat-facturacio-liquidacio">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Facturació i cobrament</h3>
        <Badge tone={SETTLEMENT_TONE[d.settlementState]}>Liquidació: {SETTLEMENT_STATE_LABEL[d.settlementState]}</Badge>
        <Badge tone={COLLECTION_TONE[d.collectionState]}>{COLLECTION_STATE_LABEL[d.collectionState]}</Badge>
        <span className="ml-auto text-muted">{BILLING_SYSTEM_LABEL[d.mode]}</span>
        {d.mode === "mixt" && !d.hasOwnInvoice && <span className="flex gap-1"><Button size="sm" onClick={() => void setMode("autofactura")}>Aquesta va amb autofactura</Button><Button size="sm" variant="ghost" onClick={() => void setMode("factura_propia")}>Factura pròpia</Button></span>}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {([["Esperat", r.expected], ["Liquidat", r.liquidated], ["Conciliat", r.conciliated], ["Autofacturat (base)", r.selfInvoiced], ["Cobrat", r.collected], ["Pendent de cobrar", r.pendingCollection]] as const).map(([l, v]) => (
          <div key={l} className="min-w-0 rounded-lg bg-ink/[0.03] px-2 py-1.5"><dt className="text-[11px] text-muted">{l}</dt><dd className="tnum font-medium">{v == null ? "—" : eur(v)}</dd></div>
        ))}
      </dl>
      {r.discrepancies.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-pend">{r.discrepancies.map((x) => <li key={x}>{x}</li>)}</ul>}
      {d.selfInvoices.length > 0 && (
        <div className="overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="py-1">Autofactura</th><th>Data</th><th className="text-right">Base</th><th className="text-right">IVA</th><th className="text-right">Total</th><th className="text-right">Vinculat</th><th>Estat</th><th /></tr></thead>
            <tbody>{d.selfInvoices.map((s) => (
              <tr key={s.id} className={cn("border-t border-line", s.status === "anullada" && "opacity-50")}>
                <td className="py-1 font-mono">{s.number}{s.source === "lector" && <Sparkles size={11} className="ml-1 inline text-brand" />}</td><td>{fmtD(s.issue_date)}</td>
                <td className="text-right tnum">{eur(s.base)}</td><td className="text-right tnum">{eur(s.vat)}</td><td className="text-right tnum">{eur(s.total)}</td><td className="text-right tnum">{eur(s.linked)}</td>
                <td>{s.status === "anullada" ? <span title={s.annulled_reason ?? ""}>Anul·lada</span> : "Registrada"}</td>
                <td className="whitespace-nowrap text-right">
                  {s.hasFile && <Button size="sm" variant="ghost" onClick={() => void open(s.id)} title="PDF original"><FileText size={12} /> PDF</Button>}
                  {s.status !== "anullada" && <Button size="sm" variant="ghost" onClick={() => { setAnnul(s.id); setReason(""); }} title="Anul·la"><Ban size={12} /></Button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {annul && (
        <Modal open onClose={() => setAnnul(null)} title="Anul·lar l'autofactura" footer={<><Button variant="ghost" onClick={() => setAnnul(null)}>Cancel·la</Button><Button variant="primary" disabled={reason.trim().length < 3} onClick={async () => { try { await fApi.act("self_invoice_annul", { id: annul, data: { reason } }); setAnnul(null); await load(); onChanged(); } catch (e) { toast("No s'ha pogut anul·lar", errMsg(e), "err"); } }}>Anul·la</Button></>}>
          <p className="mb-2 text-[12.5px] text-muted">L&apos;autofactura no s&apos;esborra: queda anul·lada amb el motiu i el PDF original. Si ja té cobraments, no es pot anul·lar.</p>
          <input className="input" autoFocus placeholder="Motiu" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </section>
  );
}
