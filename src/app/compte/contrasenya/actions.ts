"use server";

import { createClient } from "@/lib/supabase/server";

export type PasswordState = { ok?: boolean; error?: "short" | "generic" } | undefined;

export async function setPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 12) return { error: "short" };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  return error ? { error: "generic" } : { ok: true };
}
