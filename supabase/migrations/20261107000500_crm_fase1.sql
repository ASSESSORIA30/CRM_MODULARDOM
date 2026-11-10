-- =====================================================================
-- 0500 · CRM FASE 1: pipeline comercial, 11 passos, historial d'etapes,
-- activitats, tasques, calendari i notificacions.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Normalització per a cerques i duplicats
create or replace function app.norm(p text)
returns text language sql immutable set search_path = '' as $$
  select lower(trim(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))))
$$;

create or replace function app.norm_phone(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 9), '')
$$;

-- ---------------------------------------------------------------------
-- Clients: camps fiscals d'adreça i fusió
-- ---------------------------------------------------------------------
alter table public.clients
  add column postal_code text,
  add column city text,
  add column province text,
  add column merged_into uuid references public.clients (id) on delete restrict;
create index clients_name_trgm on public.clients using gin (app.norm(display_name) extensions.gin_trgm_ops);
create index clients_phone_idx on public.clients (app.norm_phone(phone));

-- ---------------------------------------------------------------------
-- Codi de projecte automàtic: MD-AAAA-NNNN
-- ---------------------------------------------------------------------
create table app.project_code_counters (
  year integer primary key,
  last_value integer not null default 0
);

create or replace function app.next_project_code()
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_year integer := extract(year from now() at time zone 'Europe/Madrid')::integer;
  v_n integer;
begin
  insert into app.project_code_counters (year, last_value) values (v_year, 1)
  on conflict (year) do update set last_value = app.project_code_counters.last_value + 1
  returning last_value into v_n;
  return format('MD-%s-%s', v_year, lpad(v_n::text, 4, '0'));
end $$;
revoke all on function app.next_project_code() from public;
grant execute on function app.next_project_code() to authenticated, service_role;
alter table public.projects alter column code set default app.next_project_code();

-- ---------------------------------------------------------------------
-- Projectes: camps del pipeline
-- ---------------------------------------------------------------------
alter table public.projects
  add column priority text not null default 'normal'
    check (priority in ('baixa', 'normal', 'alta', 'urgent')),
  add column responsible_id uuid references public.profiles (id) on delete set null,
  add column next_action text,
  add column follow_up_date date,
  add column last_activity_at timestamptz,
  add column lost_reason text,
  add column contracted_at timestamptz,
  add column stage_changed_at timestamptz not null default now();
create index projects_status_idx on public.projects (status);
create index projects_responsible_idx on public.projects (responsible_id);

-- ---------------------------------------------------------------------
-- Els 11 passos del procés comercial i constructiu
-- ---------------------------------------------------------------------
create table public.project_steps (
  project_id  uuid not null references public.projects (id) on delete cascade,
  step        smallint not null check (step between 1 and 11),
  status      text not null default 'pendent' check (status in ('pendent', 'fet', 'no_aplica')),
  done_at     timestamptz,
  done_by     uuid references public.profiles (id) on delete set null,
  notes       text,
  updated_at  timestamptz not null default now(),
  primary key (project_id, step),
  -- només la visita a la casa pilot (pas 3) és opcional
  constraint only_step3_optional check (status <> 'no_aplica' or step = 3)
);
create trigger project_steps_touch before update on public.project_steps
  for each row execute function app.touch_updated_at();

create or replace function app.seed_project_steps()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.project_steps (project_id, step)
  select new.id, s from generate_series(1, 11) s
  on conflict do nothing;
  return new;
end $$;
create trigger projects_seed_steps after insert on public.projects
  for each row execute function app.seed_project_steps();

-- Requisits per entrar a cada etapa (configurables per direcció)
create table public.pipeline_stage_requirements (
  stage text not null check (stage in ('lead','pressupost','avantprojecte','contractat',
                                       'projecte_llicencia','en_obra','finalitzat','perdut')),
  step  smallint not null check (step between 1 and 11),
  primary key (stage, step)
);
insert into public.pipeline_stage_requirements (stage, step) values
  ('pressupost', 1),
  ('avantprojecte', 1), ('avantprojecte', 2), ('avantprojecte', 4),
  ('contractat', 1), ('contractat', 2), ('contractat', 4), ('contractat', 5), ('contractat', 6),
  ('projecte_llicencia', 1), ('projecte_llicencia', 2), ('projecte_llicencia', 4),
  ('projecte_llicencia', 5), ('projecte_llicencia', 6),
  ('en_obra', 1), ('en_obra', 2), ('en_obra', 4), ('en_obra', 5), ('en_obra', 6),
  ('en_obra', 7), ('en_obra', 8), ('en_obra', 9), ('en_obra', 10);

-- Historial complet de canvis d'etapa
create table public.project_stage_history (
  id          bigint generated always as identity primary key,
  project_id  uuid not null references public.projects (id) on delete cascade,
  from_stage  text,
  to_stage    text not null,
  reason      text,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index project_stage_history_project_idx on public.project_stage_history (project_id, changed_at desc);

-- L'etapa només es pot canviar amb move_project_stage() (el drag-and-drop no esquiva validacions)
create or replace function app.guard_project_stage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status <> 'lead' then
    raise exception 'Els projectes nous comencen a l''etapa Lead nou' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and coalesce(current_setting('app.stage_move', true), 'off') <> 'on' then
    raise exception 'L''etapa només es pot canviar amb les validacions del pipeline' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger projects_guard_stage before insert or update on public.projects
  for each row execute function app.guard_project_stage();

create or replace function app.missing_steps(p_project_id uuid, p_stage text)
returns smallint[] language sql stable security definer set search_path = '' as $$
  select array_agg(r.step order by r.step)
  from public.pipeline_stage_requirements r
  left join public.project_steps s on s.project_id = p_project_id and s.step = r.step
  where r.stage = p_stage and coalesce(s.status, 'pendent') <> 'fet'
$$;

create or replace function public.move_project_stage(p_project_id uuid, p_to text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_from    text;
  v_missing smallint[];
begin
  if not app.is_direccio() then
    raise exception 'Només direcció pot canviar l''etapa' using errcode = '42501';
  end if;
  select status into v_from from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'Projecte inexistent' using errcode = 'P0002';
  end if;
  if v_from = p_to then
    return;
  end if;
  if p_to = 'perdut' and coalesce(trim(p_reason), '') = '' then
    raise exception 'Cal indicar el motiu de pèrdua o descart' using errcode = 'P0001', hint = 'lost_reason';
  end if;
  if p_to = 'finalitzat' and v_from <> 'en_obra' then
    raise exception 'Només es pot finalitzar una obra que estigui En obra' using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  v_missing := app.missing_steps(p_project_id, p_to);
  if v_missing is not null then
    raise exception 'Falten passos obligatoris: %', array_to_string(v_missing, ', ')
      using errcode = 'P0001', hint = 'missing_steps', detail = array_to_string(v_missing, ',');
  end if;

  perform set_config('app.stage_move', 'on', true);
  update public.projects
     set status = p_to,
         stage_changed_at = now(),
         lost_reason = case when p_to = 'perdut' then trim(p_reason) else lost_reason end,
         contracted_at = case when p_to = 'contractat' and contracted_at is null then now() else contracted_at end
   where id = p_project_id;
  perform set_config('app.stage_move', 'off', true);

  if p_to = 'en_obra' then
    update public.project_steps set status = 'fet', done_at = now(), done_by = auth.uid()
     where project_id = p_project_id and step = 11 and status <> 'fet';
  end if;

  insert into public.project_stage_history (project_id, from_stage, to_stage, reason, changed_by)
  values (p_project_id, v_from, p_to, nullif(trim(coalesce(p_reason, '')), ''), auth.uid());
end $$;

-- Marcar un pas. Direcció: tots. Arquitecte assignat: passos tècnics 5, 7, 8, 9 i 10.
create or replace function public.set_project_step(p_project_id uuid, p_step smallint, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_stage text;
begin
  if not (app.is_direccio()
          or (app.project_role(p_project_id) = 'arquitecte' and p_step in (5, 7, 8, 9, 10))) then
    raise exception 'No tens permís per modificar aquest pas' using errcode = '42501';
  end if;
  if p_status not in ('pendent', 'fet', 'no_aplica') then
    raise exception 'Estat de pas no vàlid' using errcode = '22023';
  end if;
  select status into v_stage from public.projects where id = p_project_id;
  if p_status <> 'fet' and exists (
       select 1 from public.pipeline_stage_requirements
        where stage = v_stage and step = p_step) then
    raise exception 'El pas % és obligatori per a l''etapa actual i no es pot desmarcar', p_step
      using errcode = 'P0001', hint = 'step_required';
  end if;
  update public.project_steps
     set status = p_status,
         done_at = case when p_status = 'fet' then coalesce(done_at, now()) else null end,
         done_by = case when p_status = 'fet' then coalesce(done_by, auth.uid()) else null end,
         notes = coalesce(p_notes, notes)
   where project_id = p_project_id and step = p_step;
  if not found then
    raise exception 'Pas inexistent' using errcode = 'P0002';
  end if;
  update public.projects set last_activity_at = now() where id = p_project_id;
end $$;

-- ---------------------------------------------------------------------
-- Alta de lead en una sola transacció (client + projecte + estimació)
-- ---------------------------------------------------------------------
create or replace function public.create_lead(
  p_client_id      uuid,
  p_display_name   text,
  p_email          text,
  p_phone          text,
  p_locale         public.app_locale,
  p_lead_source    text,
  p_municipality   text,
  p_surface_m2     numeric,
  p_estimated_cents bigint,
  p_responsible_id uuid,
  p_priority       text,
  p_next_action    text,
  p_follow_up_date date,
  p_notes          text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_client  uuid := p_client_id;
  v_project uuid;
  v_title   text;
begin
  if not app.is_direccio() then
    raise exception 'Només direcció pot crear leads' using errcode = '42501';
  end if;
  if v_client is null then
    if coalesce(trim(p_display_name), '') = '' then
      raise exception 'El nom del client és obligatori' using errcode = '22023';
    end if;
    insert into public.clients (display_name, email, phone, locale, lead_source, notes, created_by)
    values (trim(p_display_name), nullif(lower(trim(p_email)), ''), nullif(trim(p_phone), ''),
            coalesce(p_locale, 'ca'), nullif(trim(p_lead_source), ''), nullif(trim(p_notes), ''), auth.uid())
    returning id into v_client;
  end if;
  select display_name into v_title from public.clients where id = v_client;
  if v_title is null then
    raise exception 'Client inexistent' using errcode = 'P0002';
  end if;

  insert into public.projects (title, municipality, surface_m2, responsible_id, priority,
                               next_action, follow_up_date, last_activity_at, created_by)
  values (v_title || coalesce(' · ' || nullif(trim(p_municipality), ''), ''),
          nullif(trim(p_municipality), ''), p_surface_m2,
          coalesce(p_responsible_id, auth.uid()), coalesce(p_priority, 'normal'),
          nullif(trim(p_next_action), ''), p_follow_up_date, now(), auth.uid())
  returning id into v_project;

  insert into public.project_holders (project_id, client_id, is_primary) values (v_project, v_client, true);
  if p_estimated_cents is not null then
    insert into public.project_financials (project_id, estimated_sale_cents) values (v_project, p_estimated_cents);
  end if;
  insert into public.project_stage_history (project_id, from_stage, to_stage, changed_by)
  values (v_project, null, 'lead', auth.uid());
  return v_project;
end $$;

-- Possibles duplicats (per NIF, email, telèfon o nom semblant), els més probables primer.
-- Són suggeriments per a revisió humana: mai es fusiona res automàticament.
create or replace function public.find_client_duplicates(p_name text, p_email text, p_phone text, p_tax_id text)
returns table (id uuid, display_name text, email text, phone text, reason text, score real)
language sql stable security definer set search_path = '' as $$
  select * from (
    select c.id, c.display_name, c.email, c.phone,
           case
             when nullif(trim(p_tax_id), '') is not null and upper(c.tax_id) = upper(trim(p_tax_id)) then 'nif'
             when nullif(trim(p_email), '') is not null and lower(c.email) = lower(trim(p_email)) then 'email'
             when app.norm_phone(p_phone) is not null and app.norm_phone(c.phone) = app.norm_phone(p_phone) then 'telefon'
             else 'nom'
           end as reason,
           extensions.similarity(app.norm(c.display_name), app.norm(coalesce(p_name, ''))) as score
    from public.clients c
    where app.is_direccio()
      and c.merged_into is null
      and (
        (nullif(trim(p_tax_id), '') is not null and upper(c.tax_id) = upper(trim(p_tax_id)))
        or (nullif(trim(p_email), '') is not null and lower(c.email) = lower(trim(p_email)))
        or (app.norm_phone(p_phone) is not null and app.norm_phone(c.phone) = app.norm_phone(p_phone))
        or (length(trim(coalesce(p_name, ''))) >= 4
            and extensions.similarity(app.norm(c.display_name), app.norm(p_name)) >= 0.55)
      )
  ) d
  order by (d.reason <> 'nom') desc, d.score desc
  limit 10
$$;

-- ---------------------------------------------------------------------
-- Activitats / historial de comunicacions
-- ---------------------------------------------------------------------
create table public.activities (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.clients (id) on delete cascade,
  project_id   uuid references public.projects (id) on delete cascade,
  kind         text not null check (kind in ('trucada', 'email', 'reunio', 'visita', 'whatsapp', 'nota')),
  summary      text not null check (length(trim(summary)) > 0),
  occurred_at  timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  constraint activities_owner check (client_id is not null or project_id is not null)
);
create index activities_project_idx on public.activities (project_id, occurred_at desc);
create index activities_client_idx on public.activities (client_id, occurred_at desc);

create or replace function app.touch_project_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.project_id is not null then
    update public.projects set last_activity_at = greatest(coalesce(last_activity_at, new.occurred_at), new.occurred_at)
     where id = new.project_id;
  end if;
  return new;
end $$;
create trigger activities_touch_project after insert on public.activities
  for each row execute function app.touch_project_activity();

-- ---------------------------------------------------------------------
-- Tasques
-- ---------------------------------------------------------------------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) > 0),
  description   text,
  kind          text not null default 'comercial'
                check (kind in ('comercial', 'tecnica', 'obra', 'administrativa', 'altre')),
  project_id    uuid references public.projects (id) on delete cascade,
  client_id     uuid references public.clients (id) on delete cascade,
  assigned_to   uuid references public.profiles (id) on delete set null,
  due_date      date,
  priority      text not null default 'normal' check (priority in ('baixa', 'normal', 'alta', 'urgent')),
  status        text not null default 'pendent' check (status in ('pendent', 'en_curs', 'feta', 'cancellada')),
  completed_at  timestamptz,
  completed_by  uuid references public.profiles (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index tasks_assigned_idx on public.tasks (assigned_to, status, due_date);
create index tasks_project_idx on public.tasks (project_id);
create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();

create or replace function app.guard_task_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'feta' and old.status is distinct from 'feta' then
    new.completed_at := now();
    new.completed_by := auth.uid();
  elsif new.status <> 'feta' then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  if coalesce(auth.role(), 'service_role') = 'service_role' or app.is_direccio() then
    return new;
  end if;
  -- Altres usuaris: només poden canviar l'estat de les seves tasques
  if (new.title, new.description, new.kind, new.project_id, new.client_id, new.assigned_to,
      new.due_date, new.priority, new.created_by)
     is distinct from
     (old.title, old.description, old.kind, old.project_id, old.client_id, old.assigned_to,
      old.due_date, old.priority, old.created_by) then
    raise exception 'Només pots canviar l''estat de la tasca' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tasks_guard before update on public.tasks
  for each row execute function app.guard_task_update();

-- ---------------------------------------------------------------------
-- Calendari intern
-- ---------------------------------------------------------------------
create table public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  title             text not null check (length(trim(title)) > 0),
  kind              text not null check (kind in (
                      'visita_casa_pilot', 'visita_terreny', 'reunio_client', 'tasca_comercial',
                      'visita_arquitectura', 'inspeccio', 'reunio_obra', 'termini_administratiu',
                      'seguiment_pressupost', 'fita', 'entrega', 'altre')),
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  all_day           boolean not null default false,
  location          text,
  notes             text,
  project_id        uuid references public.projects (id) on delete cascade,
  client_id         uuid references public.clients (id) on delete set null,
  responsible_id    uuid references public.profiles (id) on delete set null,
  status            text not null default 'previst' check (status in ('previst', 'confirmat', 'fet', 'cancellat')),
  visible_to_client boolean not null default false,
  reminder_minutes  integer not null default 60 check (reminder_minutes between 0 and 10080),
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint events_end_after_start check (ends_at is null or ends_at >= starts_at)
);
create index calendar_events_range_idx on public.calendar_events (starts_at);
create index calendar_events_responsible_idx on public.calendar_events (responsible_id, starts_at);
create trigger calendar_events_touch before update on public.calendar_events
  for each row execute function app.touch_updated_at();

create table public.calendar_event_attendees (
  event_id   uuid not null references public.calendar_events (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  primary key (event_id, profile_id)
);

create or replace function app.can_see_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_direccio() or exists (
    select 1 from public.calendar_events e
    join public.profiles me on me.id = auth.uid() and me.is_active
    where e.id = p_event_id
      and (
        e.responsible_id = auth.uid()
        or e.created_by = auth.uid()
        or exists (select 1 from public.calendar_event_attendees a
                   where a.event_id = e.id and a.profile_id = auth.uid())
        or (e.visible_to_client and e.status = 'confirmat'
            and app.project_role(e.project_id) = 'client')
      ))
$$;

-- ---------------------------------------------------------------------
-- Notificacions
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  link        text check (link is null or (link like '/%' and link not like '//%')),
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index notifications_dedupe_uq on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

create or replace function app.notify(p_user uuid, p_kind text, p_title text, p_body text, p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and is_active) then return; end if;
  insert into public.notifications (user_id, kind, title, body, link, dedupe_key)
  values (p_user, p_kind, p_title, p_body, p_link, p_dedupe)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;

create or replace function app.notify_direccio(p_kind text, p_title text, p_body text, p_link text, p_dedupe text, p_except uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'direccio' and is_active and id is distinct from p_except loop
    perform app.notify(r.id, p_kind, p_title, p_body, p_link, p_dedupe);
  end loop;
end $$;

create or replace function app.on_project_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.notify_direccio('lead_nou', 'Lead nou: ' || new.title, null,
                              '/projectes/' || new.id, 'lead:' || new.id, auth.uid());
  return new;
end $$;
create trigger projects_notify_created after insert on public.projects
  for each row execute function app.on_project_created();

create or replace function app.on_task_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is not null and new.assigned_to is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform app.notify(new.assigned_to, 'tasca_assignada', 'Tasca assignada: ' || new.title, null,
                       '/tasques', 'task:' || new.id || ':' || new.assigned_to);
  end if;
  return new;
end $$;
create trigger tasks_notify_assigned after insert or update of assigned_to on public.tasks
  for each row execute function app.on_task_assigned();

create or replace function app.on_event_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.responsible_id is not null and new.responsible_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.responsible_id is distinct from old.responsible_id) then
    perform app.notify(new.responsible_id, 'visita', 'Nova cita: ' || new.title, null,
                       '/calendari?data=' || to_char(new.starts_at at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
                       'event:' || new.id || ':' || new.responsible_id);
  end if;
  return new;
end $$;
create trigger events_notify_assigned after insert or update of responsible_id on public.calendar_events
  for each row execute function app.on_event_assigned();

-- Recordatoris i avisos de venciment per a l'usuari actual (sense dependre de cron).
-- L'aplicació la crida en carregar el panell; també es pot programar amb pg_cron.
create or replace function public.refresh_my_notifications()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me  uuid := auth.uid();
  v_dir boolean := app.is_direccio();
  v_before integer;
  v_after integer;
  r record;
begin
  if v_me is null or app.current_role() is null then return 0; end if;
  select count(*) into v_before from public.notifications where user_id = v_me;

  for r in select id, title from public.tasks
            where assigned_to = v_me and status in ('pendent', 'en_curs')
              and due_date < (now() at time zone 'Europe/Madrid')::date loop
    perform app.notify(v_me, 'tasca_vencuda', 'Tasca vençuda: ' || r.title, null, '/tasques', 'task-overdue:' || r.id);
  end loop;

  for r in select e.id, e.title, e.starts_at from public.calendar_events e
            where (e.responsible_id = v_me
                   or exists (select 1 from public.calendar_event_attendees a where a.event_id = e.id and a.profile_id = v_me))
              and e.status in ('previst', 'confirmat')
              and e.starts_at between now() and now() + make_interval(mins => e.reminder_minutes) loop
    perform app.notify(v_me, 'visita_propera', 'Properament: ' || r.title, null,
                       '/calendari?data=' || to_char(r.starts_at at time zone 'Europe/Madrid', 'YYYY-MM-DD'),
                       'event-reminder:' || r.id);
  end loop;

  if v_dir then
    for r in select p.id, p.title from public.projects p
              join public.project_steps s on s.project_id = p.id and s.step = 1
              where p.status = 'lead' and s.status <> 'fet' and p.created_at < now() - interval '48 hours' loop
      perform app.notify(v_me, 'lead_sense_resposta', 'Lead sense contactar: ' || r.title, null,
                         '/projectes/' || r.id, 'lead-noresp:' || r.id);
    end loop;
    for r in select p.id, p.title from public.projects p
              where p.status in ('pressupost', 'avantprojecte') and p.follow_up_date < (now() at time zone 'Europe/Madrid')::date loop
      perform app.notify(v_me, 'seguiment_pendent', 'Seguiment pendent: ' || r.title, null,
                         '/projectes/' || r.id, 'followup:' || r.id || ':' || (now() at time zone 'Europe/Madrid')::date);
    end loop;
  end if;

  select count(*) into v_after from public.notifications where user_id = v_me;
  return v_after - v_before;
end $$;

-- ---------------------------------------------------------------------
-- Protecció: sempre ha de quedar com a mínim una persona de direcció activa
-- ---------------------------------------------------------------------
create or replace function app.guard_last_direccio()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'direccio' and old.is_active
     and (new.role <> 'direccio' or not new.is_active)
     and not exists (select 1 from public.profiles
                     where role = 'direccio' and is_active and id <> old.id) then
    raise exception 'No es pot desactivar l''última persona de direcció' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger profiles_guard_last_direccio before update on public.profiles
  for each row execute function app.guard_last_direccio();

-- ---------------------------------------------------------------------
-- Privilegis i RLS
-- ---------------------------------------------------------------------
revoke all on public.project_steps, public.pipeline_stage_requirements, public.project_stage_history,
              public.activities, public.tasks, public.calendar_events, public.calendar_event_attendees,
              public.notifications from anon;
grant select, insert, update, delete on public.project_steps, public.pipeline_stage_requirements,
      public.activities, public.tasks, public.calendar_events, public.calendar_event_attendees to authenticated;
grant select on public.project_stage_history to authenticated;
revoke insert, update, delete on public.project_stage_history from authenticated;
grant select on public.notifications to authenticated;
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.project_steps, public.pipeline_stage_requirements, public.project_stage_history,
      public.activities, public.tasks, public.calendar_events, public.calendar_event_attendees,
      public.notifications to service_role;

revoke all on function public.move_project_stage(uuid, text, text), public.set_project_step(uuid, smallint, text, text),
  public.create_lead(uuid, text, text, text, public.app_locale, text, text, numeric, bigint, uuid, text, text, date, text),
  public.find_client_duplicates(text, text, text, text), public.refresh_my_notifications() from public, anon;
grant execute on function public.move_project_stage(uuid, text, text), public.set_project_step(uuid, smallint, text, text),
  public.create_lead(uuid, text, text, text, public.app_locale, text, text, numeric, bigint, uuid, text, text, date, text),
  public.find_client_duplicates(text, text, text, text), public.refresh_my_notifications() to authenticated, service_role;
revoke all on function app.norm(text), app.norm_phone(text), app.missing_steps(uuid, text), app.can_see_event(uuid),
  app.notify(uuid, text, text, text, text, text), app.notify_direccio(text, text, text, text, text, uuid) from public;
grant execute on function app.norm(text), app.norm_phone(text), app.missing_steps(uuid, text), app.can_see_event(uuid)
  to authenticated, service_role;

alter table public.project_steps               enable row level security;
alter table public.pipeline_stage_requirements enable row level security;
alter table public.project_stage_history       enable row level security;
alter table public.activities                  enable row level security;
alter table public.tasks                       enable row level security;
alter table public.calendar_events             enable row level security;
alter table public.calendar_event_attendees    enable row level security;
alter table public.notifications               enable row level security;

-- project_steps: lectura per a direcció i arquitecte assignat; escriptura només via set_project_step()
create policy project_steps_select on public.project_steps
  for select to authenticated using (app.is_direccio() or app.project_role(project_id) = 'arquitecte');

-- requisits: lectura per a tothom autenticat i actiu; edició direcció
create policy stage_req_select on public.pipeline_stage_requirements
  for select to authenticated using (app.current_role() is not null);
create policy stage_req_direccio on public.pipeline_stage_requirements
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());

-- historial d'etapes
create policy stage_history_select on public.project_stage_history
  for select to authenticated using (app.is_direccio() or app.project_role(project_id) = 'arquitecte');

-- activitats
create policy activities_direccio on public.activities
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy activities_arquitecte_select on public.activities
  for select to authenticated using (project_id is not null and app.project_role(project_id) = 'arquitecte');
create policy activities_arquitecte_insert on public.activities
  for insert to authenticated with check (
    project_id is not null and app.project_role(project_id) = 'arquitecte' and created_by = auth.uid());

-- tasques
create policy tasks_direccio on public.tasks
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy tasks_assignee_select on public.tasks
  for select to authenticated using (assigned_to = auth.uid() and app.current_role() is not null);
create policy tasks_assignee_update on public.tasks
  for update to authenticated using (assigned_to = auth.uid() and app.current_role() is not null)
  with check (assigned_to = auth.uid());
create policy tasks_arquitecte_insert on public.tasks
  for insert to authenticated with check (
    kind = 'tecnica' and project_id is not null and app.project_role(project_id) = 'arquitecte'
    and created_by = auth.uid());

-- calendari
create policy events_direccio on public.calendar_events
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy events_visible_select on public.calendar_events
  for select to authenticated using (app.can_see_event(id));
create policy events_arquitecte_insert on public.calendar_events
  for insert to authenticated with check (
    project_id is not null and app.project_role(project_id) = 'arquitecte'
    and responsible_id = auth.uid() and created_by = auth.uid() and not visible_to_client);
create policy events_owner_update on public.calendar_events
  for update to authenticated
  using (created_by = auth.uid() and app.current_role() is not null and not app.is_direccio())
  with check (created_by = auth.uid() and not visible_to_client);

create policy attendees_direccio on public.calendar_event_attendees
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy attendees_select on public.calendar_event_attendees
  for select to authenticated using (profile_id = auth.uid() or app.can_see_event(event_id));

-- notificacions: cadascú les seves
create policy notifications_own_select on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Auditoria de les taules noves
do $$
declare t text;
begin
  foreach t in array array['project_steps','pipeline_stage_requirements','activities','tasks','calendar_events']
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;
