-- =====================================================================
-- Pressupostos orientatius descarregats des del configurador de la web
--
-- Cada descàrrega passa per POST /api/web/quotes (signada, com els leads). Aquí hi ha:
--   · public.web_quotes            historial: una fila per versió (configuració + tarifa), amb el
--                                  desglossament tal com es va lliurar. No es recalcula mai.
--   · public.web_quote_downloads   una fila per descàrrega (idempotent per identificador de petició)
--   · public.web_quote_tokens      enllaços privats de recuperació (només se'n desa el hash)
--   · web_register_quote()         client + oportunitat (via web_create_lead) + versió + descàrrega
--                                  + tasca de seguiment + enllaç, tot en una transacció
--   · web_recover_quote()          configuració i imports originals a partir d'un enllaç vigent
--   · web_quote_request_visit()    visita a la casa pilot lligada al mateix client i pressupost
--   · bucket privat pressupostos-web per als PDF
-- Res d'això és accessible per a anon ni per a usuaris autenticats que no siguin direcció.
-- =====================================================================

create table public.web_quotes (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique check (length(reference) between 4 and 40),
  client_id           uuid not null references public.clients (id) on delete cascade,
  project_id          uuid references public.projects (id) on delete set null,
  intake_id           uuid references public.web_lead_intake (id) on delete set null,
  version             integer not null check (version >= 1),
  -- empremta de la configuració (motor + tries del model). Mateixa empremta + mateixa tarifa = mateix pressupost
  config_hash         text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  tariff_number       text not null,
  locale              public.app_locale not null default 'ca',
  configurator_input  jsonb not null,
  configurator_visual jsonb,
  -- desglossament lliurat al client: [{key, label{ca,es}, detail?, amountCents, pending?}]
  breakdown           jsonb not null,
  roof                jsonb,
  subtotal_cents      bigint not null check (subtotal_cents >= 0),
  vat_works_cents     bigint not null check (vat_works_cents >= 0),
  vat_architect_cents bigint not null check (vat_architect_cents >= 0),
  vat_works_pct       numeric,
  vat_architect_pct   numeric,
  total_cents         bigint not null check (total_cents >= 0),
  has_pending         boolean not null default false,
  plot                text check (plot in ('yes', 'no', 'searching')),
  municipality        text,
  status              text not null default 'nou' check (status in ('nou', 'contactat', 'en_negociacio', 'acceptat', 'descartat')),
  pdf_path            text,
  downloads           integer not null default 0,
  last_download_at    timestamptz,
  visit_requested_at  timestamptz,
  created_at          timestamptz not null default now(),
  unique (client_id, config_hash, tariff_number),
  unique (client_id, version)
);
create index web_quotes_project_idx on public.web_quotes (project_id, created_at desc);
create index web_quotes_created_idx on public.web_quotes (created_at desc);

create table public.web_quote_downloads (
  quote_id      uuid not null references public.web_quotes (id) on delete cascade,
  request_id    text not null check (request_id ~ '^[0-9a-f-]{16,64}$'),
  downloaded_at timestamptz not null default now(),
  primary key (quote_id, request_id)
);

create table public.web_quote_tokens (
  token_hash   text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  quote_id     uuid not null references public.web_quotes (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create index web_quote_tokens_quote_idx on public.web_quote_tokens (quote_id);

alter table public.web_quotes enable row level security;
alter table public.web_quote_downloads enable row level security;
alter table public.web_quote_tokens enable row level security;
revoke all on public.web_quotes, public.web_quote_downloads, public.web_quote_tokens from public, anon, authenticated;
grant select on public.web_quotes, public.web_quote_downloads to authenticated;
grant select, insert, update, delete on public.web_quotes, public.web_quote_downloads, public.web_quote_tokens to service_role;
-- imports: només direcció (com project_financials). Els enllaços no els llegeix ningú des de l'API.
create policy web_quotes_direccio_select on public.web_quotes for select to authenticated using (app.is_direccio());
create policy web_quote_downloads_direccio_select on public.web_quote_downloads for select to authenticated using (app.is_direccio());

-- PDF dels pressupostos: bucket privat, sense cap política (només el servidor, amb la clau de servei)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pressupostos-web', 'pressupostos-web', false, 6291456, array['application/pdf'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Registre d'una descàrrega
-- ---------------------------------------------------------------------
create or replace function public.web_register_quote(p_idempotency_key text, p_signature text, p_lead jsonb, p_quote jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lead       jsonb;
  v_client     uuid;
  v_project    uuid;
  v_intake     uuid;
  v_hash       text := p_quote ->> 'configHash';
  v_tariff     text := p_quote ->> 'tariff';
  v_request    text := p_quote ->> 'requestId';
  v_ref        text := p_lead ->> 'reference';
  v_total      bigint := (p_quote ->> 'totalCents')::bigint;
  v_q          public.web_quotes%rowtype;
  v_new        boolean := false;
  v_counted    boolean := false;
  v_token      text;
  v_name       text;
  v_days       integer := 90;   -- vigència de l'enllaç de recuperació
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Només el servidor de la integració web pot registrar pressupostos' using errcode = '42501';
  end if;
  if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' or coalesce(v_tariff, '') = '' or v_request is null or v_request !~ '^[0-9a-f-]{16,64}$'
     or v_total is null or v_total < 0 or jsonb_typeof(p_quote -> 'lines') <> 'array' or p_lead ->> 'kind' <> 'quote'
     or jsonb_typeof(p_lead -> 'configurator' -> 'input') <> 'object' then
    raise exception 'Pressupost web mal format' using errcode = '22023';
  end if;

  -- Client i oportunitat: les mateixes regles que qualsevol sol·licitud web (i la mateixa idempotència)
  v_lead := public.web_create_lead(p_idempotency_key, p_signature, p_lead);
  v_client := (v_lead ->> 'client_id')::uuid;
  v_project := (v_lead ->> 'project_id')::uuid;
  v_intake := (v_lead ->> 'id')::uuid;
  if v_client is null then
    raise exception 'La sol·licitud original ja no té client' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('web-quote:' || v_client::text, 0));

  select * into v_q from public.web_quotes where client_id = v_client and config_hash = v_hash and tariff_number = v_tariff;
  if not found then
    -- configuració o tarifa diferents: versió nova. Les anteriors queden com estaven.
    insert into public.web_quotes (reference, client_id, project_id, intake_id, version, config_hash, tariff_number, locale,
        configurator_input, configurator_visual, breakdown, roof, subtotal_cents, vat_works_cents, vat_architect_cents,
        vat_works_pct, vat_architect_pct, total_cents, has_pending, plot, municipality)
    values (v_ref, v_client, v_project, v_intake,
        coalesce((select max(version) from public.web_quotes where client_id = v_client), 0) + 1,
        v_hash, v_tariff, case when p_quote ->> 'locale' = 'es' then 'es'::public.app_locale else 'ca'::public.app_locale end,
        p_lead -> 'configurator' -> 'input', nullif(p_lead -> 'configurator' -> 'visual', 'null'::jsonb),
        p_quote -> 'lines', nullif(p_quote -> 'roof', 'null'::jsonb),
        (p_quote ->> 'subtotalCents')::bigint, (p_quote ->> 'vatWorksCents')::bigint, (p_quote ->> 'vatArchitectCents')::bigint,
        nullif(p_quote ->> 'vatWorksPct', '')::numeric, nullif(p_quote ->> 'vatArchitectPct', '')::numeric,
        v_total, coalesce((p_quote ->> 'hasPending')::boolean, false),
        nullif(p_quote ->> 'plot', ''), nullif(trim(coalesce(p_lead -> 'project' ->> 'municipality', '')), ''))
    returning * into v_q;
    v_new := true;
  end if;

  -- Descàrrega: una per identificador de petició (un reintent no en compta dues)
  insert into public.web_quote_downloads (quote_id, request_id) values (v_q.id, v_request) on conflict do nothing;
  if found then
    v_counted := true;
    update public.web_quotes set downloads = downloads + 1, last_download_at = now(),
           plot = coalesce(nullif(p_quote ->> 'plot', ''), plot)
     where id = v_q.id returning * into v_q;
  end if;

  select display_name into v_name from public.clients where id = v_client;
  if v_new then
    -- una sola tasca de seguiment oberta per oportunitat, per moltes versions o descàrregues que hi hagi
    if v_project is not null and not exists (
         select 1 from public.tasks where project_id = v_project and status in ('pendent', 'en_curs') and title like 'Seguiment pressupost web%') then
      insert into public.tasks (title, description, kind, project_id, client_id, assigned_to, due_date, created_by)
      values ('Seguiment pressupost web · ' || v_name,
              format('Pressupost orientatiu descarregat des del configurador web (ref. %s).', v_q.reference),
              'comercial', v_project, v_client, (select responsible_id from public.projects where id = v_project),
              (now() at time zone 'Europe/Madrid')::date, null);
    end if;
    if v_project is not null and v_q.version > 1 then
      insert into public.activities (client_id, project_id, kind, summary, occurred_at, created_by)
      values (v_client, v_project, 'nota', format('Pressupost web: versió %s (ref. %s)', v_q.version, v_q.reference), now(), null);
    end if;
  elsif v_counted and v_q.downloads > 1 then
    insert into public.activities (client_id, project_id, kind, summary, occurred_at, created_by)
    values (v_client, v_q.project_id, 'nota', format('Ha tornat a descarregar el pressupost web ref. %s (descàrrega %s)', v_q.reference, v_q.downloads), now(), null);
  end if;

  -- Enllaç privat de recuperació: aleatori, amb caducitat, revocable. Només se'n desa el hash.
  delete from public.web_quote_tokens where quote_id = v_q.id and expires_at < now();
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.web_quote_tokens (token_hash, quote_id, expires_at)
  values (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_q.id, now() + make_interval(days => v_days));

  return jsonb_build_object('id', v_q.id, 'reference', v_q.reference, 'version', v_q.version, 'created', v_new,
                            'createdAt', v_q.created_at, 'pdfStored', v_q.pdf_path is not null, 'token', v_token,
                            'tokenDays', v_days, 'client_id', v_client, 'project_id', v_q.project_id);
end $$;
revoke all on function public.web_register_quote(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.web_register_quote(text, text, jsonb, jsonb) to service_role;

-- El PDF es desa una sola vegada per versió (el document original és el que val)
create or replace function public.web_quote_set_pdf(p_quote_id uuid, p_path text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Només el servidor pot desar el PDF' using errcode = '42501';
  end if;
  update public.web_quotes set pdf_path = p_path where id = p_quote_id and pdf_path is null;
  return found;
end $$;
revoke all on function public.web_quote_set_pdf(uuid, text) from public, anon, authenticated;
grant execute on function public.web_quote_set_pdf(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- Recuperació amb l'enllaç privat. No retorna cap dada personal.
-- ---------------------------------------------------------------------
create or replace function public.web_recover_quote(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_hash text;
  v_id   uuid;
  v_q    public.web_quotes%rowtype;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Només el servidor pot recuperar pressupostos' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  update public.web_quote_tokens set last_used_at = now()
   where token_hash = v_hash and revoked_at is null and expires_at > now()
  returning quote_id into v_id;
  if not found then return null; end if;
  select * into v_q from public.web_quotes where id = v_id;
  return jsonb_build_object('id', v_q.id, 'reference', v_q.reference, 'version', v_q.version, 'createdAt', v_q.created_at,
    'tariff', v_q.tariff_number, 'locale', v_q.locale, 'input', v_q.configurator_input, 'visual', v_q.configurator_visual,
    'lines', v_q.breakdown, 'roof', v_q.roof, 'subtotalCents', v_q.subtotal_cents, 'vatWorksCents', v_q.vat_works_cents,
    'vatArchitectCents', v_q.vat_architect_cents, 'vatWorksPct', v_q.vat_works_pct, 'vatArchitectPct', v_q.vat_architect_pct,
    'totalCents', v_q.total_cents, 'hasPending', v_q.has_pending, 'pdfPath', v_q.pdf_path, 'visitRequested', v_q.visit_requested_at is not null);
end $$;
revoke all on function public.web_recover_quote(text) from public, anon, authenticated;
grant execute on function public.web_recover_quote(text) to service_role;

-- ---------------------------------------------------------------------
-- Visita a la casa pilot des d'un pressupost: mateix client, mateixa oportunitat, sense tornar a demanar dades
-- ---------------------------------------------------------------------
create or replace function public.web_quote_request_visit(p_idempotency_key text, p_signature text, p_token text, p_reference text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rec    jsonb;
  v_q      public.web_quotes%rowtype;
  v_intake uuid;
  v_name   text;
begin
  if coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Només el servidor pot demanar visites' using errcode = '42501';
  end if;
  if p_idempotency_key !~ '^[0-9a-f]{64}$' or p_signature !~ '^[0-9a-f]{64}$' or length(coalesce(p_reference, '')) not between 4 and 40 then
    raise exception 'Petició de visita mal formada' using errcode = '22023';
  end if;
  v_rec := public.web_recover_quote(p_token);
  if v_rec is null then return null; end if;
  select * into v_q from public.web_quotes where id = (v_rec ->> 'id')::uuid;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  select id into v_intake from public.web_lead_intake where idempotency_key = p_idempotency_key or signature = p_signature limit 1;
  if found then
    return jsonb_build_object('id', v_intake, 'duplicate', true, 'quoteReference', v_q.reference);
  end if;
  insert into public.web_lead_intake (idempotency_key, signature, reference, kind, source, outcome, client_id, project_id,
      project_created, visit_status, page, captured_at, payload)
  values (p_idempotency_key, p_signature, p_reference, 'visit', 'configurador', 'client_existent', v_q.client_id, v_q.project_id,
      false, 'pendent_confirmacio', null, now(),
      jsonb_build_object('reference', p_reference, 'kind', 'visit', 'source', 'configurador', 'quoteReference', v_q.reference,
                         'notes', 'Sol·licita visitar la casa pilot des del pressupost web ref. ' || v_q.reference))
  returning id into v_intake;
  update public.web_quotes set visit_requested_at = coalesce(visit_requested_at, now()) where id = v_q.id;
  select display_name into v_name from public.clients where id = v_q.client_id;
  insert into public.activities (client_id, project_id, kind, summary, occurred_at, created_by)
  values (v_q.client_id, v_q.project_id, 'nota',
          format('Sol·licitud web (visita a la casa pilot) · ref. %s · pendent de confirmació comercial · pressupost %s', p_reference, v_q.reference), now(), null);
  if v_q.project_id is not null then
    update public.projects set next_action = 'Confirmar visita a la casa pilot', follow_up_date = (now() at time zone 'Europe/Madrid')::date
     where id = v_q.project_id and status = 'lead';
  end if;
  perform app.notify_direccio('visita', 'Visita a la casa pilot per confirmar: ' || v_name, 'Demanada des del pressupost web ' || v_q.reference,
                              case when v_q.project_id is not null then '/projectes/' || v_q.project_id else '/clients/' || v_q.client_id end,
                              'web-visit:' || v_intake, null);
  return jsonb_build_object('id', v_intake, 'duplicate', false, 'quoteReference', v_q.reference);
end $$;
revoke all on function public.web_quote_request_visit(text, text, text, text) from public, anon, authenticated;
grant execute on function public.web_quote_request_visit(text, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- Gestió comercial (direcció)
-- ---------------------------------------------------------------------
create or replace function public.set_web_quote_status(p_quote_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_direccio() then raise exception 'Només direcció pot canviar l''estat' using errcode = '42501'; end if;
  if p_status not in ('nou', 'contactat', 'en_negociacio', 'acceptat', 'descartat') then
    raise exception 'Estat no vàlid' using errcode = '22023';
  end if;
  update public.web_quotes set status = p_status where id = p_quote_id;
  if not found then raise exception 'Pressupost inexistent' using errcode = 'P0002'; end if;
end $$;

create or replace function public.revoke_web_quote_links(p_quote_id uuid)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare n integer;
begin
  if not app.is_direccio() then raise exception 'Només direcció pot revocar enllaços' using errcode = '42501'; end if;
  update public.web_quote_tokens set revoked_at = now() where quote_id = p_quote_id and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_web_quote_status(uuid, text), public.revoke_web_quote_links(uuid) from public, anon;
grant execute on function public.set_web_quote_status(uuid, text), public.revoke_web_quote_links(uuid) to authenticated, service_role;
