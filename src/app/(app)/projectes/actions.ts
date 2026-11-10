"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActiveProfile, requireRole } from "@/lib/auth";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { formObject, optCents, optDateKey, optPositiveNumber, optText, optUuid, reqText, reqUuid, zodFieldErrors } from "@/lib/forms";
import { ALL_STAGES, PRIORITIES } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

function revalidateProject(id: string) {
  revalidatePath(`/projectes/${id}`);
  revalidatePath("/kanban");
  revalidatePath("/clients");
  revalidatePath("/inici");
}

const projectSchema = z.object({
  title: reqText(200),
  municipality: optText(120),
  plot_address: optText(300),
  cadastral_ref: optText(40),
  surface_m2: optPositiveNumber,
  priority: z.enum(PRIORITIES),
  responsible_id: optUuid,
  next_action: optText(300),
  follow_up_date: optDateKey,
  estimated: optCents,
});

export async function updateProjectAction(projectId: string, _prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio");
  if (!reqUuid.safeParse(projectId).success) return { ok: false, error: "genericError" };
  const parsed = projectSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const { estimated, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update(fields).eq("id", projectId);
  if (error) return fromPgError(error);
  const { error: e2 } = await supabase.from("project_financials")
    .upsert({ project_id: projectId, estimated_sale_cents: estimated }, { onConflict: "project_id" });
  if (e2) return fromPgError(e2);
  revalidateProject(projectId);
  return { ok: true };
}

const moveSchema = z.object({ project_id: reqUuid, to: z.enum(ALL_STAGES), reason: optText(500) });

/** Canvi d'etapa (Kanban i fitxa). Totes les validacions es fan a PostgreSQL. */
export async function moveStageAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireRole("direccio");
  const parsed = moveSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "genericError" };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_project_stage", { p_project_id: v.project_id, p_to: v.to, p_reason: v.reason ?? null });
  if (error) return fromPgError(error);
  revalidateProject(v.project_id);
  return { ok: true };
}

export async function moveStage(projectId: string, to: string, reason?: string): Promise<ActionResult<unknown>> {
  const fd = new FormData();
  fd.set("project_id", projectId);
  fd.set("to", to);
  if (reason) fd.set("reason", reason);
  return moveStageAction(undefined, fd);
}

const stepSchema = z.object({
  project_id: reqUuid,
  step: z.coerce.number().int().min(1).max(11),
  status: z.enum(["pendent", "fet", "no_aplica"]),
});

export async function setStepAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  await requireActiveProfile();
  const parsed = stepSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "genericError" };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_project_step", { p_project_id: v.project_id, p_step: v.step, p_status: v.status, p_notes: null });
  if (error) return fromPgError(error);
  revalidateProject(v.project_id);
  return { ok: true, message: "silent" };
}

const memberSchema = z.object({ project_id: reqUuid, profile_id: reqUuid, member_role: z.enum(["arquitecte", "constructor", "client"]) });

export async function addMemberAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  const me = await requireRole("direccio");
  const parsed = memberSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required" };
  const v = parsed.data;
  const supabase = await createClient();
  const { data: target } = await supabase.from("profiles").select("role").eq("id", v.profile_id).maybeSingle();
  if (!target || target.role !== v.member_role) return { ok: false, error: "genericError" };
  const { error } = await supabase.from("project_members").insert({ ...v, granted_by: me.id });
  if (error) return fromPgError(error);
  revalidateProject(v.project_id);
  return { ok: true };
}

export async function revokeMemberAction(formData: FormData) {
  await requireRole("direccio");
  const id = z.string().uuid().safeParse(formData.get("id"));
  const projectId = z.string().uuid().safeParse(formData.get("project_id"));
  if (!id.success || !projectId.success) return;
  const supabase = await createClient();
  await supabase.from("project_members").update({ revoked_at: new Date().toISOString() }).eq("id", id.data).is("revoked_at", null);
  revalidateProject(projectId.data);
}
