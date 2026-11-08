// Una versió d'un pressupost: editor si és esborrany, vista congelada i accions si ja s'ha enviat.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { QuoteEditor } from "@/components/quotes/quote-editor";
import { Badge, Card, Field, PageHeader, btnGold, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { addMonths, formatDate, formatDateTime, madridDateKey } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { actionMessages } from "@/lib/messages";
import { centsToInput, formatCents } from "@/lib/money";
import { formatQuantity, formatRate, quoteTotals } from "@/lib/quotes/calc";
import { loadQuoteVersion } from "@/lib/quotes/load";
import { QUOTE_STATUS_CLS } from "@/lib/quotes/status";
import { createClient } from "@/lib/supabase/server";
import { archiveQuotePdfAction, duplicateQuoteAction, newVersionAction, outcomeQuoteAction, sendQuoteAction } from "../actions";

export default async function QuoteVersionPage({ params }: { params: Promise<{ versio: string }> }) {
  const profile = await requireRole("direccio");
  const { versio } = await params;
  if (!/^[0-9a-f-]{36}$/.test(versio)) notFound();
  const supabase = await createClient();
  const q = await loadQuoteVersion(supabase, versio);
  if (!q) notFound();
  const L = profile.locale;
  const T = qt(L);
  const base = actionMessages(L);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  const v = q.version;
  const isDraft = v.status === "esborrany";
  const hasDraft = q.versions.some((x) => x.status === "esborrany");
  const accepted = !!q.quote.accepted_version_id;

  const [{ data: types }, { data: rates }, { data: company }] = await Promise.all([
    supabase.from("concept_types").select("code, label_ca, label_es, default_vat_bp").eq("active", true).order("position"),
    supabase.from("vat_rates").select("rate_bp").eq("active", true).order("rate_bp"),
    supabase.from("company_settings").select("quote_validity_months").maybeSingle(),
  ]);
  const today = madridDateKey();
  const totals = quoteTotals(q.lines);

  return (
    <div className="max-w-7xl space-y-5">
      <PageHeader
        title={`${q.quote.code} · ${q.quote.title}`}
        subtitle={<>
          <Link href={`/projectes/${q.project.id}/pressupostos`} className="hover:text-gold">{q.project.code} · {q.project.title}</Link>
          {" · "}{T.version} {v.version} · <Badge className={QUOTE_STATUS_CLS[v.status]}>{T.statuses[v.status]}</Badge>
          {v.source !== "manual" && <> · {T.sources[v.source]}</>}
        </>}
        actions={<a href={`/pressupostos/${v.id}/pdf`} target="_blank" rel="noopener" className={btnSecondary} data-testid="pdf-link">⬇ {T.downloadPdf}</a>}
      />

      <nav className="flex flex-wrap gap-2 text-sm" aria-label={T.versions}>
        {q.versions.map((x) => (
          <Link key={x.id} href={`/pressupostos/${x.id}`}
            className={`rounded-full border px-3 py-1 ${x.id === v.id ? "border-navy bg-navy text-white" : "border-navy/15 bg-white text-navy hover:border-gold"}`}>
            v{x.version} · {T.statuses[x.status]}
          </Link>
        ))}
      </nav>

      {isDraft ? (
        <>
          <QuoteEditor versionId={v.id} T={T} errors={messages.errors}
            conceptTypes={(types ?? []).map((c) => ({ code: c.code, label: L === "es" ? c.label_es : c.label_ca, defaultVatBp: c.default_vat_bp }))}
            vatRates={(rates ?? []).map((r) => r.rate_bp)}
            initial={{
              locale: v.locale as "ca" | "es", intro: v.intro ?? "", notes: v.notes ?? "",
              lines: q.lines.map((l) => ({
                chapter: l.chapter, kind: l.kind, conceptType: l.conceptType, description: l.description,
                quantity: formatQuantity(l.quantityMilli).replace(/\./g, ""), unit: l.unit,
                unitPrice: centsToInput(Math.abs(l.unitPriceCents)), discount: l.discountBp ? String(l.discountBp / 100).replace(".", ",") : "",
                vatRateBp: l.vatRateBp,
              })),
            }} />
          <Card title={T.send}>
            <p className="mb-3 text-sm text-muted">{T.sendHelp}</p>
            <ActionForm action={sendQuoteAction} messages={messages} submitLabel={T.send} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="versionId" value={v.id} />
              <Field label={T.issueDate}><input type="date" name="issueDate" defaultValue={today} required className={inputCls} /></Field>
              <Field label={T.validUntil}><input type="date" name="validUntil" defaultValue={addMonths(today, company?.quote_validity_months ?? 1)} required className={inputCls} /></Field>
            </ActionForm>
            <p className="mt-3 text-xs text-muted">{T.emailNote}</p>
          </Card>
        </>
      ) : (
        <>
          <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">🔒 {accepted && v.status === "acceptat" ? T.acceptedNote : T.locked}
            {v.sent_at && <> · {T.issued}: {formatDate(v.issue_date, L)} · {T.validUntil}: {formatDate(v.valid_until, L)}</>}
            {v.accepted_on && <> · {T.statuses.acceptat}: {formatDate(v.accepted_on, L)}</>}
          </p>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm" data-testid="quote-readonly">
                <thead className="text-left text-xs text-muted">
                  <tr><th className="p-2">{T.kind}</th><th className="p-2">{T.description}</th><th className="p-2 text-right">{T.quantity}</th>
                    <th className="p-2 text-right">{T.unitPrice}</th><th className="p-2 text-right">{T.vatRate}</th><th className="p-2 text-right">{T.amount}</th></tr>
                </thead>
                <tbody>
                  {q.lines.map((l, i) => (
                    <tr key={i} className="border-t border-navy/5">
                      <td className="p-2 text-xs text-muted">{T.kinds[l.kind]}{l.chapter ? ` · ${l.chapter}` : ""}</td>
                      <td className="p-2">{l.description}</td>
                      <td className="p-2 text-right tabular-nums">{formatQuantity(l.quantityMilli, L)} {l.unit}</td>
                      <td className="p-2 text-right tabular-nums">{formatCents(l.unitPriceCents)}{l.discountBp ? ` −${formatRate(l.discountBp)}` : ""}</td>
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
            </dl>
          </Card>

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
            <Card title={T.downloadPdf}>
              {v.pdf_document_id
                ? <p className="text-sm text-emerald-700">✓ {T.pdfArchived}</p>
                : <ActionForm action={archiveQuotePdfAction} messages={{ ...messages, saved: T.pdfArchived }} submitLabel={T.archivePdf} submitClassName={btnSecondary}>
                    <input type="hidden" name="versionId" value={v.id} />
                  </ActionForm>}
              <p className="mt-3 text-xs text-muted">{T.emailNote}</p>
            </Card>
            {!accepted && !hasDraft && (
              <Card title={T.newVersion}>
                <ActionForm action={newVersionAction} messages={messages} submitLabel={T.newVersion} submitClassName={btnSecondary}>
                  <input type="hidden" name="quoteId" value={q.quote.id} />
                </ActionForm>
              </Card>
            )}
          </div>
        </>
      )}

      <Card title={T.duplicate}>
        <ActionForm action={duplicateQuoteAction} messages={messages} submitLabel={T.duplicate} className="flex flex-wrap items-end gap-3" submitClassName={btnSecondary}>
          <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="projectId" value={q.project.id} />
          <Field label={T.duplicateTitle} className="min-w-64 flex-1"><input name="title" defaultValue={q.quote.title} required className={inputCls} /></Field>
        </ActionForm>
      </Card>
      <p className="text-xs text-muted">{formatDateTime(v.created_at, L)}</p>
    </div>
  );
}
