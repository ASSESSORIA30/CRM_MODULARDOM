import Link from "next/link";
import { EmptyState, PageHeader, Tabs, btnPrimary, btnSecondary } from "@/components/ui";
import { requireActiveProfile } from "@/lib/auth";
import {
  addDays, addMonths, formatDayHeader, formatMonthTitle, formatTime, isValidDateKey, madridDateKey,
  madridLocalToDate, startOfMonth, startOfWeek,
} from "@/lib/dates";
import { t } from "@/lib/i18n";
import { EVENT_COLOR, EVENT_LABELS, type EventKind } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

type View = "mes" | "setmana" | "dia" | "agenda";
type Ev = { id: string; title: string; kind: string; starts_at: string; ends_at: string | null; all_day: boolean; status: string; location: string | null };

export default async function CalendariPage({ searchParams }: { searchParams: Promise<{ vista?: string; data?: string; meus?: string }> }) {
  const profile = await requireActiveProfile();
  const L = profile.locale;
  const d = t(L);
  const sp = await searchParams;
  const view: View = (["mes", "setmana", "dia", "agenda"] as const).find((v) => v === sp.vista) ?? "mes";
  const today = madridDateKey();
  const date = isValidDateKey(sp.data) ? sp.data : today;
  const isDir = profile.role === "direccio";
  const onlyMine = isDir && sp.meus === "1";
  const canCreate = isDir || profile.role === "arquitecte";

  // Rang visible
  let from: string, to: string, prev: string, next: string;
  if (view === "mes") {
    const m0 = startOfMonth(date);
    from = startOfWeek(m0);
    to = addDays(from, 42);
    prev = addMonths(date, -1); next = addMonths(date, 1);
  } else if (view === "setmana") {
    from = startOfWeek(date); to = addDays(from, 7);
    prev = addDays(date, -7); next = addDays(date, 7);
  } else if (view === "dia") {
    from = date; to = addDays(date, 1);
    prev = addDays(date, -1); next = addDays(date, 1);
  } else {
    from = date; to = addDays(date, 60);
    prev = addDays(date, -60); next = addDays(date, 60);
  }

  const supabase = await createClient();
  let q = supabase.from("calendar_events")
    .select("id, title, kind, starts_at, ends_at, all_day, status, location")
    .gte("starts_at", madridLocalToDate(from).toISOString())
    .lt("starts_at", madridLocalToDate(to).toISOString())
    .neq("status", "cancellat")
    .order("starts_at").limit(1000);
  if (onlyMine) q = q.eq("responsible_id", profile.id);
  const { data } = await q;
  const events = (data ?? []) as Ev[];
  const byDay = new Map<string, Ev[]>();
  for (const e of events) {
    const k = madridDateKey(e.starts_at);
    byDay.set(k, [...(byDay.get(k) ?? []), e]);
  }

  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ vista: view, data: date, ...(onlyMine ? { meus: "1" } : {}), ...o });
    return `/calendari?${p.toString()}`;
  };

  const title = view === "mes" ? formatMonthTitle(date, L)
    : view === "dia" ? formatDayHeader(date, L)
    : `${formatDayHeader(from, L)} – ${formatDayHeader(addDays(to, -1), L)}`;

  const chip = (e: Ev, compact = false) => (
    <Link key={e.id} href={`/calendari/${e.id}`}
      className={`block truncate rounded border-l-4 bg-white px-1.5 py-0.5 text-xs shadow-sm hover:bg-gold-light/40 ${EVENT_COLOR[e.kind as EventKind] ?? "border-l-slate-300"} ${e.status === "fet" ? "opacity-60" : ""}`}
      title={e.title}>
      {!e.all_day && <span className="mr-1 font-semibold tabular-nums">{formatTime(e.starts_at, L)}</span>}
      {e.title}
      {!compact && <span className="block text-[11px] text-muted">{EVENT_LABELS[L][e.kind as EventKind]}{e.location ? ` · ${e.location}` : ""}</span>}
    </Link>
  );

  const dayList = (keys: string[]) => (
    <div className="space-y-4">
      {keys.map((k) => (
        <section key={k} className="rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
          <h3 className={`mb-2 text-sm font-semibold capitalize ${k === today ? "text-gold" : "text-navy"}`}>{formatDayHeader(k, L)}</h3>
          {(byDay.get(k) ?? []).length ? <div className="space-y-1.5">{byDay.get(k)!.map((e) => chip(e))}</div> : <p className="text-xs text-muted">—</p>}
        </section>
      ))}
    </div>
  );

  return (
    <div className="max-w-6xl">
      <PageHeader title={d.calendar} actions={canCreate && <Link href={`/calendari/nou?data=${date}`} className={btnPrimary}>+ {d.newEvent}</Link>} />
      <Tabs current={view} items={[
        { key: "dia", label: d.day, href: qs({ vista: "dia" }) },
        { key: "setmana", label: d.week, href: qs({ vista: "setmana" }) },
        { key: "mes", label: d.month, href: qs({ vista: "mes" }) },
        { key: "agenda", label: d.agenda, href: qs({ vista: "agenda" }) },
      ]} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={qs({ data: prev })} className={btnSecondary} aria-label={d.previous}>‹</Link>
        <Link href={qs({ data: today })} className={btnSecondary}>{d.today}</Link>
        <Link href={qs({ data: next })} className={btnSecondary} aria-label={d.next}>›</Link>
        <h2 className="ml-2 text-lg font-semibold capitalize text-navy">{title}</h2>
        {isDir && (
          <Link href={qs({ meus: onlyMine ? "0" : "1" })} className={`ml-auto ${btnSecondary} ${onlyMine ? "border-gold bg-gold-light/40" : ""}`}>
            {onlyMine ? "✓ " : ""}{d.onlyMine}
          </Link>
        )}
      </div>

      {view === "mes" && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[44rem] grid-cols-7 overflow-hidden rounded-xl border border-navy/10 bg-navy/10 shadow-sm" style={{ gap: 1 }}>
            {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((k) => (
              <div key={k} className="bg-navy px-2 py-1.5 text-center text-xs font-semibold uppercase text-white">
                {new Intl.DateTimeFormat(L === "es" ? "es-ES" : "ca-ES", { weekday: "short", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`))}
              </div>
            ))}
            {Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((k) => {
              const inMonth = k.slice(0, 7) === date.slice(0, 7);
              const evs = byDay.get(k) ?? [];
              return (
                <div key={k} className={`min-h-24 p-1.5 ${inMonth ? "bg-white" : "bg-surface"}`}>
                  <Link href={qs({ vista: "dia", data: k })}
                    className={`mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${k === today ? "bg-gold font-bold text-navy-dark" : inMonth ? "text-navy" : "text-muted"}`}>
                    {Number(k.slice(8))}
                  </Link>
                  <div className="space-y-1">
                    {evs.slice(0, 3).map((e) => chip(e, true))}
                    {evs.length > 3 && <Link href={qs({ vista: "dia", data: k })} className="block text-[11px] text-muted">+{evs.length - 3}</Link>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {view === "setmana" && dayList(Array.from({ length: 7 }, (_, i) => addDays(from, i)))}
      {view === "dia" && dayList([date])}
      {view === "agenda" && (
        events.length ? dayList([...byDay.keys()]) : <EmptyState>{d.noEvents}</EmptyState>
      )}
    </div>
  );
}
