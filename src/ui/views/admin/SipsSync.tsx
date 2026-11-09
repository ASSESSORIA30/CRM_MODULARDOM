"use client";
/**
 * Administració → Sincronització SIPS (migració 034).
 * Indicadors i barra de progrés amb dades reals de la cua, taula de CUPS amb filtres sobre les dades desades (mai
 * consulta el SIPS per filtrar), accions, historial, oportunitats detectades i configuració (només Direcció).
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, DatabaseZap, Download, History, Loader2, Pause, Play, RefreshCw, RotateCw, Settings2, ShieldAlert, Sparkles, Zap } from "lucide-react";
import { useApp } from "@/data/store";
import { CHANGE_LABEL, JOB_STATE_LABEL, JOB_STATES, OPPORTUNITY_LABEL, REASON_LABEL, type ChangeKind, type JobState, type OpportunityKind, type SyncReason, type SyncSettings } from "@/core/sips-sync";
import { Badge, Button, Modal, Notice, Tabs, cn } from "../../components/ui";
import { PageHead, Panel, Skeleton, Stat, fdt } from "../consolidacio/shared";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({ error: `Resposta no vàlida (${r.status})` }));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
}
export const sipsSyncApi = {
  get: <T,>(r: string, p: Record<string, string | undefined> = {}) => call<T>(`/api/sips/sync?${new URLSearchParams({ r, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Record<string, string> })}`),
  act: <T = { ok?: boolean }>(action: string, b: Record<string, unknown> = {}) => call<T>("/api/sips/sync", { method: "POST", body: JSON.stringify({ action, ...b }) }),
};
const toast = (title: string, body?: string, tone: "ok" | "err" = "ok") => useApp.getState().toast({ title, body, tone });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Overview = {
  total: number; counts: Partial<Record<JobState, number>>; progressPct: number; synced: number; pending: number; errors: number; noData: number; updatedPct: number;
  lastRun: { status: string; started_at: string; finished_at: string | null; processed: number; ok: number; errors: number; stop_reason: string | null } | null; nextRun: string | null;
  multiClient: number; newOpportunities: number; canConfigure: boolean; scoped: boolean;
  status: { enabled: boolean; paused: boolean; blocker: string | null; authorizedAt: string | null; authorizationRef: string | null; blockedReason: string | null; credentialsMissing: string[] };
  settings: SyncSettings | null; authorization: { ref: string | null; limits: string | null; legalBasis: string | null; retentionDays: number | null; at: string | null } | null;
};
type JobRow = { cups20: string; variants: string[]; reason: SyncReason; status: JobState; attempts: number; last_attempt_at: string | null; next_attempt_at: string; last_success_at: string | null; last_error: string | null; last_error_code: string | null; client_ids: string[]; client_names: string[]; owner_names: string[]; retailers: string[]; tariff: string | null; energy_type: string | null; renewal_date: string | null; multi_client: boolean };
const STATE_TONE: Record<JobState, "zinc" | "blue" | "green" | "amber" | "red"> = { pendent: "zinc", en_proces: "blue", actualitzat: "green", sense_dades: "zinc", error_temporal: "amber", error_permanent: "red", bloquejat_permisos: "red" };

export function SipsSyncView() {
  const [tab, setTab] = useState<"cups" | "oportunitats" | "historial" | "config">("cups");
  const [o, setO] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const load = useCallback(() => sipsSyncApi.get<Overview>("overview").then((x) => { setO(x); setErr(null); }).catch((e) => setErr(msg(e))), []);
  useEffect(() => { void load(); }, [load, v]);
  const refresh = () => setV((x) => x + 1);
  const admin = !!o?.canConfigure;
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5 sm:px-6" data-testid="sips-sync">
      <PageHead icon={<DatabaseZap size={16} />} title="Sincronització SIPS" sub={o?.scoped ? "Estat de les dades SIPS dels CUPS dels teus clients." : "Actualització automàtica de les dades energètiques de tots els CUPS del CRM."} tone="from-sky-600 to-emerald-500">
        <Button size="sm" onClick={refresh}><RefreshCw size={13} /> Actualitza</Button>
      </PageHead>
      {err && <Notice tone={/migració/.test(err) ? "amber" : "red"}>{err}</Notice>}
      {o && <StatusBanner o={o} onChanged={refresh} />}
      {!o && !err ? <Skeleton rows={2} /> : o && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="CUPS únics" value={o.total.toLocaleString("ca-ES")} sub={o.multiClient ? <span className="text-amber-600">{o.multiClient} a més d&apos;un client</span> : undefined} />
            <Stat label="Sincronitzats" value={o.synced.toLocaleString("ca-ES")} tone="green" />
            <Stat label="Pendents" value={o.pending.toLocaleString("ca-ES")} tone="blue" />
            <Stat label="Amb errors" value={o.errors.toLocaleString("ca-ES")} tone={o.errors ? "red" : undefined} />
            <Stat label="Sense dades" value={o.noData.toLocaleString("ca-ES")} />
            <Stat label="% actualitzat" value={`${o.updatedPct.toLocaleString("ca-ES")} %`} />
            <Stat label="Última execució" value={o.lastRun ? fdt(o.lastRun.started_at) : "—"} sub={o.lastRun ? `${o.lastRun.ok} ok · ${o.lastRun.errors} errors` : undefined} />
            <Stat label="Pròxima prevista" value={o.nextRun ? fdt(o.nextRun) : "—"} sub={o.nextRun ? undefined : "Desactivada"} />
          </div>
          <div className="rounded-2xl border border-line bg-surface p-3" data-testid="sips-progres">
            <div className="mb-1.5 flex items-center justify-between text-[12px]"><span className="font-medium">Feina programada completada</span><span className="tnum text-muted">{o.progressPct.toLocaleString("ca-ES")} %</span></div>
            <div className="h-2.5 overflow-hidden rounded-full bg-ink/[0.07]" role="progressbar" aria-valuenow={o.progressPct} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all" style={{ width: `${Math.min(100, o.progressPct)}%` }} /></div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">{JOB_STATES.filter((k) => o.counts[k]).map((k) => <Badge key={k} tone={STATE_TONE[k]}>{JOB_STATE_LABEL[k]}: {o.counts[k]}</Badge>)}</div>
          </div>
          <Tabs value={tab} onChange={setTab} items={[{ id: "cups", label: "CUPS" }, { id: "oportunitats", label: "Oportunitats detectades pel SIPS", count: o.newOpportunities || undefined }, { id: "historial", label: "Historial" }, ...(admin ? [{ id: "config" as const, label: "Configuració" }] : [])]} />
          {tab === "cups" && <JobsTable o={o} onChanged={refresh} />}
          {tab === "oportunitats" && <Opportunities onChanged={refresh} />}
          {tab === "historial" && <RunsHistory />}
          {tab === "config" && admin && <Config o={o} onChanged={refresh} />}
        </>
      )}
    </div>
  );
}

function StatusBanner({ o, onChanged }: { o: Overview; onChanged: () => void }) {
  const s = o.status;
  const act = async (a: string) => { try { await sipsSyncApi.act(a); onChanged(); } catch (e) { toast("No s'ha pogut fer", msg(e), "err"); } };
  if (!s.enabled) return (
    <Notice tone="amber">
      <b>Sincronització massiva desactivada.</b> La integració actual entra al portal EAS Renovae amb usuari i contrasenya i no consta cap API documentada per a consultes automatitzades. Les consultes d&apos;un CUPS des de les fitxes funcionen com fins ara. {o.canConfigure ? "Per activar-la, registra a «Configuració» l'autorització escrita del proveïdor amb els límits i la base jurídica." : "L'activa Direcció quan tingui l'autorització del proveïdor."}
      {s.credentialsMissing.length > 0 && <span className="block">Falten variables d&apos;entorn: {s.credentialsMissing.join(", ")}.</span>}
    </Notice>
  );
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2 text-[12.5px]", s.blocker ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5")}>
      {s.blocker ? <AlertTriangle size={15} className="text-amber-600" /> : <CheckCircle2 size={15} className="text-emerald-600" />}
      <span className="min-w-0 flex-1">{s.blocker ?? `Sincronització activa (autoritzada el ${s.authorizedAt ? new Date(s.authorizedAt).toLocaleDateString("ca-ES") : "—"}).`}</span>
      {o.canConfigure && (s.paused ? <Button size="sm" onClick={() => void act("resume")}><Play size={13} /> Reprendre sincronització</Button> : <Button size="sm" onClick={() => void act("pause")}><Pause size={13} /> Pausar sincronització</Button>)}
    </div>
  );
}

function JobsTable({ o, onChanged }: { o: Overview; onChanged: () => void }) {
  const go = useApp((s) => s.navigate);
  const [f, setF] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [d, setD] = useState<{ rows: JobRow[]; total: number; size: number } | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ mode: string; cups?: string[]; est: { cups: number; requests: number; minutes: number; runs: number; blocker: string | null } } | null>(null);
  const [hist, setHist] = useState<string | null>(null);
  const load = useCallback(() => sipsSyncApi.get<{ rows: JobRow[]; total: number; size: number }>("jobs", { ...f, page: String(page) }).then(setD).catch((e) => toast("No s'han pogut carregar els CUPS", msg(e), "err")), [f, page]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  const setFilter = (k: string, v: string) => { setPage(0); setF((x) => ({ ...x, [k]: v })); };
  const ask = async (mode: string, cups?: string[]) => {
    try { const est = await sipsSyncApi.act<{ cups: number; requests: number; minutes: number; runs: number; blocker: string | null }>("enqueue", { data: { mode, cups, dryRun: true } }); setConfirm({ mode, cups, est }); }
    catch (e) { toast("No s'ha pogut preparar", msg(e), "err"); }
  };
  const doEnqueue = async () => {
    if (!confirm) return;
    setBusy("enqueue");
    try { const r = await sipsSyncApi.act<{ queued: number }>("enqueue", { data: { mode: confirm.mode, cups: confirm.cups } }); toast(`${r.queued} CUPS a la cua amb prioritat manual`, o.status.blocker ? "Es processaran quan la sincronització estigui activa." : "Es processen a la pròxima execució."); setConfirm(null); setSel(new Set()); onChanged(); void load(); }
    catch (e) { toast("No s'ha pogut encuar", msg(e), "err"); } finally { setBusy(null); }
  };
  const one = async (cups: string) => {
    setBusy(cups);
    try {
      const r = await sipsSyncApi.act<{ job: { status: JobState; last_error: string | null } | null }>("refresh_one", { cups });
      toast(r.job?.status === "actualitzat" ? "Dades SIPS actualitzades" : `Estat: ${JOB_STATE_LABEL[r.job?.status ?? "pendent"]}`, r.job?.last_error ?? undefined, r.job?.status === "actualitzat" ? "ok" : "err");
      onChanged(); void load();
    } catch (e) { toast("No s'ha pogut actualitzar", msg(e), "err"); } finally { setBusy(null); }
  };
  const runNow = async () => {
    setBusy("run");
    try { const r = await sipsSyncApi.act<{ skipped?: boolean; reason?: string; processed?: number; ok?: number; errors?: number; stop?: string | null }>("run_now"); toast(r.skipped ? "No s'ha executat" : `Execució feta: ${r.processed} CUPS (${r.ok} ok, ${r.errors} errors)`, r.reason ?? r.stop ?? undefined, r.skipped ? "err" : "ok"); onChanged(); void load(); }
    catch (e) { toast("No s'ha pogut executar", msg(e), "err"); } finally { setBusy(null); }
  };
  const toggle = (c: string) => { const n = new Set(sel); if (n.has(c)) n.delete(c); else n.add(c); setSel(n); };
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  return (
    <Panel title={<span className="flex items-center gap-2"><Zap size={14} /> CUPS ({d?.total.toLocaleString("ca-ES") ?? "…"})</span>} action={
      <div className="flex flex-wrap gap-1.5">
        {o.canConfigure && <Button size="sm" onClick={() => void ask("pendents")}><Play size={13} /> Sincronitzar pendents</Button>}
        <Button size="sm" disabled={!sel.size} onClick={() => void ask("seleccionats", [...sel])}><RefreshCw size={13} /> Sincronitzar seleccionats{sel.size ? ` (${sel.size})` : ""}</Button>
        {o.canConfigure && <Button size="sm" onClick={() => void ask("errors")}><RotateCw size={13} /> Reintentar errors</Button>}
        {o.canConfigure && <Button size="sm" variant="primary" disabled={!!o.status.blocker || busy === "run"} onClick={() => void runNow()} title={o.status.blocker ?? "Processa ara un lot de la cua"}>{busy === "run" ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Executa ara</Button>}
        <a className="inline-flex" href="/api/sips/sync?r=export"><Button size="sm"><Download size={13} /> Exportar incidències a Excel</Button></a>
      </div>
    }>
      <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
        <input className="input lg:col-span-2" placeholder="Client, CUPS o comercialitzadora" value={f.q ?? ""} onChange={(e) => setFilter("q", e.target.value)} aria-label="Cerca" />
        <select className="input" value={f.status ?? ""} onChange={(e) => setFilter("status", e.target.value)} aria-label="Estat"><option value="">Tots els estats</option>{JOB_STATES.map((k) => <option key={k} value={k}>{JOB_STATE_LABEL[k]}</option>)}</select>
        <select className="input" value={f.tariff ?? ""} onChange={(e) => setFilter("tariff", e.target.value)} aria-label="Tarifa"><option value="">Totes les tarifes</option>{["2.0TD", "3.0TD", "6.1TD", "6.2TD", "RL1", "RL2", "RL3", "RL4", "RL5", "RL6"].map((t) => <option key={t}>{t}</option>)}</select>
        <select className="input" value={f.energy ?? ""} onChange={(e) => setFilter("energy", e.target.value)} aria-label="Tipus de subministrament"><option value="">Llum i gas</option><option value="luz">Electricitat</option><option value="gas">Gas</option></select>
        <input className="input" type="date" value={f.since ?? ""} onChange={(e) => setFilter("since", e.target.value)} aria-label="Actualitzat des de" title="Última actualització des de" />
        <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={f.multi === "1"} onChange={(e) => setFilter("multi", e.target.checked ? "1" : "")} /> A més d&apos;un client</label>
      </div>
      {!d ? <Skeleton rows={4} /> : d.rows.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">{o.total ? "Cap CUPS amb aquests filtres." : "Encara no hi ha inventari: s'omple a la primera execució o amb «Executa ara»."}</p> : (
        <div className="overflow-auto">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wide text-muted"><tr><th className="w-6 py-1.5" /><th>CUPS</th><th>Client</th><th>Tarifa</th><th>Motiu</th><th>Última sincronització</th><th>Estat</th><th className="text-right">Acció</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.cups20} className="border-t border-line align-top">
                <td className="py-1.5"><input type="checkbox" checked={sel.has(r.cups20)} onChange={() => toggle(r.cups20)} aria-label={`Selecciona ${r.cups20}`} /></td>
                <td className="py-1.5 font-mono text-[11.5px]">{r.variants.find((x) => x.length === 22) ?? r.cups20}{r.multi_client && <Badge tone="amber" className="ml-1">Diversos clients</Badge>}</td>
                <td className="max-w-[240px] py-1.5">{r.client_ids[0] ? <button className="truncate text-left hover:underline" onClick={() => go("client", { id: r.client_ids[0] })}>{r.client_names[0] ?? "—"}</button> : <span className="truncate">{r.client_names[0] ?? "—"}</span>}{r.client_names.length > 1 && <span className="block text-[11px] text-amber-600">+ {r.client_names.slice(1).join(", ")}</span>}{r.owner_names[0] && <span className="block text-[11px] text-muted">{r.owner_names[0]}</span>}</td>
                <td className="py-1.5">{r.tariff ?? "—"}</td>
                <td className="py-1.5 text-[11.5px]">{REASON_LABEL[r.reason]}{r.renewal_date && <span className="block text-muted">fi {r.renewal_date}</span>}</td>
                <td className="py-1.5">{r.last_success_at ? fdt(r.last_success_at) : "—"}</td>
                <td className="py-1.5"><Badge tone={STATE_TONE[r.status]}>{JOB_STATE_LABEL[r.status]}</Badge>{r.last_error && r.status !== "actualitzat" && <span className="block max-w-[260px] truncate text-[11px] text-muted" title={r.last_error}>{r.last_error}</span>}</td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setHist(r.cups20)} title="Veure historial"><History size={13} /></Button>
                  <Button size="sm" disabled={busy === r.cups20} onClick={() => void one(r.cups20)}>{busy === r.cups20 ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {/error|bloquejat/.test(r.status) ? "Reintentar" : "Actualitzar"}</Button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          <div className="mt-2 flex items-center justify-end gap-2 text-[12px]"><Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span className="tnum">{page + 1} / {pages}</span><Button size="sm" variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Següent</Button></div>
        </div>
      )}
      {confirm && (
        <Modal open onClose={() => setConfirm(null)} title="Confirmar sincronització" footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel·la</Button><Button variant="primary" disabled={!confirm.est.cups || busy === "enqueue"} onClick={() => void doEnqueue()}>{busy === "enqueue" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Afegeix a la cua</Button></>}>
          <div className="space-y-2 text-[13px]" data-testid="sips-confirmacio">
            <p><b>{confirm.est.cups.toLocaleString("ca-ES")}</b> CUPS afectats · unes <b>{confirm.est.requests.toLocaleString("ca-ES")}</b> consultes al proveïdor.</p>
            <p className="text-muted">Amb el límit configurat calen uns {confirm.est.minutes} minuts de consultes, repartits en {confirm.est.runs} execucions. Les dades noves depenen de quan el proveïdor les publica (sovint mensualment).</p>
            {confirm.est.blocker && <Notice tone="amber">{confirm.est.blocker} Les tasques quedaran a la cua fins llavors.</Notice>}
          </div>
        </Modal>
      )}
      {hist && <HistoryModal cups={hist} onClose={() => setHist(null)} />}
    </Panel>
  );
}

type Snap = { id: string; consulted_at: string; reference_from: string | null; reference_to: string | null; source: string | null; data: { tariff: string | null; tariffOriginal: string | null; powerKw: (number | null)[]; annualKwh: number | null; periodKwh: (number | null)[] | null; consumptionStatus: string; monthsAvailable: number; maxDemandMonths: number; warnings: string[]; surplusNote: string } };
function HistoryModal({ cups, onClose }: { cups: string; onClose: () => void }) {
  const [d, setD] = useState<{ snapshots: Snap[]; changes: { id: string; kind: ChangeKind; note: string; detected_at: string }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { sipsSyncApi.get<typeof d>("history", { cups }).then(setD).catch((e) => setErr(msg(e))); }, [cups]);
  const kw = (a: (number | null)[]) => a.map((v, i) => `P${i + 1} ${v ?? "—"}`).join(" · ");
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={<span className="font-mono">Historial · {cups}</span>}>
      {err && <Notice tone="red">{err}</Notice>}
      {!d && !err ? <Skeleton rows={3} /> : d && (
        <div className="space-y-3 text-[12.5px]">
          {d.changes.length > 0 && <div><p className="mb-1 font-semibold">Canvis detectats</p><ul className="space-y-1">{d.changes.map((c) => <li key={c.id}><Badge tone={c.kind === "incoherent" ? "red" : "blue"}>{CHANGE_LABEL[c.kind]}</Badge> <span className="text-muted">{fdt(c.detected_at)}</span> · {c.note}</li>)}</ul></div>}
          <div><p className="mb-1 font-semibold">Instantànies ({d.snapshots.length})</p>
            {d.snapshots.length === 0 ? <p className="text-muted">Encara no hi ha cap consulta desada.</p> : (
              <table className="w-full"><thead className="text-left text-[10.5px] uppercase text-muted"><tr><th>Consulta</th><th>Tarifa</th><th>Consum anual</th><th>Període</th><th>Potències (kW)</th></tr></thead>
                <tbody>{d.snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-line align-top"><td className="py-1">{fdt(s.consulted_at)}</td><td>{s.data.tariff ?? "—"}{s.data.tariffOriginal && s.data.tariffOriginal !== s.data.tariff && <span className="block text-[11px] text-muted">rebut: {s.data.tariffOriginal}</span>}</td>
                    <td className="tnum">{s.data.annualKwh != null ? `${Math.round(s.data.annualKwh).toLocaleString("ca-ES")} kWh` : "—"}<span className="block text-[11px] text-muted">{s.data.consumptionStatus === "parcial" ? `Parcial (${s.data.monthsAvailable} mesos)` : s.data.consumptionStatus}</span></td>
                    <td>{s.reference_from ? `${s.reference_from} – ${s.reference_to}` : "—"}</td><td className="text-[11.5px]">{kw(s.data.powerKw)}</td></tr>
                ))}</tbody></table>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

type Opp = { id: string; cups20: string; kind: OpportunityKind; title: string; quality: string; status: string; created_at: string; client_id: string | null; crm_clients: { id: string; name: string } | null; details: Record<string, unknown> & { note?: string; supplyId?: string | null; activeOpportunity?: boolean }; changes: { kind: ChangeKind; note: string }[]; task_id: string | null };
function Opportunities({ onChanged }: { onChanged: () => void }) {
  const go = useApp((s) => s.navigate);
  const [status, setStatus] = useState("nova");
  const [d, setD] = useState<Opp[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => sipsSyncApi.get<{ rows: Opp[] }>("opportunities", { status }).then((r) => setD(r.rows)).catch((e) => toast("No s'han pogut carregar", msg(e), "err")), [status]);
  useEffect(() => { void load(); }, [load]);
  const act = async (id: string, action: string) => {
    try { const r = await sipsSyncApi.act<{ existing?: boolean }>("opportunity", { id, data: { action } }); toast(action === "tasca" ? (r.existing ? "La tasca ja existia" : "Tasca comercial creada") : action === "descartada" ? "Alerta descartada" : "Marcada com a revisada"); void load(); onChanged(); }
    catch (e) { toast("No s'ha pogut fer", msg(e), "err"); }
  };
  return (
    <Panel title={<span className="flex items-center gap-2"><Sparkles size={14} /> Oportunitats detectades pel SIPS</span>} action={<select className="input h-8 py-0 text-[12px]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="nova">Noves</option><option value="revisada">Revisades</option><option value="tasca_creada">Amb tasca</option><option value="descartada">Descartades</option></select>}>
      <p className="mb-2 text-[12px] text-muted">Són indicis, no recomanacions: cal calcular l&apos;estalvi amb Comparatives IA i validar-ho abans d&apos;enviar res al client.</p>
      {!d ? <Skeleton rows={3} /> : d.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">Cap alerta en aquest estat.</p> : (
        <ul className="divide-y divide-line">{d.map((x) => (
          <li key={x.id} className="py-2.5" data-testid="sips-oportunitat">
            <div className="flex flex-wrap items-start gap-2">
              <Badge tone={x.kind === "optimitzacio_potencia" ? "blue" : x.kind === "augment_consum" ? "amber" : "green"}>{OPPORTUNITY_LABEL[x.kind]}</Badge>
              <span className="min-w-0 flex-1 text-[13px]"><b>{x.crm_clients?.name ?? "Sense client al CRM"}</b> · {x.title}<span className="block font-mono text-[11px] text-muted">{x.cups20} · qualitat de dades {x.quality} · {fdt(x.created_at)}{x.details.activeOpportunity ? " · ja té una oportunitat activa" : ""}</span></span>
              <div className="flex flex-wrap gap-1">
                {x.client_id && <Button size="sm" variant="ghost" onClick={() => go("client", { id: x.client_id! })}>Fitxa del client</Button>}
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === x.id ? null : x.id)}>Detalls</Button>
                {x.client_id && <Button size="sm" onClick={() => go("comparativa", x.details.supplyId ? { client: x.client_id!, supply: x.details.supplyId } : { client: x.client_id! })}>Comparatives IA</Button>}
                {x.status !== "tasca_creada" && x.client_id && <Button size="sm" onClick={() => void act(x.id, "tasca")}>Crear tasca</Button>}
                {x.status === "nova" && <Button size="sm" variant="ghost" onClick={() => void act(x.id, "revisada")}>Revisada</Button>}
                {x.status !== "descartada" && x.status !== "tasca_creada" && <Button size="sm" variant="ghost" onClick={() => void act(x.id, "descartada")}>Descartar</Button>}
              </div>
            </div>
            {open === x.id && (
              <div className="mt-2 rounded-lg bg-ink/[0.03] px-3 py-2 text-[12px]">
                {x.details.note && <p>{String(x.details.note)}</p>}
                {x.changes.map((c, i) => <p key={i}><b>{CHANGE_LABEL[c.kind]}:</b> {c.note}</p>)}
                <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[11px] text-muted">{JSON.stringify(Object.fromEntries(Object.entries(x.details).filter(([k]) => !["note", "supplyId", "activeOpportunity"].includes(k))), null, 1)}</pre>
              </div>
            )}
          </li>
        ))}</ul>
      )}
    </Panel>
  );
}

function RunsHistory() {
  const [d, setD] = useState<{ runs: { id: string; trigger: string; status: string; started_at: string; finished_at: string | null; claimed: number; processed: number; ok: number; no_data: number; errors: number; requests: number; stop_reason: string | null }[]; errors: { id: number; cups20: string; code: string; http_status: number | null; message: string | null; at: string }[] } | null>(null);
  useEffect(() => { sipsSyncApi.get<typeof d>("runs").then(setD).catch((e) => toast("No s'ha pogut carregar l'historial", msg(e), "err")); }, []);
  if (!d) return <Skeleton rows={3} />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={<span className="flex items-center gap-2"><Clock size={14} /> Execucions</span>} empty={d.runs.length ? false : "Encara no hi ha cap execució."}>
        <table className="w-full text-[12px]"><thead className="text-left text-[10.5px] uppercase text-muted"><tr><th>Inici</th><th>Origen</th><th>Estat</th><th className="text-right">CUPS</th><th className="text-right">OK</th><th className="text-right">Errors</th></tr></thead>
          <tbody>{d.runs.map((r) => <tr key={r.id} className="border-t border-line"><td className="py-1">{fdt(r.started_at)}</td><td>{r.trigger}</td><td>{r.status}{r.stop_reason && <span className="block text-[11px] text-amber-600">{r.stop_reason}</span>}</td><td className="text-right tnum">{r.processed}/{r.claimed}</td><td className="text-right tnum">{r.ok}</td><td className="text-right tnum">{r.errors}</td></tr>)}</tbody></table>
      </Panel>
      <Panel title={<span className="flex items-center gap-2"><ShieldAlert size={14} /> Últimes incidències</span>} empty={d.errors.length ? false : "Cap incidència registrada."}>
        <ul className="space-y-1 text-[12px]">{d.errors.map((e) => <li key={e.id} className="border-t border-line pt-1"><span className="font-mono text-[11px]">{e.cups20}</span> · <Badge tone="amber">{e.code}</Badge> {e.http_status && <span className="text-muted">HTTP {e.http_status}</span>} <span className="text-muted">{fdt(e.at)}</span><span className="block text-muted">{e.message}</span></li>)}</ul>
      </Panel>
    </div>
  );
}

function Config({ o, onChanged }: { o: Overview; onChanged: () => void }) {
  const s = o.settings!;
  const [form, setForm] = useState<SyncSettings>(s);
  const [auth, setAuth] = useState({ ref: o.authorization?.ref ?? "", limits: o.authorization?.limits ?? "", legalBasis: o.authorization?.legalBasis ?? "", retentionDays: String(o.authorization?.retentionDays ?? "") });
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const num = (k: keyof SyncSettings, label: string, hint?: string) => <label className="block text-[12px]"><span className="label">{label}</span><input className="input tnum" type="number" value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: Number(e.target.value) })} />{hint && <span className="text-[10.5px] text-muted">{hint}</span>}</label>;
  const save = async () => { setBusy(true); try { await sipsSyncApi.act("settings", { data: form }); toast("Configuració desada"); onChanged(); } catch (e) { toast("No s'ha pogut desar", msg(e), "err"); } finally { setBusy(false); } };
  const authorize = async (enable: boolean) => {
    setBusy(true);
    try { await sipsSyncApi.act("authorization", { data: enable ? { enable, ref: auth.ref, limits: auth.limits || undefined, legalBasis: auth.legalBasis, retentionDays: auth.retentionDays ? Number(auth.retentionDays) : undefined, confirm: true } : { enable } }); toast(enable ? "Sincronització massiva activada" : "Sincronització massiva desactivada"); onChanged(); }
    catch (e) { toast("No s'ha pogut canviar", msg(e), "err"); } finally { setBusy(false); }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={<span className="flex items-center gap-2"><ShieldAlert size={14} /> Autorització del proveïdor</span>}>
        <div className="space-y-2 text-[12.5px]">
          <p className="text-muted">Activa la sincronització programada només amb una autorització expressa del proveïdor SIPS per a consultes automatitzades (API o mecanisme autoritzat), els seus límits i la base jurídica del tractament. No s&apos;utilitza scraping ni automatització de navegador.</p>
          <label className="block"><span className="label">Autorització (document, data i abast) *</span><textarea className="input" rows={2} value={auth.ref} onChange={(e) => setAuth({ ...auth, ref: e.target.value })} placeholder="P. ex.: contracte o correu del proveïdor amb data i abast de l'autorització" /></label>
          <label className="block"><span className="label">Límits del proveïdor</span><input className="input" value={auth.limits} onChange={(e) => setAuth({ ...auth, limits: e.target.value })} placeholder="Consultes per minut / dia" /></label>
          <label className="block"><span className="label">Base jurídica del tractament *</span><input className="input" value={auth.legalBasis} onChange={(e) => setAuth({ ...auth, legalBasis: e.target.value })} /></label>
          <label className="block"><span className="label">Conservació de l&apos;històric (dies)</span><input className="input tnum" type="number" value={auth.retentionDays} onChange={(e) => setAuth({ ...auth, retentionDays: e.target.value })} /></label>
          {!o.status.enabled && <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Confirmo que el proveïdor autoritza aquestes consultes automatitzades i que he revisat les condicions i la conservació de les dades.</label>}
          <div className="flex gap-2">{o.status.enabled ? <Button disabled={busy} onClick={() => void authorize(false)}>Desactiva la sincronització massiva</Button> : <Button variant="primary" disabled={busy || !ok || auth.ref.trim().length < 10 || !auth.legalBasis.trim()} onClick={() => void authorize(true)}>Activa la sincronització massiva</Button>}</div>
        </div>
      </Panel>
      <Panel title={<span className="flex items-center gap-2"><Settings2 size={14} /> Freqüències, límits i llindars</span>} action={<Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>Desa</Button>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(["nou", "renovacio", "oportunitat", "actiu", "historic"] as const).map((k) => <label key={k} className="block text-[12px]"><span className="label">{REASON_LABEL[k]} (dies)</span><input className="input tnum" type="number" value={form.frequencies[k]} onChange={(e) => setForm({ ...form, frequencies: { ...form.frequencies, [k]: Number(e.target.value) } })} /></label>)}
          {num("renewalWindowDays", "Finestra de renovació (dies)")}
          {num("maxPerRun", "CUPS per execució")}{num("concurrency", "Concurrència", "1–4")}{num("perMinute", "Peticions per minut")}
          {num("maxAttempts", "Intents màxims")}{num("backoffMinutes", "Retard base (min)")}{num("maxBackoffHours", "Retard màxim (h)")}
          {num("windowStartHour", "Inici finestra (h, Espanya)")}{num("windowEndHour", "Fi finestra (h)")}
          {num("consumptionChangePct", "Canvi de consum (%)")}{num("minConsumptionChangeKwh", "Canvi mínim (kWh)")}{num("powerToleranceKw", "Tolerància potència (kW)")}
          {num("oversizeRatio", "Màx./contractada (sobredimensionament)", "p. ex. 0,6 = 60 %")}{num("oversizeMinMonths", "Mesos mínims de màxims")}
          {num("errorRateAlertPct", "Avís si errors ≥ (%)")}{num("staleAlertHours", "Avís sense èxit (h)")}{num("historyPerCups", "Instantànies per CUPS")}
          <label className="col-span-2 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={form.includeHistoric} onChange={(e) => setForm({ ...form, includeHistoric: e.target.checked })} /> Inclou contractes històrics</label>
        </div>
      </Panel>
    </div>
  );
}
