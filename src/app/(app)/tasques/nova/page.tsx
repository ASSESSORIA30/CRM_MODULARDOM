import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { PRIORITIES, PRIORITY_LABELS, TASK_KINDS, TASK_KIND_LABELS } from "@/lib/pipeline";
import { eventOptions } from "../../calendari/options";
import { createTaskAction } from "../actions";

export default async function NovaTascaPage({ searchParams }: { searchParams: Promise<{ projecte?: string; client?: string }> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const L = profile.locale;
  const d = t(L);
  const sp = await searchParams;
  const isDir = profile.role === "direccio";
  const { projects, clients, people } = await eventOptions(isDir);
  const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : "");

  return (
    <div className="max-w-3xl">
      <PageHeader title={d.newTask} actions={<Link href="/tasques" className={btnSecondary}>{d.back}</Link>} />
      <Card>
        <ActionForm action={createTaskAction} messages={actionMessages(L)} submitLabel={d.create} submitClassName={btnPrimary}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={d.title} className="sm:col-span-2"><input name="title" required className={inputCls} autoFocus /></Field>
            <Field label={d.kind}>
              <select name="kind" defaultValue={isDir ? "comercial" : "tecnica"} disabled={!isDir} className={inputCls}>
                {TASK_KINDS.map((k) => <option key={k} value={k}>{TASK_KIND_LABELS[L][k]}</option>)}
              </select>
              {!isDir && <input type="hidden" name="kind" value="tecnica" />}
            </Field>
            <Field label={d.priority}>
              <select name="priority" defaultValue="normal" className={inputCls}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[L][p]}</option>)}
              </select>
            </Field>
            <Field label={d.project}>
              <select name="project_id" defaultValue={uuid(sp.projecte)} required={!isDir} className={inputCls}>
                <option value="">—</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            {isDir && (
              <Field label={d.client}>
                <select name="client_id" defaultValue={uuid(sp.client)} className={inputCls}>
                  <option value="">—</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </Field>
            )}
            {isDir && (
              <Field label={d.assignedTo}>
                <select name="assigned_to" defaultValue={profile.id} className={inputCls}>
                  <option value="">—</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </Field>
            )}
            <Field label={d.dueDate}><input name="due_date" type="date" className={inputCls} /></Field>
            <Field label={d.notes} className="sm:col-span-2"><textarea name="description" rows={3} className={inputCls} /></Field>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
