// Client per al navegador. Només rep la URL i la clau publicable.
// Mai importar aquí SUPABASE_SECRET_KEY: no té prefix NEXT_PUBLIC_ i Next.js no l'exposa.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
