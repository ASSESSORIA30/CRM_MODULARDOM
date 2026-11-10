// Client per a Server Components / Server Actions amb la sessió de l'usuari.
// Usa la clau publicable: tots els accessos passen per RLS.
import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requirePublicSupabaseEnv } from "@/lib/env";

export async function createClient() {
  // cookies() primer: marca la ruta com a dinàmica (mai prerenderitzada en el build).
  const cookieStore = await cookies();
  const { url, publishableKey } = requirePublicSupabaseEnv();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Cridat des d'un Server Component: el proxy ja refresca la sessió.
        }
      },
    },
  });
}
