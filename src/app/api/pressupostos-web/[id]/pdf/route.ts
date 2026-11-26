// Descàrrega del PDF d'un pressupost web des del CRM. Només hi arriba qui pot llegir el pressupost
// (direcció, per RLS); el fitxer es llegeix del bucket privat amb la clau de servei.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PDF_BUCKET } from "@/lib/web-leads/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const supabase = await createClient();
  const { data: q } = await supabase.from("web_quotes").select("reference, pdf_path").eq("id", id).maybeSingle();
  if (!q?.pdf_path) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const file = await createAdminClient().storage.from(PDF_BUCKET).download(q.pdf_path);
  if (file.error || !file.data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new Response(Buffer.from(await file.data.arrayBuffer()), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="ModularDom-${q.reference}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
