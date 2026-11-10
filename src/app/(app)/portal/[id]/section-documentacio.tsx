import Link from "next/link";
import { Uploader } from "@/components/avantprojecte/uploader";
import { Badge, Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { isPreviewable, loadDocuments, signedUrls } from "@/lib/avantprojecte-data";
import { createClient } from "@/lib/supabase/server";
import { GalleryTab } from "../../projectes/[id]/avantprojecte/gallery-tab";
import { clientTexts } from "../../projectes/[id]/avantprojecte/shared";
import type { SectionProps } from "./shared";

export async function SectionDocumentacio({ projectId, profile, room }: SectionProps & { room?: string }) {
  const L = profile.locale;
  const { T, uploader, categories, rooms } = clientTexts(profile);
  const P = T.portal;
  const supabase = await createClient();
  const [{ groups, current }, { data: rules }] = await Promise.all([
    loadDocuments(supabase, projectId),
    supabase.from("upload_rules").select("extension, mime_type, max_bytes").eq("bucket_id", "avantprojecte"),
  ]);
  const urls = await signedUrls(supabase, groups.flat().map((d) => d.storage_path));

  return (
    <div className="space-y-6">
      <Card title={P.uploadDocs}>
        <Uploader projectId={projectId} rules={rules ?? []} staff={false} defaultCategory="inspiracio" texts={uploader} rooms={rooms}
          categories={categories.filter((c) => c.value !== "avantprojecte")} />
      </Card>
      <Card>
        {groups.length ? (
          <ul className="divide-y divide-navy/5">
            {groups.map((g) => {
              const cur = current(g);
              return (
                <li key={cur.group_id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-navy">{cur.title}</span>
                    <Badge className="bg-navy/5 text-navy">{T.categories[cur.category as keyof typeof T.categories] ?? cur.category}</Badge>
                    {cur.visibility === "compartit" && <Badge className="bg-gold-light text-navy">{T.visibility.compartit}</Badge>}
                    {cur.approved_at && <Badge className="bg-emerald-600 text-white">✓ {T.approved}</Badge>}
                    <span className="ml-auto flex gap-2 text-sm">
                      {isPreviewable(cur.storage_path) && (
                        <Link href={`/portal/${projectId}?apartat=actual&doc=${cur.id}`} className="text-navy underline">{T.open}</Link>
                      )}
                      {urls.get(cur.storage_path) && <a href={urls.get(cur.storage_path)} target="_blank" rel="noopener noreferrer" className="text-navy underline">⬇ {T.download}</a>}
                    </span>
                  </div>
                  {g.length > 1 && (
                    <p className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                      {T.versions}:
                      {g.map((v) => (
                        <a key={v.id} href={urls.get(v.storage_path) ?? "#"} target="_blank" rel="noopener noreferrer" className="underline">
                          v{v.version}{v.published_at ? ` · ${formatDate(v.published_at, L)}` : ""}{v.id === cur.id ? ` (${T.current.toLowerCase()})` : ""}
                        </a>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <EmptyState>{P.noCurrent}</EmptyState>}
      </Card>
      <section>
        <h2 className="mb-3 text-lg font-semibold text-navy">{T.tabs.galeria}</h2>
        <GalleryTab projectId={projectId} profile={profile} room={room} basePath={`/portal/${projectId}?apartat=documentacio`} />
      </section>
    </div>
  );
}
