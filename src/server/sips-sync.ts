import "server-only";
/**
 * SINCRONITZACIÓ AUTOMÀTICA SIPS (migració 034).
 *  - Reutilitza el motor i la memòria cau existents (`refreshSips` → `sips_cache`): no hi ha una segona integració.
 *  - Inventari de tots els CUPS del CRM → cua persistent `sips_sync_jobs` (una fila per CUPS, base de 20).
 *  - Execucions amb bloqueig a la base de dades, reserva de tasques `for update skip locked`, ritme limitat
 *    (peticions/minut i concurrència), reintents amb retard exponencial i aturada davant 401/403/429.
 *  - Cada consulta correcta desa una instantània normalitzada, detecta canvis i proposa oportunitats sense duplicats.
 *
 * IMPORTANT: la sincronització programada/massiva NOMÉS s'executa si Direcció l'ha activada registrant l'autorització
 * del proveïdor (`sips_sync_settings.enabled`). Per defecte està desactivada: la integració actual entra al portal
 * EAS amb usuari i contrasenya i no consta una API documentada per a consultes massives.
 */
import ExcelJS from "exceljs";
import { z } from "zod";
import {
  buildInventory, classifyError, cupsKey, detectChanges, detectOpportunities, inWindow, madridDay, nextDue, normTaxId,
  progressPct, resolveSettings, snapshotFromCache, snapshotHash, spacingMs, JOB_STATES, REASON_PRIORITY, REQUESTS_PER_CUPS,
  type CacheLike, type InventoryRecord, type JobState, type Snapshot, type SyncReason, type SyncSettings,
} from "@/core/sips-sync";
import { withAnnualConsumption } from "@/energy/lib/sips-record";
import { adminClient, HttpError } from "./supabase";
import type { U } from "./crm";
import { refreshSips, sipsMissing, visibleCupsSet } from "./sips";
import { secLog } from "./permissions";

type Db = ReturnType<typeof adminClient>;
type Job = {
  cups20: string; variants: string[]; reason: SyncReason; base_reason: Exclude<SyncReason, "manual">; priority: number; status: JobState; attempts: number;
  last_attempt_at: string | null; next_attempt_at: string; last_success_at: string | null; finished_at: string | null; last_error: string | null; last_error_code: string | null;
  client_ids: string[]; client_names: string[]; owner_ids: string[]; owner_names: string[]; retailers: string[]; tariff: string | null; energy_type: string | null;
  renewal_date: string | null; multi_client: boolean; in_inventory: boolean; refs: { source: string; id: string }[]; requested_by: string | null;
};
const MIGRATION = "Falta aplicar la migració supabase/migrations/034_sips_sincronitzacio.sql a Supabase";
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST202" || /sips_sync|sips_snap|sips_change|sips_opport|schema cache|does not exist/i.test(e.message ?? ""));
function dbFail(e: { code?: string; message?: string } | null): never {
  if (missing(e)) throw new HttpError(409, MIGRATION);
  console.error("[sips-sync]", e?.code, (e?.message ?? "").slice(0, 200));
  throw new HttpError(500, "Error de base de dades a la sincronització SIPS");
}
const FULL_ROLES = new Set(["admin", "cap_administrativa"]);
const isAdmin = (u: U) => u.profile.role === "admin";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Missatge segur per al registre: sense credencials, cookies ni respostes internes. */
const safeMsg = (m: unknown) => String(m ?? "").replace(/(password|contrasenya|token|cookie|bearer)\S*/gi, "[ocult]").slice(0, 300);

/* ======================================================================= configuració */

export async function loadSettings(db: Db = adminClient()) {
  const r = await db.from("sips_sync_settings").select("*").eq("id", 1).maybeSingle();
  if (r.error) dbFail(r.error);
  const row = (r.data ?? { id: 1, settings: {}, enabled: false, paused: false }) as Record<string, unknown>;
  const settings = resolveSettings({ ...(row.settings as Partial<SyncSettings>), enabled: row.enabled === true, paused: row.paused === true });
  return { row, settings };
}

/** Pot funcionar la sincronització massiva ara? (motiu si no) */
function massiveBlocker(row: Record<string, unknown>, s: SyncSettings): string | null {
  if (!s.enabled) return "La sincronització massiva està desactivada fins que Direcció registri l'autorització del proveïdor SIPS.";
  if (!row.authorized_at || !row.authorization_ref) return "Falta registrar l'autorització del proveïdor per a consultes automatitzades.";
  if (s.paused) return "La sincronització està en pausa.";
  if (row.blocked_reason) return `Sincronització aturada: ${row.blocked_reason}`;
  const m = sipsMissing();
  if (m.length) return `Falten variables d'entorn: ${m.join(", ")}.`;
  return null;
}

/* ======================================================================= inventari */

async function pageAll<T>(fn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>, max = 100_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const r = await fn(from, from + 999);
    if (r.error) throw r.error;
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) break;
  }
  return out;
}

/** Tots els registres amb CUPS del CRM (service role). */
export async function collectRecords(db: Db = adminClient()): Promise<InventoryRecord[]> {
  const opt = async <T,>(p: Promise<T[]>) => p.catch((e: { code?: string; message?: string }) => { if (missing(e) || /does not exist|column/i.test(e?.message ?? "")) return [] as T[]; throw e; });
  type Cl = { id: string; name: string; tax_id: string | null; owner_id: string | null };
  const [clients, supplies, contracts, opps, leads, legacy, states, profiles] = await Promise.all([
    opt(pageAll<Cl>((a, b) => db.from("crm_clients").select("id,name,tax_id,owner_id").range(a, b))),
    opt(pageAll<{ id: string; client_id: string; cups: string; energy_type: string; access_tariff: string | null; current_retailer: string | null; status: string; archived_at: string | null }>((a, b) => db.from("crm_supplies").select("id,client_id,cups,energy_type,access_tariff,current_retailer,status,archived_at").range(a, b))),
    opt(pageAll<{ id: string; client_id: string; supply_id: string | null; retailer: string; access_tariff: string | null; status: string; end_date: string | null; owner_id: string | null }>((a, b) => db.from("crm_contracts").select("id,client_id,supply_id,retailer,access_tariff,status,end_date,owner_id").range(a, b))),
    opt(pageAll<{ id: string; client_id: string | null; supply_id: string | null; stage: string; owner_id: string | null }>((a, b) => db.from("crm_opportunities").select("id,client_id,supply_id,stage,owner_id").range(a, b))),
    opt(pageAll<{ id: string; name: string; cups: string | null; status: string; owner_id: string | null; converted_client_id: string | null; tax_id?: string | null }>((a, b) => db.from("crm_leads").select("id,name,cups,status,owner_id,converted_client_id").not("cups", "is", null).range(a, b))),
    opt(pageAll<{ id: string; cups: string | null; comercial: string | null; data: Record<string, unknown>; removed_from_source: boolean }>((a, b) => db.from("contracts").select("id,cups,comercial,data,removed_from_source").range(a, b))),
    opt(pageAll<{ contract_id: string; status: string }>((a, b) => db.from("crm_state").select("contract_id,status").range(a, b))),
    opt(pageAll<{ id: string; name: string }>((a, b) => db.from("profiles").select("id,name").range(a, b))),
  ]);
  const cl = new Map(clients.map((c) => [c.id, c]));
  const sup = new Map(supplies.map((s) => [s.id, s]));
  const pname = new Map(profiles.map((p) => [p.id, p.name]));
  const st = new Map(states.map((s) => [s.contract_id, s.status]));
  // identitat del client: NIF si en té (comparable amb la cartera), si no l'id del CRM
  const ident = (id: string | null | undefined) => { const c = id ? cl.get(id) : null; return c ? normTaxId(c.tax_id) ?? c.id : null; };
  const out: InventoryRecord[] = [];
  for (const s of supplies) {
    const c = cl.get(s.client_id);
    out.push({ source: "subministrament", id: s.id, cups: s.cups, clientKey: ident(s.client_id), clientId: s.client_id, clientName: c?.name ?? null, supplyId: s.id, ownerId: c?.owner_id ?? null, ownerName: c?.owner_id ? pname.get(c.owner_id) ?? null : null, retailer: s.current_retailer, tariff: s.access_tariff, energy: s.energy_type === "gas" ? "gas" : "luz", active: !s.archived_at && s.status !== "baixa" });
  }
  for (const k of contracts) {
    const s = k.supply_id ? sup.get(k.supply_id) : null;
    if (!s) continue;
    const c = cl.get(k.client_id);
    out.push({ source: "contracte", id: k.id, cups: s.cups, clientKey: ident(k.client_id), clientId: k.client_id, clientName: c?.name ?? null, supplyId: s.id, ownerId: k.owner_id ?? c?.owner_id ?? null, ownerName: pname.get(k.owner_id ?? c?.owner_id ?? "") ?? null, retailer: k.retailer, tariff: k.access_tariff ?? s.access_tariff, energy: s.energy_type === "gas" ? "gas" : "luz", status: k.status, endDate: k.end_date });
  }
  for (const o of opps) {
    const s = o.supply_id ? sup.get(o.supply_id) : null;
    if (!s) continue;
    const c = o.client_id ? cl.get(o.client_id) : null;
    out.push({ source: "oportunitat", id: o.id, cups: s.cups, clientKey: ident(o.client_id ?? s.client_id), clientId: o.client_id ?? s.client_id, clientName: c?.name ?? cl.get(s.client_id)?.name ?? null, supplyId: s.id, ownerId: o.owner_id, ownerName: pname.get(o.owner_id ?? "") ?? null, active: !["guanyat", "perdut"].includes(o.stage) });
  }
  for (const l of leads) {
    out.push({ source: "lead", id: l.id, cups: l.cups, clientKey: l.converted_client_id ? ident(l.converted_client_id) : normTaxId(l.tax_id ?? null), clientId: l.converted_client_id, clientName: l.name, ownerId: l.owner_id, ownerName: pname.get(l.owner_id ?? "") ?? null, active: !["convertit", "descartat"].includes(l.status) });
  }
  for (const c of legacy) {
    const d = c.data as { cliente?: string; cif?: string | null; comercializadora?: string | null; tarifa?: string | null; tipo?: string; vencimiento?: string | null; fechaBaja?: string | null };
    const status = st.get(c.id);
    const end = d.fechaBaja ? null : d.vencimiento ?? null;
    out.push({ source: "cartera", id: c.id, cups: c.cups, clientKey: normTaxId(d.cif ?? null), clientName: d.cliente ?? null, ownerName: c.comercial && c.comercial !== "SIN ASIGNAR" ? c.comercial : null, retailer: d.comercializadora ?? null, tariff: d.tarifa ?? null, energy: d.tipo === "gas" ? "gas" : d.tipo === "luz" ? "luz" : null, active: !c.removed_from_source && status !== "no_renueva" && !d.fechaBaja, endDate: end && /^\d{4}-\d{2}-\d{2}/.test(end) ? end.slice(0, 10) : null, status: status === "pendiente" || status === "contactado" ? "renovacio_pendent" : null });
  }
  return out;
}

/**
 * Actualitza la cua amb l'inventari: CUPS nous (pendents ara), canvis de motiu/prioritat (una renovació pròxima
 * avança la consulta) i CUPS que ja no són al CRM (es deixen de consultar, sense esborrar l'històric).
 */
export async function syncInventory(db: Db = adminClient(), now = new Date()) {
  const { settings } = await loadSettings(db);
  const items = buildInventory(await collectRecords(db), settings, now.toISOString().slice(0, 10));
  type JobLite = Pick<Job, "cups20" | "status" | "reason" | "base_reason" | "priority" | "next_attempt_at" | "last_success_at" | "in_inventory">;
  const existing = new Map((await pageAll<JobLite>((a, b) => db.from("sips_sync_jobs").select("cups20,status,reason,base_reason,priority,next_attempt_at,last_success_at,in_inventory").range(a, b))).map((j) => [j.cups20, j]));
  let added = 0, updated = 0, removed = 0;
  const rows: Record<string, unknown>[] = [];
  for (const it of items) {
    const old = existing.get(it.cups20);
    const base = { cups20: it.cups20, variants: it.variants, base_reason: it.reason, client_ids: it.clientIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)), client_names: it.clientNames.slice(0, 20), owner_ids: it.ownerIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)), owner_names: it.ownerNames.slice(0, 10), retailers: it.retailers.slice(0, 10), tariff: it.tariff, energy_type: it.energy, renewal_date: it.renewalDate, sources: it.sources, refs: it.refs.slice(0, 50), multi_client: it.multiClient, in_inventory: true, inventory_at: now.toISOString(), search: [it.cups20, ...it.variants, ...it.clientNames, ...it.retailers, ...it.ownerNames].join(" ").toLowerCase().slice(0, 2000), updated_at: now.toISOString() };
    if (!old) { rows.push({ ...base, reason: "nou", priority: REASON_PRIORITY.nou, status: "pendent", next_attempt_at: now.toISOString() }); added++; continue; }
    const keepManual = old.reason === "manual" && ["pendent", "en_proces"].includes(old.status);
    const reason = keepManual ? "manual" : old.status === "pendent" && old.reason === "nou" && !old.last_success_at ? "nou" : it.reason;
    // la pròxima consulta segons la nova freqüència (si s'avança, p. ex. per una renovació)
    let next = old.next_attempt_at;
    if (old.last_success_at && ["actualitzat", "sense_dades"].includes(old.status)) {
      const due = nextDue(it.reason, settings, new Date(old.last_success_at)).toISOString();
      if (due < next || it.reason !== old.base_reason) next = due;
    }
    rows.push({ ...base, reason, priority: REASON_PRIORITY[reason as SyncReason], next_attempt_at: next });
    if (it.reason !== old.base_reason || !old.in_inventory) updated++;
  }
  for (let i = 0; i < rows.length; i += 500) {
    const r = await db.from("sips_sync_jobs").upsert(rows.slice(i, i + 500), { onConflict: "cups20" });
    if (r.error) dbFail(r.error);
  }
  const keys = new Set(items.map((x) => x.cups20));
  const gone = [...existing.values()].filter((j) => j.in_inventory && !keys.has(j.cups20)).map((j) => j.cups20);
  for (let i = 0; i < gone.length; i += 500) {
    const r = await db.from("sips_sync_jobs").update({ in_inventory: false, updated_at: now.toISOString() }).in("cups20", gone.slice(i, i + 500));
    if (r.error) dbFail(r.error);
    removed += gone.slice(i, i + 500).length;
  }
  return { total: items.length, added, updated, removed, multiClient: items.filter((x) => x.multiClient).length };
}

/* ======================================================================= instantànies, canvis i oportunitats */

/**
 * Desa la instantània de la memòria cau (si ha canviat), detecta canvis respecte de l'anterior i crea les
 * oportunitats que no existeixin ja (clau única) ni estiguin cobertes per una oportunitat comercial o tasca activa.
 */
export async function recordSnapshot(db: Db, cache: CacheLike, ctx: { renewalDate?: string | null; clientId?: string | null; ownerId?: string | null; supplyId?: string | null }, s: SyncSettings) {
  if (cache.status !== "found") return { snapshotId: null, events: 0, opportunities: 0 };
  const snap = snapshotFromCache(cache);
  const hash = snapshotHash(snap);
  const prevR = await db.from("sips_snapshots").select("id,hash,data").eq("cups20", snap.cups20).order("consulted_at", { ascending: false }).limit(1);
  if (prevR.error) dbFail(prevR.error);
  const prev = (prevR.data ?? [])[0] as { id: string; hash: string; data: Snapshot } | undefined;
  if (prev?.hash === hash) return { snapshotId: prev.id, events: 0, opportunities: 0 };
  const ins = await db.from("sips_snapshots").upsert({ cups20: snap.cups20, hash, consulted_at: snap.consultedAt, reference_from: snap.consumptionFrom, reference_to: snap.consumptionTo, source: snap.source, data: snap }, { onConflict: "cups20,hash" }).select("id").single();
  if (ins.error) dbFail(ins.error);
  const sid = ins.data!.id as string;
  const events = detectChanges(prev?.data ?? null, snap, s);
  if (events.length) {
    const r = await db.from("sips_change_events").upsert(events.map((e) => ({ cups20: snap.cups20, snapshot_id: sid, previous_snapshot_id: prev?.id ?? null, kind: e.kind, field: e.field, old_value: e.oldValue ?? null, new_value: e.newValue ?? null, magnitude: e.magnitude, note: e.note })), { onConflict: "snapshot_id,kind", ignoreDuplicates: true });
    if (r.error) dbFail(r.error);
  }
  let created = 0;
  const cands = detectOpportunities(snap, events, { renewalDate: ctx.renewalDate ?? null }, s);
  if (cands.length) {
    // ja gestionat? oportunitat comercial activa del mateix subministrament o tasca pendent SIPS del client
    const activeOpp = ctx.clientId ? ((await db.from("crm_opportunities").select("id,supply_id,stage,crm_supplies(cups20)").eq("client_id", ctx.clientId).not("stage", "in", "(guanyat,perdut)")).data ?? []).some((o) => { const sp = (Array.isArray(o.crm_supplies) ? o.crm_supplies[0] : o.crm_supplies) as { cups20?: string } | null; return sp?.cups20 === snap.cups20; }) : false;
    for (const c of cands) {
      if (c.kind === "renovacio" && activeOpp) continue;
      const r = await db.from("sips_opportunities").upsert({ cups20: snap.cups20, kind: c.kind, dedupe_key: c.dedupeKey, title: c.title, quality: c.quality, details: { ...c.details, activeOpportunity: activeOpp, supplyId: ctx.supplyId ?? null }, client_id: ctx.clientId ?? null, owner_id: ctx.ownerId ?? null, snapshot_id: sid }, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
      if (r.error) dbFail(r.error);
      created += (r.data ?? []).length;
    }
  }
  // control del volum d'històric: es conserven les N instantànies més recents per CUPS
  const old = await db.from("sips_snapshots").select("id").eq("cups20", snap.cups20).order("consulted_at", { ascending: false }).range(s.historyPerCups, s.historyPerCups + 200);
  if (!old.error && old.data?.length) await db.from("sips_snapshots").delete().in("id", old.data.map((x) => x.id as string));
  return { snapshotId: sid, events: events.length, opportunities: created };
}

/* ======================================================================= execució */

export type Fetcher = (cups: string, onError: (e: unknown) => void) => Promise<CacheLike & { error?: string | null }>;
const defaultFetcher: Fetcher = (cups, onError) => refreshSips(cups, { force: true, onError }) as Promise<CacheLike & { error?: string | null }>;

/**
 * Una execució: reserva tasques degudes, les processa amb ritme limitat i desa resultats; si s'acaba el temps, les
 * no processades tornen a la cua (la pròxima execució continua). Una sola execució alhora (bloqueig a la BD).
 */
export async function runSync(opts: { trigger: "cron" | "manual" | "sobre_demanda"; userId?: string | null; budgetMs?: number; cups?: string[]; fetcher?: Fetcher; now?: () => Date; db?: Db; skipWindow?: boolean; wait?: (ms: number) => Promise<void> }) {
  const db = opts.db ?? adminClient();
  const now = opts.now ?? (() => new Date());
  const fetcher = opts.fetcher ?? defaultFetcher;
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  const { row, settings } = await loadSettings(db);
  // sobre demanda (un CUPS concret des de la fitxa) no depèn de l'activació massiva; la resta sí
  if (opts.trigger !== "sobre_demanda") {
    const b = massiveBlocker(row, settings);
    if (b) return { skipped: true as const, reason: b };
    if (opts.trigger === "cron" && !opts.skipWindow && !inWindow(now(), settings)) return { skipped: true as const, reason: "Fora de la finestra horària programada" };
  }
  if (opts.trigger === "cron") await syncInventory(db, now());
  const start = await db.rpc("sips_start_run", { p_trigger: opts.trigger, p_user: opts.userId ?? null, p_stale_minutes: 15 });
  if (start.error) dbFail(start.error);
  const runId = start.data as string | null;
  if (!runId) return { skipped: true as const, reason: "Ja hi ha una sincronització en curs" };
  const claim = await db.rpc("sips_claim_jobs", { p_run: runId, p_limit: opts.cups?.length ? opts.cups.length : settings.maxPerRun, p_cups: opts.cups?.length ? opts.cups : null });
  if (claim.error) dbFail(claim.error);
  const jobs = (claim.data ?? []) as Job[];
  const stats = { claimed: jobs.length, processed: 0, ok: 0, noData: 0, errors: 0, requests: 0, opportunities: 0, changes: 0 };
  let stop: string | null = null;
  const gap = spacingMs(settings.perMinute) * REQUESTS_PER_CUPS;
  let nextSlot = Date.now();
  let i = 0;
  const work = async () => {
    while (i < jobs.length && !stop) {
      if (Date.now() + 15_000 > deadline) break; // marge per desar i tancar
      const job = jobs[i++];
      const wait = nextSlot - Date.now();
      nextSlot = Math.max(nextSlot, Date.now()) + gap;
      if (wait > 0) { if (Date.now() + wait + 15_000 > deadline) { i--; break; } await (opts.wait ?? sleep)(wait); }
      const r = await processJob(db, job, runId, settings, fetcher, now);
      stats.processed++; stats.requests += REQUESTS_PER_CUPS;
      if (r.state === "actualitzat") stats.ok++; else if (r.state === "sense_dades") stats.noData++; else stats.errors++;
      stats.opportunities += r.opportunities; stats.changes += r.changes;
      if (r.stop) stop = r.stop;
      await db.from("sips_sync_runs").update({ heartbeat_at: now().toISOString(), processed: stats.processed }).eq("id", runId);
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(settings.concurrency, Math.max(1, jobs.length)) }, work));
  } finally {
    // les reservades que no s'han processat tornen a la cua tal com eren
    await db.from("sips_sync_jobs").update({ status: "pendent", locked_by: null, locked_at: null }).eq("locked_by", runId).eq("status", "en_proces");
    const status = stop ? "aturada" : stats.processed < stats.claimed ? "parcial" : "completada";
    await db.from("sips_sync_runs").update({ status, finished_at: now().toISOString(), heartbeat_at: now().toISOString(), claimed: stats.claimed, processed: stats.processed, ok: stats.ok, no_data: stats.noData, errors: stats.errors, requests: stats.requests, stop_reason: stop, stats }).eq("id", runId);
    await db.from("sips_sync_settings").update({ last_run_at: now().toISOString(), ...(stats.ok ? { last_success_at: now().toISOString() } : {}) }).eq("id", 1);
  }
  await raiseAlerts(db, settings, stats, stop, now());
  return { skipped: false as const, runId, ...stats, stop };
}

async function processJob(db: Db, job: Job, runId: string, s: SyncSettings, fetcher: Fetcher, now: () => Date): Promise<{ state: JobState; stop: string | null; opportunities: number; changes: number }> {
  let err: unknown = null;
  const capture = (e: unknown) => { err = e; };
  const attemptAt = now().toISOString();
  let res: (CacheLike & { error?: string | null }) | null = null;
  try {
    res = await fetcher(job.cups20, capture);
    // sense resultats amb la base: es prova la variant completa coneguda (p. ex. amb 0F)
    if (res.status === "not_found") {
      const full = job.variants.find((v) => v.length === 22);
      if (full) res = await fetcher(full, capture);
    }
  } catch (e) { err = e; }
  const base = { last_attempt_at: attemptAt, locked_by: null, locked_at: null, updated_at: now().toISOString(), reason: job.reason === "manual" || job.reason === "nou" ? job.base_reason : job.reason, priority: REASON_PRIORITY[job.reason === "manual" || job.reason === "nou" ? job.base_reason : job.reason] };
  if (res && !err && res.status === "found") {
    let rec = { snapshotId: null as string | null, events: 0, opportunities: 0 };
    try {
      const firstClient = job.client_ids[0] ?? null, firstOwner = job.owner_ids[0] ?? null;
      rec = await recordSnapshot(db, withAnnualConsumption(res as CacheLike & { raw?: Record<string, unknown> | null }) as CacheLike, { renewalDate: job.renewal_date, clientId: firstClient, ownerId: firstOwner, supplyId: job.refs?.find((r) => r.source === "subministrament")?.id ?? null }, s);
    } catch (e) {
      await logError(db, runId, job.cups20, "base_dades", null, e instanceof Error ? e.message : String(e));
    }
    await db.from("sips_sync_jobs").update({ ...base, status: "actualitzat", attempts: 0, last_success_at: attemptAt, finished_at: attemptAt, last_error: res.error ? safeMsg(res.error) : null, last_error_code: res.error ? "incomplet" : null, next_attempt_at: nextDue(base.reason as SyncReason, s, now()).toISOString() }).eq("cups20", job.cups20);
    return { state: "actualitzat", stop: null, opportunities: rec.opportunities, changes: rec.events };
  }
  if (res && !err && res.status === "not_found") {
    await db.from("sips_sync_jobs").update({ ...base, status: "sense_dades", attempts: 0, finished_at: attemptAt, last_error: "El proveïdor no retorna dades per a aquest CUPS (no s'inventa res).", last_error_code: "not_found", next_attempt_at: nextDue("historic", s, now()).toISOString() }).eq("cups20", job.cups20);
    return { state: "sense_dades", stop: null, opportunities: 0, changes: 0 };
  }
  // error: es conserven les dades vàlides anteriors (refreshSips no les esborra mai)
  const e = err as { status?: number; code?: string; message?: string; retryAfterSec?: number | null } | null;
  const out = classifyError(e ?? { code: "consulta" }, job.attempts + 1, s, now());
  const message = safeMsg(e?.message ?? res?.error ?? "Error de consulta");
  await logError(db, runId, job.cups20, out.code, e?.status ?? null, message);
  await db.from("sips_sync_jobs").update({ ...base, status: out.state, attempts: job.attempts + 1, last_error: message, last_error_code: out.code, next_attempt_at: (out.retryAt ?? new Date(now().getTime() + 30 * 86_400_000)).toISOString(), finished_at: out.state === "error_permanent" ? attemptAt : null }).eq("cups20", job.cups20);
  if (out.stopRun && (out.code === "credencials" || out.code === "sense_permisos" || out.code === "no_configurat")) {
    await db.from("sips_sync_settings").update({ blocked_reason: out.code === "credencials" ? "El proveïdor ha rebutjat les credencials (SIPS_USER / SIPS_PASSWORD)." : out.code === "no_configurat" ? "Falten les credencials SIPS al servidor." : "El proveïdor ha denegat l'accés (403).", blocked_at: now().toISOString() }).eq("id", 1);
  }
  return { state: out.state, stop: out.stopRun ? (out.code === "limit" ? "El proveïdor ha limitat les consultes (429): es reprèn més tard" : "Accés al proveïdor rebutjat: revisa les credencials i l'autorització") : null, opportunities: 0, changes: 0 };
}

async function logError(db: Db, runId: string | null, cups20: string, code: string, status: number | null, message: string) {
  await db.from("sips_sync_errors").insert({ run_id: runId, cups20, code, http_status: status, message: safeMsg(message) });
}

/* ======================================================================= avisos a l'administració (agrupats) */

async function notifyAdmins(db: Db, kind: string, title: string, body: string, ruleKey: string) {
  const admins = ((await db.from("profiles").select("id,role")).data ?? []).filter((p) => p.role === "admin");
  if (!admins.length) return;
  await db.from("crm_notifications").upsert(admins.map((a) => ({ user_id: a.id, kind, title, body, link: { view: "sips-sync" }, rule_key: ruleKey })), { onConflict: "user_id,rule_key", ignoreDuplicates: true });
}

async function raiseAlerts(db: Db, s: SyncSettings, stats: { processed: number; errors: number }, stop: string | null, now: Date) {
  const day = madridDay(now);
  if (stop && /credencials|rebutjat/.test(stop)) await notifyAdmins(db, "sips", "Sincronització SIPS aturada", `${stop}. No es tornarà a provar fins que es revisi.`, `sips:credencials:${day}`);
  if (stats.processed >= 5 && (stats.errors / stats.processed) * 100 >= s.errorRateAlertPct) {
    const n = (await db.from("sips_sync_jobs").select("cups20", { count: "exact", head: true }).in("status", ["error_temporal", "error_permanent"])).count ?? stats.errors;
    await notifyAdmins(db, "sips", "Errors repetits a la sincronització SIPS", `${Math.round((stats.errors / stats.processed) * 100)} % d'errors a l'última execució. ${n} CUPS afectats en total.`, `sips:errors:${day}`);
  }
}

/** Comprovació de salut (cron): avisa si porta massa temps sense cap consulta correcta. */
export async function staleCheck(db: Db = adminClient(), now = new Date()) {
  const { row, settings } = await loadSettings(db);
  if (!settings.enabled || settings.paused) return { checked: false };
  const last = row.last_success_at ? Date.parse(String(row.last_success_at)) : 0;
  const hours = (now.getTime() - last) / 3_600_000;
  if (hours >= settings.staleAlertHours) await notifyAdmins(db, "sips", "La sincronització SIPS no funciona", `Fa ${last ? Math.round(hours) : "més de " + settings.staleAlertHours} hores sense cap consulta correcta. Comprova el proveïdor i les credencials.`, `sips:stale:${madridDay(now)}`);
  return { checked: true, hours: Math.round(hours) };
}

/* ======================================================================= abast per rol */

/** CUPS (base 20) visibles per a l'usuari: tots per a Direcció i Cap administrativa; la resta, segons la RLS. */
async function visibleScope(u: U): Promise<Set<string> | null> {
  if (FULL_ROLES.has(u.profile.role)) return null;
  const set = await visibleCupsSet(u.sb).catch(() => new Set<string>());
  const [sup, leads] = await Promise.all([
    pageAll<{ cups20: string }>((a, b) => u.sb.from("crm_supplies").select("cups20").is("archived_at", null).range(a, b)).catch(() => []),
    pageAll<{ cups: string | null }>((a, b) => u.sb.from("crm_leads").select("cups").not("cups", "is", null).range(a, b)).catch(() => []),
  ]);
  for (const s of sup) if (s.cups20) set.add(s.cups20);
  for (const l of leads) { const k = cupsKey(l.cups); if (k) set.add(k.key); }
  return set;
}
const requireAdmin = (u: U) => { if (!isAdmin(u)) throw new HttpError(403, "Només Direcció pot configurar o llançar la sincronització massiva SIPS"); };

/* ======================================================================= lectura (panell) */

export async function overview(u: U) {
  const db = adminClient();
  const scope = await visibleScope(u);
  const { row, settings } = await loadSettings(db);
  const counts: Partial<Record<JobState, number>> = {};
  if (scope) {
    const keys = [...scope];
    for (let i = 0; i < keys.length; i += 500) {
      const r = await db.from("sips_sync_jobs").select("status").eq("in_inventory", true).in("cups20", keys.slice(i, i + 500));
      if (r.error) dbFail(r.error);
      for (const j of r.data ?? []) counts[j.status as JobState] = (counts[j.status as JobState] ?? 0) + 1;
    }
  } else {
    await Promise.all(JOB_STATES.map(async (st) => {
      const r = await db.from("sips_sync_jobs").select("cups20", { count: "exact", head: true }).eq("in_inventory", true).eq("status", st);
      if (r.error) dbFail(r.error);
      counts[st] = r.count ?? 0;
    }));
  }
  const total = JOB_STATES.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const runs = await db.from("sips_sync_runs").select("id,trigger,status,started_at,finished_at,processed,ok,no_data,errors,stop_reason").order("started_at", { ascending: false }).limit(1);
  const multi = scope ? 0 : (await db.from("sips_sync_jobs").select("cups20", { count: "exact", head: true }).eq("multi_client", true).eq("in_inventory", true)).count ?? 0;
  const opps = (await db.from("sips_opportunities").select("id", { count: "exact", head: true }).eq("status", "nova")).count ?? 0;
  const blocker = massiveBlocker(row, settings);
  return {
    total, counts, progressPct: progressPct(counts),
    synced: counts.actualitzat ?? 0, pending: (counts.pendent ?? 0) + (counts.en_proces ?? 0), errors: (counts.error_temporal ?? 0) + (counts.error_permanent ?? 0) + (counts.bloquejat_permisos ?? 0), noData: counts.sense_dades ?? 0,
    updatedPct: total ? Math.round(((counts.actualitzat ?? 0) / total) * 1000) / 10 : 0,
    lastRun: (runs.data ?? [])[0] ?? null,
    nextRun: blocker ? null : nextWindowStart(new Date(), settings),
    multiClient: multi, newOpportunities: opps,
    canConfigure: isAdmin(u), scoped: !!scope,
    status: { enabled: settings.enabled, paused: settings.paused, blocker, authorizedAt: row.authorized_at ?? null, authorizationRef: isAdmin(u) ? row.authorization_ref ?? null : null, blockedReason: row.blocked_reason ?? null, credentialsMissing: sipsMissing() },
    settings: isAdmin(u) ? settings : null,
    authorization: isAdmin(u) ? { ref: row.authorization_ref ?? null, limits: row.authorization_limits ?? null, legalBasis: row.legal_basis ?? null, retentionDays: row.retention_days ?? null, at: row.authorized_at ?? null } : null,
  };
}

/** Pròxima hora d'inici de la finestra (hora d'Espanya), aproximada a l'hora. */
function nextWindowStart(from: Date, s: SyncSettings): string {
  for (let h = 0; h <= 48; h++) {
    const d = new Date(Math.ceil(from.getTime() / 3_600_000) * 3_600_000 + h * 3_600_000);
    if (inWindow(d, s)) return d.toISOString();
  }
  return from.toISOString();
}

const jobFilter = z.object({
  q: z.string().trim().max(100).optional(), status: z.enum(JOB_STATES).optional(), tariff: z.string().trim().max(20).optional(), energy: z.enum(["luz", "gas"]).optional(),
  owner: z.string().uuid().optional(), retailer: z.string().trim().max(80).optional(), since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  multi: z.enum(["1"]).optional(), page: z.coerce.number().int().min(0).max(10_000).default(0), size: z.coerce.number().int().min(10).max(200).default(50),
});
/** Taula de CUPS: filtres sobre les dades desades (mai es consulta el SIPS per filtrar). Paginada al servidor. */
export async function listJobs(u: U, raw: Record<string, string>) {
  const f = jobFilter.parse(raw);
  const db = adminClient();
  const scope = await visibleScope(u);
  const build = (keys?: string[]) => {
    let q = db.from("sips_sync_jobs").select("cups20,variants,reason,priority,status,attempts,last_attempt_at,next_attempt_at,last_success_at,last_error,last_error_code,client_ids,client_names,owner_names,retailers,tariff,energy_type,renewal_date,multi_client", { count: "exact" }).eq("in_inventory", true);
    if (keys) q = q.in("cups20", keys);
    if (f.q) q = q.ilike("search", `%${f.q.toLowerCase().replace(/[%_]/g, " ")}%`);
    if (f.status) q = q.eq("status", f.status);
    if (f.tariff) q = q.eq("tariff", f.tariff);
    if (f.energy) q = q.eq("energy_type", f.energy);
    if (f.owner) q = q.contains("owner_ids", [f.owner]);
    if (f.retailer) q = q.ilike("search", `%${f.retailer.toLowerCase().replace(/[%_]/g, " ")}%`);
    if (f.since) q = q.gte("last_success_at", f.since);
    if (f.until) q = q.lte("last_success_at", `${f.until}T23:59:59Z`);
    if (f.multi) q = q.eq("multi_client", true);
    return q.order("priority").order("cups20");
  };
  if (!scope) {
    const r = await build().range(f.page * f.size, f.page * f.size + f.size - 1);
    if (r.error) dbFail(r.error);
    return { rows: r.data ?? [], total: r.count ?? 0, page: f.page, size: f.size };
  }
  // abast limitat: es filtra per lots de CUPS visibles i es pagina en memòria (un comercial en té pocs)
  const keys = [...scope];
  const all: Record<string, unknown>[] = [];
  for (let i = 0; i < keys.length; i += 300) {
    const r = await build(keys.slice(i, i + 300));
    if (r.error) dbFail(r.error);
    all.push(...(r.data ?? []));
  }
  all.sort((a, b) => Number(a.priority) - Number(b.priority) || String(a.cups20).localeCompare(String(b.cups20)));
  return { rows: all.slice(f.page * f.size, f.page * f.size + f.size), total: all.length, page: f.page, size: f.size };
}

async function assertCupsInScope(u: U, cups20: string[]) {
  const scope = await visibleScope(u);
  if (!scope) return;
  const bad = cups20.filter((c) => !scope.has(c));
  if (bad.length) throw new HttpError(403, `No tens accés a ${bad.length === 1 ? "aquest CUPS" : `${bad.length} dels CUPS seleccionats`}.`);
}

export async function runsHistory(u: U) {
  const db = adminClient();
  const r = await db.from("sips_sync_runs").select("*").order("started_at", { ascending: false }).limit(50);
  if (r.error) dbFail(r.error);
  const errs = isAdmin(u) || FULL_ROLES.has(u.profile.role) ? await db.from("sips_sync_errors").select("id,run_id,cups20,code,http_status,message,at").order("at", { ascending: false }).limit(200) : { data: [], error: null };
  if (errs.error) dbFail(errs.error);
  return { runs: r.data ?? [], errors: errs.data ?? [] };
}

/** Històric d'un CUPS: instantànies i canvis detectats. */
export async function cupsHistory(u: U, cups: string) {
  const k = cupsKey(cups);
  if (!k) throw new HttpError(400, "CUPS no vàlid");
  await assertCupsInScope(u, [k.key]);
  const db = adminClient();
  const [job, snaps, changes] = await Promise.all([
    db.from("sips_sync_jobs").select("*").eq("cups20", k.key).maybeSingle(),
    db.from("sips_snapshots").select("id,consulted_at,reference_from,reference_to,source,data").eq("cups20", k.key).order("consulted_at", { ascending: false }).limit(24),
    db.from("sips_change_events").select("*").eq("cups20", k.key).order("detected_at", { ascending: false }).limit(50),
  ]);
  if (snaps.error) dbFail(snaps.error);
  return { job: job.data ?? null, snapshots: snaps.data ?? [], changes: changes.data ?? [] };
}

/** Exportació a Excel de les incidències (errors, sense dades, bloquejats i CUPS a més d'un client). */
export async function exportIncidents(u: U) {
  const db = adminClient();
  const scope = await visibleScope(u);
  const r = await db.from("sips_sync_jobs").select("cups20,variants,status,last_error_code,last_error,attempts,last_attempt_at,client_names,owner_names,retailers,tariff,multi_client").eq("in_inventory", true).or("status.in.(error_temporal,error_permanent,bloquejat_permisos,sense_dades),multi_client.eq.true").limit(20_000);
  if (r.error) dbFail(r.error);
  const rows = (r.data ?? []).filter((x) => !scope || scope.has(x.cups20 as string));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Incidències SIPS");
  ws.columns = [
    { header: "CUPS", key: "cups", width: 26 }, { header: "Variants", key: "var", width: 30 }, { header: "Estat", key: "st", width: 20 }, { header: "Codi", key: "code", width: 16 },
    { header: "Detall", key: "msg", width: 60 }, { header: "Intents", key: "att", width: 8 }, { header: "Últim intent", key: "at", width: 20 }, { header: "Clients", key: "cl", width: 40 },
    { header: "Mateix CUPS a més d'un client", key: "multi", width: 14 }, { header: "Responsable", key: "own", width: 24 }, { header: "Comercialitzadora", key: "ret", width: 24 }, { header: "Tarifa", key: "tar", width: 10 },
  ];
  for (const x of rows) ws.addRow({ cups: x.cups20, var: (x.variants as string[]).join(", "), st: x.status, code: x.last_error_code ?? "", msg: x.last_error ?? "", att: x.attempts, at: x.last_attempt_at ?? "", cl: (x.client_names as string[]).join(" | "), multi: x.multi_client ? "Sí" : "", own: (x.owner_names as string[]).join(", "), ret: (x.retailers as string[]).join(", "), tar: x.tariff ?? "" });
  ws.getRow(1).font = { bold: true };
  await secLog(u, "sips_export_incidencies", "sips_sync_jobs", null, { rows: rows.length });
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), fileName: `incidencies-sips-${new Date().toISOString().slice(0, 10)}.xlsx` };
}

/* ======================================================================= accions */

const enqueueInput = z.object({ mode: z.enum(["pendents", "seleccionats", "errors"]), cups: z.array(z.string()).max(2000).optional(), dryRun: z.boolean().default(false) });
/**
 * «Sincronitzar pendents / seleccionats» i «Reintentar errors». Amb dryRun retorna el nombre de CUPS i de consultes
 * estimades (per a la confirmació). Les tasques passen a prioritat manual; les processa la pròxima execució o «Executa ara».
 */
export async function enqueue(u: U, raw: unknown) {
  const b = enqueueInput.parse(raw);
  const db = adminClient();
  let keys: string[] = [];
  if (b.mode === "seleccionats") {
    keys = [...new Set((b.cups ?? []).map((c) => cupsKey(c)?.key).filter((x): x is string => !!x))];
    if (!keys.length) throw new HttpError(400, "No hi ha cap CUPS vàlid seleccionat");
    await assertCupsInScope(u, keys);
  } else {
    requireAdmin(u);
    const statuses = b.mode === "errors" ? ["error_temporal", "error_permanent", "bloquejat_permisos"] : ["pendent"];
    keys = (await pageAll<{ cups20: string }>((a, z2) => db.from("sips_sync_jobs").select("cups20").eq("in_inventory", true).in("status", statuses).range(a, z2))).map((x) => x.cups20);
  }
  const { row, settings } = await loadSettings(db);
  const estimate = { cups: keys.length, requests: keys.length * REQUESTS_PER_CUPS, minutes: Math.ceil((keys.length * REQUESTS_PER_CUPS) / settings.perMinute), runs: Math.ceil(keys.length / settings.maxPerRun) };
  if (b.dryRun) return { ...estimate, blocker: b.mode === "seleccionats" && keys.length <= 5 ? null : massiveBlocker(row, settings) };
  if (keys.length > 5 && b.mode === "seleccionats") requireAdmin(u);
  for (let i = 0; i < keys.length; i += 500) {
    const r = await db.from("sips_sync_jobs").update({ reason: "manual", priority: 1, status: "pendent", next_attempt_at: new Date().toISOString(), requested_by: u.user.id, ...(b.mode === "errors" ? { attempts: 0 } : {}) }).in("cups20", keys.slice(i, i + 500)).neq("status", "en_proces");
    if (r.error) dbFail(r.error);
  }
  if (b.mode === "errors") await db.from("sips_sync_settings").update({ blocked_reason: null, blocked_at: null }).eq("id", 1);
  await secLog(u, "sips_encua", "sips_sync_jobs", null, { mode: b.mode, cups: keys.length });
  return { queued: keys.length, ...estimate };
}

/** «Executa ara»: una execució manual (Direcció) amb el temps de la petició; la resta continua a la cua. */
export async function runNow(u: U) {
  requireAdmin(u);
  await syncInventory();
  return runSync({ trigger: "manual", userId: u.user.id, budgetMs: 50_000 });
}

/**
 * Actualització d'un CUPS concret des de la fitxa (consulta interactiva, com fins ara): no depèn de la sincronització
 * massiva. Desa la instantània i actualitza la tasca de la cua.
 */
export async function refreshOne(u: U, cups: string) {
  const k = cupsKey(cups);
  if (!k) throw new HttpError(400, "CUPS no vàlid");
  await assertCupsInScope(u, [k.key]);
  const db = adminClient();
  const exists = await db.from("sips_sync_jobs").select("cups20").eq("cups20", k.key).maybeSingle();
  if (exists.error) dbFail(exists.error);
  if (!exists.data) await db.from("sips_sync_jobs").upsert({ cups20: k.key, variants: [k.full], reason: "manual", base_reason: "nou", priority: 1, status: "pendent", next_attempt_at: new Date().toISOString(), requested_by: u.user.id, search: `${k.key} ${k.full}`.toLowerCase() }, { onConflict: "cups20" });
  else await db.from("sips_sync_jobs").update({ reason: "manual", priority: 1, status: "pendent", next_attempt_at: new Date().toISOString(), requested_by: u.user.id }).eq("cups20", k.key).neq("status", "en_proces");
  const r = await runSync({ trigger: "sobre_demanda", userId: u.user.id, budgetMs: 45_000, cups: [k.key] });
  const job = (await db.from("sips_sync_jobs").select("status,last_success_at,last_error,next_attempt_at").eq("cups20", k.key).maybeSingle()).data;
  return { run: r, job };
}

/** Després d'una consulta interactiva existent (/api/sips/refresh): històric i canvis, sense consultar res més. */
export async function afterInteractiveRefresh(entry: CacheLike) {
  try {
    const db = adminClient();
    const { settings } = await loadSettings(db);
    const job = (await db.from("sips_sync_jobs").select("client_ids,owner_ids,renewal_date,base_reason,refs").eq("cups20", entry.cups).maybeSingle()).data as Pick<Job, "client_ids" | "owner_ids" | "renewal_date" | "base_reason" | "refs"> | null;
    await recordSnapshot(db, withAnnualConsumption(entry as CacheLike & { raw?: Record<string, unknown> | null }) as CacheLike, { renewalDate: job?.renewal_date ?? null, clientId: job?.client_ids?.[0] ?? null, ownerId: job?.owner_ids?.[0] ?? null, supplyId: job?.refs?.find((r) => r.source === "subministrament")?.id ?? null }, settings);
    if (job && entry.status === "found") await db.from("sips_sync_jobs").update({ status: "actualitzat", attempts: 0, last_success_at: entry.consulted_at, last_attempt_at: entry.consulted_at, next_attempt_at: nextDue(job.base_reason, settings, new Date()).toISOString(), last_error: null, last_error_code: null }).eq("cups20", entry.cups).neq("status", "en_proces");
  } catch { /* la migració 034 pot no estar aplicada: la consulta interactiva funciona igual */ }
}

const settingsInput = z.object({
  frequencies: z.object({ nou: z.number(), renovacio: z.number(), oportunitat: z.number(), actiu: z.number(), historic: z.number() }).partial().optional(),
  renewalWindowDays: z.number().optional(), includeHistoric: z.boolean().optional(), maxPerRun: z.number().optional(), concurrency: z.number().optional(), perMinute: z.number().optional(),
  maxAttempts: z.number().optional(), backoffMinutes: z.number().optional(), maxBackoffHours: z.number().optional(), windowStartHour: z.number().optional(), windowEndHour: z.number().optional(),
  consumptionChangePct: z.number().optional(), minConsumptionChangeKwh: z.number().optional(), powerToleranceKw: z.number().optional(), oversizeRatio: z.number().optional(), oversizeMinMonths: z.number().optional(),
  errorRateAlertPct: z.number().optional(), staleAlertHours: z.number().optional(), historyPerCups: z.number().optional(),
});
export async function saveSettings(u: U, raw: unknown) {
  requireAdmin(u);
  const b = settingsInput.parse(raw);
  const db = adminClient();
  const { settings } = await loadSettings(db);
  const merged = resolveSettings({ ...settings, ...b, frequencies: { ...settings.frequencies, ...(b.frequencies ?? {}) } as SyncSettings["frequencies"] });
  const { enabled: _e, paused: _p, ...persist } = merged;
  void _e; void _p;
  const r = await db.from("sips_sync_settings").update({ settings: persist, updated_by: u.user.id, updated_at: new Date().toISOString() }).eq("id", 1);
  if (r.error) dbFail(r.error);
  await secLog(u, "sips_config", "sips_sync_settings", "1", persist as unknown as Record<string, unknown>);
  return { settings: merged };
}

const authInput = z.object({
  enable: z.boolean(),
  ref: z.string().trim().min(10, "Descriu l'autorització del proveïdor (document, data i abast)").max(1000).optional(),
  limits: z.string().trim().max(500).optional(), legalBasis: z.string().trim().max(500).optional(), retentionDays: z.number().int().min(30).max(3650).optional(),
  confirm: z.literal(true).optional(),
});
/** Activa o desactiva la sincronització massiva. Activar-la exige registrar l'autorització del proveïdor i la base jurídica. */
export async function setAuthorization(u: U, raw: unknown) {
  requireAdmin(u);
  const b = authInput.parse(raw);
  const db = adminClient();
  if (b.enable) {
    if (!b.ref || !b.legalBasis || !b.confirm) throw new HttpError(400, "Per activar-la cal descriure l'autorització del proveïdor, la base jurídica i confirmar-ho expressament");
    if (sipsMissing().length) throw new HttpError(409, `No es pot activar: falten variables d'entorn (${sipsMissing().join(", ")})`);
  }
  const r = await db.from("sips_sync_settings").update(b.enable
    ? { enabled: true, paused: false, authorization_ref: b.ref, authorization_limits: b.limits ?? null, legal_basis: b.legalBasis, retention_days: b.retentionDays ?? null, authorized_by: u.user.id, authorized_at: new Date().toISOString(), blocked_reason: null, blocked_at: null, updated_by: u.user.id, updated_at: new Date().toISOString() }
    : { enabled: false, updated_by: u.user.id, updated_at: new Date().toISOString() }).eq("id", 1);
  if (r.error) dbFail(r.error);
  await secLog(u, b.enable ? "sips_massiva_activada" : "sips_massiva_desactivada", "sips_sync_settings", "1", b.enable ? { limits: b.limits ?? null, retentionDays: b.retentionDays ?? null } : null);
  return { ok: true };
}

export async function setPaused(u: U, paused: boolean) {
  requireAdmin(u);
  const r = await adminClient().from("sips_sync_settings").update({ paused, updated_by: u.user.id, updated_at: new Date().toISOString() }).eq("id", 1);
  if (r.error) dbFail(r.error);
  await secLog(u, paused ? "sips_pausa" : "sips_repren", "sips_sync_settings", "1");
  return { ok: true, paused };
}

/* ======================================================================= oportunitats detectades pel SIPS */

export async function listOpportunities(u: U, raw: Record<string, string>) {
  const db = adminClient();
  const scope = await visibleScope(u);
  let q = db.from("sips_opportunities").select("*, crm_clients(id,name)").order("created_at", { ascending: false }).limit(300);
  if (raw.status && ["nova", "revisada", "descartada", "tasca_creada"].includes(raw.status)) q = q.eq("status", raw.status);
  const r = await q;
  if (r.error) dbFail(r.error);
  const rows = (r.data ?? []).filter((o) => !scope || scope.has(o.cups20 as string));
  // canvis que expliquen cada alerta
  const sids = [...new Set(rows.map((o) => o.snapshot_id).filter(Boolean))] as string[];
  const ch = sids.length ? ((await db.from("sips_change_events").select("snapshot_id,kind,note").in("snapshot_id", sids)).data ?? []) : [];
  return { rows: rows.map((o) => ({ ...o, changes: ch.filter((c) => c.snapshot_id === o.snapshot_id) })) };
}

const oppAction = z.object({ action: z.enum(["revisada", "descartada", "tasca"]), dueAt: z.string().optional() });
/** Marca com a revisada, descarta o crea una tasca comercial (sense duplicats: rule_key únic). */
export async function actOpportunity(u: U, id: string, raw: unknown) {
  const b = oppAction.parse(raw);
  const db = adminClient();
  const o = await db.from("sips_opportunities").select("*").eq("id", z.string().uuid().parse(id)).maybeSingle();
  if (o.error) dbFail(o.error);
  if (!o.data) throw new HttpError(404, "Alerta no trobada");
  await assertCupsInScope(u, [o.data.cups20 as string]);
  if (b.action !== "tasca") {
    const r = await db.from("sips_opportunities").update({ status: b.action, handled_by: u.user.id, handled_at: new Date().toISOString() }).eq("id", id);
    if (r.error) dbFail(r.error);
    return { ok: true };
  }
  if (o.data.task_id) return { ok: true, taskId: o.data.task_id, existing: true };
  if (!o.data.client_id) throw new HttpError(409, "Aquest CUPS no està vinculat a cap client del CRM: no es pot crear la tasca");
  // la tasca es crea amb la sessió de l'usuari (RLS: només en clients que pot veure)
  const t = await u.sb.from("crm_tasks").upsert({ client_id: o.data.client_id, title: `SIPS · ${String(o.data.title).slice(0, 180)}`, notes: `CUPS ${o.data.cups20}. ${(o.data.details as { note?: string } | null)?.note ?? ""} Detectat per la sincronització SIPS: valida-ho amb Comparatives IA abans de proposar res al client.`.slice(0, 2000), due_at: b.dueAt ?? new Date(Date.now() + 3 * 86_400_000).toISOString(), assigned_to: o.data.owner_id ?? u.user.id, rule_key: `sips-opp:${o.data.id}` }, { onConflict: "rule_key", ignoreDuplicates: false }).select("id").single();
  if (t.error) throw new HttpError(t.error.code === "42501" ? 403 : 500, t.error.code === "42501" ? "No tens permís per crear tasques en aquest client" : "No s'ha pogut crear la tasca");
  await db.from("sips_opportunities").update({ status: "tasca_creada", task_id: t.data!.id, handled_by: u.user.id, handled_at: new Date().toISOString() }).eq("id", id);
  return { ok: true, taskId: t.data!.id };
}

/* ======================================================================= estat d'un CUPS (fitxa 360) */

export async function cupsStatus(u: U, cupsList: string[]) {
  const keys = [...new Set(cupsList.map((c) => cupsKey(c)?.key).filter((x): x is string => !!x))].slice(0, 200);
  if (!keys.length) return { rows: [] };
  await assertCupsInScope(u, keys);
  const r = await adminClient().from("sips_sync_jobs").select("cups20,status,last_success_at,last_attempt_at,next_attempt_at,last_error,reason,multi_client").in("cups20", keys);
  if (r.error) { if (missing(r.error)) return { rows: [], migration: false }; dbFail(r.error); }
  return { rows: r.data ?? [] };
}
