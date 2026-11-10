import { notFound } from "next/navigation";
import { RoundsMeter } from "@/components/avantprojecte/rounds-meter";
import { Tabs } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadProjectDocuments, loadRounds } from "@/lib/avantprojecte-data";
import { ProjectDocuments } from "@/components/avantprojecte/project-documents";
import { av } from "@/lib/i18n-avantprojecte";
import { createClient } from "@/lib/supabase/server";
import { SectionActual } from "./section-actual";
import { SectionDocumentacio } from "./section-documentacio";
import { SectionMissatges } from "./section-missatges";
import { SectionSeguiment } from "./section-seguiment";
import { SectionSollicitar } from "./section-sollicitar";

type SP = { apartat?: string; doc?: string; marker?: string; pas?: string; punt?: string; sala?: string; enviada?: string };
const SECTIONS = ["actual", "sollicitar", "seguiment", "documentacio", "missatges", "contracte"] as const;

export default async function PortalProject({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const profile = await requireRole("client");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const T = av(profile.locale);
  const P = T.portal;
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, title, code").eq("id", id).maybeSingle();
  if (!project) notFound(); // l'RLS només mostra els projectes del client

  const { status } = await loadRounds(supabase, id);
  const section = SECTIONS.find((s) => s === sp.apartat) ?? (sp.punt ? "seguiment" : "actual");
  const base = `/portal/${id}`;
  const ctx = { projectId: id, profile, status };

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-gold">{P.title}</p>
          <h1 className="text-2xl font-semibold text-navy">{project.title}</h1>
          <div className="mt-2 h-1 w-14 rounded bg-gold" />
        </div>
        <RoundsMeter used={status.used} base={status.base} granted={status.granted} label={P.roundsUsed}
          caption={status.available > 0 ? P.roundsLeft(status.available) : P.noRoundsLeft.split(".")[0] + "."} />
      </div>
      <Tabs current={section} items={SECTIONS.map((s) => ({ key: s, label: s === "contracte" ? T.projectDocs.title : P.sections[s], href: `${base}?apartat=${s}` }))} />
      {sp.enviada === "1" && section === "seguiment" && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {P.sent}</p>
      )}
      {section === "actual" && <SectionActual {...ctx} docId={sp.doc} markerId={sp.marker} />}
      {section === "sollicitar" && <SectionSollicitar {...ctx} docId={sp.doc} markerId={sp.marker} confirm={sp.pas === "confirmar"} />}
      {section === "seguiment" && <SectionSeguiment {...ctx} focusItem={sp.punt} />}
      {section === "documentacio" && <SectionDocumentacio {...ctx} room={sp.sala} />}
      {section === "missatges" && <SectionMissatges {...ctx} />}
      {section === "contracte" && <ProjectDocuments projectId={id} docs={await loadProjectDocuments(supabase, id)} locale={profile.locale} manage={false} />}
    </div>
  );
}
