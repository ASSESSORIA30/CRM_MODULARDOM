import { NextResponse } from "next/server";
import { missingEnvNames } from "@/lib/env";

export const dynamic = "force-dynamic";

// Estat del desplegament. No retorna mai valors de configuració.
export function GET() {
  const missing = missingEnvNames();
  return NextResponse.json({
    ok: true,
    app: "modulardom-crm",
    supabaseConfigured: missing.length === 0,
    serverSecretConfigured: Boolean(process.env.SUPABASE_SECRET_KEY),
    missing,
  });
}
