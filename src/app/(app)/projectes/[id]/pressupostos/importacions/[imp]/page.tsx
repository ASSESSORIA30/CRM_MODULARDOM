// Pressupost pujat: original intacte, estat declarat, lectura IA i previsualització per validar i convertir.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { QuoteEditor } from "@/components/quotes/quote-editor";
import { Badge, Card, PageHeader, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import type { ImportPreview, ImportReading } from "@/lib/quotes/import-reading";
import { createClient } from "@/lib/supabase/server";
import { analyzeImportAction, discardImportAction, setDeclaredStatusAction } from "../../import-actions";

// La lectura d'un document llarg pot trigar uns minuts
export const maxDuration = 300;

export default async function ImportPage({ params }: { params: Promise<{ id: string; imp: string }> }) {
  const profile = await requireRole("direccio");
  const { id, imp } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(imp)) notFound();
  const supabase = await createClient();
  const { data: i } = await supabase.from("quote_imports")
    .select("id, title, status, declared_status, extraction, model, analyzed_at, created_at, quote_version_id, documents(id, title, storage_path, bucket_id, sha256, size_bytes, uploaded_by, created_at)")
    .eq("id", imp).eq("project_id", id).maybeSingle();
  if (!i) notFound();
  const L = profile.locale;
  const X = qx(L);
  const T = qt(L);
  const base = actionMessages(L);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  const doc = (Array.isArray(i.documents) ? i.documents[0] : i.documents) as { id: string; storage_path: string; bucket_id: string; sha256: string | null; size_bytes: number | null; created_at: string } | null;
  const [signed, { data: types }, { data: rates }] = await Promise.all([
    doc ? supabase.storage.from(doc.bucket_id).createSignedUrl(doc.storage_path, 3600) : Promise.resolve({ data: null }),
    supabase.from("concept_types").select("code, label_ca, label_es, default_vat_bp").eq("active", true).order("position"),
    supabase.from("vat_rates").select("rate_bp").eq("active", true).order("rate_bp"),
  ]);
  const url = signed.data?.signedUrl ?? null;
  const ext = (i.extraction ?? null) as { reading: ImportReading; preview: ImportPreview } | null;
  const open = i.status === "pujat" || i.status === "analitzat";
  const reading = ext?.reading;
  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title={i.title} subtitle={<><Badge>{X.importStatus[i.status]}</Badge> · {X.declared[i.declared_status]} · {formatDateTime(i.created_at, L)}</>}
        actions={<Link href={`/projectes/${id}/pressupostos`} className={btnSecondary}>← {T.projectQuotes}</Link>} />

      <Card title={X.original}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {url && <a href={url} target="_blank" rel="noopener" className={btnSecondary}>👁 {X.view}</a>}
          {url && <a href={`${url}&download=`} className={btnSecondary}>⬇ {X.download}</a>}
          <span className="break-all text-xs text-muted">{X.originalIntact} <span className="font-mono">{doc?.sha256 ?? "—"}</span></span>
        </div>
        {open && (
          <ActionForm action={setDeclaredStatusAction} messages={messages} submitLabel={T.confirm} className="mt-3 flex flex-wrap items-end gap-2" submitClassName={btnSecondary}>
            <input type="hidden" name="id" value={i.id} /><input type="hidden" name="projectId" value={id} />
            <label className="text-sm"><span className="mb-1 block font-medium text-navy">{X.declaredStatus}</span>
              <select name="declaredStatus" defaultValue={i.declared_status} className={inputCls}>
                {Object.entries(X.declared).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
          </ActionForm>
        )}
        {i.quote_version_id && <p className="mt-3 text-sm">✓ {X.convertedTo} <Link href={`/pressupostos/${i.quote_version_id}`} className="font-semibold text-navy underline">{T.open}</Link></p>}
      </Card>

      {open && (
        <Card title={X.analyze}>
          <p className="mb-3 text-sm text-muted">{X.analyzeHelp}</p>
          <div className="flex flex-wrap gap-2">
            <ActionForm action={analyzeImportAction} messages={messages} submitLabel={ext ? X.reanalyze : X.analyze} submitClassName={btnPrimary}>
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="projectId" value={id} />
            </ActionForm>
            <ActionForm action={discardImportAction} messages={messages} submitLabel={X.discard} submitClassName={btnSecondary}>
              <input type="hidden" name="id" value={i.id} /><input type="hidden" name="projectId" value={id} />
            </ActionForm>
          </div>
          {i.analyzed_at && <p className="mt-2 text-xs text-muted">{i.model} · {formatDateTime(i.analyzed_at, L)}</p>}
        </Card>
      )}

      {open && ext?.preview?.warnings?.length ? (
        <Card title={X.warnings}>
          <ul className="ml-5 list-disc text-sm text-amber-800" data-testid="import-warnings">{ext.preview.warnings.map((w, k) => <li key={k}>{w.message}</li>)}</ul>
        </Card>
      ) : null}

      {open && (
        <Card title={ext ? X.preview : X.manualEntry}>
          <QuoteEditor target={{ kind: "import", importId: i.id, projectId: id }} T={T} errors={messages.errors}
            conceptTypes={(types ?? []).map((c) => ({ code: c.code, label: L === "es" ? c.label_es : c.label_ca, defaultVatBp: c.default_vat_bp }))}
            vatRates={(rates ?? []).map((r) => r.rate_bp)}
            initial={{
              title: i.title, locale: "es", intro: "", notes: [reading?.validity, ...(reading?.conditions ?? [])].filter(Boolean).join("\n"),
              exclusions: (reading?.exclusions ?? []).join("\n"), paymentTerms: reading?.payment_terms ?? "",
              lines: ext?.preview?.lines ?? [],
            }} />
        </Card>
      )}
    </div>
  );
}
