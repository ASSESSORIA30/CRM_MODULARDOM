// Client per a Server Components / Server Actions amb la sessió de l'usuari.
// Usa la clau publicable: tots els accessos passen per RLS.
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Cridat des d'un Server Component: el middleware refresca la sessió.
          }
        },
      },
    },
  );
}
