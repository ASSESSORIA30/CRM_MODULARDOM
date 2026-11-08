// Proves de l'informe de ronda (dades fictícies, sense Supabase). Només amb ENABLE_TEST_ROUTES=1.
import { notFound } from "next/navigation";
import { ReportActions } from "@/components/avantprojecte/report-actions";
import { RoundReportView } from "@/components/avantprojecte/round-report-view";
import { av } from "@/lib/i18n-avantprojecte";
import { actionMessages } from "@/lib/messages";
import type { RoundReport } from "@/lib/report/round-report";
import { reportTexts } from "@/lib/report/report-texts";

export const dynamic = "force-dynamic";

const base = { room: null, sourceExcerpt: null, assessment: null, alternative: null, alternativeStatus: "cap", economic: null,
  confirmations: [], comments: [], markers: [], photos: [], resolution: null };
const marker = (label: string, kind: "punt" | "rectangle", f: "pdf" | "png", x: number, y: number, w: number | null = null, h: number | null = null) => ({
  label, page: 1, kind, x, y, w, h, documentTitle: "Plànol planta baixa", documentVersion: 2,
  documentKind: f === "pdf" ? "pdf" as const : "image" as const, url: `/proves/visor/fixture?f=${f}`, comment: "",
});

const REPORT: RoundReport = {
  project: { title: "Habitatge de prova", code: "MD-2026-000" },
  round: { number: 1, submittedAt: "05/11/2026 10:30", submittedBy: "Client de prova", status: "tancada", closedAt: "07/11/2026 18:00", isException: false, originalText: "Voldríem una finestra més gran al menjador i treure la banyera." },
  generatedAt: "08/11/2026 09:00",
  items: [
    { ...base, ref: "R1.1", position: 1, title: "Finestra del menjador més gran", description: "Ampliar l'obertura de la façana sud", status: "incorporat",
      sourceExcerpt: "una finestra més gran al menjador", assessment: "Viable sense afectar l'estructura.",
      markers: [marker("1", "punt", "pdf", 0.4, 0.3), marker("2", "rectangle", "pdf", 0.05, 0.1, 0.3, 0.4)],
      confirmations: [{ kind: "punt_revisat", who: "Client de prova", when: "06/11/2026 12:00" }],
      comments: [{ author: "Arquitecte de prova", when: "06/11/2026 09:00", body: "S'amplia a 2,40 m." }],
      resolution: { documentTitle: "Avantprojecte", version: 3, resolution: "incorporat", note: null } },
    { ...base, ref: "R1.2", position: 2, title: "Treure la banyera", description: "Plat de dutxa al bany principal", status: "viable_amb_modificacions",
      alternative: "Dutxa de 90 cm amb mampara", alternativeStatus: "acceptada", markers: [marker("1", "punt", "png", 0.25, 0.75)],
      photos: [{ title: "Inspiració dutxa", description: null, url: "/proves/visor/fixture?f=png", isImage: true }],
      resolution: { documentTitle: "Avantprojecte", version: 3, resolution: "alternativa", note: null } },
    { ...base, ref: "R1.3", position: 3, title: "Soterrani", description: "Afegir un soterrani", status: "no_viable", assessment: "El terreny no ho permet." },
  ],
  versions: [{ title: "Avantprojecte", version: 3, publishedAt: "07/11/2026 17:00", approvedAt: null }],
};

export default function InformeProves() {
  if (process.env.ENABLE_TEST_ROUTES !== "1") notFound();
  const T = av("ca");
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <ReportActions report={REPORT} texts={reportTexts("ca")} projectId="00000000-0000-0000-0000-0000000000aa" canArchive={false} previousVersionId={null}
        labels={{ download: T.report.download, archive: T.report.archive, archived: T.report.archived, preparing: T.report.preparing, print: T.report.print }}
        errors={actionMessages("ca").errors} />
      <RoundReportView report={REPORT} T={reportTexts("ca")} note={T.report.summaryNote} />
    </main>
  );
}
