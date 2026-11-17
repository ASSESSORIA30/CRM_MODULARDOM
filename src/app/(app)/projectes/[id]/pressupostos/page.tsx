// Pressupostos d'un projecte: crear amb el configurador, pujar un pressupost extern, llistat i importacions.
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { QuoteTable } from "@/components/quotes/quote-table";
import { Badge, Card, Field, PageHeader, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import { listQuotes } from "@/lib/quotes/list";
import { createClient } from "@/lib/supabase/server";
import { createQuoteAction } from "@/app/(app)/pressupostos/actions";

export default async function PressupostosProjecte({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const L = profile.locale;
  const T = qt(L);
  const X = qx(L);
  const isDir = profile.role === "direccio";
  const [rows, { data: imports }] = await Promise.all([
    listQuotes(supabase, id),
    supabase.from("quote_imports").select("id, title, status, declared_status, created_at, quote_version_id").eq("project_id", id).order("created_at", { ascending: false }),
  ]);
  const big = "flex flex-col gap-1 rounded-xl border-2 border-navy/10 bg-white p-5 transition hover:border-gold hover:shadow-sm";
  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title={T.projectQuotes} subtitle={`${project.code} · ${project.title}`}
        actions={<div className="flex flex-wrap gap-2">
          {isDir && <Link href={`/projectes/${id}/extres`} className={btnSecondary}>➕ {X.extras}</Link>}
          <Link href={`/projectes/${id}`} className={btnSecondary}>← {project.code}</Link>
        </div>} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Link href={`/projectes/${id}/pressupostos/configurador`} className={big} data-testid="create-quote">
          <span className="text-lg font-semibold text-navy">🧮 {X.createQuote}</span><span className="text-sm text-muted">{X.createHelp}</span>
        </Link>
        {isDir ? (
          <Link href={`/projectes/${id}/pressupostos/pujar`} className={big} data-testid="upload-quote">
            <span className="text-lg font-semibold text-navy">📤 {X.uploadQuote}</span><span className="text-sm text-muted">{X.uploadHelp}</span>
          </Link>
        ) : <div />}
      </div>
      <Card><QuoteTable rows={rows} T={T} L={L} showProject={false} /></Card>
      {!!imports?.length && (
        <Card title={X.imports}>
          <ul className="divide-y divide-navy/5 text-sm">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/projectes/${id}/pressupostos/importacions/${i.id}`} className="font-semibold text-navy hover:text-gold">{i.title}</Link>
                <span className="flex items-center gap-2 text-muted">
                  {X.declared[i.declared_status]} · {formatDateTime(i.created_at, L)} <Badge>{X.importStatus[i.status]}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <details className="rounded-xl border border-navy/10 bg-white p-4">
        <summary className="cursor-pointer font-semibold text-navy">{X.blankQuote}</summary>
        <ActionForm action={createQuoteAction} messages={actionMessages(L)} submitLabel={T.create} className="mt-3 grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <input type="hidden" name="projectId" value={id} />
          <Field label={T.quoteTitle}><input name="title" required maxLength={200} placeholder={T.quoteTitlePh} className={inputCls} /></Field>
          <Field label={T.docLocale}>
            <select name="locale" defaultValue="es" className={inputCls}><option value="es">Castellano</option><option value="ca">Català</option></select>
          </Field>
        </ActionForm>
      </details>
    </div>
  );
}
