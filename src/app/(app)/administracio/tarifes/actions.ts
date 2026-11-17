"use server";

// Tarifes del configurador i dades de l'empresa (només direcció).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/auth";
import { tariffSchema } from "@/lib/configurator/tariff";
import { paramsFromForm } from "@/lib/configurator/tariff-form";
import { isValidDateKey } from "@/lib/dates";
import { optText, reqUuid } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";

const PATH = "/administracio/tarifes";

export async function newTariffDraftAction(): Promise<ActionResult> {
  await requireRole("direccio");
  const supabase = await createClient();
  const { error } = await supabase.rpc("new_tariff_draft");
  if (error) return fromPgError(error);
  revalidatePath(PATH);
  return { ok: true };
}

export async function saveTariffDraftAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "genericError" };
  const parsed = tariffSchema.safeParse(paramsFromForm(formData));
  if (!parsed.success) return { ok: false, error: "tariffInvalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("tariff_versions").update({ params: parsed.data, notes: optText(1000).parse(formData.get("notes")) ?? null })
    .eq("id", id.data).eq("status", "esborrany");
  if (error) return fromPgError(error);
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteTariffDraftAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("tariff_versions").delete().eq("id", id.data).eq("status", "esborrany");
  if (error) return fromPgError(error);
  revalidatePath(PATH);
  return { ok: true };
}

export async function approveTariffAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({ id: reqUuid, effectiveFrom: z.string().refine(isValidDateKey), notes: optText(1000) })
    .safeParse({ id: formData.get("id"), effectiveFrom: formData.get("effectiveFrom"), notes: formData.get("notes") });
  if (!p.success) return { ok: false, error: "invalidDate" };
  const supabase = await createClient();
  // Abans d'aprovar, es torna a validar el contingut desat
  const { data } = await supabase.from("tariff_versions").select("params").eq("id", p.data.id).maybeSingle();
  if (!tariffSchema.safeParse(data?.params).success) return { ok: false, error: "tariffInvalid" };
  const { error } = await supabase.rpc("approve_tariff", { p_id: p.data.id, p_effective_from: p.data.effectiveFrom, p_notes: p.data.notes ?? "" });
  if (error) return fromPgError(error);
  revalidatePath(PATH);
  return { ok: true };
}

export async function publishTariffWebAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const id = reqUuid.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("publish_tariff_to_web", { p_id: id.data });
  if (error) return fromPgError(error);
  revalidatePath(PATH);
  return { ok: true };
}

export async function saveCompanySettingsAction(_: unknown, formData: FormData): Promise<ActionResult> {
  await requireRole("direccio");
  const p = z.object({
    tax_id: optText(30), address: optText(300), phone: optText(40), email: optText(120), website: optText(120), iban: optText(40),
    quote_validity_months: z.coerce.number().int().min(0).max(24), client_quote_decisions: z.boolean(),
  }).safeParse({
    tax_id: formData.get("tax_id"), address: formData.get("address"), phone: formData.get("phone"), email: formData.get("email"),
    website: formData.get("website"), iban: formData.get("iban"), quote_validity_months: formData.get("quote_validity_months"),
    client_quote_decisions: formData.get("client_quote_decisions") === "on",
  });
  if (!p.success) return { ok: false, error: "required" };
  const v = p.data;
  const supabase = await createClient();
  const { error } = await supabase.from("company_settings").update({
    tax_id: v.tax_id ?? null, address: v.address ?? null, phone: v.phone ?? null, email: v.email ?? null, website: v.website ?? null,
    iban: v.iban ?? null, quote_validity_months: v.quote_validity_months, client_quote_decisions: v.client_quote_decisions,
  }).eq("id", true);
  if (error) return fromPgError(error);
  revalidatePath(PATH);
  return { ok: true };
}
