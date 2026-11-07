import { PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { formatDate, isoFromNow, madridDateKey } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { formatCents } from "@/lib/money";
import { MAIN_STAGES, PRIORITY_LABELS, PRIORITY_STYLE, SIDE_STAGES, stageLabel, type Priority } from "@/lib/pipeline";
import { one } from "@/lib/rel";
import { createClient } from "@/lib/supabase/server";
import { Board, type KanbanCard } from "./board";

export default async function KanbanPage() {
  const profile = await requireRole("direccio");
  const L = profile.locale;
  const d = t(L);
  const supabase = await createClient();
  const today = madridDateKey();
  const sideSince = isoFromNow(-180);

  const { data: rows } = await supabase.from("projects")
    .select("id, code, title, status, municipality, surface_m2, priority, next_action, follow_up_date, last_activity_at, stage_changed_at, responsible_id, responsible:profiles!projects_responsible_id_fkey(full_name, email), project_financials(estimated_sale_cents), project_holders(is_primary, clients(display_name))")
    // Els estats laterals només mostren els últims 6 mesos
    .or(`status.in.(${MAIN_STAGES.join(",")}),stage_changed_at.gte.${sideSince}`)
    .order("stage_changed_at", { ascending: false })
    .limit(500);

  const { data: people } = await supabase.from("profiles").select("id, full_name, email")
    .in("role", ["direccio", "arquitecte"]).eq("is_active", true).order("full_name");

  const cards: KanbanCard[] = (rows ?? []).map((p) => {
    const holders = p.project_holders as unknown as { is_primary: boolean; clients: { display_name: string } | { display_name: string }[] | null }[];
    const primary = one(holders.find((h) => h.is_primary)?.clients ?? null);
    const fin = one(p.project_financials as unknown as { estimated_sale_cents: number | null } | null);
    const resp = one(p.responsible as unknown as { full_name: string; email: string } | null);
    const pr = p.priority as Priority;
    return {
      id: p.id,
      code: p.code,
      status: p.status,
      clientName: primary?.display_name ?? p.title,
      location: p.municipality,
      surface: p.surface_m2 ? `${Number(p.surface_m2).toLocaleString(L === "es" ? "es-ES" : "ca-ES")} m²` : null,
      budget: fin?.estimated_sale_cents != null ? formatCents(fin.estimated_sale_cents, { decimals: false }) : null,
      responsible: resp ? resp.full_name || resp.email : null,
      responsibleId: p.responsible_id,
      lastActivity: p.last_activity_at ? formatDate(p.last_activity_at, L) : null,
      nextAction: p.next_action,
      followUp: p.follow_up_date ? formatDate(p.follow_up_date, L) : null,
      followUpLate: !!p.follow_up_date && p.follow_up_date < today && MAIN_STAGES.slice(0, 3).includes(p.status as never),
      priority: pr,
      priorityLabel: PRIORITY_LABELS[L][pr],
      priorityClass: PRIORITY_STYLE[pr],
    };
  });

  return (
    <div>
      <PageHeader title={d.kanban} />
      <Board
        initialCards={cards}
        messages={actionMessages(L)}
        people={(people ?? []).map((p) => ({ id: p.id, name: p.full_name || p.email }))}
        columns={[
          ...MAIN_STAGES.map((s) => ({ stage: s, label: stageLabel(s, L) })),
          ...SIDE_STAGES.map((s) => ({ stage: s, label: stageLabel(s, L), side: true })),
        ]}
        texts={{
          noCards: d.noCards, moveTo: d.move, lostReason: d.lostReason, cancel: d.cancel, move: d.move,
          search: d.search, responsible: d.responsible, all: d.all, lastActivity: d.lastActivity,
          nextAction: d.nextAction, followUp: d.followUpDate, dragHint: d.dragHint,
        }}
      />
    </div>
  );
}
