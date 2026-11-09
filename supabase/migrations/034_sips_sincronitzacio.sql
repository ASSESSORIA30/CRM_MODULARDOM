-- =====================================================================================================================
-- 034 · Sincronització automàtica SIPS
-- Reutilitza `sips_cache` (004) com a registre únic per CUPS amb les últimes dades. Afegeix:
--   sips_sync_settings   configuració (freqüències, límits, llindars) i AUTORITZACIÓ del proveïdor (desactivada per defecte)
--   sips_sync_jobs       cua persistent: una fila per CUPS (base de 20), amb prioritat, estat, intents i pròxima consulta
--   sips_sync_runs       execucions (bloqueig: només una alhora) i estadístiques
--   sips_sync_errors     incidències de consulta (sense credencials ni dades personals)
--   sips_snapshots       històric de dades normalitzades (sense duplicats: una entrada per empremta)
--   sips_change_events   canvis significatius detectats
--   sips_opportunities   oportunitats detectades pel SIPS (sense duplicats: clau única)
-- Totes amb RLS activada i SENSE polítiques per a `authenticated`: només hi accedeix el servidor (service role) després
-- de comprovar el rol i la visibilitat de cada CUPS. Idempotent; no toca cap taula existent.
-- =====================================================================================================================

create table if not exists public.sips_sync_settings (
  id smallint primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,              -- freqüències, límits i llindars (vegeu src/core/sips-sync.ts)
  enabled boolean not null default false,                   -- sincronització programada (massiva)
  paused boolean not null default false,
  -- autorització del proveïdor: sense aquestes dades el servidor no activa la sincronització massiva
  authorization_ref text,                                   -- p. ex. «Correu d'EAS del 12/11/2026: autoritzen 2.000 consultes/dia via API»
  authorization_limits text,
  legal_basis text,
  retention_days integer check (retention_days is null or retention_days between 30 and 3650),
  authorized_by uuid references auth.users (id),
  authorized_at timestamptz,
  blocked_reason text,                                      -- p. ex. credencials rebutjades: s'atura fins que es revisi
  blocked_at timestamptz,
  last_run_at timestamptz,
  last_success_at timestamptz,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);
insert into public.sips_sync_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.sips_sync_jobs (
  cups20 text primary key check (cups20 ~ '^ES[0-9]{16}[A-Z]{2}$'),
  variants text[] not null default '{}',                    -- CUPS originals (amb i sense 0F)
  reason text not null default 'nou' check (reason in ('manual', 'nou', 'renovacio', 'oportunitat', 'actiu', 'historic')),
  base_reason text not null default 'nou' check (base_reason in ('nou', 'renovacio', 'oportunitat', 'actiu', 'historic')),
  priority smallint not null default 2 check (priority between 1 and 9),
  status text not null default 'pendent' check (status in ('pendent', 'en_proces', 'actualitzat', 'sense_dades', 'error_temporal', 'error_permanent', 'bloquejat_permisos')),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_success_at timestamptz,
  finished_at timestamptz,
  last_error text,
  last_error_code text,
  locked_by uuid,                                           -- execució que la processa
  locked_at timestamptz,
  requested_by uuid references auth.users (id) on delete set null,
  -- dades de l'inventari (per filtrar sense tornar a consultar el SIPS)
  client_ids uuid[] not null default '{}',
  client_names text[] not null default '{}',
  owner_ids uuid[] not null default '{}',
  owner_names text[] not null default '{}',
  retailers text[] not null default '{}',
  tariff text,
  energy_type text check (energy_type is null or energy_type in ('luz', 'gas')),
  renewal_date date,
  sources jsonb not null default '{}'::jsonb,
  refs jsonb not null default '[]'::jsonb,
  multi_client boolean not null default false,
  in_inventory boolean not null default true,               -- false: el CUPS ja no és al CRM (no es consulta)
  search text not null default '',                          -- CUPS, variants, clients, comercialitzadores i responsables (cerca sense SIPS)
  inventory_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sips_jobs_due_idx on public.sips_sync_jobs (priority, next_attempt_at) where in_inventory and status in ('pendent', 'actualitzat', 'sense_dades', 'error_temporal');
create index if not exists sips_jobs_status_idx on public.sips_sync_jobs (status);
create index if not exists sips_jobs_clients_idx on public.sips_sync_jobs using gin (client_ids);
create index if not exists sips_jobs_owners_idx on public.sips_sync_jobs using gin (owner_ids);
create index if not exists sips_jobs_success_idx on public.sips_sync_jobs (last_success_at);

create table if not exists public.sips_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron', 'manual', 'sobre_demanda')),
  status text not null default 'en_curs' check (status in ('en_curs', 'completada', 'parcial', 'aturada', 'interrompuda', 'error')),
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  finished_at timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  claimed integer not null default 0,
  processed integer not null default 0,
  ok integer not null default 0,
  no_data integer not null default 0,
  errors integer not null default 0,
  requests integer not null default 0,
  stop_reason text,
  stats jsonb
);
-- una sola execució en curs alhora (bloqueig a la base de dades)
create unique index if not exists sips_runs_one_running on public.sips_sync_runs ((true)) where status = 'en_curs';
create index if not exists sips_runs_started_idx on public.sips_sync_runs (started_at desc);

create table if not exists public.sips_sync_errors (
  id bigint generated always as identity primary key,
  run_id uuid references public.sips_sync_runs (id) on delete set null,
  cups20 text not null,
  code text not null,
  http_status integer,
  message text,                                             -- missatge depurat: mai credencials ni respostes internes
  at timestamptz not null default now()
);
create index if not exists sips_errors_at_idx on public.sips_sync_errors (at desc);
create index if not exists sips_errors_cups_idx on public.sips_sync_errors (cups20, at desc);

create table if not exists public.sips_snapshots (
  id uuid primary key default gen_random_uuid(),
  cups20 text not null,
  hash text not null,
  consulted_at timestamptz not null,
  reference_from date,
  reference_to date,
  source text,
  data jsonb not null,                                      -- instantània normalitzada (Snapshot)
  created_at timestamptz not null default now(),
  unique (cups20, hash)
);
create index if not exists sips_snapshots_cups_idx on public.sips_snapshots (cups20, consulted_at desc);

create table if not exists public.sips_change_events (
  id uuid primary key default gen_random_uuid(),
  cups20 text not null,
  snapshot_id uuid not null references public.sips_snapshots (id) on delete cascade,
  previous_snapshot_id uuid references public.sips_snapshots (id) on delete set null,
  kind text not null check (kind in ('potencia', 'tarifa', 'consum_augment', 'consum_reduccio', 'dades_noves', 'incoherent')),
  field text,
  old_value jsonb,
  new_value jsonb,
  magnitude numeric,
  note text,
  validation text not null default 'pendent' check (validation in ('pendent', 'validat', 'descartat')),
  detected_at timestamptz not null default now(),
  unique (snapshot_id, kind)
);
create index if not exists sips_changes_cups_idx on public.sips_change_events (cups20, detected_at desc);

create table if not exists public.sips_opportunities (
  id uuid primary key default gen_random_uuid(),
  cups20 text not null,
  kind text not null check (kind in ('optimitzacio_potencia', 'augment_consum', 'renovacio')),
  dedupe_key text not null unique,
  title text not null,
  quality text not null default 'mitjana' check (quality in ('alta', 'mitjana', 'baixa')),
  details jsonb,
  client_id uuid references public.crm_clients (id) on delete set null,
  owner_id uuid references auth.users (id) on delete set null,
  snapshot_id uuid references public.sips_snapshots (id) on delete set null,
  status text not null default 'nova' check (status in ('nova', 'revisada', 'descartada', 'tasca_creada')),
  task_id uuid references public.crm_tasks (id) on delete set null,
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sips_opps_status_idx on public.sips_opportunities (status, created_at desc);
create index if not exists sips_opps_client_idx on public.sips_opportunities (client_id);

-- RLS sense polítiques: només el servidor (service role)
alter table public.sips_sync_settings enable row level security;
alter table public.sips_sync_jobs enable row level security;
alter table public.sips_sync_runs enable row level security;
alter table public.sips_sync_errors enable row level security;
alter table public.sips_snapshots enable row level security;
alter table public.sips_change_events enable row level security;
alter table public.sips_opportunities enable row level security;

-- ------------------------------------------------------------ inici d'execució amb bloqueig (atòmic)
-- Tanca com a «interrompuda» una execució sense batec durant p_stale_minutes i allibera les seves tasques.
create or replace function public.sips_start_run(p_trigger text, p_user uuid, p_stale_minutes integer default 15)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update sips_sync_runs set status = 'interrompuda', finished_at = now(), stop_reason = 'Sense activitat: execució interrompuda'
   where status = 'en_curs' and heartbeat_at < now() - make_interval(mins => p_stale_minutes);
  update sips_sync_jobs set status = 'pendent', locked_by = null, locked_at = null
   where status = 'en_proces' and (locked_at is null or locked_at < now() - make_interval(mins => p_stale_minutes));
  begin
    insert into sips_sync_runs (trigger, started_by) values (p_trigger, p_user) returning id into v_id;
  exception when unique_violation then
    return null;  -- ja n'hi ha una en curs
  end;
  return v_id;
end $$;

-- Reserva les tasques degudes per ordre de prioritat (sense que dues execucions agafin la mateixa)
create or replace function public.sips_claim_jobs(p_run uuid, p_limit integer, p_cups text[] default null)
returns setof public.sips_sync_jobs language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select j.cups20 from sips_sync_jobs j
     where j.in_inventory
       and (p_cups is null or j.cups20 = any (p_cups))
       and j.status in ('pendent', 'actualitzat', 'sense_dades', 'error_temporal')
       and j.next_attempt_at <= now()
     order by j.priority, j.next_attempt_at
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update sips_sync_jobs j set status = 'en_proces', locked_by = p_run, locked_at = now(), updated_at = now()
    from c where j.cups20 = c.cups20
  returning j.*;
end $$;

revoke all on function public.sips_start_run(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.sips_claim_jobs(uuid, integer, text[]) from public, anon, authenticated;
