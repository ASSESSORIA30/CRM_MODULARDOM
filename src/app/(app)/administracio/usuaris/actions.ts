"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { formObject, optText, optUuid, reqText, reqUuid, zodFieldErrors } from "@/lib/forms";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const ROLES = ["direccio", "arquitecte", "constructor", "client"] as const;

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("invalidEmail"),
  full_name: reqText(200),
  role: z.enum(ROLES),
  locale: z.enum(["ca", "es"]),
  company_id: optUuid,
  client_id: optUuid,
});

export async function inviteUserAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio");
  const parsed = inviteSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  if (v.role === "constructor" && !v.company_id) return { ok: false, error: "required", fieldErrors: { company_id: "required" } };
  if (!process.env.SUPABASE_SECRET_KEY) return { ok: false, error: "secretMissing" };

  // 1) Invitació amb la clau secreta (només al servidor)
  const admin = createAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(v.email, {
    data: { full_name: v.full_name, locale: v.locale },
    redirectTo: site ? `${site}/auth/confirm` : undefined,
  });
  if (invErr || !invited?.user) {
    console.error("[invite]", invErr?.status, invErr?.message);
    return { ok: false, error: invErr?.status === 422 ? "duplicate" : "genericError" };
  }

  // 2) Rol, empresa i activació amb la sessió de direcció (queda a l'auditoria amb l'autor)
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({
    full_name: v.full_name, role: v.role, locale: v.locale,
    company_id: v.role === "constructor" ? v.company_id : null,
    is_active: true,
  }).eq("id", invited.user.id);
  if (error) return fromPgError(error);
  if (v.role === "client" && v.client_id) {
    const { error: e2 } = await supabase.from("client_users").insert({ client_id: v.client_id, profile_id: invited.user.id });
    if (e2) return fromPgError(e2);
  }
  revalidatePath("/administracio/usuaris");
  return { ok: true };
}

const updateSchema = z.object({
  id: reqUuid,
  full_name: optText(200),
  role: z.enum(ROLES),
  is_active: z.string().optional(),
  company_id: optUuid,
  client_id: optUuid,
});

export async function updateUserAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  const me = await requireRole("direccio");
  const parsed = updateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const active = v.is_active === "on";
  if (v.id === me.id && (!active || v.role !== "direccio")) return { ok: false, error: "cannotDeactivateSelf" };
  if (v.role === "constructor" && !v.company_id) return { ok: false, error: "required", fieldErrors: { company_id: "required" } };

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({
    full_name: v.full_name ?? "", role: v.role, is_active: active,
    company_id: v.role === "constructor" ? v.company_id : null,
  }).eq("id", v.id);
  if (error) return fromPgError(error);

  if (v.role === "client") {
    await supabase.from("client_users").delete().eq("profile_id", v.id);
    if (v.client_id) {
      const { error: e2 } = await supabase.from("client_users").insert({ client_id: v.client_id, profile_id: v.id });
      if (e2) return fromPgError(e2);
    }
  }
  revalidatePath("/administracio/usuaris");
  return { ok: true };
}

const companySchema = z.object({ name: reqText(200), tax_id: optText(20) });

export async function createCompanyAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio");
  const parsed = companySchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.from("companies").insert({
    name: parsed.data.name, tax_id: parsed.data.tax_id?.toUpperCase() ?? null,
  });
  if (error) return fromPgError(error);
  revalidatePath("/administracio/usuaris");
  return { ok: true };
}
