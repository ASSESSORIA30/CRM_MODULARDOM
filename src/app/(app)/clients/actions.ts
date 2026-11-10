"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { formObject, optCents, optDateKey, optEmail, optPositiveNumber, optText, optUuid, reqText, reqUuid, zodFieldErrors } from "@/lib/forms";
import { ACTIVITY_KINDS, LEAD_SOURCES, PRIORITIES } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

const leadSchema = z.object({
  client_id: optUuid,
  display_name: optText(200),
  email: optEmail,
  phone: optText(40),
  locale: z.enum(["ca", "es"]).default("ca"),
  lead_source: z.preprocess((v) => (v === "" ? null : v), z.enum(LEAD_SOURCES).nullable()),
  municipality: optText(120),
  surface_m2: optPositiveNumber,
  estimated: optCents,
  responsible_id: optUuid,
  priority: z.enum(PRIORITIES).default("normal"),
  next_action: optText(300),
  follow_up_date: optDateKey,
  notes: optText(4000),
  force: z.string().optional(),
});

export async function createLeadAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio");
  const parsed = leadSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (!v.client_id && !v.display_name) return { ok: false, error: "required", fieldErrors: { display_name: "required" } };

  const supabase = await createClient();
  if (!v.client_id && v.force !== "1") {
    const { data: dups, error } = await supabase.rpc("find_client_duplicates", {
      p_name: v.display_name ?? "", p_email: v.email ?? "", p_phone: v.phone ?? "", p_tax_id: "",
    });
    if (error) return fromPgError(error);
    if (dups && dups.length > 0) {
      return { ok: false, error: "duplicates", duplicates: dups.map(({ id, display_name, email, phone, reason }: { id: string; display_name: string; email: string | null; phone: string | null; reason: string }) => ({ id, display_name, email, phone, reason })) };
    }
  }

  const { data: projectId, error } = await supabase.rpc("create_lead", {
    p_client_id: v.client_id,
    p_display_name: v.display_name ?? null,
    p_email: v.email ?? null,
    p_phone: v.phone ?? null,
    p_locale: v.locale,
    p_lead_source: v.lead_source,
    p_municipality: v.municipality ?? null,
    p_surface_m2: v.surface_m2,
    p_estimated_cents: v.estimated,
    p_responsible_id: v.responsible_id,
    p_priority: v.priority,
    p_next_action: v.next_action ?? null,
    p_follow_up_date: v.follow_up_date,
    p_notes: v.notes ?? null,
  });
  if (error) return fromPgError(error);
  revalidatePath("/", "layout");
  redirect(`/projectes/${projectId}`);
}

const clientSchema = z.object({
  kind: z.enum(["persona", "empresa"]),
  display_name: reqText(200),
  tax_id: optText(20),
  email: optEmail,
  phone: optText(40),
  address: optText(300),
  postal_code: optText(10),
  city: optText(120),
  province: optText(120),
  locale: z.enum(["ca", "es"]),
  lead_source: z.preprocess((v) => (v === "" ? null : v), z.enum(LEAD_SOURCES).nullable()),
  notes: optText(4000),
});

export async function updateClientAction(clientId: string, _prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio");
  if (!reqUuid.safeParse(clientId).success) return { ok: false, error: "genericError" };
  const parsed = clientSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({
    ...v,
    tax_id: v.tax_id ? v.tax_id.toUpperCase().replace(/[\s-]/g, "") : null,
  }).eq("id", clientId);
  if (error) return fromPgError(error);
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

const activitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  summary: reqText(4000),
  client_id: optUuid,
  project_id: optUuid,
});

export async function addActivityAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  const profile = await requireRole("direccio", "arquitecte");
  const parsed = activitySchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (!v.client_id && !v.project_id) return { ok: false, error: "genericError" };
  const supabase = await createClient();
  const { error } = await supabase.from("activities").insert({ ...v, created_by: profile.id });
  if (error) return fromPgError(error);
  if (v.client_id) revalidatePath(`/clients/${v.client_id}`);
  if (v.project_id) revalidatePath(`/projectes/${v.project_id}`);
  return { ok: true };
}
