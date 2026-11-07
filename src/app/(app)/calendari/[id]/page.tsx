import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, btnPrimary, btnSecondary } from "@/components/ui";
import { requireActiveProfile } from "@/lib/auth";
import { formatDateTime, madridDateKey, toMadridInput } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { EVENT_LABELS, EVENT_STATUS_LABELS, type EventKind } from "@/lib/pipeline";
import { one } from "@/lib/rel";
import { createClient } from "@/lib/supabase/server";
import { deleteEventAction, updateEventAction } from "../actions";
import { EventFields } from "../event-fields";
import { eventOptions } from "../options";

export default async function CitaPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireActiveProfile();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const L = profile.locale;
  const d = t(L);
  const supabase = await createClient();
  const { data: e } = await supabase.from("calendar_events")
    .select("*, projects(id, code, title), responsible:profiles!calendar_events_responsible_id_fkey(full_name, email), calendar_event_attendees(profile_id)")
    .eq("id", id).maybeSingle();
  if (!e) notFound();

  const isDir = profile.role === "direccio";
  const canEdit = isDir || (profile.role === "arquitecte" && e.created_by === profile.id);
  const project = one(e.projects as { id: string; code: string; title: string } | null);
  const resp = one(e.responsible as { full_name: string; email: string } | null);
  const back = `/calendari?data=${madridDateKey(e.starts_at)}`;
  const opts = canEdit ? await eventOptions(isDir) : null;
  const update = updateEventAction.bind(null, id);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={e.title}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <Badge className="bg-navy/5 text-navy">{EVENT_LABELS[L][e.kind as EventKind]}</Badge>
          <Badge>{EVENT_STATUS_LABELS[L][e.status as keyof (typeof EVENT_STATUS_LABELS)["ca"]]}</Badge>
          <span>{formatDateTime(e.starts_at, L)}{e.ends_at ? ` – ${formatDateTime(e.ends_at, L)}` : ""}</span>
        </span>}
        actions={<Link href={back} className={btnSecondary}>{d.back}</Link>}
      />
      {canEdit ? (
        <Card>
          <ActionForm action={update} messages={actionMessages(L)} submitLabel={d.save} submitClassName={btnPrimary}>
                <EventFields locale={L} isDir={isDir} {...opts!}
                  defaults={{
                    title: e.title, kind: e.kind, start: toMadridInput(e.starts_at), end: e.ends_at ? toMadridInput(e.ends_at) : "",
                    all_day: e.all_day, location: e.location, notes: e.notes, project_id: e.project_id, client_id: e.client_id,
                    responsible_id: e.responsible_id, status: e.status, reminder_minutes: e.reminder_minutes,
                    visible_to_client: e.visible_to_client,
                    attendees: (e.calendar_event_attendees as { profile_id: string }[]).map((a) => a.profile_id),
                  }} />
          </ActionForm>
          {isDir && (
            <form action={deleteEventAction} className="mt-6 border-t border-navy/10 pt-4">
              <input type="hidden" name="id" value={id} />
              <button className="text-sm text-red-700 underline">{d.deleteEvent}</button>
            </form>
          )}
        </Card>
      ) : (
        <Card>
          <dl className="space-y-2 text-sm">
            {e.location && <div><dt className="text-xs text-muted">{d.location}</dt><dd>{e.location}</dd></div>}
            {project && <div><dt className="text-xs text-muted">{d.project}</dt><dd>{project.code} · {project.title}</dd></div>}
            {resp && <div><dt className="text-xs text-muted">{d.responsible}</dt><dd>{resp.full_name || resp.email}</dd></div>}
            {e.notes && profile.role !== "client" && <div><dt className="text-xs text-muted">{d.notes}</dt><dd className="whitespace-pre-line">{e.notes}</dd></div>}
          </dl>
        </Card>
      )}
    </div>
  );
}
