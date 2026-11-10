// Camps del formulari de cita (Server Component reutilitzat a "nova" i "editar").
import { Field, inputCls } from "@/components/ui";
import type { AppLocale } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { EVENT_KINDS, EVENT_LABELS, EVENT_STATUSES, EVENT_STATUS_LABELS } from "@/lib/pipeline";

export type EventDefaults = {
  title?: string; kind?: string; start?: string; end?: string; all_day?: boolean; location?: string | null;
  notes?: string | null; project_id?: string | null; client_id?: string | null; responsible_id?: string | null;
  status?: string; reminder_minutes?: number; visible_to_client?: boolean; attendees?: string[];
};

export function EventFields({ locale, isDir, defaults, projects, clients, people }: {
  locale: AppLocale; isDir: boolean; defaults: EventDefaults;
  projects: { id: string; label: string }[]; clients: { id: string; label: string }[]; people: { id: string; label: string }[];
}) {
  const d = t(locale);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={d.title} className="sm:col-span-2"><input name="title" required defaultValue={defaults.title ?? ""} className={inputCls} /></Field>
      <Field label={d.kind}>
        <select name="kind" defaultValue={defaults.kind ?? "visita_terreny"} className={inputCls}>
          {EVENT_KINDS.map((k) => <option key={k} value={k}>{EVENT_LABELS[locale][k]}</option>)}
        </select>
      </Field>
      <Field label={d.status}>
        <select name="status" defaultValue={defaults.status ?? "previst"} className={inputCls}>
          {EVENT_STATUSES.map((s) => <option key={s} value={s}>{EVENT_STATUS_LABELS[locale][s]}</option>)}
        </select>
      </Field>
      <Field label={d.start}><input name="start" type="datetime-local" required defaultValue={defaults.start ?? ""} className={inputCls} /></Field>
      <Field label={d.end}><input name="end" type="datetime-local" defaultValue={defaults.end ?? ""} className={inputCls} /></Field>
      <label className="flex items-center gap-2 text-sm text-navy">
        <input type="checkbox" name="all_day" defaultChecked={defaults.all_day} className="h-4 w-4 accent-navy" /> {d.allDay}
      </label>
      <Field label={d.reminder}><input name="reminder_minutes" type="number" min={0} max={10080} defaultValue={defaults.reminder_minutes ?? 60} className={inputCls} /></Field>
      <Field label={d.location} className="sm:col-span-2"><input name="location" defaultValue={defaults.location ?? ""} className={inputCls} /></Field>
      <Field label={d.project}>
        <select name="project_id" defaultValue={defaults.project_id ?? ""} className={inputCls} required={!isDir}>
          <option value="">—</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      {isDir && (
        <Field label={d.client}>
          <select name="client_id" defaultValue={defaults.client_id ?? ""} className={inputCls}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
      )}
      {isDir && (
        <Field label={d.responsible}>
          <select name="responsible_id" defaultValue={defaults.responsible_id ?? ""} className={inputCls}>
            <option value="">—</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      )}
      {isDir && (
        <Field label={d.attendees}>
          <select name="attendees" multiple defaultValue={defaults.attendees ?? []} className={`${inputCls} h-28`}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </Field>
      )}
      {isDir && (
        <label className="flex items-center gap-2 text-sm text-navy sm:col-span-2">
          <input type="checkbox" name="visible_to_client" defaultChecked={defaults.visible_to_client} className="h-4 w-4 accent-navy" /> {d.visibleToClient}
        </label>
      )}
      <Field label={d.notes} className="sm:col-span-2"><textarea name="notes" rows={3} defaultValue={defaults.notes ?? ""} className={inputCls} /></Field>
    </div>
  );
}
