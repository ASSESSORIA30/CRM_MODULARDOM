import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteUpload } from "@/components/quotes/quote-upload";
import { Card, PageHeader, btnSecondary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function PujarPressupost({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const X = qx(profile.locale);
  const T = qt(profile.locale);
  const base = actionMessages(profile.locale);
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={X.uploadQuote} subtitle={`${project.code} · ${project.title}`}
        actions={<Link href={`/projectes/${id}/pressupostos`} className={btnSecondary}>← {T.projectQuotes}</Link>} />
      <Card><p className="mb-3 text-sm text-muted">{X.uploadHelp} {X.analyzeHelp}</p>
        <QuoteUpload projectId={id} X={X} errors={{ ...base.errors, ...T.errors }} /></Card>
    </div>
  );
}
