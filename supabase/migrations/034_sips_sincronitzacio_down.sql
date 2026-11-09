-- 034 · REVERSIÓ: elimina només les taules i funcions de la sincronització SIPS.
-- `sips_cache` (dades SIPS de cada CUPS) NO es toca. Es perd l'històric d'instantànies, la cua i les oportunitats detectades.
drop function if exists public.sips_claim_jobs(uuid, integer, text[]);
drop function if exists public.sips_start_run(text, uuid, integer);
drop table if exists public.sips_opportunities;
drop table if exists public.sips_change_events;
drop table if exists public.sips_snapshots;
drop table if exists public.sips_sync_errors;
drop table if exists public.sips_sync_runs;
drop table if exists public.sips_sync_jobs;
drop table if exists public.sips_sync_settings;
