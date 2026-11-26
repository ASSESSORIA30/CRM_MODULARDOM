-- =====================================================================
-- Integració amb la web pública: recepció de sol·licituds (leads)
--
-- La web (repositori modulardom-web) envia cada formulari signat a
-- POST /api/web/leads. Aquesta migració hi posa la part de base de dades:
--   · public.web_lead_intake   bústia de sol·licituds rebudes, amb la clau
--                              d'idempotència (única) i la configuració sencera
--   · public.web_create_lead() crea client + projecte (lead) + activitat en UNA
--                              transacció; només la pot executar service_role
--   · app.web_rate_hit()       límit de peticions persistent
--
-- create_lead() no es reutilitza perquè exigeix un usuari de direcció; la
-- funció nova en segueix la mateixa lògica (títol, titular, estimació, historial).
-- Cap usuari anònim ni autenticat pot escriure a la bústia ni cridar la funció.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bústia de sol·licituds web
-- ---------------------------------------------------------------------
create table public.web_lead_intake (
  id               uuid primary key default gen_random_uuid(),
  -- clau que calcula la web (correu + telèfon + tipus + dia): una mateixa sol·licitud no entra dues vegades
  idempotency_key  text not null unique check (idempotency_key ~ '^[0-9a-f]{64}$'),
  -- signatura de la petició: una petició capturada no es pot tornar a enviar amb una altra clau
  signature        text not null unique check (signature ~ '^[0-9a-f]{64}$'),
  reference        text not null check (length(reference) between 4 and 40),
  kind             text not null check (kind in ('info', 'quote', 'visit', 'mineral')),
  source           text not null check (source in ('web', 'configurador')),
  -- què se n'ha fet: client nou, afegida a un client existent, o cal que algú revisi possibles duplicats
  outcome          text not null check (outcome in ('client_nou', 'client_existent', 'revisio_duplicats')),
  client_id        uuid references public.clients (id) on delete set null,
  project_id       uuid references public.projects (id) on delete set null,
  project_created  boolean not null default false,
  -- clients que coincideixen per correu o telèfon quan la coincidència és contradictòria (mai es fusionen sols)
  match_candidates uuid[] not null default '{}',
  -- la configuració de l'habitatge tal com l'ha feta el client, en el vocabulari del motor (ConfigInput)
  configurator_input  jsonb,
  configurator_visual jsonb,
  tariff_number    text,
  total_cents      bigint check (total_cents is null or total_cents >= 0),
  -- visites a la casa pilot: sempre entren pendents de confirmació comercial
  visit_status     text check (visit_status in ('pendent_confirmacio', 'confirmada', 'descartada')),
  visit_reviewed_by uuid references public.profiles (id) on delete set null,
  visit_reviewed_at timestamptz,
  page             text,
  captured_at      timestamptz not null,
  received_at      timestamptz not null default now(),
  -- el cos sencer rebut (ja validat), per no perdre cap dada i per a auditoria
  payload          jsonb not null,
  constraint visit_status_only_for_visits check ((kind = 'visit') = (visit_status is not null))
);
create index web_lead_intake_project_idx on public.web_lead_intake (project_id, received_at desc);
create index web_lead_intake_client_idx on public.web_lead_intake (client_id, received_at desc);
create index web_lead_intake_pending_visits_idx on public.web_lead_intake (received_at desc) where visit_status = 'pendent_confirmacio';

alter table public.web_lead_intake enable row level security;
revoke all on public.web_lead_intake from public, anon, authenticated;
-- direcció ho veu tot; l'arquitecte, les dels projectes que té assignats. Ningú hi escriu directament.
grant select on public.web_lead_intake to authenticated;
grant select, insert, update on public.web_lead_intake to service_role;
create policy web_lead_intake_direccio_select on public.web_lead_intake
  for select to authenticated using (app.is_direccio());
create policy web_lead_intake_arquitecte_select on public.web_lead_intake
  for select to authenticated using (project_id is not null and app.project_role(project_id) = 'arquitecte');

-- ---------------------------------------------------------------------
-- Límit de peticions persistent (finestra fixa). Només servidor.
-- ---------------------------------------------------------------------
create table app.web_rate_limits (
  bucket        text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (bucket, window_start)
);
-- Només hi escriu web_rate_hit() (security definer). Cap rol de l'API hi té accés, ni per privilegis ni per RLS.
alter table app.web_rate_limits enable row level security;
revoke all on app.web_rate_limits from public, anon, authenticated;

-- true si la petició entra dins del límit. Compta la petició en la mateixa instrucció (sense curses).
create or replace function public.web_rate_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Només el servidor pot comptar peticions' using errcode = '42501';
  end if;
  if p_limit < 1 or p_window_seconds < 1 or coalesce(length(p_bucket), 0) not between 1 and 200 then
    raise exception 'Paràmetres del límit no vàlids' using errcode = '22023';
  end if;
  insert into app.web_rate_limits as r (bucket, window_start, hits) values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  -- neteja oportunista de finestres antigues
  if v_hits = 1 then
    delete from app.web_rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end $$;
revoke all on function public.web_rate_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.web_rate_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------
-- Alta d'una sol·licitud web: tot o res
-- ---------------------------------------------------------------------
create or replace function public.web_create_lead(p_idempotency_key text, p_signature text, p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_kind      text := p_payload ->> 'kind';
  v_source    text := p_payload ->> 'source';
  v_ref       text := p_payload ->> 'reference';
  v_client    jsonb := coalesce(p_payload -> 'client', '{}'::jsonb);
  v_project   jsonb := coalesce(p_payload -> 'project', '{}'::jsonb);
  v_cfg       jsonb := nullif(p_payload -> 'configurator', 'null'::jsonb);
  v_name      text := trim(coalesce(v_client ->> 'display_name', ''));
  v_email     text := nullif(lower(trim(coalesce(v_client ->> 'email', ''))), '');
  v_phone     text := nullif(trim(coalesce(v_client ->> 'phone', '')), '');
  v_locale    public.app_locale := case when v_client ->> 'locale' = 'es' then 'es' else 'ca' end;
  v_city      text := nullif(trim(coalesce(v_project ->> 'municipality', v_client ->> 'city', '')), '');
  v_plot      text := nullif(trim(coalesce(v_project ->> 'plot_address', '')), '');
  v_surface   numeric := nullif(v_project ->> 'surface_m2', '')::numeric;
  v_notes     text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_total     bigint := nullif(v_cfg ->> 'totalCents', '')::bigint;
  v_captured  timestamptz := coalesce((p_payload ->> 'capturedAt')::timestamptz, now());
  v_intake    uuid;
  v_existing  public.web_lead_intake%rowtype;
  v_by_email  uuid[];
  v_by_phone  uuid[];
  v_all       uuid[];
  v_client_id uuid;
  v_project_id uuid;
  v_project_new boolean := false;
  v_outcome   text;
  v_code      text;
  v_label     text;
  v_action    text;
  v_summary   text;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Només el servidor de la integració web pot crear sol·licituds' using errcode = '42501';
  end if;
  -- La ruta ja ha validat el cos; aquí es repeteix l'essencial perquè la funció no depengui de qui la crida.
  if p_idempotency_key !~ '^[0-9a-f]{64}$' or p_signature !~ '^[0-9a-f]{64}$' then
    raise exception 'Clau d''idempotència no vàlida' using errcode = '22023';
  end if;
  if v_kind not in ('info', 'quote', 'visit', 'mineral') or v_source not in ('web', 'configurador') then
    raise exception 'Tipus o origen de sol·licitud no vàlid' using errcode = '22023';
  end if;
  if length(v_name) < 2 or v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Falten el nom o un correu vàlid' using errcode = '22023';
  end if;
  if v_surface is not null and (v_surface <= 0 or v_surface > 100000) then
    raise exception 'Superfície no vàlida' using errcode = '22023';
  end if;

  -- Idempotència: la clau és única. Dues peticions simultànies amb la mateixa clau s'esperen aquí
  -- i només la primera segueix; la segona rep el resultat de la primera.
  -- La signatura també és única: reenviar una petició capturada amb una altra clau tampoc crea res.
  perform pg_advisory_xact_lock(hashtextextended(least(p_idempotency_key, p_signature), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(p_idempotency_key, p_signature), 0));
  select * into v_existing from public.web_lead_intake
   where idempotency_key = p_idempotency_key or signature = p_signature
   order by (idempotency_key = p_idempotency_key) desc limit 1;
  if found then
    return jsonb_build_object('id', v_existing.id, 'duplicate', true, 'project_id', v_existing.project_id,
                              'client_id', v_existing.client_id, 'outcome', v_existing.outcome);
  end if;

  -- Client: mateixes regles que find_client_duplicates (correu en minúscules; 9 últims dígits del telèfon)
  select coalesce(array_agg(id), '{}') into v_by_email from public.clients
   where merged_into is null and lower(email) = v_email;
  select coalesce(array_agg(id), '{}') into v_by_phone from public.clients
   where merged_into is null and app.norm_phone(v_phone) is not null and app.norm_phone(phone) = app.norm_phone(v_phone);
  select coalesce(array_agg(distinct x), '{}') into v_all from unnest(v_by_email || v_by_phone) x;

  if cardinality(v_all) = 1 then
    -- un sol client coincideix: es conserven les seves dades i s'hi afegeix la sol·licitud
    v_client_id := v_all[1];
    v_outcome := 'client_existent';
  else
    -- cap coincidència, o coincidències contradictòries (el correu és d'un client i el telèfon d'un altre,
    -- o n'hi ha més d'un): es crea un client nou i, si cal, es deixa marcat per a revisió. Mai es fusiona res.
    v_outcome := case when cardinality(v_all) = 0 then 'client_nou' else 'revisio_duplicats' end;
    insert into public.clients (kind, display_name, email, phone, locale, lead_source, city, created_by)
    values (case when v_client ->> 'kind' = 'empresa' then 'empresa' else 'persona' end,
            v_name, v_email, v_phone, v_locale, v_source, v_city, null)
    returning id into v_client_id;
  end if;

  -- Projecte: si el client ja té una oportunitat oberta, la sol·licitud s'hi afegeix; si no, se'n crea una (lead)
  if v_outcome = 'client_existent' then
    select p.id into v_project_id
      from public.projects p join public.project_holders h on h.project_id = p.id
     where h.client_id = v_client_id and p.status in ('lead', 'pressupost')
     order by p.created_at desc limit 1;
  end if;
  v_label := case v_kind when 'quote' then 'pressupost' when 'visit' then 'visita a la casa pilot'
                         when 'mineral' then 'MINERAL' else 'informació' end;
  v_action := case v_kind when 'quote' then 'Preparar pressupost (configuració web)'
                          when 'visit' then 'Confirmar visita a la casa pilot'
                          when 'mineral' then 'Contactar: consulta MINERAL'
                          else 'Contactar: sol·licitud d''informació' end;
  if v_project_id is null then
    select display_name into v_name from public.clients where id = v_client_id;
    insert into public.projects (title, municipality, plot_address, surface_m2, priority, next_action,
                                 follow_up_date, last_activity_at, created_by)
    values (v_name || coalesce(' · ' || v_city, ''), v_city, v_plot, v_surface, 'normal', v_action,
            (now() at time zone 'Europe/Madrid')::date, now(), null)
    returning id into v_project_id;
    v_project_new := true;
    insert into public.project_holders (project_id, client_id, is_primary) values (v_project_id, v_client_id, true);
    insert into public.project_stage_history (project_id, from_stage, to_stage, reason, changed_by)
    values (v_project_id, null, 'lead', 'Sol·licitud web ' || v_ref, null);
    -- el pressupost orientatiu de la web és l'estimació inicial; no es crea cap pressupost
    if v_total is not null then
      insert into public.project_financials (project_id, estimated_sale_cents) values (v_project_id, v_total)
      on conflict (project_id) do nothing;
    end if;
  else
    update public.projects set next_action = v_action, follow_up_date = (now() at time zone 'Europe/Madrid')::date
     where id = v_project_id and status = 'lead';
  end if;
  select code into v_code from public.projects where id = v_project_id;

  insert into public.web_lead_intake (idempotency_key, signature, reference, kind, source, outcome, client_id, project_id,
      project_created, match_candidates, configurator_input, configurator_visual, tariff_number, total_cents,
      visit_status, page, captured_at, payload)
  values (p_idempotency_key, p_signature, v_ref, v_kind, v_source, v_outcome, v_client_id, v_project_id, v_project_new,
      case when v_outcome = 'revisio_duplicats' then v_all else '{}' end,
      v_cfg -> 'input', v_cfg -> 'visual', nullif(v_cfg ->> 'tariff', ''), v_total,
      case when v_kind = 'visit' then 'pendent_confirmacio' end,
      nullif(p_payload ->> 'page', ''), v_captured, p_payload)
  returning id into v_intake;

  -- Activitat al fil comercial: què ha demanat i què ha escrit
  v_summary := format('Sol·licitud web (%s) · ref. %s', v_label, v_ref)
            || case when v_kind = 'visit' then ' · pendent de confirmació comercial' else '' end
            || case when v_cfg is not null then ' · amb configuració de l''habitatge' else '' end
            || coalesce(E'\n' || v_notes, '');
  insert into public.activities (client_id, project_id, kind, summary, occurred_at, created_by)
  values (v_client_id, v_project_id, 'nota', v_summary, v_captured, null);

  -- Avisos a direcció. Un projecte nou ja avisa pel seu trigger («Lead nou»); aquí s'avisa del que aquell no cobreix.
  if not v_project_new then
    perform app.notify_direccio('lead_web', 'Nova sol·licitud web (' || v_label || '): ' || v_name, null,
                                '/projectes/' || v_project_id, 'web-intake:' || v_intake, null);
  end if;
  if v_kind = 'visit' then
    perform app.notify_direccio('visita', 'Visita a la casa pilot per confirmar: ' || v_name, null,
                                '/projectes/' || v_project_id, 'web-visit:' || v_intake, null);
  end if;
  if v_outcome = 'revisio_duplicats' then
    perform app.notify_direccio('lead_web', 'Possible client duplicat (sol·licitud web): ' || v_name,
                                'El correu o el telèfon coincideixen amb altres clients. No s''ha fusionat res.',
                                '/clients/' || v_client_id, 'web-dup:' || v_intake, null);
  end if;

  return jsonb_build_object('id', v_intake, 'duplicate', false, 'project_id', v_project_id, 'project_code', v_code,
                            'client_id', v_client_id, 'outcome', v_outcome, 'project_created', v_project_new);
end $$;
revoke all on function public.web_create_lead(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.web_create_lead(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- Confirmació comercial de les visites (direcció)
-- ---------------------------------------------------------------------
create or replace function public.review_web_visit(p_intake_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_direccio() then
    raise exception 'Només direcció pot confirmar visites' using errcode = '42501';
  end if;
  if p_status not in ('confirmada', 'descartada', 'pendent_confirmacio') then
    raise exception 'Estat de visita no vàlid' using errcode = '22023';
  end if;
  update public.web_lead_intake
     set visit_status = p_status,
         visit_reviewed_by = case when p_status = 'pendent_confirmacio' then null else auth.uid() end,
         visit_reviewed_at = case when p_status = 'pendent_confirmacio' then null else now() end
   where id = p_intake_id and kind = 'visit';
  if not found then
    raise exception 'Sol·licitud de visita inexistent' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.review_web_visit(uuid, text) from public, anon;
grant execute on function public.review_web_visit(uuid, text) to authenticated, service_role;
