import Link from "next/link";
import { Badge, EmptyState, PageHeader, Tabs, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate, madridDateKey } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatCents } from "@/lib/money";
import { ALL_STAGES, PRIORITY_LABELS, PRIORITY_STYLE, isStage, stageLabel, type Priority } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/rel";

type SP = { vista?: string; q?: string; etapa?: string; resp?: string; contactar?: string; seguiment?: string };

function clean(q: string | undefined) {
  // Evita caràcters amb significat especial als filtres de PostgREST
  return (q ?? "").replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const profile = await requireRole("direccio");
  const d = t(profile.locale);
  const sp = await searchParams;
  const vista = sp.vista === "clients" ? "clients" : "projectes";
  const q = clean(sp.q);
  const supabase = await createClient();

  const tabs = (
    <Tabs current={vista} items={[
      { key: "projectes", label: `${d.projects} / leads`, href: "/clients" },
      { key: "clients", label: d.clients.split(" ")[0], href: "/clients?vista=clients" },
    ]} />
  );
  const header = <PageHeader title={d.clients} actions={<Link href="/clients/nou" className={btnPrimary}>+ {d.newLead}</Link>} />;

  if (vista === "clients") {
    let cq = supabase.from("clients").select("id, display_name, email, phone, city, lead_source, created_at, project_holders(project_id)")
      .is("merged_into", null).order("display_name").limit(300);
    if (q) cq = cq.or(`display_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,tax_id.ilike.%${q}%`);
    const { data: clients } = await cq;
    return (
      <div className="max-w-6xl">
        {header}{tabs}
        <form className="mb-4 flex gap-2">
          <input type="hidden" name="vista" value="clients" />
          <input name="q" defaultValue={q} placeholder={`${d.search}…`} className={`${inputCls} max-w-sm`} />
          <button className={btnSecondary}>{d.search}</button>
        </form>
        {clients?.length ? (
          <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-navy text-left text-xs uppercase tracking-wide text-white">
                <tr><th className="px-4 py-3">{d.client}</th><th className="px-4 py-3">{d.email}</th><th className="px-4 py-3">{d.phone}</th><th className="px-4 py-3">{d.city}</th><th className="px-4 py-3 text-right">{d.projects}</th></tr>
              </thead>
              <tbody className="divide-y divide-navy/5">
                {clients.map((c) => (
                  <tr key={c.id} className="hover:bg-surface">
                    <td className="px-4 py-3"><Link href={`/clients/${c.id}`} className="font-medium text-navy hover:text-gold">{c.display_name}</Link></td>
                    <td className="px-4 py-3 text-muted">{c.email ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{c.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{c.city ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{(c.project_holders as unknown[]).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>{d.noData}</EmptyState>}
      </div>
    );
  }

  // ---- Vista de projectes / leads ----
  const today = madridDateKey();
  let pq = supabase.from("projects")
    .select("id, code, title, municipality, status, priority, next_action, follow_up_date, last_activity_at, created_at, responsible:profiles!projects_responsible_id_fkey(full_name, email), project_financials(estimated_sale_cents), project_holders(is_primary, clients(id, display_name))")
    .order("created_at", { ascending: false }).limit(300);
  if (isStage(sp.etapa)) pq = pq.eq("status", sp.etapa);
  if (sp.resp && /^[0-9a-f-]{36}$/.test(sp.resp)) pq = pq.eq("responsible_id", sp.resp);
  if (sp.seguiment === "vencut") pq = pq.in("status", ["pressupost", "avantprojecte"]).lt("follow_up_date", today);
  if (q) pq = pq.or(`title.ilike.%${q}%,code.ilike.%${q}%,municipality.ilike.%${q}%`);
  const { data: rows } = await pq;

  let list = rows ?? [];
  if (sp.contactar === "1") {
    const { data: pend } = await supabase.from("project_steps").select("project_id").eq("step", 1).eq("status", "pendent");
    const set = new Set((pend ?? []).map((r) => r.project_id));
    list = list.filter((p) => set.has(p.id));
  }

  return (
    <div className="max-w-6xl">
      {header}{tabs}
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder={`${d.search}…`} className={`${inputCls} max-w-xs`} />
        <select name="etapa" defaultValue={sp.etapa ?? ""} className={`${inputCls} w-auto`}>
          <option value="">{d.stage}: {d.all}</option>
          {ALL_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s, profile.locale)}</option>)}
        </select>
        <button className={btnSecondary}>{d.filter}</button>
      </form>
      {list.length ? (
        <div className="overflow-x-auto rounded-xl border border-navy/10 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-navy text-left text-xs uppercase tracking-wide text-white">
              <tr>
                <th className="px-4 py-3">{d.project}</th><th className="px-4 py-3">{d.stage}</th>
                <th className="px-4 py-3">{d.responsible}</th><th className="px-4 py-3 text-right">{d.estimatedBudget.split(" (")[0]}</th>
                <th className="px-4 py-3">{d.nextAction}</th><th className="px-4 py-3">{d.followUpDate}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {list.map((p) => {
                const holder = one((p.project_holders as unknown as { is_primary: boolean; clients: { id: string; display_name: string } | null }[]).find((h) => h.is_primary)?.clients);
                const fin = one(p.project_financials as unknown as { estimated_sale_cents: number | null } | null);
                const respP = one(p.responsible as unknown as { full_name: string; email: string } | null);
                const late = p.follow_up_date && p.follow_up_date < today;
                return (
                  <tr key={p.id} className="hover:bg-surface">
                    <td className="px-4 py-3">
                      <Link href={`/projectes/${p.id}`} className="font-medium text-navy hover:text-gold">{holder?.display_name ?? p.title}</Link>
                      <p className="text-xs text-muted">{p.code}{p.municipality ? ` · ${p.municipality}` : ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className="bg-navy/5 text-navy">{stageLabel(p.status, profile.locale)}</Badge>{" "}
                      <Badge className={PRIORITY_STYLE[p.priority as Priority]}>{PRIORITY_LABELS[profile.locale][p.priority as Priority]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted">{respP ? respP.full_name || respP.email : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fin?.estimated_sale_cents != null ? formatCents(fin.estimated_sale_cents, { decimals: false }) : "—"}</td>
                    <td className="px-4 py-3 text-muted">{p.next_action ?? "—"}</td>
                    <td className={`px-4 py-3 ${late ? "font-semibold text-red-700" : "text-muted"}`}>{formatDate(p.follow_up_date, profile.locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState>{d.noData}</EmptyState>}
    </div>
  );
}
