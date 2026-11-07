import Link from "next/link";
import { CommentThread } from "@/components/avantprojecte/comment-thread";
import { Card } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { projectPeople } from "@/lib/avantprojecte-data";
import { generalMessages } from "@/lib/avantprojecte-workspace";
import { createClient } from "@/lib/supabase/server";
import { clientTexts, mentionable } from "../../projectes/[id]/avantprojecte/shared";
import type { SectionProps } from "./shared";

export async function SectionMissatges({ projectId, profile }: SectionProps) {
  const L = profile.locale;
  const { T, messages } = clientTexts(profile);
  const P = T.portal;
  const supabase = await createClient();
  const people = await projectPeople(supabase, projectId);
  const [general, { data: recent }] = await Promise.all([
    generalMessages(supabase, projectId, people, L),
    supabase.from("comments").select("id, body, created_at, author_id, item_id, document_id, annotation_id")
      .eq("project_id", projectId).or("item_id.not.is.null,document_id.not.is.null,annotation_id.not.is.null")
      .order("created_at", { ascending: false }).limit(10),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card title={P.sections.missatges}>
        <p className="mb-4 text-sm text-muted">{P.messagesHelp}</p>
        <CommentThread projectId={projectId} target={{}} comments={general} canInternal={false} canResolve
          participants={mentionable(people, profile.id)} texts={T.thread} messages={messages} />
      </Card>
      <Card title={P.recentActivity}>
        <ul className="space-y-2 text-sm">
          {(recent ?? []).map((c) => (
            <li key={c.id}>
              <Link href={c.item_id ? `/portal/${projectId}?apartat=seguiment&punt=${c.item_id}#punt-${c.item_id}` : `/portal/${projectId}?apartat=actual${c.document_id ? `&doc=${c.document_id}` : ""}`}
                className="block rounded-md p-2 hover:bg-surface">
                <span className="line-clamp-2 text-ink">{c.body}</span>
                <span className="text-xs text-muted">{people.get(c.author_id ?? "")?.name ?? "—"} · {formatDateTime(c.created_at, L)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
