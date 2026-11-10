import Link from "next/link";
import { Badge, EmptyState, PageHeader, Tabs, btnPrimary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate, madridDateKey } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { PRIORITY_LABELS, PRIORITY_STYLE, TASK_KIND_LABELS, TASK_STATUS_LABELS, type Priority } from "@/lib/pipeline";
import { one } from "@/lib/rel";
import { createClient } from "@/lib/supabase/server";
import { setTaskStatusAction } from "./actions";

export default async function TasquesPage({ searchParams }: { searchParams: Promise<{ vista?: string; vencudes?: string }> }) {
  const profile = await requireRole("direccio", "arquitecte", "constructor");
  const L = profile.locale;
  const d = t(L);
  const sp = await searchParams;
  const isDir = profile.role === "direccio";
  const vista = sp.vista === "fetes" ? "fetes" : sp.vista === "totes" && isDir ? "totes" : "meves";
  const today = madridDateKey();
  const supabase = await createClient();

  let q = supabase.from("tasks")
    .select("id, title, description, kind, status, priority, due_date, project_id, client_id, projects(code, title), clients(display_name), assignee:profiles!tasks_assigned_to_fkey(full_name, email)")
    .order("due_date", { ascending: true, nullsFirst: false }).order("created_at").limit(500);
  if (vista === "meves") q = q.eq("assigned_to", profile.id).in("status", ["pendent", "en_curs"]);
  if (vista === "totes") q = q.in("status", ["pendent", "en_curs"]);
  if (vista === "fetes") q = (isDir ? q : q.eq("assigned_to", profile.id)).in("status", ["feta", "cancellada"]);
  if (sp.vencudes === "1") q = q.lt("due_date", today);
  const { data: tasks } = await q;

  return (
    <div className="max-w-5xl">
      <PageHeader title={d.tasks} actions={profile.role !== "constructor" && <Link href="/tasques/nova" className={btnPrimary}>+ {d.newTask}</Link>} />
      <Tabs current={vista} items={[
        { key: "meves", label: d.mine, href: "/tasques" },
        ...(isDir ? [{ key: "totes", label: `${d.all} · ${d.open}`, href: "/tasques?vista=totes" }] : []),
        { key: "fetes", label: d.done, href: "/tasques?vista=fetes" },
      ]} />
      {tasks?.length ? (
        <ul className="space-y-2">
          {tasks.map((tk) => {
            const late = tk.due_date && tk.due_date < today && ["pendent", "en_curs"].includes(tk.status);
            const proj = one(tk.projects as unknown as { code: string; title: string } | null);
            const cli = one(tk.clients as unknown as { display_name: string } | null);
            const who = one(tk.assignee as unknown as { full_name: string; email: string } | null);
            const open = ["pendent", "en_curs"].includes(tk.status);
            return (
              <li key={tk.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-navy/10 bg-white p-4 shadow-sm">
                <form action={setTaskStatusAction} className="pt-0.5">
                  <input type="hidden" name="id" value={tk.id} />
                  <button name="status" value={open ? "feta" : "pendent"} title={open ? d.markDone : d.reopen}
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs ${open ? "border-navy/30 hover:border-gold" : "border-gold bg-gold text-navy-dark"}`}>
                    {open ? "" : "✓"}
                  </button>
                </form>
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${open ? "text-ink" : "text-muted line-through"}`}>{tk.title}</p>
                  {tk.description && <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{tk.description}</p>}
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge className={PRIORITY_STYLE[tk.priority as Priority]}>{PRIORITY_LABELS[L][tk.priority as Priority]}</Badge>
                    <span>{TASK_KIND_LABELS[L][tk.kind as keyof (typeof TASK_KIND_LABELS)["ca"]]}</span>
                    {proj && (isDir || profile.role === "arquitecte"
                      ? <Link href={`/projectes/${tk.project_id}`} className="underline">{proj.code}</Link>
                      : <span>{proj.code}</span>)}
                    {cli && isDir && <Link href={`/clients/${tk.client_id}`} className="underline">{cli.display_name}</Link>}
                    {who && vista !== "meves" && <span>· {who.full_name || who.email}</span>}
                    <span className={late ? "font-semibold text-red-700" : ""}>· {formatDate(tk.due_date, L)}{late ? ` (${d.overdue})` : ""}</span>
                  </p>
                </div>
                {open && (
                  <form action={setTaskStatusAction}>
                    <input type="hidden" name="id" value={tk.id} />
                    {tk.status === "pendent" ? (
                      <button name="status" value="en_curs" className="text-xs text-navy underline">{TASK_STATUS_LABELS[L].en_curs}</button>
                    ) : (
                      <span className="text-xs text-sky-700">{TASK_STATUS_LABELS[L].en_curs}</span>
                    )}
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : <EmptyState>{d.noData}</EmptyState>}
    </div>
  );
}
