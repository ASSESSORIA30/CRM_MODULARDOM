import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { QuoteTable } from "@/components/quotes/quote-table";
import { Card, Field, PageHeader, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { qt } from "@/lib/i18n-pressupostos";
import { actionMessages } from "@/lib/messages";
import { listQuotes } from "@/lib/quotes/list";
import { createClient } from "@/lib/supabase/server";
import { createQuoteAction } from "@/app/(app)/pressupostos/actions";

export default async function PressupostosProjecte({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const T = qt(profile.locale);
  const rows = await listQuotes(supabase, id);
  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title={T.projectQuotes} subtitle={`${project.code} · ${project.title}`}
        actions={<Link href={`/projectes/${id}`} className={btnSecondary}>← {project.code}</Link>} />
      <Card><QuoteTable rows={rows} T={T} L={profile.locale} showProject={false} /></Card>
      <Card title={T.newQuote}>
        <ActionForm action={createQuoteAction} messages={actionMessages(profile.locale)} submitLabel={T.create} className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <input type="hidden" name="projectId" value={id} />
          <Field label={T.quoteTitle}><input name="title" required maxLength={200} placeholder={T.quoteTitlePh} className={inputCls} /></Field>
          <Field label={T.docLocale}>
            <select name="locale" defaultValue="es" className={inputCls}><option value="es">Castellano</option><option value="ca">Català</option></select>
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
