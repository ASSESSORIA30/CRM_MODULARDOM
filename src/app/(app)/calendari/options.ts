import "server-only";
import { createClient } from "@/lib/supabase/server";
import { one } from "@/lib/rel";

/** Opcions dels desplegables del formulari de cita, limitades per l'RLS. */
export async function eventOptions(isDir: boolean) {
  const supabase = await createClient();
  const [{ data: projects }, { data: clients }, { data: people }] = await Promise.all([
    supabase.from("projects").select("id, code, title, project_holders(is_primary, clients(display_name))")
      .not("status", "in", "(perdut,finalitzat)").order("created_at", { ascending: false }).limit(300),
    isDir ? supabase.from("clients").select("id, display_name").is("merged_into", null).order("display_name").limit(500) : Promise.resolve({ data: [] }),
    isDir ? supabase.from("profiles").select("id, full_name, email, role").eq("is_active", true).neq("role", "client").order("full_name") : Promise.resolve({ data: [] }),
  ]);
  return {
    projects: (projects ?? []).map((p) => {
      const h = (p.project_holders as unknown as { is_primary: boolean; clients: unknown }[]).find((x) => x.is_primary);
      const name = one(h?.clients as { display_name: string } | null)?.display_name;
      return { id: p.id, label: `${p.code} · ${name ?? p.title}` };
    }),
    clients: ((clients ?? []) as { id: string; display_name: string }[]).map((c) => ({ id: c.id, label: c.display_name })),
    people: ((people ?? []) as { id: string; full_name: string; email: string }[]).map((p) => ({ id: p.id, label: p.full_name || p.email })),
  };
}
