// Una versió d'un pressupost: editor si és esborrany, vista congelada i accions si ja s'ha enviat.
// Direcció ho gestiona tot; l'arquitecte assignat prepara esborranys (l'RLS limita què veu cadascú).
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { QuoteEditor } from "@/components/quotes/quote-editor";
import { Badge, Card, Field, PageHeader, btnGold, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addMonths, formatDate, formatDateTime, madridDateKey } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import { centsToInput, formatCents } from "@/lib/money";
import { formatQuantity, formatRate, quoteTotals } from "@/lib/quotes/calc";
import { loadQuoteVersion } from "@/lib/quotes/load";
import { QUOTE_STATUS_CLS } from "@/lib/quotes/status";
import { createClient } from "@/lib/supabase/server";
import {
  archiveQuotePdfAction, duplicateQuoteAction, newVersionAction, outcomeQuoteAction, publishQuoteAction, sendQuoteAction, setCurrentQuoteAction,
} from "../actions";

const LINE_STATUS_CLS: Record<string, string> = { inclosa: "", opcional: "bg-sky-50", pendent_valoracio: "bg-amber-50", exclosa: "bg-slate-50 text-muted line-through" };

export default async function QuoteVersionPage({ params }: { params: Promise<{ versio: string }> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const { versio } = await params;
  if (!/^[0-9a-f-]{36}$/.test(versio)) notFound();
  const supabase = await createClient();
  const q = await loadQuoteVersion(supabase, versio);
  if (!q) notFound();
  const L = profile.locale;
  const T = qt(L);
  const X = qx(L);
  const isDir = profile.role === "direccio";
  const base = actionMessages(L);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  const v = q.version;
  const isDraft = v.status === "esborrany";
  const hasDraft = q.versions.some((x) => x.status === "esborrany");
  const accepted = !!q.quote.accepted_version_id;

  const [{ data: types }, { data: rates }, { data: tariff }, { data: creator }] = await Promise.all([
    supabase.from("concept_types").select("code, label_ca, label_es, default_vat_bp").eq("active", true).order("position"),
    supabase.from("vat_rates").select("rate_bp").eq("active", true).order("rate_bp"),
    v.tariff_version_id ? supabase.from("tariff_versions").select("number, effective_from").eq("id", v.tariff_version_id).maybeSingle() : Promise.resolve({ data: null }),
    v.created_by ? supabase.from("profiles").select("full_name").eq("id", v.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const validityMonths = isDir ? (await supabase.from("company_settings").select("quote_validity_months").maybeSingle()).data?.quote_validity_months ?? 1 : 1;
  const today = madridDateKey();
  const totals = quoteTotals(q.lines);
  const overrides = q.lines.filter((l) => l.priceOverridden).length;
  const other = q.versions.find((x) => x.id !== v.id);

  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader
        title={`${q.quote.code} · ${q.quote.title}`}
        subtitle={<>
          <Link href={`/projectes/${q.project.id}/pressupostos`} className="hover:text-gold">{q.project.code} · {q.project.title}</Link>
          {" · "}{T.version} {v.version} · <Badge className={QUOTE_STATUS_CLS[v.status]}>{T.statuses[v.status]}</Badge>
          {v.is_current && <> · <Badge className="bg-gold-light text-navy">★ {X.current}</Badge></>}
          {v.status !== "esborrany" && <> · <Badge className={v.published_to_client ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>{v.published_to_client ? X.published : X.notPublished}</Badge></>}
        </>}
        actions={<div className="flex flex-wrap gap-2">
          {other && <Link href={`/pressupostos/${v.id}/comparar?amb=${other.id}`} className={btnSecondary} data-testid="compare-link">⇄ {X.compare}</Link>}
          <a href={`/pressupostos/${v.id}/pdf`} target="_blank" rel="noopener" className={btnSecondary} data-testid="pdf-link">⬇ {T.downloadPdf}</a>
        </div>}
      />

      <nav className="flex flex-wrap gap-2 text-sm" aria-label={T.versions}>
        {q.versions.map((x) => (
          <Link key={x.id} href={`/pressupostos/${x.id}`}
            className={`rounded-full border px-3 py-1 ${x.id === v.id ? "border-navy bg-navy text-white" : "border-navy/15 bg-white text-navy hover:border-gold"}`}>
            v{x.version} · {T.statuses[x.status]}{x.is_current ? " ★" : ""}
          </Link>
        ))}
      </nav>

      <p className="text-xs text-muted">
        {X.createdBy}: {creator?.full_name ?? "—"} · {formatDateTime(v.created_at, L)}
        {v.source !== "manual" && <> · {T.sources[v.source]}</>}
        {tariff && <> · {X.fromConfigurator} {tariff.number} ({X.effectiveFrom} {formatDate(tariff.effective_from, L)})</>}
        {v.origin_import_id && <> · <Link href={`/projectes/${q.project.id}/pressupostos/importacions/${v.origin_import_id}`} className="underline">{X.fromImport}</Link></>}
        {v.client_decision && <> · {X.clientDecision}: {T.statuses[v.client_decision]} ({formatDateTime(v.client_decided_at!, L)})</>}
        {overrides > 0 && <> · <span className="font-semibold text-amber-700">✎ {X.priceOverrides.replace("{n}", String(overrides))}</span></>}
      </p>

      {isDraft ? (
        <>
          <QuoteEditor target={{ kind: "draft", versionId: v.id }} T={T} errors={messages.errors} canOverridePrices={isDir}
            conceptTypes={(types ?? []).map((c) => ({ code: c.code, label: L === "es" ? c.label_es : c.label_ca, defaultVatBp: c.default_vat_bp }))}
            vatRates={(rates ?? []).map((r) => r.rate_bp)}
            initial={{
              locale: v.locale as "ca" | "es", intro: v.intro ?? "", notes: v.notes ?? "", exclusions: v.exclusions ?? "", paymentTerms: v.payment_terms ?? "",
              lines: q.lines.map((l) => ({
                chapter: l.chapter, kind: l.kind, status: l.status, conceptType: l.conceptType, description: l.description,
                quantity: formatQuantity(l.quantityMilli).replace(/\./g, ""), unit: l.unit,
                unitPrice: centsToInput(Math.abs(l.unitPriceCents)), discount: l.discountBp ? String(l.discountBp / 100).replace(".", ",") : "",
                vatRateBp: l.vatRateBp, catalogKey: l.catalogKey, catalogUnitPriceCents: l.catalogUnitPriceCents, needsReview: l.needsReview,
                sourceRef: l.sourceRef, constructorVisible: l.constructorVisible,
              })),
            }} />
          {isDir && (
            <Card title={T.send}>
              <p className="mb-3 text-sm text-muted">{T.sendHelp}</p>
              <ActionForm action={sendQuoteAction} messages={messages} submitLabel={T.send} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <input type="hidden" name="versionId" value={v.id} />
                <Field label={T.issueDate}><input type="date" name="issueDate" defaultValue={today} required className={inputCls} /></Field>
                <Field label={T.validUntil}><input type="date" name="validUntil" defaultValue={addMonths(today, validityMonths)} required className={inputCls} /></Field>
              </ActionForm>
              <p className="mt-3 text-xs text-muted">{T.emailNote}</p>
            </Card>
          )}
        </>
      ) : (
        <>
          <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">🔒 {accepted && v.status === "acceptat" ? T.acceptedNote : T.locked}
            {v.sent_at && <> · {T.issued}: {formatDate(v.issue_date, L)} · {T.validUntil}: {formatDate(v.valid_until, L)}</>}
            {v.accepted_on && <> · {T.statuses.acceptat}: {formatDate(v.accepted_on, L)}</>}
          </p>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-testid="quote-readonly">
                <thead className="text-left text-xs text-muted">
                  <tr><th className="p-2">{T.kind}</th><th className="p-2">{T.description}</th><th className="p-2 text-right">{T.quantity}</th>
                    <th className="p-2 text-right">{T.unitPrice}</th><th className="p-2 text-right">{T.vatRate}</th><th className="p-2 text-right">{T.amount}</th></tr>
                </thead>
                <tbody>
                  {q.lines.map((l, i) => (
                    <tr key={i} className={`border-t border-navy/5 ${LINE_STATUS_CLS[l.status]}`}>
                      <td className="p-2 text-xs text-muted">{T.kinds[l.kind]}{l.chapter ? ` · ${l.chapter}` : ""}{l.status !== "inclosa" ? ` · ${T.lineStatuses[l.status]}` : ""}</td>
                      <td className="p-2">{l.description}</td>
                      <td className="p-2 text-right tabular-nums">{formatQuantity(l.quantityMilli, L)} {l.unit}</td>
                      <td className="p-2 text-right tabular-nums">{formatCents(l.unitPriceCents)}{l.discountBp ? ` −${formatRate(l.discountBp)}` : ""}{l.priceOverridden ? " ✎" : ""}</td>
                      <td className="p-2 text-right">{formatRate(l.vatRateBp)}</td>
                      <td className="p-2 text-right font-medium tabular-nums">{formatCents(l.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto mt-4 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
              <dt>{T.base}</dt><dd className="text-right">{formatCents(totals.baseCents)}</dd>
              <dt>{T.extrasInitial}</dt><dd className="text-right">{formatCents(totals.extrasInitialCents)}</dd>
              {totals.discountCents !== 0 && <><dt>{T.discounts}</dt><dd className="text-right">{formatCents(totals.discountCents)}</dd></>}
              <dt className="font-semibold text-navy">{T.taxable}</dt><dd className="text-right font-semibold text-navy">{formatCents(totals.taxableCents)}</dd>
              {totals.vatBreakdown.map((r) => [
                <dt key={`a${r.rateBp}`} className="text-muted">{T.vat} {formatRate(r.rateBp)}</dt>,
                <dd key={`b${r.rateBp}`} className="text-right">{formatCents(r.vatCents)}</dd>,
              ])}
              <dt className="font-semibold text-navy">{T.totalWithVat}</dt><dd className="text-right font-semibold text-navy">{formatCents(totals.totalCents)}</dd>
              {totals.optionalCents > 0 && <><dt className="text-sky-800">{T.optionalNotIncluded}</dt><dd className="text-right text-sky-800">{formatCents(totals.optionalCents)}</dd></>}
            </dl>
            {(v.exclusions || v.payment_terms || v.notes) && (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                {v.notes && <div><dt className="text-xs font-semibold text-muted">{T.notes}</dt><dd className="whitespace-pre-wrap">{v.notes}</dd></div>}
                {v.exclusions && <div><dt className="text-xs font-semibold text-muted">{T.exclusions}</dt><dd className="whitespace-pre-wrap">{v.exclusions}</dd></div>}
                {v.payment_terms && <div><dt className="text-xs font-semibold text-muted">{T.paymentTerms}</dt><dd className="whitespace-pre-wrap">{v.payment_terms}</dd></div>}
              </dl>
            )}
          </Card>

          {isDir && (
            <div className="grid gap-4 lg:grid-cols-2">
              {v.status === "enviat" && (
                <Card title={T.accept}>
                  <ActionForm action={outcomeQuoteAction} messages={messages} submitLabel={T.accept} className="flex flex-wrap items-end gap-3" submitClassName={btnGold}>
                    <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="outcome" value="acceptat" />
                    <Field label={T.acceptedOn}><input type="date" name="date" defaultValue={today} required className={inputCls} /></Field>
                  </ActionForm>
                  <ActionForm action={outcomeQuoteAction} messages={messages} submitLabel={T.reject} className="mt-3" submitClassName={btnSecondary}>
                    <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="outcome" value="rebutjat" />
                  </ActionForm>
                </Card>
              )}
              <Card title={X.publish}>
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={publishQuoteAction} messages={messages} submitLabel={v.published_to_client ? X.unpublish : X.publish} submitClassName={v.published_to_client ? btnSecondary : btnGold}>
                    <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="published" value={v.published_to_client ? "0" : "1"} />
                  </ActionForm>
                  {!v.is_current && v.status !== "rebutjat" && (
                    <ActionForm action={setCurrentQuoteAction} messages={messages} submitLabel={X.setCurrent} submitClassName={btnSecondary}>
                      <input type="hidden" name="versionId" value={v.id} />
                    </ActionForm>
                  )}
                </div>
              </Card>
              <Card title={T.downloadPdf}>
                {v.pdf_document_id
                  ? <p className="text-sm text-emerald-700">✓ {T.pdfArchived}</p>
                  : <ActionForm action={archiveQuotePdfAction} messages={{ ...messages, saved: T.pdfArchived }} submitLabel={T.archivePdf} submitClassName={btnSecondary}>
                      <input type="hidden" name="versionId" value={v.id} />
                    </ActionForm>}
                <p className="mt-3 text-xs text-muted">{T.emailNote}</p>
              </Card>
            </div>
          )}
          {!accepted && !hasDraft && (
            <Card title={T.newVersion}>
              <ActionForm action={newVersionAction} messages={messages} submitLabel={T.newVersion} submitClassName={btnSecondary}>
                <input type="hidden" name="quoteId" value={q.quote.id} />
              </ActionForm>
            </Card>
          )}
        </>
      )}

      <Card title={T.duplicate}>
        <ActionForm action={duplicateQuoteAction} messages={messages} submitLabel={T.duplicate} className="flex flex-wrap items-end gap-3" submitClassName={btnSecondary}>
          <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="projectId" value={q.project.id} />
          <Field label={T.duplicateTitle} className="min-w-64 flex-1"><input name="title" defaultValue={q.quote.title} required className={inputCls} /></Field>
        </ActionForm>
      </Card>
    </div>
  );
}
