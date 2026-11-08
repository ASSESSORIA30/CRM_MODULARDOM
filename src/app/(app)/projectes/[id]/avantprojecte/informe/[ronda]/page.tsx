// FASE D: resum de la ronda i informe PDF arxivable.
// Accessible per direcció, arquitecte i el client del projecte (l'RLS limita les dades).
// Només s'hi inclou contingut compartit amb el client.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ReportActions } from "@/components/avantprojecte/report-actions";
import { RoundReportView } from "@/components/avantprojecte/round-report-view";
import { btnSecondary } from "@/components/ui";
import { requireActiveProfile } from "@/lib/auth";
import { av } from "@/lib/i18n-avantprojecte";
import { actionMessages } from "@/lib/messages";
import { loadRoundReport } from "@/lib/report/load-round-report";
import { reportTexts } from "@/lib/report/report-texts";
import { createClient } from "@/lib/supabase/server";

export default async function RoundReportPage({ params }: { params: Promise<{ id: string; ronda: string }> }) {
  const profile = await requireActiveProfile();
  if (profile.role === "constructor") redirect("/inici");
  const { id, ronda } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^\d{1,3}$/.test(ronda)) notFound();
  const supabase = await createClient();
  const report = await loadRoundReport(supabase, id, Number(ronda), profile.locale);
  if (!report) notFound();

  const T = av(profile.locale);
  const texts = reportTexts(profile.locale);
  const isStaff = profile.role === "direccio" || profile.role === "arquitecte";
  const back = isStaff ? `/projectes/${id}/avantprojecte?tab=rondes` : `/portal/${id}?apartat=seguiment`;

  // Si ja s'havia arxivat un informe d'aquesta ronda, el nou en serà una versió nova
  let previousVersionId: string | null = null;
  if (isStaff) {
    const { data } = await supabase.from("documents").select("id")
      .eq("project_id", id).eq("bucket_id", "avantprojecte").eq("category", "memoria")
      .eq("title", `${texts.title} · ${texts.round} ${report.round.number}`)
      .order("version", { ascending: false }).limit(1);
    previousVersionId = data?.[0]?.id ?? null;
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={back} className={btnSecondary}>← {T.report.back}</Link>
        <ReportActions report={report} texts={texts} projectId={id} canArchive={isStaff} previousVersionId={previousVersionId}
          labels={{ download: T.report.download, archive: T.report.archive, archived: T.report.archived, preparing: T.report.preparing, print: T.report.print }}
          errors={actionMessages(profile.locale).errors} />
      </div>
      <RoundReportView report={report} T={texts} note={T.report.summaryNote} />
    </div>
  );
}
