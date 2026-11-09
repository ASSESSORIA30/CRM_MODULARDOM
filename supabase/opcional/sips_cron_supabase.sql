-- =====================================================================================================================
-- OPCIONAL · Supabase Cron per a la sincronització SIPS (NO és una migració; executa-ho només si cal).
--
-- Per què: el cron de Vercel (vercel.json) crida /api/sips/sync/cron una vegada cada nit. Cada crida processa un lot
-- limitat (≈50 s i el límit de peticions per minut configurat). Si hi ha molts CUPS i el proveïdor ho autoritza, es pot
-- cridar més sovint dins de la finestra nocturna amb Supabase Cron (pg_cron + pg_net). El bloqueig de la base de dades
-- evita execucions simultànies i la cua persistent continua des del punt on s'havia quedat.
--
-- Abans d'executar-ho:
--   1. Activa les extensions pg_cron i pg_net (Supabase → Database → Extensions).
--   2. Desa el CRON_SECRET a Vault (Supabase → Project Settings → Vault) amb el nom «sips_cron_secret».
--   3. Substitueix <DOMINI> pel domini real del CRM (sense barra final).
-- La finestra horària (hora d'Espanya) la decideix el servidor: les crides de fora de la finestra no consulten res.
-- =====================================================================================================================

-- cada 10 minuts entre les 00:00 i les 05:59 UTC (cobreix les 02:00–07:00 d'Espanya a l'hivern i a l'estiu)
select cron.schedule(
  'sips-sync-nocturna',
  '*/10 0-5 * * *',
  $$
  select net.http_get(
    url := 'https://<DOMINI>/api/sips/sync/cron',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'sips_cron_secret')),
    timeout_milliseconds := 65000
  );
  $$
);

-- Per aturar-la:  select cron.unschedule('sips-sync-nocturna');
-- Per comprovar-la: select * from cron.job; select * from cron.job_run_details order by start_time desc limit 10;
