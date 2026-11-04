import { requireActiveProfile } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export default async function IniciPage() {
  const profile = await requireActiveProfile();
  const d = t(profile.locale);
  const supabase = await createClient();

  // Recompte real; l'RLS limita automàticament què veu cada rol.
  const { count: projectCount, error: projectsError } = await supabase
    .from("projects")
    .select("id", { count: "exact", head: true });

  let pendingUsers: number | null = null;
  if (profile.role === "direccio") {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_active", false);
    pendingUsers = count ?? 0;
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-navy">
        {d.welcome}, {profile.fullName || profile.email}
      </h1>
      <div className="mt-2 h-1 w-16 rounded bg-gold" />

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card label={d.projectsVisible} value={projectsError ? "—" : String(projectCount ?? 0)} />
        {pendingUsers !== null && <Card label={d.usersPending} value={String(pendingUsers)} />}
      </section>

      {!projectsError && projectCount === 0 && <p className="mt-6 text-muted">{d.noProjects}</p>}
      {projectsError && <p className="mt-6 text-red-700">{d.genericError}</p>}

      {profile.role === "direccio" && <p className="mt-10 text-sm text-muted">{d.nextModules}</p>}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-navy">{value}</p>
    </div>
  );
}
