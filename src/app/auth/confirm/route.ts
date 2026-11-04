// Enllaços dels correus d'Auth (invitació, recuperació de contrasenya, confirmació).
// Plantilles d'email de Supabase:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery
import { type NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const ALLOWED: EmailOtpType[] = ["invite", "recovery", "signup", "email", "email_change"];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  if (tokenHash && type && ALLOWED.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const dest = type === "invite" || type === "recovery" ? "/compte/contrasenya" : "/inici";
      return NextResponse.redirect(new URL(dest, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=enllac", request.url));
}
