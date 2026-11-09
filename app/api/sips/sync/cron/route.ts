import { env } from "@/server/env";
import { HttpError, handler } from "@/server/supabase";
import { runSync, staleCheck } from "@/server/sips-sync";

export const runtime = "nodejs";
export const preferredRegion = "cdg1";
export const maxDuration = 60;

/**
 * Execució programada de la sincronització SIPS (Vercel Cron o Supabase Cron). Protegida amb CRON_SECRET.
 * Cada crida processa un lot amb temps limitat i deixa la resta a la cua persistent: es pot cridar sovint
 * (p. ex. cada 10 minuts durant la nit) sense risc de duplicats (bloqueig a la base de dades).
 * Només consulta el proveïdor si Direcció ha activat la sincronització amb l'autorització registrada,
 * i dins de la finestra horària configurada (hora d'Espanya, amb canvi d'horari d'estiu).
 */
export const GET = handler(async (req): Promise<unknown> => {
  if (!env.cronSecret || req.headers.get("authorization") !== `Bearer ${env.cronSecret}`) throw new HttpError(401, "No autoritzat");
  const result = await runSync({ trigger: "cron", budgetMs: 50_000 });
  const health = await staleCheck().catch(() => ({ checked: false }));
  return { result, health };
});
