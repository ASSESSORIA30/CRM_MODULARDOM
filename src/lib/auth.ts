// Capa d'accés a dades per a la identitat de l'usuari (Data Access Layer).
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole = "direccio" | "arquitecte" | "constructor" | "client";
export type AppLocale = "ca" | "es";

export type CurrentProfile = {
  id: string;
  email: string;
  fullName: string;
  role: AppRole;
  locale: AppLocale;
  isActive: boolean;
};

/** Usuari autenticat + perfil (llegit amb RLS). Redirigeix si no hi ha sessió. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/login");

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, locale, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`No s'ha pogut llegir el perfil: ${error.message}`);
  if (!data) redirect("/login?error=perfil");

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role as AppRole,
    locale: data.locale as AppLocale,
    isActive: data.is_active,
  };
});

/** Perfil actiu; si el compte no està activat, porta a /pendent. */
export async function requireActiveProfile(): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile.isActive) redirect("/pendent");
  return profile;
}
