// Crear un pressupost amb el configurador (tarifa vigent del catàleg central).
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfiguratorForm } from "@/components/configurator/configurator-form";
import { Card, PageHeader, btnSecondary } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { loadTariffInForce } from "@/lib/configurator/load-tariff";
import { formatDate } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export default async function ConfiguradorPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("direccio", "arquitecte");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("id, code, title").eq("id", id).maybeSingle();
  if (!project) notFound();
  const L = profile.locale;
  const X = qx(L);
  const T = qt(L);
  const tariff = await loadTariffInForce(supabase);
  const base = actionMessages(L);
  return (
    <div className="max-w-7xl space-y-4">
      <PageHeader title={`${X.configurator} · ${X.createQuote}`} subtitle={`${project.code} · ${project.title}`}
        actions={<Link href={`/projectes/${id}/pressupostos`} className={btnSecondary}>← {T.projectQuotes}</Link>} />
      {tariff ? (
        <ConfiguratorForm projectId={id} tariff={tariff.params} tariffId={tariff.id} showInternal={profile.role === "direccio"}
          tariffLabel={`${X.tariffInForce} ${tariff.number} · ${X.effectiveFrom} ${formatDate(tariff.effectiveFrom, L)}`}
          X={X} errors={{ ...base.errors, ...T.errors }} defaultTitle={`${L === "es" ? "Vivienda" : "Habitatge"} ${project.title}`} />
      ) : <Card><p className="text-sm text-red-700">{T.errors.noTariff}</p></Card>}
    </div>
  );
}
