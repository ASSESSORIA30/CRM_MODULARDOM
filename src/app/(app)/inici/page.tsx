import Link from "next/link";
import { Card, EmptyState, PageHeader, StatCard, inputCls, btnSecondary } from "@/components/ui";
import { requireActiveProfile } from "@/lib/auth";
import { formatDateTime, isoFromNow, madridDateKey } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { EVENT_LABELS, type EventKind } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

const PERIODS = [7, 30, 90] as const;

export default async function IniciPage({ searchParams }: { searchParams: Promise<{ periode?: string; resp?: string }> }) {
  const profile = await requireActiveProfile();
  const d = t(profile.locale);
  const supabase = await createClient();
  const sp = await searchParams;
  const today = madridDateKey();
  const nowIso = isoFromNow(0);
  const in7 = isoFromNow(7);

  const { data: upcoming } = await supabase
    .from("calendar_events")
    .select("id, title, kind, starts_at, location, projects(title)")
    .gte("starts_at", nowIso).lte("starts_at", in7)
    .in("status", ["previst", "confirmat"])
    .order("starts_at").limit(8);

  const { count: myTasks } = await supabase
    .from("tasks").select("id", { count: "exact", head: true })
    .eq("assigned_to", profile.id).in("status", ["pendent", "en_curs"]);

  const upcomingList = (
    <Card title={d.dashUpcoming} actions={<Link href="/calendari?vista=agenda" className="text-sm text-navy underline">{d.calendar}</Link>}>
      {upcoming?.length ? (
        <ul className="divide-y divide-navy/5">
          {upcoming.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <Link href={`/calendari/${e.id}`} className="flex flex-wrap justify-between gap-2 hover:text-gold">
                <span className="font-medium text-navy">{e.title}</span>
                <span className="text-muted">{formatDateTime(e.starts_at, profile.locale)}</span>
              </Link>
              <p className="text-xs text-muted">
                {EVENT_LABELS[profile.locale][e.kind as EventKind]}
                {(e.projects as { title?: string } | null)?.title ? ` · ${(e.projects as { title?: string }).title}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : <EmptyState>{d.noEvents}</EmptyState>}
    </Card>
  );

  if (profile.role !== "direccio") {
    const { count: projects } = await supabase.from("projects").select("id", { count: "exact", head: true });
    return (
      <div className="max-w-6xl">
        <PageHeader title={`${d.welcome}, ${profile.fullName || profile.email}`} />
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label={d.dashMyProjects} value={projects ?? 0} />
          {profile.role !== "client" && <StatCard label={d.dashMyTasks} value={myTasks ?? 0} href="/tasques" />}
        </section>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">{upcomingList}</div>
      </div>
    );
  }

  // ---- Direcció ----
  const period = PERIODS.find((p) => String(p) === sp.periode) ?? null;
  const resp = sp.resp && /^[0-9a-f-]{36}$/.test(sp.resp) ? sp.resp : null;

  let q = supabase.from("projects").select("id, status, created_at, follow_up_date");
  if (resp) q = q.eq("responsible_id", resp);
  const [{ data: projects }, { data: pendingContact }, { count: overdueTasks }, { data: people }] = await Promise.all([
    q,
    supabase.from("project_steps").select("project_id").eq("step", 1).eq("status", "pendent"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["pendent", "en_curs"]).lt("due_date", today),
    supabase.from("profiles").select("id, full_name, email").in("role", ["direccio", "arquitecte"]).eq("is_active", true).order("full_name"),
  ]);

  const list = projects ?? [];
  const by = (s: string) => list.filter((p) => p.status === s).length;
  const since = period ? new Date(isoFromNow(-period)) : null;
  const leadsNew = list.filter((p) => p.status === "lead" && (!since || new Date(p.created_at) >= since)).length;
  const pendingSet = new Set((pendingContact ?? []).map((r) => r.project_id));
  const toContact = list.filter((p) => p.status === "lead" && pendingSet.has(p.id)).length;
  const followUpOverdue = list.filter((p) => ["pressupost", "avantprojecte"].includes(p.status) && p.follow_up_date && p.follow_up_date < today).length;
  const r = resp ? `&resp=${resp}` : "";

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`${d.welcome}, ${profile.fullName || profile.email}`}
        actions={
          <form className="flex flex-wrap items-end gap-2">
            <select name="periode" defaultValue={sp.periode ?? ""} className={`${inputCls} w-auto`} aria-label={d.period}>
              <option value="">{d.period}: {d.periodAll}</option>
              {PERIODS.map((p) => <option key={p} value={p}>{d.periodDays(p)}</option>)}
            </select>
            <select name="resp" defaultValue={resp ?? ""} className={`${inputCls} w-auto`} aria-label={d.responsible}>
              <option value="">{d.responsible}: {d.all}</option>
              {(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
            </select>
            <button className={btnSecondary}>{d.filter}</button>
          </form>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={d.dashLeadsNew} value={leadsNew} href={`/clients?etapa=lead${r}`} />
        <StatCard label={d.dashLeadsToContact} value={toContact} href={`/clients?etapa=lead&contactar=1${r}`} tone="alert" />
        <StatCard label={d.dashQuotesSent} value={by("pressupost")} href={`/clients?etapa=pressupost${r}`} />
        <StatCard label={d.dashQuotesFollowUp} value={followUpOverdue} href={`/clients?seguiment=vencut${r}`} tone="alert" />
        <StatCard label={d.dashPreproject} value={by("avantprojecte")} href={`/clients?etapa=avantprojecte${r}`} />
        <StatCard label={d.dashContracted} value={by("contractat")} href={`/clients?etapa=contractat${r}`} tone="gold" />
        <StatCard label={d.dashLicensing} value={by("projecte_llicencia")} href={`/clients?etapa=projecte_llicencia${r}`} />
        <StatCard label={d.dashActiveWorks} value={by("en_obra")} href={`/clients?etapa=en_obra${r}`} />
        <StatCard label={d.dashMyTasks} value={myTasks ?? 0} href="/tasques" />
        <StatCard label={d.dashOverdueTasks} value={overdueTasks ?? 0} href="/tasques?vista=totes&vencudes=1" tone="alert" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">{upcomingList}</div>
      <p className="mt-8 text-xs text-muted">{d.dashEconomicLater}</p>
    </div>
  );
}
