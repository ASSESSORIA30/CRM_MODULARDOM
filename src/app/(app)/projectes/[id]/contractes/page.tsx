// Contractes d'un projecte (només direcció)
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, PageHeader, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { ct, qt } from "@/lib/i18n-pressupostos";
import { actionMessages } from "@/lib/messages";
import { formatCents } from "@/lib/money";
import { CONTRACT_STATUS_CLS } from "@/lib/contracts/status";
import { createClient } from "@/lib/supabase/server";
import { createContractAction } from "./actions";

export default async function ContractesProjecte({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const L = profile.locale;
  const T = ct(L);
  const Q = qt(L);
  const [{ data: contracts }, { data: docs }, { data: quotes }] = await Promise.all([
    supabase.from("contracts").select("id, title, status, total_cents, signed_date, validated_at, created_at").eq("project_id", id).order("created_at", { ascending: false }),
    supabase.from("documents").select("id, title, version, created_at").eq("project_id", id).eq("bucket_id", "contractes").neq("status", "arxivat").order("created_at", { ascending: false }),
    supabase.from("quotes").select("code, title, quote_versions(id, version, status)").eq("project_id", id),
  ]);
  const quoteOptions = (quotes ?? []).flatMap((q) => (q.quote_versions ?? []).filter((v) => v.status === "acceptat" || v.status === "enviat")
    .map((v) => ({ id: v.id, label: `${q.code} v${v.version} · ${Q.statuses[v.status]} · ${q.title}`, accepted: v.status === "acceptat" })));
  const base = actionMessages(L);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  return (
    <div className="max-w-6xl space-y-4">
      <PageHeader title={T.contracts} subtitle={`${project.code} · ${project.title}`}
        actions={<Link href={`/projectes/${id}`} className={btnSecondary}>← {project.code}</Link>} />
      <Card>
        {!contracts?.length ? <EmptyState>{T.none}</EmptyState> : (
          <ul className="divide-y divide-navy/5" data-testid="contract-list">
            {contracts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <Link href={`/projectes/${id}/contractes/${c.id}`} className="font-semibold text-navy hover:text-gold">{c.title}</Link>
                <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
                  {c.total_cents != null && <span className="tabular-nums">{formatCents(c.total_cents)}</span>}
                  {c.signed_date && <span>{T.signedDate}: {formatDate(c.signed_date, L)}</span>}
                  <Badge className={CONTRACT_STATUS_CLS[c.status]}>{T.statuses[c.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={T.newContract}>
        <p className="mb-3 text-sm text-muted">{T.newHelp}</p>
        {!docs?.length ? (
          <p className="text-sm">{T.noDocs} <Link href={`/projectes/${id}/documents`} className="font-semibold text-navy underline">{T.uploadFirst}</Link></p>
        ) : (
          <ActionForm action={createContractAction} messages={messages} submitLabel={T.create} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="projectId" value={id} />
            <Field label={T.document}>
              <select name="documentId" required className={inputCls}>
                {docs.map((d) => <option key={d.id} value={d.id}>{d.title} · v{d.version} · {formatDate(d.created_at, L)}</option>)}
              </select>
            </Field>
            <Field label={Q.quoteTitle}><input name="title" required maxLength={200} defaultValue={L === "es" ? "Contrato de ejecución de obra" : "Contracte d'execució d'obra"} className={inputCls} /></Field>
            <Field label={T.quote} className="sm:col-span-2">
              <select name="quoteVersionId" defaultValue={quoteOptions.find((o) => o.accepted)?.id ?? ""} className={inputCls}>
                <option value="">{T.noQuote}</option>
                {quoteOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>
          </ActionForm>
        )}
      </Card>
    </div>
  );
}
