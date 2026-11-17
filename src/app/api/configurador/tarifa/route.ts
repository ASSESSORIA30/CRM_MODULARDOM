// Tarifa publicada del configurador (JSON) per a la web www.modulardom.com/presupuesto.
import { NextResponse } from "next/server";
import { corsHeaders, getPublishedTariff } from "@/lib/configurator/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t = await getPublishedTariff();
  return NextResponse.json(t ?? { error: "not_published" }, { status: t ? 200 : 404, headers: corsHeaders(req) });
}
