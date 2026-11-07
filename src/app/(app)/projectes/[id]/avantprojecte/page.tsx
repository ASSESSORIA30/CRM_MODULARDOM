import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Tabs, btnSecondary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { av } from "@/lib/i18n-avantprojecte";
import { createClient } from "@/lib/supabase/server";
import { DocumentsTab } from "./documents-tab";
import { GalleryTab } from "./gallery-tab";
import { QueueTab } from "./queue-tab";
import { RoundsTab } from "./rounds-tab";

type SP = { tab?: string; doc?: string; marker?: string; ronda?: string; punt?: string; sala?: string };

export default async function AvantprojectePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sp = await searchParams;
  const T = av(profile.locale);
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();

  // Els enllaços de les notificacions porten ?punt= o ?ronda=: obren la pestanya de rondes
  const tab = sp.tab ?? (sp.punt || sp.ronda ? "rondes" : "documents");
  const isDir = profile.role === "direccio";
  const base = `/projectes/${id}/avantprojecte`;

  return (
    <div className="max-w-[90rem]">
      <PageHeader
        title={`${T.module} · ${project.title}`}
        subtitle={<span className="font-mono">{project.code}</span>}
        actions={<Link href={`/projectes/${id}`} className={btnSecondary}>← {project.code}</Link>}
      />
      <Tabs current={tab} items={[
        { key: "documents", label: T.tabs.documents, href: base },
        { key: "rondes", label: T.tabs.rondes, href: `${base}?tab=rondes` },
        { key: "galeria", label: T.tabs.galeria, href: `${base}?tab=galeria` },
        ...(isDir ? [{ key: "publicacio", label: T.tabs.publicacio, href: `${base}?tab=publicacio` }] : []),
      ]} />
      {tab === "rondes" && <RoundsTab projectId={id} profile={profile} focusItem={sp.punt} />}
      {tab === "galeria" && <GalleryTab projectId={id} profile={profile} room={sp.sala} />}
      {tab === "publicacio" && isDir && <QueueTab projectId={id} profile={profile} />}
      {(tab === "documents" || !["rondes", "galeria", "publicacio"].includes(tab)) && (
        <DocumentsTab projectId={id} profile={profile} docId={sp.doc} markerId={sp.marker} />
      )}
    </div>
  );
}
