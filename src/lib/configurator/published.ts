import "server-only";
import { createClient } from "@supabase/supabase-js";
import { tariffSchema } from "./tariff";

// Orígens que poden llegir la tarifa des del navegador (la web pública de ModularDom)
export const WEB_ORIGINS = ["https://www.modulardom.com", "https://modulardom.com"];

export type PublishedTariff = { number: number; effectiveFrom: string; publishedAt: string; params: unknown };

/** Tarifa publicada a la web (lectura anònima; sense dades personals). null si encara no se n'ha publicat cap. */
export async function getPublishedTariff(): Promise<PublishedTariff | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("web_published_tariff");
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row || !tariffSchema.safeParse(row.params).success) return null;
  return { number: row.number, effectiveFrom: row.effective_from, publishedAt: row.published_at, params: row.params };
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && WEB_ORIGINS.includes(origin) ? origin : WEB_ORIGINS[0],
    "Vary": "Origin",
    "Cache-Control": "public, max-age=60, s-maxage=60",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}
