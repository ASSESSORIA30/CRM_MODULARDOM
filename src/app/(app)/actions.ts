"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActiveProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function setLocale(formData: FormData) {
  const profile = await requireActiveProfile();
  const locale = formData.get("locale") === "es" ? "es" : "ca";
  const supabase = await createClient();
  await supabase.from("profiles").update({ locale }).eq("id", profile.id);
  revalidatePath("/", "layout");
}

/** Marca una notificació com a llegida i hi navega. */
export async function openNotification(formData: FormData) {
  await requireActiveProfile();
  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("link")
    .maybeSingle();
  const link = data?.link && data.link.startsWith("/") && !data.link.startsWith("//") ? data.link : "/notificacions";
  redirect(link);
}

export async function markAllNotificationsRead() {
  const profile = await requireActiveProfile();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile.id).is("read_at", null);
  revalidatePath("/", "layout");
}
