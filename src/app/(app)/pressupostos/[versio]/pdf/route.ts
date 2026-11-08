// PDF d'una versió del pressupost (generat al moment a partir de les dades desades). Només direcció.
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { quotePdfTexts } from "@/lib/i18n-pressupostos";
import { loadQuoteVersion, quotePdfData } from "@/lib/quotes/load";
import { buildQuotePdf } from "@/lib/quotes/quote-pdf";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: Request, { params }: { params: Promise<{ versio: string }> }) {
  const profile = await getCurrentProfile().catch(() => null);
  if (!profile || profile.role !== "direccio" || !profile.isActive) return new NextResponse("Forbidden", { status: 403 });
  const { versio } = await params;
  if (!/^[0-9a-f-]{36}$/.test(versio)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const q = await loadQuoteVersion(supabase, versio);
  if (!q) return new NextResponse("Not found", { status: 404 });
  const bytes = await buildQuotePdf(await quotePdfData(supabase, q), quotePdfTexts(q.version.locale));
  const name = `${q.quote.code}-v${q.version.version}${q.version.status === "esborrany" ? "-esborrany" : ""}.pdf`;
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "private, no-store" },
  });
}
