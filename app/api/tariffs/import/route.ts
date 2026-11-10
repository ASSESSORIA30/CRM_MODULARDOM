import { z } from "zod";
import { handler, HttpError } from "@/server/supabase";
import { requireInternal } from "@/server/permissions";
import { saveVersion } from "@/server/tariffs";
import { checkVersion } from "@/comparator/catalog";
import { offerVersionSchema, type OfferVersion } from "@/comparator/types";
import { tariffReview } from "@/comparator/review-state";

export const maxDuration = 60;

const body = z.object({
  fileName: z.string().max(200),
  supplierName: z.string().max(120).nullable(),
  mapping: z.record(z.string(), z.string()),
  counts: z.record(z.string(), z.number()),
  report: z.array(z.object({ row: z.number(), status: z.string(), errors: z.array(z.string()), warnings: z.array(z.string()) })).max(5000),
  offers: z.array(z.unknown()).max(2000),
  activateComplete: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  /** Lector IA: les tarifes amb dades que falten es desen igualment com a ESBORRANY per completar-les al catàleg. */
  keepIncompleteAsDraft: z.boolean().default(false),
  /** Tarifes que s'han de desar com a esborrany encara que siguin completes (tenen avisos per revisar). */
  keepDraftIds: z.array(z.string().max(80)).max(2000).default([]),
  /** Importació per lots: el primer lot crea el registre i els següents hi acumulen el progrés (persistent). */
  runId: z.string().uuid().nullable().optional(),
  batch: z.object({ index: z.number().int().min(0), total: z.number().int().min(1) }).nullable().optional(),
});

/**
 * Confirma una importació revisada. Les tarifes entren com a ESBORRANY; només s'activen les completes i
 * sense avisos si l'administrador ho demana explícitament. Es registra qui ha importat i l'informe.
 */
export const POST = handler(async (req) => {
  const u = await requireInternal({ staff: true });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) throw new HttpError(400, "Importació no vàlida");
  const b = p.data;
  // registre persistent de la importació: un sol registre per a tots els lots (progrés i informe acumulats)
  let runId = b.runId ?? null;
  let prev: { counts: Record<string, number>; report: unknown[] } | null = null;
  if (runId) {
    const r = await u.sb.from("tariff_import_runs").select("id,counts,report").eq("id", runId).maybeSingle();
    if (r.error || !r.data) throw new HttpError(404, "No es troba la importació en curs: torna a començar (les tarifes ja desades es detectaran com a repetides)");
    prev = { counts: (r.data.counts ?? {}) as Record<string, number>, report: (r.data.report ?? []) as unknown[] };
  } else {
    const run = await u.sb.from("tariff_import_runs").insert({ file_name: b.fileName, supplier_name: b.supplierName, mapping: b.mapping, dry_run: b.dryRun, counts: { ...b.counts, lots_totals: b.batch?.total ?? 1, lots_fets: 0, desades: 0, actives: 0, repetides: 0, rebutjades: 0 }, report: [], created_by_name: u.profile.name }).select("id").single();
    if (run.error) throw run.error;
    runId = run.data.id as string;
    prev = { counts: { ...b.counts, lots_totals: b.batch?.total ?? 1, lots_fets: 0, desades: 0, actives: 0, repetides: 0, rebutjades: 0 }, report: [] };
  }
  if (b.dryRun) return { runId, saved: 0, activated: 0 };
  let saved = 0, activated = 0, rejected = 0, duplicates = 0;
  const reasons: string[] = [];
  const results: { product: string; result: "desada" | "activa" | "repetida" | "rebutjada"; version?: number; reason?: string }[] = [];
  for (const raw of b.offers) {
    const o = offerVersionSchema.safeParse(raw);
    if (!o.success) { rejected++; results.push({ product: "?", result: "rebutjada", reason: "dades no vàlides" }); continue; }
    const v = o.data as OfferVersion;
    const label = `${v.productName} (${v.accessTariff})`;
    const check = checkVersion(v);
    if (!check.ok && !b.keepIncompleteAsDraft) { rejected++; results.push({ product: label, result: "rebutjada", reason: check.errors[0] }); continue; }
    // només s'activen les tarifes VALIDADES (cap descompte ni preu ambigu, cap regla pendent, indexades amb fórmula completa)
    const review = tariffReview(v);
    const activate = b.activateComplete && check.ok && check.warnings.length === 0 && review.state === "validada" && !b.keepDraftIds.includes(v.id);
    try {
      const r = await saveVersion(u, { ...v, status: activate ? "activa" : "esborrany" }, { origin: "excel", importRunId: runId, skipIfSame: true });
      if ("duplicate" in r && r.duplicate) { duplicates++; results.push({ product: label, result: "repetida", version: r.version, reason: "ja importada (no es duplica)" }); continue; }
      saved++;
      if (r.status === "activa") activated++;
      results.push({ product: label, result: r.status === "activa" ? "activa" : "desada", version: r.version, reason: r.status === "activa" ? undefined : review.reasons[0] });
    } catch (e) {
      // p. ex. un annex més antic que el del catàleg: no se substitueix, es compta com a rebutjada amb el motiu
      if (e instanceof HttpError && e.status === 409) { rejected++; reasons.push(e.message); results.push({ product: label, result: "rebutjada", reason: e.message }); continue; }
      throw e;
    }
  }
  const c = prev!.counts;
  const counts = { ...c, lots_fets: (c.lots_fets ?? 0) + 1, desades: (c.desades ?? 0) + saved, actives: (c.actives ?? 0) + activated, repetides: (c.repetides ?? 0) + duplicates, rebutjades: (c.rebutjades ?? 0) + rejected };
  await u.sb.from("tariff_import_runs").update({ counts, report: [...prev!.report, ...results].slice(-2000) }).eq("id", runId);
  return { runId, saved, activated, rejected, duplicates, reasons, results, progress: counts };
});

export const GET = handler(async () => {
  const u = await requireInternal({ staff: true });
  const { data, error } = await u.sb.from("tariff_import_runs").select("id,file_name,supplier_name,dry_run,counts,created_by_name,created_at").order("created_at", { ascending: false }).limit(30);
  if (error) throw error;
  return { runs: data ?? [] };
});
