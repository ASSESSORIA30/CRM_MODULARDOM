import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { TariffParams } from "./engine";
import { tariffSchema } from "./tariff";

type Supa = Awaited<ReturnType<typeof createClient>>;
export type LoadedTariff = { id: string; number: number; effectiveFrom: string; params: TariffParams };

/** Tarifa vigent avui per als pressupostos nous del CRM (validada amb l'esquema). */
export async function loadTariffInForce(supabase: Supa): Promise<LoadedTariff | null> {
  const { data: id } = await supabase.rpc("tariff_in_force");
  if (!id) return null;
  const { data } = await supabase.from("tariff_versions").select("id, number, effective_from, params").eq("id", id as string).maybeSingle();
  const parsed = tariffSchema.safeParse(data?.params);
  if (!data || !parsed.success) return null;
  return { id: data.id, number: data.number, effectiveFrom: data.effective_from!, params: parsed.data };
}
