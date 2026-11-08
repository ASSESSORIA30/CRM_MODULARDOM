// Llistat de pressupostos amb la darrera versió i els seus totals.
import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

export async function listQuotes(supabase: Supa, projectId?: string) {
  let query = supabase.from("quotes")
    .select("id, code, title, created_at, accepted_version_id, project_id, projects(code, title), quote_versions(id, version, status, issue_date, valid_until)")
    .order("created_at", { ascending: false }).limit(300);
  if (projectId) query = query.eq("project_id", projectId);
  const { data } = await query;
  const rows = (data ?? []).map((q) => {
    const versions = [...(q.quote_versions ?? [])].sort((a, b) => b.version - a.version);
    const current = versions.find((v) => v.id === q.accepted_version_id) ?? versions[0];
    const p = (Array.isArray(q.projects) ? q.projects[0] : q.projects) as { code: string; title: string } | null;
    return { id: q.id, code: q.code, title: q.title, projectId: q.project_id, project: p, current, versionCount: versions.length };
  }).filter((r) => r.current);
  const ids = rows.map((r) => r.current!.id);
  const { data: totals } = ids.length
    ? await supabase.from("quote_version_totals").select("version_id, taxable_cents, total_cents").in("version_id", ids)
    : { data: [] };
  const byId = new Map((totals ?? []).map((t) => [t.version_id, t]));
  return rows.map((r) => ({ ...r, taxableCents: Number(byId.get(r.current!.id)?.taxable_cents ?? 0), totalCents: Number(byId.get(r.current!.id)?.total_cents ?? 0) }));
}
export type QuoteRow = Awaited<ReturnType<typeof listQuotes>>[number];
