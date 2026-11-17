// Tarifa publicada com a script (<script src=".../api/configurador/tarifa.js">): defineix window.MODULARDOM_TARIFA.
// Si encara no s'ha publicat cap tarifa, val null i la web fa servir la seva còpia de seguretat.
import { corsHeaders, getPublishedTariff } from "@/lib/configurator/published";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const t = await getPublishedTariff();
  const body = `/* ModularDom · tarifa publicada des del CRM */\nwindow.MODULARDOM_TARIFA = ${JSON.stringify(t)};\n`;
  return new Response(body, { headers: { ...corsHeaders(req), "Content-Type": "application/javascript; charset=utf-8" } });
}
