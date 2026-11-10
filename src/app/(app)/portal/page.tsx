import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { av } from "@/lib/i18n-avantprojecte";
import { createClient } from "@/lib/supabase/server";

// Entrada del portal: si el client només té un projecte, hi va directament.
export default async function PortalIndex() {
  const profile = await requireRole("client");
  const T = av(profile.locale).portal;
  const supabase = await createClient();
  const { data: projects } = await supabase.from("projects").select("id, title, code").order("created_at", { ascending: false });
  if (projects?.length === 1) redirect(`/portal/${projects[0].id}`);
  return (
    <div className="max-w-3xl">
      <PageHeader title={T.myProjects} />
      {projects?.length ? (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/portal/${p.id}`} className="block rounded-xl border border-navy/10 bg-white p-4 shadow-sm hover:border-gold">
                <span className="font-semibold text-navy">{p.title}</span> <span className="text-xs text-muted">{p.code}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyState>—</EmptyState>}
    </div>
  );
}
