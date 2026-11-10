// Revisió d'un contracte: lectura amb IA, dades, discrepàncies, fites i validació de direcció.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { MilestoneReview } from "@/components/contracts/milestone-review";
import { Badge, Card, Field, PageHeader, btnGold, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { CONTRACT_STATUS_CLS } from "@/lib/contracts/status";
import { formatDateTime } from "@/lib/dates";
import { ct } from "@/lib/i18n-pressupostos";
import { actionMessages } from "@/lib/messages";
import { centsToInput, formatCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import {
  applyDefaultVatAction, confirmAllAction, readContractAction, resolveDiscrepancyAction, startManualAction, updateContractAction, validateContractAction,
} from "../actions";

// La lectura d'un contracte llarg pot trigar uns minuts (límit del pla de Vercel)
export const maxDuration = 300;

type Loc = { text: string; page: number | null } | null;
const SEV_CLS: Record<string, string> = { alta: "bg-red-100 text-red-800", mitjana: "bg-amber-100 text-amber-800", baixa: "bg-slate-100 text-slate-700" };

export default async function ContractePage({ params }: { params: Promise<{ id: string; contracte: string }> }) {
  const profile = await requireRole("direccio");
  const { id, contracte } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(contracte)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("contracts")
    .select("id, project_id, title, status, total_cents, document_date, signed_date, data, validated_at, quote_version_id, documents(id, title, bucket_id, storage_path)")
    .eq("id", contracte).eq("project_id", id).maybeSingle();
  if (!c) notFound();
  const L = profile.locale;
  const T = ct(L);
  const base = actionMessages(L);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  const doc = (Array.isArray(c.documents) ? c.documents[0] : c.documents) as { id: string; title: string; bucket_id: string; storage_path: string } | null;

  const [{ data: project }, { data: ms }, { data: disc }, { data: exts }, { data: rates }, { data: types }, signed] = await Promise.all([
    supabase.from("projects").select("code, title").eq("id", id).single(),
    supabase.from("contract_milestones").select("id, position, code, phase, concept, amount_cents, vat_rate_bp, concept_type, trigger_condition, is_extra, source_page, source_text, origin, confirmed, billing_status")
      .eq("contract_id", c.id).order("position"),
    supabase.from("contract_discrepancies").select("id, kind, severity, message, expected_cents, found_cents, refs, status, resolution, resolved_at").eq("contract_id", c.id).order("created_at"),
    supabase.from("contract_extractions").select("version, provider, model, pages, created_at").eq("contract_id", c.id).order("version", { ascending: false }),
    supabase.from("vat_rates").select("rate_bp").eq("active", true).order("rate_bp"),
    supabase.from("concept_types").select("code, label_ca, label_es").eq("active", true).order("position"),
    doc ? supabase.storage.from(doc.bucket_id).createSignedUrl(doc.storage_path, 3600) : Promise.resolve({ data: null }),
  ]);
  const docUrl = signed.data?.signedUrl ?? null;
  const locked = c.status === "validat" || c.status === "substituit";
  const data = (c.data ?? {}) as Record<string, unknown>;
  const loc = (k: string) => data[k] as Loc;
  const locList = (k: string) => (Array.isArray(data[k]) ? (data[k] as NonNullable<Loc>[]) : []);
  const pageLink = (p: number | null | undefined) => (p && docUrl ? <a href={`${docUrl}#page=${p}`} target="_blank" rel="noopener" className="ml-1 text-xs font-semibold text-navy underline">{T.page} {p}</a> : null);
  const open = (disc ?? []).filter((d) => d.status === "oberta");

  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader title={c.title}
        subtitle={<><Link href={`/projectes/${id}/contractes`} className="hover:text-gold">{project?.code} · {project?.title}</Link> · <Badge className={CONTRACT_STATUS_CLS[c.status]}>{T.statuses[c.status]}</Badge></>}
        actions={docUrl ? <a href={docUrl} target="_blank" rel="noopener" className={btnSecondary}>📄 {T.openDoc}</a> : undefined} />

      {locked && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800" data-testid="contract-validated">🔒 {T.validated}{c.validated_at ? ` · ${formatDateTime(c.validated_at, L)}` : ""}</p>}

      {!locked && (
        <Card title={T.extraction}>
          <p className="mb-3 text-sm text-muted">{T.aiHelp}</p>
          <div className="flex flex-wrap items-start gap-3">
            <ActionForm action={readContractAction} messages={messages} submitLabel={exts?.length ? T.reread : T.read} submitClassName={btnPrimary} className="space-y-2">
              <input type="hidden" name="contractId" value={c.id} />
              {!!exts?.length && <p className="max-w-md text-xs text-amber-700">{T.rereadWarn}</p>}
            </ActionForm>
            {c.status === "pendent_lectura" && (
              <ActionForm action={startManualAction} messages={messages} submitLabel={T.manual} submitClassName={btnSecondary}>
                <input type="hidden" name="contractId" value={c.id} />
              </ActionForm>
            )}
          </div>
          {!!exts?.length && (
            <p className="mt-3 text-xs text-muted">{T.history}: {exts.map((e) => `v${e.version} · ${e.provider === "manual" ? T.manual : e.model} · ${formatDateTime(e.created_at, L)}${e.pages ? ` · ${e.pages} p.` : ""}`).join(" | ")}</p>
          )}
        </Card>
      )}

      {c.status !== "pendent_lectura" && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={T.data}>
              <ActionForm action={updateContractAction} messages={messages} submitLabel={T.save} className="grid gap-3 sm:grid-cols-3" submitClassName={locked ? "hidden" : btnSecondary}>
                <input type="hidden" name="contractId" value={c.id} />
                <Field label={T.total}><input name="total" disabled={locked} defaultValue={centsToInput(c.total_cents)} inputMode="decimal" className={inputCls} /></Field>
                <Field label={T.documentDate}><input type="date" name="documentDate" disabled={locked} defaultValue={c.document_date ?? ""} className={inputCls} /></Field>
                <Field label={T.signedDate}><input type="date" name="signedDate" disabled={locked} defaultValue={c.signed_date ?? ""} className={inputCls} /></Field>
              </ActionForm>
              <dl className="mt-4 space-y-2 text-sm">
                {Array.isArray(data.holders) && (data.holders as { name: string; tax_id: string | null; page: number | null }[]).length > 0 && (
                  <div><dt className="text-xs font-semibold text-muted">{T.holders}</dt>
                    <dd>{(data.holders as { name: string; tax_id: string | null; page: number | null }[]).map((h, k) => <span key={k} className="mr-3">{h.name}{h.tax_id ? ` (${h.tax_id})` : ""}{pageLink(h.page)}</span>)}</dd></div>
                )}
                {(data.contractor as { name: string; page: number | null } | null)?.name && (
                  <div><dt className="text-xs font-semibold text-muted">{T.contractor}</dt><dd>{(data.contractor as { name: string }).name}{pageLink((data.contractor as { page: number | null }).page)}</dd></div>
                )}
                {([["site_address", T.siteAddress], ["cadastral_ref", T.cadastral], ["vat_clause", T.vatClause], ["payment_terms", T.paymentTerms], ["later_extras_rule", T.laterExtras]] as const).map(([k, label]) => loc(k)?.text ? (
                  <div key={k}><dt className="text-xs font-semibold text-muted">{label}</dt><dd>{loc(k)!.text}{pageLink(loc(k)!.page)}</dd></div>
                ) : null)}
                {([["deadlines", T.deadlines], ["special_conditions", T.special], ["modifications", T.modifications]] as const).map(([k, label]) => locList(k).length ? (
                  <div key={k}><dt className="text-xs font-semibold text-muted">{label}</dt>
                    <dd><ul className="ml-4 list-disc">{locList(k).map((x, i) => <li key={i}>{x.text}{pageLink(x.page)}</li>)}</ul></dd></div>
                ) : null)}
              </dl>
            </Card>

            <Card title={`${T.discrepancies} (${open.length})`}>
              {!disc?.length ? <p className="text-sm text-muted">{T.noDiscrepancies}</p> : (
                <ul className="space-y-3" data-testid="discrepancies">
                  {disc.map((d) => {
                    const refs = Array.isArray(d.refs) ? (d.refs as { page?: number | null; code?: string | null }[]) : [];
                    return (
                      <li key={d.id} className={`rounded-lg border p-3 text-sm ${d.status === "oberta" ? "border-amber-300 bg-amber-50/50" : "border-navy/10 bg-white opacity-80"}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={SEV_CLS[d.severity]}>{T.severity[d.severity]}</Badge>
                          <Badge>{T.dStatus[d.status]}</Badge>
                          {refs.map((r, k) => <span key={k} className="text-xs">{r.code}{pageLink(r.page)}</span>)}
                        </div>
                        <p className="mt-1">{d.message}</p>
                        {d.expected_cents != null && d.found_cents != null && (
                          <p className="text-xs text-muted">{formatCents(d.expected_cents)} ↔ {formatCents(d.found_cents)}</p>
                        )}
                        {d.resolution && <p className="mt-1 text-xs text-emerald-800">✓ {d.resolution}</p>}
                        {d.status === "oberta" && !locked && (
                          <ActionForm action={resolveDiscrepancyAction} messages={messages} submitLabel={T.markResolved} className="mt-2 flex flex-wrap items-end gap-2" submitClassName={btnSecondary}>
                            <input type="hidden" name="id" value={d.id} />
                            <Field label={T.resolution} className="min-w-60 flex-1"><input name="resolution" required maxLength={1000} className={inputCls} /></Field>
                            <select name="status" defaultValue="resolta" aria-label={T.dStatus.oberta} className={inputCls + " w-auto"}>
                              <option value="resolta">{T.markResolved}</option><option value="acceptada">{T.markAccepted}</option><option value="ignorada">{T.markIgnored}</option>
                            </select>
                          </ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          <Card title={T.milestones}>
            <p className="mb-3 text-sm text-muted">{T.milestonesHelp}</p>
            {!locked && (
              <div className="mb-3 flex flex-wrap gap-2">
                <ActionForm action={applyDefaultVatAction} messages={messages} submitLabel={T.applyVat} submitClassName={btnSecondary} className="contents">
                  <input type="hidden" name="contractId" value={c.id} />
                </ActionForm>
                <ActionForm action={confirmAllAction} messages={messages} submitLabel={T.confirmAll} submitClassName={btnSecondary} className="contents">
                  <input type="hidden" name="contractId" value={c.id} />
                </ActionForm>
              </div>
            )}
            <MilestoneReview contractId={c.id} locked={locked} totalCents={c.total_cents} T={T} errors={messages.errors} docUrl={docUrl}
              vatRates={(rates ?? []).map((r) => r.rate_bp)}
              conceptTypes={(types ?? []).map((t) => ({ code: t.code, label: L === "es" ? t.label_es : t.label_ca }))}
              milestones={(ms ?? []).map((m) => ({
                id: m.id, position: m.position, code: m.code, phase: m.phase, concept: m.concept, amountCents: Number(m.amount_cents),
                vatRateBp: m.vat_rate_bp, conceptType: m.concept_type, triggerCondition: m.trigger_condition, isExtra: m.is_extra,
                sourcePage: m.source_page, sourceText: m.source_text, origin: m.origin, confirmed: m.confirmed, billingStatus: m.billing_status,
              }))} />
          </Card>

          {!locked && (
            <Card title={T.validate}>
              <p className="mb-3 text-sm text-muted">{T.validateHelp}</p>
              <ActionForm action={validateContractAction} messages={messages} submitLabel={T.validate} submitClassName={btnGold}>
                <input type="hidden" name="contractId" value={c.id} />
              </ActionForm>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
