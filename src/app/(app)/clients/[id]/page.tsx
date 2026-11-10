import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ActivityBlock, EventsBlock, TasksBlock } from "@/components/crm-blocks";
import { Badge, Card, EmptyState, Field, PageHeader, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, stageLabel } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";
import { updateClientAction } from "../actions";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = t(profile.locale);
  const supabase = await createClient();

  const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  const [{ data: holders }, { data: activities }, { data: tasks }, { data: events }] = await Promise.all([
    supabase.from("project_holders").select("is_primary, projects(id, code, title, status, created_at)").eq("client_id", id),
    supabase.from("activities").select("id, kind, summary, occurred_at, author:profiles!activities_created_by_fkey(full_name, email)")
      .eq("client_id", id).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("tasks").select("id, title, status, priority, due_date, assignee:profiles!tasks_assigned_to_fkey(full_name, email)")
      .eq("client_id", id).order("due_date", { ascending: true, nullsFirst: false }).limit(50),
    supabase.from("calendar_events").select("id, title, kind, starts_at, status").eq("client_id", id).order("starts_at", { ascending: false }).limit(30),
  ]);
  const projects = (holders ?? []).map((h) => h.projects as unknown as { id: string; code: string; title: string; status: string; created_at: string }).filter(Boolean);
  const update = updateClientAction.bind(null, id);

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={c.display_name}
        subtitle={[c.email, c.phone, c.city].filter(Boolean).join(" · ")}
        actions={<>
          <Link href="/clients?vista=clients" className={btnSecondary}>{d.back}</Link>
          <Link href={`/tasques/nova?client=${id}`} className={btnSecondary}>+ {d.newTask}</Link>
          <Link href={`/calendari/nou?client=${id}`} className={btnSecondary}>+ {d.newEvent}</Link>
        </>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title={d.projects}>
            {projects.length ? (
              <ul className="divide-y divide-navy/5">
                {projects.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/projectes/${p.id}`} className="font-medium text-navy hover:text-gold">{p.code} · {p.title}</Link>
                    <span className="flex items-center gap-2"><Badge className="bg-navy/5 text-navy">{stageLabel(p.status, profile.locale)}</Badge><span className="text-xs text-muted">{formatDate(p.created_at, profile.locale)}</span></span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState>{d.noData}</EmptyState>}
          </Card>
          <ActivityBlock locale={profile.locale} clientId={id} canAdd items={(activities ?? []) as never} />
          <div className="grid gap-6 xl:grid-cols-2">
            <TasksBlock locale={profile.locale} items={(tasks ?? []) as never} newHref={`/tasques/nova?client=${id}`} />
            <EventsBlock locale={profile.locale} items={events ?? []} newHref={`/calendari/nou?client=${id}`} />
          </div>
        </div>

        <Card title={d.clientData}>
          <ActionForm action={update} messages={actionMessages(profile.locale)} submitLabel={d.save} className="space-y-3"
            submitClassName={btnPrimary}>
            <Field label={d.kind}>
              <select name="kind" defaultValue={c.kind} className={inputCls}>
                <option value="persona">{d.person}</option><option value="empresa">{d.company}</option>
              </select>
            </Field>
            <Field label={d.clientName}><input name="display_name" defaultValue={c.display_name} required className={inputCls} /></Field>
            <Field label={d.taxId}><input name="tax_id" defaultValue={c.tax_id ?? ""} className={inputCls} /></Field>
            <Field label={d.email}><input name="email" type="email" defaultValue={c.email ?? ""} className={inputCls} /></Field>
            <Field label={d.phone}><input name="phone" defaultValue={c.phone ?? ""} className={inputCls} /></Field>
            <Field label={d.address}><input name="address" defaultValue={c.address ?? ""} className={inputCls} /></Field>
            <div className="grid grid-cols-[6rem_1fr] gap-2">
              <Field label={d.postalCode}><input name="postal_code" defaultValue={c.postal_code ?? ""} className={inputCls} /></Field>
              <Field label={d.city}><input name="city" defaultValue={c.city ?? ""} className={inputCls} /></Field>
            </div>
            <Field label={d.province}><input name="province" defaultValue={c.province ?? ""} className={inputCls} /></Field>
            <Field label={d.language}>
              <select name="locale" defaultValue={c.locale} className={inputCls}><option value="ca">Català</option><option value="es">Castellano</option></select>
            </Field>
            <Field label={d.leadSource}>
              <select name="lead_source" defaultValue={c.lead_source ?? ""} className={inputCls}>
                <option value="">—</option>
                {LEAD_SOURCES.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABELS[profile.locale][s]}</option>)}
              </select>
            </Field>
            <Field label={d.notes}><textarea name="notes" rows={3} defaultValue={c.notes ?? ""} className={inputCls} /></Field>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
