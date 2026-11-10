// Client amb privilegis d'administració (salta l'RLS).
// NOMÉS per a codi de servidor: Server Actions, Route Handlers, jobs.
// `server-only` fa fallar el build si aquest mòdul s'importa des d'un component client.
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error("Falten NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY al servidor");
  }
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
