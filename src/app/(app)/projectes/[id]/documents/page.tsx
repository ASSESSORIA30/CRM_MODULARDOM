import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectDocuments } from "@/components/avantprojecte/project-documents";
import { Uploader } from "@/components/avantprojecte/uploader";
import { PageHeader, btnSecondary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadProjectDocuments } from "@/lib/avantprojecte-data";
import { av } from "@/lib/i18n-avantprojecte";
import { actionMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

const BUCKET_CATEGORIES = {
  contractes: ["contracte", "annex"],
  factures: ["factura", "justificant_pagament"],
  documents: ["llicencia", "visat", "projecte_tecnic", "memoria", "certificacio", "acta_entrega", "identificacio", "altres"],
} as const;

// Contracte signat, factures emeses i altres documents del projecte (només direcció en gestiona la publicació).
export default async function DocumentsProjecte({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const T = av(profile.locale);
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const [docs, { data: rules }] = await Promise.all([
    loadProjectDocuments(supabase, id),
    supabase.from("upload_rules").select("bucket_id, extension, mime_type, max_bytes").in("bucket_id", ["contractes", "factures", "documents"]),
  ]);
  const messages = actionMessages(profile.locale);
  const uploader = (b: keyof typeof BUCKET_CATEGORIES) => (
    <Uploader compact projectId={id} bucket={b} staff rooms={[]}
      rules={(rules ?? []).filter((r) => r.bucket_id === b)}
      categories={BUCKET_CATEGORIES[b].map((c) => ({ value: c, label: T.categories[c as keyof typeof T.categories] ?? c }))}
      defaultCategory={BUCKET_CATEGORIES[b][0]}
      texts={{ ...T.uploader, formats: b === "factures" ? "PDF, JPG, PNG" : "PDF, JPG, PNG, DOCX", errors: messages.errors }} />
  );
  return (
    <div className="max-w-7xl">
      <PageHeader title={`${T.projectDocs.title} · ${project.title}`} subtitle={T.projectDocs.help}
        actions={<Link href={`/projectes/${id}`} className={btnSecondary}>← {project.code}</Link>} />
      <ProjectDocuments projectId={id} docs={docs} locale={profile.locale} manage
        uploaders={{ contractes: uploader("contractes"), factures: uploader("factures"), documents: uploader("documents") }} />
    </div>
  );
}
