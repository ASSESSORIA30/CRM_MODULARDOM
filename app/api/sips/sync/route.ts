import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { actOpportunity, cupsHistory, cupsStatus, enqueue, exportIncidents, listJobs, listOpportunities, overview, refreshOne, runNow, runsHistory, saveSettings, setAuthorization, setPaused } from "@/server/sips-sync";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 60;

/**
 * Administració → Sincronització SIPS (migració 034).
 * GET ?r=overview | jobs&filtres | runs | history&cups= | opportunities&status= | status&cups=a,b | export (Excel)
 * POST {action: enqueue | run_now | refresh_one | settings | authorization | pause | resume | opportunity}
 * Abast per rol: Direcció i Cap administrativa veuen tots els CUPS; la resta, només els dels clients que pot veure.
 */
export async function GET(req: Request) {
  const p = Object.fromEntries(new URL(req.url).searchParams);
  if (p.r === "export") {
    try {
      const f = await exportIncidents(await requireInternal());
      return new Response(f.bytes as BodyInit, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${f.fileName}"`, "cache-control": "no-store" } });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      return Response.json({ error: e instanceof Error ? e.message : "Error" }, { status });
    }
  }
  return get(req);
}
// el retorn es declara «unknown»: evita que la validació de tipus de Next expandeixi els tipus inferits de Supabase
const get = handler(async (req): Promise<unknown> => {
  const u = await requireInternal();
  const p = Object.fromEntries(new URL(req.url).searchParams);
  switch (p.r) {
    case "overview": return overview(u);
    case "jobs": return listJobs(u, p);
    case "runs": return runsHistory(u);
    case "history": return cupsHistory(u, p.cups ?? "");
    case "opportunities": return listOpportunities(u, p);
    case "status": return cupsStatus(u, (p.cups ?? "").split(",").filter(Boolean));
    default: throw new HttpError(400, "Recurs desconegut");
  }
});

const body = z.object({ action: z.enum(["enqueue", "run_now", "refresh_one", "settings", "authorization", "pause", "resume", "opportunity"]), id: z.string().optional(), cups: z.string().optional(), data: z.unknown().optional() });
export const POST = handler(async (req): Promise<unknown> => {
  const u = await requireInternal();
  const b = body.parse(await req.json().catch(() => ({})));
  switch (b.action) {
    case "enqueue": return enqueue(u, b.data);
    case "run_now": return runNow(u);
    case "refresh_one": return refreshOne(u, b.cups ?? "");
    case "settings": return saveSettings(u, b.data);
    case "authorization": return setAuthorization(u, b.data);
    case "pause": return setPaused(u, true);
    case "resume": return setPaused(u, false);
    case "opportunity": return actOpportunity(u, b.id ?? "", b.data);
  }
});
