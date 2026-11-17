"use server";

// Crear un pressupost amb el configurador (mateix motor i mateixa tarifa que la web).
import { redirect } from "next/navigation";
import { z } from "zod";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { calculate, validateInput } from "@/lib/configurator/engine";
import { loadTariffInForce } from "@/lib/configurator/load-tariff";
import { engineToQuoteLines } from "@/lib/configurator/to-quote";
import { reqText, reqUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  metres: z.number().int(), habitacions: z.number().int(), banys: z.number().int(),
  suite: z.enum(["sin", "bano", "bano_vestidor"]), cuina: z.enum(["basica", "isla"]), vehicles: z.number().int(),
  safareig: z.boolean(), installacions: z.array(z.string().max(40)).max(10), extres: z.array(z.string().max(40)).max(20),
});

export async function createFromConfiguratorAction(raw: { projectId: string; title: string; locale: string; tariffId: string; input: unknown }): Promise<ActionResult> {
  await requireRole("direccio", "arquitecte");
  const p = z.object({ projectId: reqUuid, title: reqText(200), locale: z.enum(["ca", "es"]), tariffId: reqUuid, input: inputSchema }).safeParse(raw);
  if (!p.success) return { ok: false, error: "required" };
  const supabase = await createClient();
  const tariff = await loadTariffInForce(supabase);
  if (!tariff) return { ok: false, error: "noTariff" };
  // Si la tarifa ha canviat mentre es configurava, cal tornar a revisar els imports
  if (tariff.id !== p.data.tariffId) return { ok: false, error: "tariffChanged" };
  if (validateInput(tariff.params, p.data.input).length) return { ok: false, error: "invalidConfig" };
  const result = calculate(tariff.params, p.data.input);
  const { data: versionId, error } = await supabase.rpc("create_quote", { p_project_id: p.data.projectId, p_title: p.data.title, p_locale: p.data.locale });
  if (error) return fromPgError(error);
  const snap = await supabase.rpc("set_configurator_snapshot", { p_version_id: versionId, p_tariff_id: tariff.id, p_input: p.data.input, p_result: result });
  if (snap.error) return fromPgError(snap.error);
  const save = await supabase.rpc("save_quote_draft", {
    p_version_id: versionId, p_locale: p.data.locale, p_intro: null, p_notes: null, p_exclusions: null, p_payment_terms: null,
    p_lines: engineToQuoteLines(tariff.params, p.data.input, result, p.data.locale),
  });
  if (save.error) return fromPgError(save.error);
  redirect(`/pressupostos/${versionId}`);
}
