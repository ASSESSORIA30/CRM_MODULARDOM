// Blocs reutilitzables per a les fitxes de client i de projecte (Server Components).
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, inputCls } from "@/components/ui";
import type { AppLocale } from "@/lib/auth";
import { formatDate, formatDateTime, madridDateKey } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import {
  ACTIVITY_KINDS, ACTIVITY_LABELS, EVENT_LABELS, EVENT_STATUS_LABELS, PRIORITY_LABELS, PRIORITY_STYLE,
  TASK_STATUS_LABELS, type EventKind, type Priority,
} from "@/lib/pipeline";
import { addActivityAction } from "@/app/(app)/clients/actions";

type Activity = { id: string; kind: string; summary: string; occurred_at: string; author?: { full_name: string; email: string } | null };

export function ActivityBlock({ locale, items, clientId, projectId, canAdd }: {
  locale: AppLocale; items: Activity[]; clientId?: string; projectId?: string; canAdd: boolean;
}) {
  const d = t(locale);
  return (
    <Card title={d.activity}>
      {canAdd && (
        <ActionForm action={addActivityAction} messages={actionMessages(locale)} submitLabel={d.addActivity} resetOnSuccess
          className="mb-5 grid gap-3 rounded-lg bg-surface p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-start" submitClassName="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white">
          {clientId && <input type="hidden" name="client_id" value={clientId} />}
          {projectId && <input type="hidden" name="project_id" value={projectId} />}
          <select name="kind" className={inputCls} aria-label={d.kind}>
            {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_LABELS[locale][k]}</option>)}
          </select>
          <textarea name="summary" required rows={2} placeholder={d.summary} className={inputCls} />
        </ActionForm>
      )}
      {items.length ? (
        <ol className="relative space-y-4 border-l border-navy/10 pl-5">
          {items.map((a) => (
            <li key={a.id}>
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-gold" />
              <p className="text-xs text-muted">
                {formatDateTime(a.occurred_at, locale)} · {ACTIVITY_LABELS[locale][a.kind as keyof (typeof ACTIVITY_LABELS)["ca"]] ?? a.kind}
                {a.author ? ` · ${a.author.full_name || a.author.email}` : ""}
              </p>
              <p className="whitespace-pre-line text-sm text-ink">{a.summary}</p>
            </li>
          ))}
        </ol>
      ) : <EmptyState>{d.noData}</EmptyState>}
    </Card>
  );
}

type Task = { id: string; title: string; status: string; priority: string; due_date: string | null; assignee?: { full_name: string; email: string } | null };

export function TasksBlock({ locale, items, newHref }: { locale: AppLocale; items: Task[]; newHref?: string }) {
  const d = t(locale);
  const today = madridDateKey();
  return (
    <Card title={d.tasks} actions={newHref && <Link href={newHref} className="text-sm font-medium text-navy underline">+ {d.newTask}</Link>}>
      {items.length ? (
        <ul className="divide-y divide-navy/5 text-sm">
          {items.map((tk) => {
            const late = tk.due_date && tk.due_date < today && ["pendent", "en_curs"].includes(tk.status);
            return (
              <li key={tk.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={tk.status === "feta" ? "text-muted line-through" : "text-ink"}>{tk.title}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge className={PRIORITY_STYLE[tk.priority as Priority]}>{PRIORITY_LABELS[locale][tk.priority as Priority]}</Badge>
                  <span>{TASK_STATUS_LABELS[locale][tk.status as keyof (typeof TASK_STATUS_LABELS)["ca"]]}</span>
                  {tk.assignee && <span>· {tk.assignee.full_name || tk.assignee.email}</span>}
                  <span className={late ? "font-semibold text-red-700" : ""}>· {formatDate(tk.due_date, locale)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : <EmptyState>{d.noData}</EmptyState>}
    </Card>
  );
}

type Ev = { id: string; title: string; kind: string; starts_at: string; status: string };

export function EventsBlock({ locale, items, newHref }: { locale: AppLocale; items: Ev[]; newHref?: string }) {
  const d = t(locale);
  return (
    <Card title={d.calendar} actions={newHref && <Link href={newHref} className="text-sm font-medium text-navy underline">+ {d.newEvent}</Link>}>
      {items.length ? (
        <ul className="divide-y divide-navy/5 text-sm">
          {items.map((e) => (
            <li key={e.id} className="py-2">
              <Link href={`/calendari/${e.id}`} className="flex flex-wrap justify-between gap-2 hover:text-gold">
                <span className="font-medium text-navy">{e.title}</span>
                <span className="text-muted">{formatDateTime(e.starts_at, locale)}</span>
              </Link>
              <p className="text-xs text-muted">
                {EVENT_LABELS[locale][e.kind as EventKind]} · {EVENT_STATUS_LABELS[locale][e.status as keyof (typeof EVENT_STATUS_LABELS)["ca"]]}
              </p>
            </li>
          ))}
        </ul>
      ) : <EmptyState>{d.noEvents}</EmptyState>}
    </Card>
  );
}

export { Field };
