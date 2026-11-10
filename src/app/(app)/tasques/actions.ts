"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActiveProfile, requireRole } from "@/lib/auth";
import { fromPgError, type ActionResult } from "@/lib/action-result";
import { formObject, optDateKey, optText, optUuid, reqText, zodFieldErrors } from "@/lib/forms";
import { PRIORITIES, TASK_KINDS, TASK_STATUSES } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/server";

const taskSchema = z.object({
  title: reqText(200),
  description: optText(4000),
  kind: z.enum(TASK_KINDS),
  project_id: optUuid,
  client_id: optUuid,
  assigned_to: optUuid,
  due_date: optDateKey,
  priority: z.enum(PRIORITIES),
});

export async function createTaskAction(_prev: ActionResult<unknown> | undefined, formData: FormData): Promise<ActionResult<unknown>> {
  const me = await requireRole("direccio", "arquitecte");
  const parsed = taskSchema.safeParse(formObject(formData));
  if (!parsed.success) return { ok: false, error: "required", fieldErrors: zodFieldErrors(parsed.error) };
  const v = parsed.data;
  const isDir = me.role === "direccio";
  if (!isDir && !v.project_id) return { ok: false, error: "required", fieldErrors: { project_id: "required" } };
  const row = isDir ? v : { ...v, kind: "tecnica" as const, client_id: null, assigned_to: me.id };
  const supabase = await createClient();
  const { error } = await supabase.from("tasks").insert({ ...row, created_by: me.id });
  if (error) return fromPgError(error);
  revalidatePath("/tasques");
  if (v.project_id) revalidatePath(`/projectes/${v.project_id}`);
  if (v.project_id) redirect(`/projectes/${v.project_id}`);
  if (v.client_id) redirect(`/clients/${v.client_id}`);
  redirect("/tasques");
}

export async function setTaskStatusAction(formData: FormData) {
  await requireActiveProfile();
  const id = z.string().uuid().safeParse(formData.get("id"));
  const status = z.enum(TASK_STATUSES).safeParse(formData.get("status"));
  if (!id.success || !status.success) return;
  const supabase = await createClient();
  await supabase.from("tasks").update({ status: status.data }).eq("id", id.data);
  revalidatePath("/tasques");
  revalidatePath("/inici");
}
