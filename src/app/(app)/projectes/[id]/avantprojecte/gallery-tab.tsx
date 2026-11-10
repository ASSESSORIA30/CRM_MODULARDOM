import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { isImage, signedUrls } from "@/lib/avantprojecte-data";
import { createClient } from "@/lib/supabase/server";
import { clientTexts, type TabProps } from "./shared";

// Galeria d'inspiració: cada fotografia conserva els vincles amb els punts i marcadors.
export async function GalleryTab({ projectId, profile, room, basePath }: TabProps & { room?: string; basePath?: string }) {
  const { T } = clientTexts(profile);
  const supabase = await createClient();
  let q = supabase.from("documents").select("id, title, description, room_tag, storage_path, created_at")
    .eq("project_id", projectId).eq("bucket_id", "avantprojecte").in("category", ["inspiracio", "fotografia"])
    .neq("status", "arxivat").order("created_at", { ascending: false });
  if (room && room in T.rooms) q = q.eq("room_tag", room);
  const { data: photos } = await q;
  const list = (photos ?? []).filter((p) => isImage(p.storage_path));
  const ids = list.map((p) => p.id);
  const [urls, { data: links }] = await Promise.all([
    signedUrls(supabase, list.map((p) => p.storage_path)),
    ids.length ? supabase.from("document_links").select("document_id, item_id, annotation_id, revision_items(position, title)").in("document_id", ids) : Promise.resolve({ data: [] }),
  ]);
  const base = basePath ?? `/projectes/${projectId}/avantprojecte?tab=galeria`;

  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-1.5">
        <Link href={base} className={`rounded-full px-3 py-1 text-sm ${!room ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-navy/15"}`}>{T.all}</Link>
        {Object.entries(T.rooms).map(([k, v]) => (
          <Link key={k} href={`${base}&sala=${k}`} className={`rounded-full px-3 py-1 text-sm ${room === k ? "bg-navy text-white" : "bg-white text-navy ring-1 ring-navy/15"}`}>{v}</Link>
        ))}
      </nav>
      {list.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => {
            const pl = (links ?? []).filter((l) => l.document_id === p.id);
            return (
              <li key={p.id} className="overflow-hidden rounded-xl border border-navy/10 bg-white shadow-sm">
                <a href={urls.get(p.storage_path) ?? "#"} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={urls.get(p.storage_path)} alt={p.title} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                </a>
                <div className="space-y-1 p-2.5 text-xs">
                  <p className="font-medium text-navy">{p.title}</p>
                  {p.room_tag && <p className="text-muted">{T.rooms[p.room_tag as keyof typeof T.rooms]}</p>}
                  {p.description && <p className="line-clamp-2 text-muted">{p.description}</p>}
                  {pl.length > 0 && (
                    <p className="text-muted">{T.linkedTo}: {pl.map((l) => {
                      const ri = (Array.isArray(l.revision_items) ? l.revision_items[0] : l.revision_items) as { position: number; title: string } | null;
                      return ri ? `#${ri.position} ${ri.title}` : l.annotation_id ? "📍" : "";
                    }).filter(Boolean).join(", ")}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState>{T.galleryEmpty}</EmptyState>}
    </div>
  );
}
