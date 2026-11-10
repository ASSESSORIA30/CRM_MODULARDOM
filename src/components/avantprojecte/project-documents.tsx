// Llista de contracte, factures i altres documents del projecte (direcció i client).
import { Badge, Card, EmptyState } from "@/components/ui";
import type { AppLocale } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { av } from "@/lib/i18n-avantprojecte";
import type { ProjectDoc } from "@/lib/avantprojecte-data";
import { archiveProjectDocumentAction, setProjectDocumentPublishedAction } from "@/app/(app)/projectes/[id]/avantprojecte/actions";
import type { ReactNode } from "react";

export function ProjectDocuments({ projectId, docs, locale, manage, uploaders }: {
  projectId: string; docs: ProjectDoc[]; locale: AppLocale; manage: boolean; uploaders?: Partial<Record<"contractes" | "factures" | "documents", ReactNode>>;
}) {
  const T = av(locale);
  const D = T.projectDocs;
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {(["contractes", "factures", "documents"] as const).map((b) => {
        const list = docs.filter((d) => d.bucket_id === b);
        return (
          <Card key={b} title={D.groups[b]}>
            {manage && uploaders?.[b] && <div className="mb-4">{uploaders[b]}</div>}
            {list.length ? (
              <ul className="divide-y divide-navy/5" data-testid={`docs-${b}`}>
                {list.map((d) => (
                  <li key={d.id} className="py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-navy">{d.title}</p>
                        <p className="text-xs text-muted">
                          {T.categories[d.category as keyof typeof T.categories] ?? d.category} · {formatDate(d.published_at ?? d.created_at, locale)}
                        </p>
                      </div>
                      {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md border border-navy/20 px-2 py-1 text-xs text-navy">⬇ {T.open}</a>}
                    </div>
                    {manage && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                        <Badge className={d.published_to_client ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}>
                          {d.published_to_client ? `👁 ${D.visibleToClient}` : `🔒 ${D.notVisible}`}
                        </Badge>
                        <form action={setProjectDocumentPublishedAction}>
                          <input type="hidden" name="id" value={d.id} /><input type="hidden" name="project_id" value={projectId} />
                          <input type="hidden" name="publish" value={d.published_to_client ? "0" : "1"} />
                          <button className="text-navy underline">{d.published_to_client ? D.unpublish : D.publish}</button>
                        </form>
                        <form action={archiveProjectDocumentAction}>
                          <input type="hidden" name="id" value={d.id} /><input type="hidden" name="project_id" value={projectId} />
                          <button className="text-muted underline">{D.archive}</button>
                        </form>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <EmptyState>{manage ? D.empty : D.clientEmpty}</EmptyState>}
          </Card>
        );
      })}
    </div>
  );
}
