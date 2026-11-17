// Extres del projecte i control econòmic: estats, acceptació, annex, fites de cobrament, costos reals i marge.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, PageHeader, btnGold, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate, formatDateTime, madridDateKey } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import { formatCents } from "@/lib/money";
import { formatRate } from "@/lib/quotes/calc";
import { createClient } from "@/lib/supabase/server";
import {
  addExtraCostAction, addExtraMilestoneAction, createExtraAction, deleteExtraCostAction, deleteExtraMilestoneAction, markIncludedAction,
  setExtraStatusAction, updateExtraAction,
} from "./actions";

const NEXT: Record<string, string[]> = {
  proposat: ["pendent_aprovacio", "aprovat", "rebutjat"], pendent_aprovacio: ["aprovat", "rebutjat", "proposat"], rebutjat: ["proposat"],
  aprovat: ["incorporat"], incorporat: ["executat"], executat: ["facturat"], facturat: ["cobrat"], cobrat: [],
};
const STATUS_CLS: Record<string, string> = {
  proposat: "bg-slate-100 text-slate-700", pendent_aprovacio: "bg-amber-100 text-amber-800", aprovat: "bg-emerald-100 text-emerald-800",
  rebutjat: "bg-red-100 text-red-800", incorporat: "bg-sky-100 text-sky-800", executat: "bg-indigo-100 text-indigo-800",
  facturat: "bg-violet-100 text-violet-800", cobrat: "bg-emerald-200 text-emerald-900",
};

export default async function ExtresPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const L = profile.locale;
  const X = qx(L);
  const T = qt(L);
  const base = actionMessages(L);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  const [{ data: extras }, { data: eco }, { data: contract }, { data: accepted }, { data: versions }, { data: docs }, { data: rates }, { data: types }] = await Promise.all([
    supabase.from("project_extras").select("*, project_extra_events(id, from_status, to_status, event_date, note, created_at), project_extra_costs(id, supplier, description, amount_cents, cost_date), project_extra_milestones(id, position, concept, amount_cents, trigger_condition, billing_status)")
      .eq("project_id", id).order("created_at"),
    supabase.from("project_extras_economics").select("*").eq("project_id", id).maybeSingle(),
    supabase.from("contracts").select("id, title, total_cents").eq("project_id", id).eq("status", "validat").maybeSingle(),
    supabase.from("quote_versions").select("id, version, quotes(code)").eq("project_id", id).eq("status", "acceptat").order("accepted_at", { ascending: false }).limit(1),
    supabase.from("quote_versions").select("id, version, status, quotes(code), quote_lines(id, description, amount_cents, status, vat_rate_bp, concept_type)").eq("project_id", id).neq("status", "esborrany"),
    supabase.from("documents").select("id, title, version, bucket_id").eq("project_id", id).in("bucket_id", ["contractes", "documents"]).neq("status", "arxivat"),
    supabase.from("vat_rates").select("rate_bp").eq("active", true).order("rate_bp"),
    supabase.from("concept_types").select("code, label_ca, label_es").eq("active", true).order("position"),
  ]);
  const acc = accepted?.[0];
  const accTotals = acc ? (await supabase.from("quote_version_totals").select("taxable_cents").eq("version_id", acc.id).maybeSingle()).data : null;
  const contracted = contract?.total_cents ?? accTotals?.taxable_cents ?? null;
  const code = (v: { quotes: unknown }) => ((Array.isArray(v.quotes) ? v.quotes[0] : v.quotes) as { code: string } | null)?.code ?? "";
  const used = new Set((extras ?? []).map((e) => e.source_quote_line_id).filter(Boolean));
  const optional = (versions ?? []).flatMap((v) => (v.quote_lines ?? []).filter((l) => (l.status === "opcional" || l.status === "pendent_valoracio") && !used.has(l.id))
    .map((l) => ({ ...l, label: `${code(v)} v${v.version} · ${l.description} · ${formatCents(Number(l.amount_cents))}` })));
  const today = madridDateKey();
  const e0 = eco ?? { approved_cents: 0, pending_cents: 0, rejected_cents: 0, invoiced_cents: 0, collected_cents: 0, estimated_cost_cents: 0, actual_cost_cents: 0 };

  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title={X.extrasTitle} subtitle={`${project.code} · ${project.title}`}
        actions={<Link href={`/projectes/${id}/pressupostos`} className={btnSecondary}>← {T.projectQuotes}</Link>} />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="extras-economics">
        {[
          [X.summaryContract, contracted != null ? formatCents(contracted) : "—"],
          [X.summaryApproved, formatCents(Number(e0.approved_cents))],
          [X.summaryTotal, contracted != null ? formatCents(contracted + Number(e0.approved_cents)) : "—"],
          [X.summaryPending, formatCents(Number(e0.pending_cents))],
          [X.summaryInvoiced, formatCents(Number(e0.invoiced_cents))],
          [X.summaryCollected, formatCents(Number(e0.collected_cents))],
          [X.summaryCosts, `${formatCents(Number(e0.estimated_cost_cents))} / ${formatCents(Number(e0.actual_cost_cents))}`],
          [X.margin, formatCents(Number(e0.approved_cents) - Number(e0.actual_cost_cents || e0.estimated_cost_cents))],
        ].map(([k, v]) => <div key={k} className="rounded-xl border border-navy/10 bg-white p-3"><p className="text-xs text-muted">{k}</p><p className="text-lg font-semibold tabular-nums text-navy">{v}</p></div>)}
      </section>
      <p className="text-xs text-muted">ⓘ {X.approvedNotInvoiced} {X.summaryRejected}: {formatCents(Number(e0.rejected_cents))}</p>

      <Card title={X.newExtra}>
        <ActionForm action={createExtraAction} messages={messages} submitLabel={X.newExtra} className="grid gap-3 sm:grid-cols-6" submitClassName={btnGold}>
          <input type="hidden" name="projectId" value={id} />
          {optional.length > 0 && (
            <Field label={X.fromOptional} className="sm:col-span-6">
              <select name="sourceLineId" defaultValue="" className={inputCls}>
                <option value="">— {X.manualExtra} —</option>
                {optional.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </Field>
          )}
          <Field label={X.extraTitle} className="sm:col-span-2"><input name="title" required maxLength={300} className={inputCls} /></Field>
          <Field label={X.extraDescription} className="sm:col-span-2"><input name="description" maxLength={2000} className={inputCls} /></Field>
          <Field label={X.amount}><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
          <Field label={X.vat}><select name="vatRateBp" defaultValue={1000} className={inputCls}>{(rates ?? []).map((r) => <option key={r.rate_bp} value={r.rate_bp}>{formatRate(r.rate_bp)}</option>)}</select></Field>
          <Field label={T.conceptType} className="sm:col-span-2"><select name="conceptType" defaultValue="extra_constructiu" className={inputCls}>{(types ?? []).map((t) => <option key={t.code} value={t.code}>{L === "es" ? t.label_es : t.label_ca}</option>)}</select></Field>
        </ActionForm>
      </Card>

      {!extras?.length ? <Card><EmptyState>{X.noExtras}</EmptyState></Card> : extras.map((e) => {
        const costs = (e.project_extra_costs ?? []) as { id: string; supplier: string | null; description: string; amount_cents: number; cost_date: string }[];
        const ms = ((e.project_extra_milestones ?? []) as { id: string; position: number; concept: string; amount_cents: number; trigger_condition: string | null; billing_status: string }[]).sort((a, b) => a.position - b.position);
        const events = ((e.project_extra_events ?? []) as { id: string; from_status: string | null; to_status: string; event_date: string | null; note: string | null; created_at: string }[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
        const actual = costs.reduce((s, c) => s + Number(c.amount_cents), 0);
        const msSum = ms.reduce((s, m) => s + Number(m.amount_cents), 0);
        const editableMs = ["proposat", "pendent_aprovacio", "aprovat"].includes(e.status);
        return (
          <section key={e.id} className="space-y-3 rounded-xl border border-navy/10 bg-white p-4" data-testid="extra-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-navy"><span className="mr-2 rounded bg-navy px-2 py-0.5 font-mono text-xs text-white">{e.code}</span>{e.title}</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold tabular-nums">{formatCents(Number(e.amount_cents))}</span><span className="text-muted">+ {formatRate(e.vat_rate_bp)}</span>
                <Badge className={STATUS_CLS[e.status]}>{X.extraStatuses[e.status]}</Badge>
                {e.included_in_version_id && <Badge className="bg-slate-100 text-slate-600">{X.includedIn}</Badge>}
              </div>
            </div>
            {e.description && <p className="text-sm text-muted">{e.description}</p>}
            {e.accepted_on && <p className="text-xs text-emerald-800">✓ {X.extraStatuses.aprovat} {formatDate(e.accepted_on, L)} · {X.via[e.accepted_via ?? "direccio"]}</p>}
            {e.included_in_version_id && <p className="text-xs text-muted">{X.includedNote}</p>}

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted">{X.next}</p>
                {NEXT[e.status].map((s) => (
                  <ActionForm key={s} action={setExtraStatusAction} messages={messages} submitLabel={X.transitions[s]} className="space-y-2 rounded-lg border border-navy/10 p-2" submitClassName={s === "rebutjat" ? btnSecondary : btnGold}>
                    <input type="hidden" name="id" value={e.id} /><input type="hidden" name="projectId" value={id} /><input type="hidden" name="status" value={s} />
                    {(s === "aprovat" || s === "incorporat" || s === "executat" || s === "facturat" || s === "cobrat") && <input type="date" name="date" defaultValue={today} required={s === "aprovat"} className={inputCls} aria-label={X.date} />}
                    {s === "incorporat" && (
                      <>
                        <select name="annexDocumentId" defaultValue="" className={inputCls} aria-label={X.annex}>
                          <option value="">— {X.annex} —</option>
                          {(docs ?? []).map((d) => <option key={d.id} value={d.id}>{d.title} · v{d.version}</option>)}
                        </select>
                        {contract && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="contractId" value={contract.id} /> {X.contract}: {contract.title}</label>}
                        <p className="text-[11px] text-muted">{X.annexHelp}</p>
                      </>
                    )}
                    <input name="note" maxLength={1000} placeholder={X.note} required={s === "rebutjat"} className={inputCls} aria-label={X.note} />
                  </ActionForm>
                ))}
                <ActionForm action={markIncludedAction} messages={messages} submitLabel={e.included_in_version_id ? X.unmarkIncluded : X.markIncluded} className="space-y-2" submitClassName={btnSecondary}>
                  <input type="hidden" name="id" value={e.id} /><input type="hidden" name="projectId" value={id} />
                  {!e.included_in_version_id ? (
                    <select name="versionId" required className={inputCls} aria-label={X.includedIn}>
                      {(versions ?? []).map((v) => <option key={v.id} value={v.id}>{code(v)} v{v.version}</option>)}
                    </select>
                  ) : <input type="hidden" name="versionId" value="" />}
                </ActionForm>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted">{X.milestones} · {formatCents(msSum)} / {formatCents(Number(e.amount_cents))}</p>
                <ul className="space-y-1 text-sm">
                  {ms.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 border-b border-navy/5">
                      <span>{m.concept}{m.trigger_condition ? <span className="text-xs text-muted"> · {m.trigger_condition}</span> : null}</span>
                      <span className="flex items-center gap-2 tabular-nums">{formatCents(Number(m.amount_cents))}<Badge>{m.billing_status}</Badge>
                        {editableMs && <ActionForm action={deleteExtraMilestoneAction} messages={messages} submitLabel="✕" submitClassName="text-red-700 text-xs">
                          <input type="hidden" name="id" value={m.id} /><input type="hidden" name="projectId" value={id} />
                        </ActionForm>}
                      </span>
                    </li>
                  ))}
                </ul>
                {editableMs && (
                  <ActionForm action={addExtraMilestoneAction} messages={messages} submitLabel={X.addMilestone} className="grid grid-cols-2 gap-2" submitClassName={btnSecondary}>
                    <input type="hidden" name="extraId" value={e.id} /><input type="hidden" name="projectId" value={id} />
                    <input name="concept" required placeholder={X.concept} className={inputCls} aria-label={X.concept} />
                    <input name="amount" required inputMode="decimal" placeholder={X.amount} className={inputCls} aria-label={X.amount} />
                    <input name="trigger" placeholder={X.trigger} className={inputCls + " col-span-2"} aria-label={X.trigger} />
                  </ActionForm>
                )}
                <ActionForm action={updateExtraAction} messages={messages} submitLabel={T.confirm} className="grid grid-cols-2 items-end gap-2" submitClassName={btnSecondary}>
                  <input type="hidden" name="id" value={e.id} /><input type="hidden" name="projectId" value={id} />
                  <Field label={X.estimatedCost}><input name="estimatedCost" inputMode="decimal" defaultValue={e.estimated_cost_cents != null ? (Number(e.estimated_cost_cents) / 100).toFixed(2).replace(".", ",") : ""} className={inputCls} /></Field>
                </ActionForm>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted">{X.costs} · {formatCents(actual)} · {X.margin}: <span className="font-semibold text-navy">{formatCents(Number(e.amount_cents) - actual)}</span></p>
                <ul className="space-y-1 text-sm">
                  {costs.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 border-b border-navy/5">
                      <span>{c.description}{c.supplier ? <span className="text-xs text-muted"> · {c.supplier}</span> : null} <span className="text-xs text-muted">{formatDate(c.cost_date, L)}</span></span>
                      <span className="flex items-center gap-2 tabular-nums">{formatCents(Number(c.amount_cents))}
                        <ActionForm action={deleteExtraCostAction} messages={messages} submitLabel="✕" submitClassName="text-red-700 text-xs">
                          <input type="hidden" name="id" value={c.id} /><input type="hidden" name="projectId" value={id} />
                        </ActionForm>
                      </span>
                    </li>
                  ))}
                </ul>
                <ActionForm action={addExtraCostAction} messages={messages} submitLabel={X.addCost} className="grid grid-cols-2 gap-2" submitClassName={btnSecondary}>
                  <input type="hidden" name="extraId" value={e.id} /><input type="hidden" name="projectId" value={id} />
                  <input name="description" required placeholder={X.concept} className={inputCls} aria-label={X.concept} />
                  <input name="supplier" placeholder={X.supplier} className={inputCls} aria-label={X.supplier} />
                  <input name="amount" required inputMode="decimal" placeholder={X.amount} className={inputCls} aria-label={X.amount} />
                  <input type="date" name="date" required defaultValue={today} className={inputCls} aria-label={X.date} />
                </ActionForm>
              </div>
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-navy">{X.events} ({events.length})</summary>
              <ul className="mt-1 space-y-0.5 text-muted">
                {events.map((ev) => <li key={ev.id}>{formatDateTime(ev.created_at, L)} · {ev.from_status ? `${X.extraStatuses[ev.from_status]} → ` : ""}{X.extraStatuses[ev.to_status]}{ev.event_date ? ` (${formatDate(ev.event_date, L)})` : ""}{ev.note ? ` · ${ev.note}` : ""}</li>)}
              </ul>
            </details>
          </section>
        );
      })}
    </div>
  );
}
