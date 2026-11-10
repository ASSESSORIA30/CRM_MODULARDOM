import Link from "next/link";
import { PageHeader, btnSecondary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { actionMessages } from "@/lib/messages";
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, PRIORITIES, PRIORITY_LABELS } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";
import { LeadForm } from "./lead-form";

export default async function NouLeadPage() {
  const profile = await requireRole("direccio");
  const d = t(profile.locale);
  const supabase = await createClient();
  const { data: people } = await supabase.from("profiles").select("id, full_name, email")
    .in("role", ["direccio", "arquitecte"]).eq("is_active", true).order("full_name");

  return (
    <div className="max-w-4xl">
      <PageHeader title={d.newLead} actions={<Link href="/clients" className={btnSecondary}>{d.back}</Link>} />
      <LeadForm
        me={profile.id}
        messages={actionMessages(profile.locale)}
        d={{
          clientName: d.clientName, email: d.email, phone: d.phone, language: d.language, leadSource: d.leadSource,
          municipality: d.municipality, surface: d.surface, estimatedBudget: d.estimatedBudget, responsible: d.responsible,
          priority: d.priority, nextAction: d.nextAction, followUpDate: d.followUpDate, notes: d.notes, create: d.create,
          possibleDuplicates: d.possibleDuplicates, duplicatesHelp: d.duplicatesHelp, useThisClient: d.useThisClient,
          createAnyway: d.createAnyway, optional: d.optional, dupReason: d.dupReason,
        }}
        sources={LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABELS[profile.locale][s] }))}
        priorities={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[profile.locale][p] }))}
        people={(people ?? []).map((p) => ({ value: p.id, label: p.full_name || p.email }))}
      />
    </div>
  );
}
