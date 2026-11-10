// Lectura centralitzada de la configuració pública de Supabase.
// Si falta, l'aplicació mostra /configuracio-pendent en lloc de fallar en blanc.

export const REQUIRED_PUBLIC_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export type PublicSupabaseEnv = { url: string; publishableKey: string };

export function readPublicSupabaseEnv(): PublicSupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return null;
    }
  } catch {
    return null;
  }
  return { url, publishableKey };
}

/** Noms (mai valors) de les variables que falten. */
export function missingEnvNames(): string[] {
  const names: string[] = REQUIRED_PUBLIC_ENV.filter((n) => !process.env[n]);
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && !readPublicSupabaseEnv() && names.length === 0) {
    names.push("NEXT_PUBLIC_SUPABASE_URL (format no vàlid)");
  }
  return names;
}

export function requirePublicSupabaseEnv(): PublicSupabaseEnv {
  const env = readPublicSupabaseEnv();
  if (!env) throw new Error(`Configuració de Supabase incompleta: ${missingEnvNames().join(", ")}`);
  return env;
}
