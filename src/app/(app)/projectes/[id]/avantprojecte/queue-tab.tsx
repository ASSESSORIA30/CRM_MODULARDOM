import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { projectPeople } from "@/lib/avantprojecte-data";
import { createClient } from "@/lib/supabase/server";
import { clientTexts, type TabProps } from "./shared";

// Cua de documents que l'arquitecte ha enviat a validar (només direcció).
export async function QueueTab({ projectId, profile }: TabProps) {
  const { T } = clientTexts(profile);
  const supabase = await createClient();
  const [{ data: docs }, people] = await Promise.all([
    supabase.from("documents").select("id, title, version, category, uploaded_by, created_at")
      .eq("project_id", projectId).eq("bucket_id", "avantprojecte").eq("visibility", "revisio").order("created_at"),
    projectPeople(supabase, projectId),
  ]);
  return (
    <Card title={T.tabs.publicacio}>
      {docs?.length ? (
        <ul className="divide-y divide-navy/5">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span>
                <strong className="text-navy">{d.title}</strong> · {T.version} {d.version} · {T.categories[d.category as keyof typeof T.categories] ?? d.category}
                <span className="block text-xs text-muted">{people.get(d.uploaded_by ?? "")?.name ?? "—"} · {formatDateTime(d.created_at, profile.locale)}</span>
              </span>
              <Link href={`/projectes/${projectId}/avantprojecte?doc=${d.id}`} className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white">{T.open}</Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState>{T.queueEmpty}</EmptyState>}
    </Card>
  );
}
