import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ActivityBlock, EventsBlock, TasksBlock } from "@/components/crm-blocks";
import { Badge, Card, EmptyState, Field, PageHeader, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { centsToInput, formatCents } from "@/lib/money";
import { ALL_STAGES, ARCHITECT_STEPS, PRIORITIES, PRIORITY_LABELS, PRIORITY_STYLE, stageLabel, stepLabel, type Priority } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";
import { addMemberAction, revokeMemberAction, updateProjectAction } from "../actions";
import { StageForm } from "./stage-form";
import { StepsList } from "./steps-list";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const isDir = profile.role === "direccio";
  const L = profile.locale;
  const d = t(L);
  const supabase = await createClient();

  const { data: p } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!p) notFound(); // l'RLS amaga els projectes no assignats

  const [{ data: steps }, { data: history }, { data: holders }, { data: fin }, { data: activities }, { data: tasks }, { data: events }, { data: members }, { data: people }] = await Promise.all([
    supabase.from("project_steps").select("step, status, done_at").eq("project_id", id).order("step"),
    supabase.from("project_stage_history").select("id, from_stage, to_stage, reason, changed_at, who:profiles!project_stage_history_changed_by_fkey(full_name, email)").eq("project_id", id).order("changed_at", { ascending: false }),
    supabase.from("project_holders").select("is_primary, clients(id, display_name, email, phone)").eq("project_id", id),
    isDir ? supabase.from("project_financials").select("estimated_sale_cents").eq("project_id", id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("activities").select("id, kind, summary, occurred_at, author:profiles!activities_created_by_fkey(full_name, email)").eq("project_id", id).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("tasks").select("id, title, status, priority, due_date, assignee:profiles!tasks_assigned_to_fkey(full_name, email)").eq("project_id", id).order("due_date", { nullsFirst: false }),
    supabase.from("calendar_events").select("id, title, kind, starts_at, status").eq("project_id", id).order("starts_at", { ascending: false }).limit(30),
    isDir ? supabase.from("project_members").select("id, member_role, profile:profiles!project_members_profile_id_fkey(id, full_name, email)").eq("project_id", id).is("revoked_at", null) : Promise.resolve({ data: [] }),
    isDir ? supabase.from("profiles").select("id, full_name, email, role").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
  ]);

  const msgs = actionMessages(L);
  const clients = (holders ?? []).map((h) => ({ primary: h.is_primary, c: h.clients as unknown as { id: string; display_name: string; email: string | null; phone: string | null } }));
  const update = updateProjectAction.bind(null, id);
  const memberList = (members ?? []) as unknown as { id: string; member_role: string; profile: { id: string; full_name: string; email: string } }[];
  const peopleList = (people ?? []) as { id: string; full_name: string; email: string; role: string }[];

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={clients.find((c) => c.primary)?.c.display_name ?? p.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.code}</span>
            <Badge className="bg-navy text-white">{stageLabel(p.status, L)}</Badge>
            <Badge className={PRIORITY_STYLE[p.priority as Priority]}>{PRIORITY_LABELS[L][p.priority as Priority]}</Badge>
            {p.municipality && <span>· {p.municipality}</span>}
            {isDir && fin?.estimated_sale_cents != null && <span>· {formatCents(fin.estimated_sale_cents, { decimals: false })}</span>}
          </span>
        }
        actions={<>
          {isDir && <Link href="/kanban" className={btnSecondary}>{d.kanban}</Link>}
          <Link href={`/tasques/nova?projecte=${id}`} className={btnSecondary}>+ {d.newTask}</Link>
          <Link href={`/calendari/nou?projecte=${id}`} className={btnSecondary}>+ {d.newEvent}</Link>
        </>}
      />
      {p.status === "perdut" && p.lost_reason && (
        <p className="mb-6 rounded-lg bg-red-50 p-3 text-sm text-red-800"><strong>{d.lostReason}:</strong> {p.lost_reason}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title={d.steps}>
            <StepsList
              projectId={id}
              messages={msgs}
              texts={{ done: d.stepDone, pending: d.stepPending, na: d.stepNA }}
              steps={(steps ?? []).map((s) => ({
                step: s.step, status: s.status, done_at: s.done_at,
                label: stepLabel(s.step, L),
                doneAtText: s.done_at ? formatDateTime(s.done_at, L) : "",
                editable: isDir || ARCHITECT_STEPS.includes(s.step),
              }))}
            />
          </Card>
          <ActivityBlock locale={L} projectId={id} canAdd items={(activities ?? []) as never} />
          <div className="grid gap-6 xl:grid-cols-2">
            <TasksBlock locale={L} items={(tasks ?? []) as never} newHref={`/tasques/nova?projecte=${id}`} />
            <EventsBlock locale={L} items={events ?? []} newHref={`/calendari/nou?projecte=${id}`} />
          </div>
          <Card title={d.stageHistory}>
            {history?.length ? (
              <ol className="space-y-2 text-sm">
                {history.map((h) => {
                  const who = h.who as unknown as { full_name: string; email: string } | null;
                  return (
                    <li key={h.id} className="flex flex-wrap gap-x-2">
                      <span className="text-muted">{formatDateTime(h.changed_at, L)}</span>
                      <span className="text-ink">{h.from_stage ? `${stageLabel(h.from_stage, L)} → ` : ""}<strong>{stageLabel(h.to_stage, L)}</strong></span>
                      {who && <span className="text-muted">· {who.full_name || who.email}</span>}
                      {h.reason && <span className="w-full text-muted">“{h.reason}”</span>}
                    </li>
                  );
                })}
              </ol>
            ) : <EmptyState>{d.noData}</EmptyState>}
          </Card>
        </div>

        <div className="space-y-6">
          {isDir && (
            <Card>
              <StageForm projectId={id} current={p.status} messages={msgs}
                texts={{ move: d.move, lostReason: d.lostReason, changeStage: d.changeStage }}
                stages={ALL_STAGES.map((s) => ({ value: s, label: stageLabel(s, L) }))} />
            </Card>
          )}

          <Card title={d.clients.split(" ")[0]}>
            <ul className="space-y-2 text-sm">
              {clients.map(({ c, primary }) => (
                <li key={c.id}>
                  {isDir ? <Link href={`/clients/${c.id}`} className="font-medium text-navy hover:text-gold">{c.display_name}</Link> : <span className="font-medium">{c.display_name}</span>}
                  {primary && <span className="ml-2 text-xs text-gold">★</span>}
                  <p className="text-xs text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </Card>

          {isDir ? (
            <Card title={d.pipelineData}>
              <ActionForm action={update} messages={msgs} submitLabel={d.save} className="space-y-3" submitClassName={btnPrimary}>
                <Field label={d.title}><input name="title" defaultValue={p.title} required className={inputCls} /></Field>
                <Field label={d.municipality}><input name="municipality" defaultValue={p.municipality ?? ""} className={inputCls} /></Field>
                <Field label={d.plotAddress}><input name="plot_address" defaultValue={p.plot_address ?? ""} className={inputCls} /></Field>
                <Field label={d.cadastralRef}><input name="cadastral_ref" defaultValue={p.cadastral_ref ?? ""} className={inputCls} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="m²"><input name="surface_m2" defaultValue={p.surface_m2 ?? ""} inputMode="decimal" className={inputCls} /></Field>
                  <Field label={d.priority}>
                    <select name="priority" defaultValue={p.priority} className={inputCls}>
                      {PRIORITIES.map((x) => <option key={x} value={x}>{PRIORITY_LABELS[L][x]}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label={d.estimatedBudget}><input name="estimated" defaultValue={centsToInput(fin?.estimated_sale_cents ?? null)} inputMode="decimal" className={inputCls} /></Field>
                <Field label={d.responsible}>
                  <select name="responsible_id" defaultValue={p.responsible_id ?? ""} className={inputCls}>
                    <option value="">—</option>
                    {peopleList.filter((x) => x.role === "direccio" || x.role === "arquitecte").map((x) => <option key={x.id} value={x.id}>{x.full_name || x.email}</option>)}
                  </select>
                </Field>
                <Field label={d.nextAction}><input name="next_action" defaultValue={p.next_action ?? ""} className={inputCls} /></Field>
                <Field label={d.followUpDate}><input name="follow_up_date" type="date" defaultValue={p.follow_up_date ?? ""} className={inputCls} /></Field>
              </ActionForm>
              <p className="mt-3 text-xs text-muted">{d.lastActivity}: {formatDateTime(p.last_activity_at, L)}</p>
            </Card>
          ) : (
            <Card title={d.pipelineData}>
              <dl className="space-y-1 text-sm">
                <div><dt className="text-xs text-muted">{d.plotAddress}</dt><dd>{p.plot_address ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">{d.cadastralRef}</dt><dd>{p.cadastral_ref ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">m²</dt><dd>{p.surface_m2 ?? "—"}</dd></div>
                <div><dt className="text-xs text-muted">{d.followUpDate}</dt><dd>{formatDate(p.follow_up_date, L)}</dd></div>
              </dl>
            </Card>
          )}

          {isDir && (
            <Card title={d.team}>
              {memberList.length ? (
                <ul className="mb-4 space-y-2 text-sm">
                  {memberList.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2">
                      <span>{m.profile.full_name || m.profile.email} <span className="text-xs text-muted">· {d.roles[m.member_role as keyof typeof d.roles]}</span></span>
                      <form action={revokeMemberAction}>
                        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="project_id" value={id} />
                        <button className="text-xs text-red-700 underline">{d.revoke}</button>
                      </form>
                    </li>
                  ))}
                </ul>
              ) : <p className="mb-4 text-sm text-muted">{d.none}</p>}
              <ActionForm action={addMemberAction} messages={msgs} submitLabel={d.addMember} resetOnSuccess className="space-y-2"
                submitClassName="w-full rounded-md border border-navy/20 px-3 py-2 text-sm font-medium text-navy hover:border-gold">
                <input type="hidden" name="project_id" value={id} />
                <select name="profile_id" required className={inputCls} defaultValue="">
                  <option value="" disabled>—</option>
                  {peopleList.filter((x) => x.role !== "direccio" && !memberList.some((m) => m.profile.id === x.id)).map((x) => (
                    <option key={x.id} value={x.id}>{x.full_name || x.email} ({d.roles[x.role as keyof typeof d.roles]})</option>
                  ))}
                </select>
                <select name="member_role" className={inputCls} defaultValue="arquitecte">
                  <option value="arquitecte">{d.roles.arquitecte}</option>
                  <option value="constructor">{d.roles.constructor}</option>
                  <option value="client">{d.roles.client}</option>
                </select>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
