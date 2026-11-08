-- =====================================================================
-- 1000 · FASE 2 — Pressupostos i contractes
-- · Configuració: tipus d'IVA, tipus de concepte (IVA per defecte), sèries de factura (FASE 4).
-- · Pressupostos amb versions; una versió enviada o acceptada és immutable.
-- · Contractes: lectures IA versionades, fites, discrepàncies i validació de direcció.
-- Imports en cèntims enters. Tipus d'IVA en punts bàsics (2100 = 21 %).
-- Tot és només de direcció, excepte que el client pot consultar el pressupost acceptat.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuració
-- ---------------------------------------------------------------------
create table public.vat_rates (
  rate_bp     integer primary key check (rate_bp between 0 and 10000),
  label       text not null,
  active      boolean not null default true
);
insert into public.vat_rates (rate_bp, label) values
  (0, 'Exempt / 0 %'), (400, '4 %'), (1000, '10 %'), (2100, '21 %');

-- IVA per defecte per tipus de concepte. Decisió de direcció (8/11/2026):
-- 21 % serveis d'arquitectura, 10 % construcció. Sempre modificable per línia.
create table public.concept_types (
  code            text primary key check (code ~ '^[a-z_]+$'),
  label_ca        text not null,
  label_es        text not null,
  default_vat_bp  integer references public.vat_rates (rate_bp),
  position        smallint not null default 0,
  active          boolean not null default true
);
insert into public.concept_types (code, label_ca, label_es, default_vat_bp, position) values
  ('construccio',       'Construcció de l''habitatge', 'Construcción de la vivienda', 1000, 1),
  ('cimentacio',        'Cimentació',                  'Cimentación',                 1000, 2),
  ('escomeses',         'Escomeses i connexions',      'Acometidas y conexiones',     1000, 3),
  ('projecte_direccio', 'Projecte, direcció i final d''obra', 'Proyecto, dirección y final de obra', 2100, 4),
  ('extra_constructiu', 'Extra constructiu',           'Extra constructivo',          1000, 5),
  ('altres',            'Altres (IVA a decidir)',      'Otros (IVA a decidir)',       null, 9);

-- Sèries de factura (s'utilitzaran a la FASE 4). Darrera factura emesa: 26-013.
create table public.invoice_series (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[a-z0-9_]+$'),
  label        text not null,
  year         smallint not null check (year between 2020 and 2100),
  last_number  integer not null default 0 check (last_number >= 0),
  pattern      text not null default 'AA-NNN',
  active       boolean not null default true,
  updated_at   timestamptz not null default now()
);
insert into public.invoice_series (code, label, year, last_number) values ('general', 'Sèrie general', 2026, 13);
create trigger invoice_series_touch before update on public.invoice_series
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Pressupostos
-- ---------------------------------------------------------------------
create table app.quote_counters (year smallint primary key, last_number integer not null default 0);

create table public.quotes (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete restrict,
  code                 text not null unique,
  title                text not null check (length(trim(title)) > 0),
  accepted_version_id  uuid,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now()
);
create index quotes_project_idx on public.quotes (project_id);

create table public.quote_versions (
  id              uuid primary key default gen_random_uuid(),
  quote_id        uuid not null references public.quotes (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete restrict,
  version         integer not null check (version > 0),
  status          text not null default 'esborrany'
                  check (status in ('esborrany', 'enviat', 'acceptat', 'rebutjat', 'substituit')),
  source          text not null default 'manual' check (source in ('manual', 'configurador', 'importat', 'duplicat')),
  locale          public.app_locale not null default 'es',
  issue_date      date,
  valid_until     date,
  intro           text,
  notes           text,
  sent_at         timestamptz,
  sent_by         uuid references public.profiles (id) on delete set null,
  accepted_at     timestamptz,
  accepted_on     date,
  accepted_by     uuid references public.profiles (id) on delete set null,
  pdf_document_id uuid references public.documents (id) on delete set null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (quote_id, version),
  constraint valid_dates check (valid_until is null or issue_date is null or valid_until >= issue_date)
);
create unique index quote_versions_one_draft on public.quote_versions (quote_id) where status = 'esborrany';
create unique index quote_versions_one_accepted on public.quote_versions (quote_id) where status = 'acceptat';
alter table public.quotes add constraint quotes_accepted_fk
  foreign key (accepted_version_id) references public.quote_versions (id) on delete restrict;
create trigger quote_versions_touch before update on public.quote_versions
  for each row execute function app.touch_updated_at();

create table public.quote_lines (
  id                uuid primary key default gen_random_uuid(),
  version_id        uuid not null references public.quote_versions (id) on delete cascade,
  position          integer not null,
  chapter           text not null default '' ,
  kind              text not null check (kind in ('base', 'extra_inicial', 'extra_posterior', 'descompte')),
  concept_type      text references public.concept_types (code),
  description       text not null check (length(trim(description)) > 0),
  quantity          numeric(14,3) not null default 1 check (quantity > 0),
  unit              text not null default 'u',
  unit_price_cents  bigint not null,
  discount_bp       integer not null default 0 check (discount_bp between 0 and 10000),
  vat_rate_bp       integer not null references public.vat_rates (rate_bp),
  amount_cents      bigint generated always as
                    (round(quantity * unit_price_cents * (10000 - discount_bp) / 10000.0)::bigint) stored,
  constraint sign_by_kind check ((kind = 'descompte' and unit_price_cents <= 0) or (kind <> 'descompte' and unit_price_cents >= 0))
);
create index quote_lines_version_idx on public.quote_lines (version_id, position);

-- Totals: base imposable i IVA per tipus (arrodonit per tipus, no per línia)
create view public.quote_version_totals with (security_invoker = true) as
with per_rate as (
  select version_id, vat_rate_bp, sum(amount_cents) as base_cents
  from public.quote_lines group by version_id, vat_rate_bp
), t as (
  select v.id as version_id,
    coalesce((select sum(amount_cents) from public.quote_lines l where l.version_id = v.id and l.kind = 'base'), 0)::bigint            as base_cents,
    coalesce((select sum(amount_cents) from public.quote_lines l where l.version_id = v.id and l.kind = 'extra_inicial'), 0)::bigint   as extras_initial_cents,
    coalesce((select sum(amount_cents) from public.quote_lines l where l.version_id = v.id and l.kind = 'extra_posterior'), 0)::bigint as extras_later_cents,
    coalesce((select sum(amount_cents) from public.quote_lines l where l.version_id = v.id and l.kind = 'descompte'), 0)::bigint       as discount_cents,
    coalesce((select sum(base_cents) from per_rate p where p.version_id = v.id), 0)::bigint                                           as taxable_cents,
    coalesce((select sum(round(base_cents * vat_rate_bp / 10000.0)) from per_rate p where p.version_id = v.id), 0)::bigint            as vat_cents,
    coalesce((select jsonb_agg(jsonb_build_object('rate_bp', vat_rate_bp, 'base_cents', base_cents,
                       'vat_cents', round(base_cents * vat_rate_bp / 10000.0)::bigint) order by vat_rate_bp)
              from per_rate p where p.version_id = v.id), '[]'::jsonb)                                                              as vat_breakdown
  from public.quote_versions v
)
select t.*, t.taxable_cents + t.vat_cents as total_cents from t;

-- Una versió que ja no és esborrany no es pot tocar (ni les línies) fora de les funcions
create or replace function app.guard_quote_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.quote_tx', true), 'off') = 'on' then return new; end if;
  if old.status <> 'esborrany' then
    raise exception 'Aquesta versió del pressupost ja s''ha enviat i no es pot modificar: crea''n una versió nova'
      using errcode = '42501', hint = 'quote_locked';
  end if;
  if new.status <> old.status or new.quote_id <> old.quote_id or new.version <> old.version or new.project_id <> old.project_id
     or new.accepted_at is distinct from old.accepted_at or new.sent_at is distinct from old.sent_at then
    raise exception 'Canvi d''estat no permès' using errcode = '42501', hint = 'invalid_transition';
  end if;
  return new;
end $$;
create trigger quote_versions_guard before update on public.quote_versions
  for each row execute function app.guard_quote_version();

create or replace function app.guard_quote_line()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.quote_versions
   where id = case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  if v_status is distinct from 'esborrany' and coalesce(current_setting('app.quote_tx', true), 'off') <> 'on' then
    raise exception 'Aquesta versió del pressupost ja s''ha enviat i no es pot modificar: crea''n una versió nova'
      using errcode = '42501', hint = 'quote_locked';
  end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'No es pot moure una línia a una altra versió' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger quote_lines_guard before insert or update or delete on public.quote_lines
  for each row execute function app.guard_quote_line();

create or replace function app.require_direccio()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_direccio() then
    raise exception 'Només direcció pot fer aquesta acció' using errcode = '42501';
  end if;
end $$;

create or replace function app.next_quote_code()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_year smallint := extract(year from (now() at time zone 'Europe/Madrid'))::smallint;
  v_n integer;
begin
  insert into app.quote_counters (year, last_number) values (v_year, 1)
  on conflict (year) do update set last_number = app.quote_counters.last_number + 1
  returning last_number into v_n;
  return format('P%s-%s', lpad((v_year % 100)::text, 2, '0'), lpad(v_n::text, 3, '0'));
end $$;

create or replace function public.create_quote(p_project_id uuid, p_title text, p_locale public.app_locale default 'es')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_quote uuid; v_version uuid;
begin
  perform app.require_direccio();
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Projecte inexistent' using errcode = 'P0002';
  end if;
  insert into public.quotes (project_id, code, title, created_by)
  values (p_project_id, app.next_quote_code(), trim(p_title), auth.uid()) returning id into v_quote;
  insert into public.quote_versions (quote_id, project_id, version, locale, created_by)
  values (v_quote, p_project_id, 1, p_locale, auth.uid()) returning id into v_version;
  return v_version;
end $$;

create or replace function app.copy_quote_lines(p_from uuid, p_to uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.quote_lines (version_id, position, chapter, kind, concept_type, description, quantity, unit,
                                  unit_price_cents, discount_bp, vat_rate_bp)
  select p_to, position, chapter, kind, concept_type, description, quantity, unit, unit_price_cents, discount_bp, vat_rate_bp
  from public.quote_lines where version_id = p_from order by position;
$$;

-- Nova versió (esborrany) a partir de la darrera
create or replace function public.new_quote_version(p_quote_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_last public.quote_versions; v_new uuid;
begin
  perform app.require_direccio();
  perform 1 from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'Pressupost inexistent' using errcode = 'P0002'; end if;
  if exists (select 1 from public.quote_versions where quote_id = p_quote_id and status = 'esborrany') then
    raise exception 'Ja hi ha un esborrany obert d''aquest pressupost' using errcode = 'P0001', hint = 'draft_exists';
  end if;
  if exists (select 1 from public.quote_versions where quote_id = p_quote_id and status = 'acceptat') then
    raise exception 'El pressupost ja està acceptat: els canvis posteriors es tramiten com a extres'
      using errcode = 'P0001', hint = 'quote_accepted';
  end if;
  select * into v_last from public.quote_versions where quote_id = p_quote_id order by version desc limit 1;
  insert into public.quote_versions (quote_id, project_id, version, locale, intro, notes, source, created_by)
  values (p_quote_id, v_last.project_id, v_last.version + 1, v_last.locale, v_last.intro, v_last.notes, v_last.source, auth.uid())
  returning id into v_new;
  perform app.copy_quote_lines(v_last.id, v_new);
  return v_new;
end $$;

-- Duplicar una versió en un pressupost nou (mateix projecte o un altre)
create or replace function public.duplicate_quote(p_version_id uuid, p_project_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_src public.quote_versions; v_new uuid;
begin
  perform app.require_direccio();
  select * into v_src from public.quote_versions where id = p_version_id;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  v_new := public.create_quote(p_project_id, p_title, v_src.locale);
  update public.quote_versions set intro = v_src.intro, notes = v_src.notes, source = 'duplicat' where id = v_new;
  perform app.copy_quote_lines(p_version_id, v_new);
  return v_new;
end $$;

create or replace function public.send_quote_version(p_version_id uuid, p_issue_date date, p_valid_until date)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  perform app.require_direccio();
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  if v.status <> 'esborrany' then
    raise exception 'Només es pot enviar un esborrany' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  if not exists (select 1 from public.quote_lines where version_id = p_version_id) then
    raise exception 'El pressupost no té cap partida' using errcode = 'P0001', hint = 'empty_quote';
  end if;
  if p_issue_date is null or p_valid_until is null or p_valid_until < p_issue_date then
    raise exception 'Cal la data d''emissió i una data de validesa posterior' using errcode = '22023', hint = 'invalid_dates';
  end if;
  perform set_config('app.quote_tx', 'on', true);
  -- Les versions enviades anteriors queden substituïdes
  update public.quote_versions set status = 'substituit'
   where quote_id = v.quote_id and status = 'enviat' and id <> p_version_id;
  update public.quote_versions
     set status = 'enviat', issue_date = p_issue_date, valid_until = p_valid_until, sent_at = now(), sent_by = auth.uid()
   where id = p_version_id;
  perform set_config('app.quote_tx', 'off', true);
end $$;

create or replace function public.set_quote_outcome(p_version_id uuid, p_outcome text, p_date date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  perform app.require_direccio();
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  if v.status <> 'enviat' or p_outcome not in ('acceptat', 'rebutjat') then
    raise exception 'Només una versió enviada es pot acceptar o rebutjar' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  if p_outcome = 'acceptat' and p_date is null then
    raise exception 'Cal la data d''acceptació' using errcode = '22023', hint = 'invalid_dates';
  end if;
  perform set_config('app.quote_tx', 'on', true);
  update public.quote_versions
     set status = p_outcome,
         accepted_at = case when p_outcome = 'acceptat' then now() end,
         accepted_on = case when p_outcome = 'acceptat' then p_date end,
         accepted_by = case when p_outcome = 'acceptat' then auth.uid() end
   where id = p_version_id;
  if p_outcome = 'acceptat' then
    update public.quotes set accepted_version_id = p_version_id where id = v.quote_id;
  end if;
  perform set_config('app.quote_tx', 'off', true);
end $$;

-- Vincular el PDF generat a una versió (també quan ja s'ha enviat)
create or replace function public.attach_quote_pdf(p_version_id uuid, p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_direccio();
  if not exists (select 1 from public.documents d join public.quote_versions v on v.project_id = d.project_id
                  where d.id = p_document_id and v.id = p_version_id) then
    raise exception 'Document no vàlid' using errcode = '22023';
  end if;
  perform set_config('app.quote_tx', 'on', true);
  update public.quote_versions set pdf_document_id = p_document_id where id = p_version_id;
  perform set_config('app.quote_tx', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- Contractes
-- ---------------------------------------------------------------------
create table public.contracts (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete restrict,
  document_id        uuid not null references public.documents (id) on delete restrict,
  quote_version_id   uuid references public.quote_versions (id) on delete set null,
  title              text not null,
  status             text not null default 'pendent_lectura'
                     check (status in ('pendent_lectura', 'en_revisio', 'validat', 'substituit')),
  document_date      date,
  signed_date        date,
  total_cents        bigint check (total_cents is null or total_cents >= 0),
  data               jsonb not null default '{}'::jsonb,   -- titulars, adreça, terminis… (revisables)
  validated_by       uuid references public.profiles (id) on delete set null,
  validated_at       timestamptz,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index contracts_project_idx on public.contracts (project_id);
create unique index contracts_one_valid on public.contracts (project_id) where status = 'validat';
create trigger contracts_touch before update on public.contracts
  for each row execute function app.touch_updated_at();

-- Cada lectura de la IA es conserva tal com va arribar (immutable)
create table public.contract_extractions (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts (id) on delete cascade,
  version       integer not null check (version > 0),
  provider      text not null,
  model         text not null,
  prompt_version text not null,
  pages         integer,
  output        jsonb not null,
  checks        jsonb not null default '[]'::jsonb,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (contract_id, version)
);

create table public.contract_milestones (
  id               uuid primary key default gen_random_uuid(),
  contract_id      uuid not null references public.contracts (id) on delete cascade,
  extraction_id    uuid references public.contract_extractions (id) on delete set null,
  position         integer not null,
  code             text,
  phase            text,
  subphase         text,
  concept          text not null check (length(trim(concept)) > 0),
  amount_cents     bigint not null check (amount_cents >= 0),
  vat_rate_bp      integer references public.vat_rates (rate_bp),
  concept_type     text references public.concept_types (code),
  trigger_condition text,
  is_extra         boolean not null default false,
  extra_label      text,
  source_page      integer check (source_page is null or source_page > 0),
  source_text      text,
  origin           text not null default 'ia' check (origin in ('ia', 'manual', 'fusio', 'divisio')),
  confirmed        boolean not null default false,
  -- Estat de cobrament (FASE 4). Només rellevant quan el contracte està validat.
  billing_status   text not null default 'pendent' check (billing_status in
                   ('pendent','en_execucio','comunicada','pendent_validacio','validada','pendent_facturar',
                    'facturada','parcialment_cobrada','cobrada')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index contract_milestones_contract_idx on public.contract_milestones (contract_id, position);
create trigger contract_milestones_touch before update on public.contract_milestones
  for each row execute function app.touch_updated_at();

create table public.contract_discrepancies (
  id             uuid primary key default gen_random_uuid(),
  contract_id    uuid not null references public.contracts (id) on delete cascade,
  extraction_id  uuid references public.contract_extractions (id) on delete set null,
  kind           text not null,
  severity       text not null check (severity in ('alta', 'mitjana', 'baixa')),
  message        text not null,
  expected_cents bigint,
  found_cents    bigint,
  refs           jsonb not null default '[]'::jsonb,
  status         text not null default 'oberta' check (status in ('oberta', 'acceptada', 'ignorada', 'resolta')),
  resolution     text,
  resolved_by    uuid references public.profiles (id) on delete set null,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint resolution_required check (status = 'oberta' or length(trim(coalesce(resolution, ''))) > 0)
);
create index contract_discrepancies_contract_idx on public.contract_discrepancies (contract_id);

-- Un contracte validat no es pot modificar (fites, imports, discrepàncies) fora de les funcions
create or replace function app.guard_contract_child()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if coalesce(current_setting('app.contract_tx', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from public.contracts
   where id = case when tg_op = 'DELETE' then old.contract_id else new.contract_id end;
  if v_status in ('validat', 'substituit') then
    raise exception 'El contracte ja està validat i no es pot modificar' using errcode = '42501', hint = 'contract_locked';
  end if;
  if tg_op = 'UPDATE' and new.contract_id <> old.contract_id then
    raise exception 'No es pot moure a un altre contracte' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger contract_milestones_guard before insert or update or delete on public.contract_milestones
  for each row execute function app.guard_contract_child();
create trigger contract_discrepancies_guard before insert or update or delete on public.contract_discrepancies
  for each row execute function app.guard_contract_child();

create or replace function app.guard_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.contract_tx', true), 'off') = 'on' then return new; end if;
  if old.status in ('validat', 'substituit') or new.status <> old.status
     or new.validated_at is distinct from old.validated_at or new.document_id <> old.document_id then
    raise exception 'El contracte ja està validat o el canvi d''estat no és permès' using errcode = '42501', hint = 'contract_locked';
  end if;
  return new;
end $$;
create trigger contracts_guard before update on public.contracts
  for each row execute function app.guard_contract();

create or replace function public.create_contract(p_project_id uuid, p_document_id uuid, p_title text, p_quote_version_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_direccio();
  if not exists (select 1 from public.documents where id = p_document_id and project_id = p_project_id and bucket_id = 'contractes') then
    raise exception 'El document ha de ser un contracte d''aquest projecte' using errcode = '22023', hint = 'invalid_document';
  end if;
  if p_quote_version_id is not null and not exists (
      select 1 from public.quote_versions where id = p_quote_version_id and project_id = p_project_id) then
    raise exception 'El pressupost no és d''aquest projecte' using errcode = '22023';
  end if;
  insert into public.contracts (project_id, document_id, quote_version_id, title, created_by)
  values (p_project_id, p_document_id, p_quote_version_id, trim(p_title), auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Desa una lectura de la IA (ja validada amb l'esquema al servidor) i en substitueix la proposta.
-- p_milestones: [{position, code, phase, subphase, concept, amount_cents, vat_rate_bp, concept_type,
--                 trigger_condition, is_extra, extra_label, source_page, source_text}]
-- p_discrepancies: [{kind, severity, message, expected_cents, found_cents, refs}]
create or replace function public.record_contract_extraction(
  p_contract_id uuid, p_provider text, p_model text, p_prompt_version text, p_pages integer,
  p_output jsonb, p_checks jsonb, p_fields jsonb, p_milestones jsonb, p_discrepancies jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v_ext uuid; v_n integer;
begin
  perform app.require_direccio();
  select * into c from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'Contracte inexistent' using errcode = 'P0002'; end if;
  if c.status in ('validat', 'substituit') then
    raise exception 'El contracte ja està validat' using errcode = '42501', hint = 'contract_locked';
  end if;
  select coalesce(max(version), 0) + 1 into v_n from public.contract_extractions where contract_id = p_contract_id;
  insert into public.contract_extractions (contract_id, version, provider, model, prompt_version, pages, output, checks, created_by)
  values (p_contract_id, v_n, p_provider, p_model, p_prompt_version, p_pages, p_output, coalesce(p_checks, '[]'), auth.uid())
  returning id into v_ext;

  perform set_config('app.contract_tx', 'on', true);
  delete from public.contract_milestones where contract_id = p_contract_id;
  delete from public.contract_discrepancies where contract_id = p_contract_id;
  insert into public.contract_milestones (contract_id, extraction_id, position, code, phase, subphase, concept, amount_cents,
       vat_rate_bp, concept_type, trigger_condition, is_extra, extra_label, source_page, source_text, origin)
  select p_contract_id, v_ext, (m->>'position')::int, m->>'code', m->>'phase', m->>'subphase', m->>'concept',
         (m->>'amount_cents')::bigint, nullif(m->>'vat_rate_bp', '')::int, nullif(m->>'concept_type', ''),
         m->>'trigger_condition', coalesce((m->>'is_extra')::boolean, false), m->>'extra_label',
         nullif(m->>'source_page', '')::int, m->>'source_text', 'ia'
  from jsonb_array_elements(coalesce(p_milestones, '[]')) m;
  insert into public.contract_discrepancies (contract_id, extraction_id, kind, severity, message, expected_cents, found_cents, refs)
  select p_contract_id, v_ext, d->>'kind', d->>'severity', d->>'message',
         nullif(d->>'expected_cents', '')::bigint, nullif(d->>'found_cents', '')::bigint, coalesce(d->'refs', '[]')
  from jsonb_array_elements(coalesce(p_discrepancies, '[]')) d;
  update public.contracts
     set status = 'en_revisio',
         data = coalesce(p_fields, '{}'),
         total_cents = coalesce(c.total_cents, nullif(p_fields->>'total_cents', '')::bigint),
         document_date = coalesce(c.document_date, nullif(p_fields->>'document_date', '')::date),
         signed_date = coalesce(c.signed_date, nullif(p_fields->>'signed_date', '')::date)
   where id = p_contract_id;
  perform set_config('app.contract_tx', 'off', true);
  return v_ext;
end $$;

-- Fusionar fites consecutives: suma imports, conserva textos i pàgines de totes
create or replace function public.merge_contract_milestones(p_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_first public.contract_milestones; v_contract uuid; v_n integer;
begin
  perform app.require_direccio();
  select count(*), min(contract_id::text)::uuid into v_n, v_contract from public.contract_milestones where id = any (p_ids);
  if v_n < 2 or v_n <> cardinality(p_ids)
     or (select count(distinct contract_id) from public.contract_milestones where id = any (p_ids)) <> 1 then
    raise exception 'Selecciona almenys dues fites del mateix contracte' using errcode = '22023';
  end if;
  select * into v_first from public.contract_milestones where id = any (p_ids) order by position limit 1;
  update public.contract_milestones m set
    amount_cents = (select sum(amount_cents) from public.contract_milestones where id = any (p_ids)),
    concept = (select string_agg(concept, ' + ' order by position) from public.contract_milestones where id = any (p_ids)),
    source_text = (select string_agg(coalesce(source_text, ''), E'\n' order by position) from public.contract_milestones where id = any (p_ids)),
    origin = 'fusio', confirmed = false
  where m.id = v_first.id;
  delete from public.contract_milestones where id = any (p_ids) and id <> v_first.id;
  return v_first.id;
end $$;

-- Dividir una fita en diversos imports que sumin exactament l'original
create or replace function public.split_contract_milestone(p_id uuid, p_amounts bigint[])
returns void language plpgsql security definer set search_path = '' as $$
declare m public.contract_milestones; i integer;
begin
  perform app.require_direccio();
  select * into m from public.contract_milestones where id = p_id;
  if not found then raise exception 'Fita inexistent' using errcode = 'P0002'; end if;
  if cardinality(p_amounts) < 2 or (select sum(a) from unnest(p_amounts) a) <> m.amount_cents
     or exists (select 1 from unnest(p_amounts) a where a <= 0) then
    raise exception 'Els imports han de ser positius i sumar exactament l''import de la fita'
      using errcode = '22023', hint = 'split_sum';
  end if;
  update public.contract_milestones set position = position + cardinality(p_amounts) - 1
   where contract_id = m.contract_id and position > m.position;
  update public.contract_milestones set amount_cents = p_amounts[1], origin = 'divisio', confirmed = false,
         concept = m.concept || ' (1/' || cardinality(p_amounts) || ')' where id = p_id;
  for i in 2 .. cardinality(p_amounts) loop
    insert into public.contract_milestones (contract_id, extraction_id, position, code, phase, subphase, concept, amount_cents,
         vat_rate_bp, concept_type, trigger_condition, is_extra, extra_label, source_page, source_text, origin)
    values (m.contract_id, m.extraction_id, m.position + i - 1, m.code, m.phase, m.subphase,
            m.concept || ' (' || i || '/' || cardinality(p_amounts) || ')', p_amounts[i], m.vat_rate_bp, m.concept_type,
            m.trigger_condition, m.is_extra, m.extra_label, m.source_page, m.source_text, 'divisio');
  end loop;
end $$;

-- Validació de direcció: activa les fites per a la facturació
create or replace function public.validate_contract(p_contract_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.contracts; v_sum bigint;
begin
  perform app.require_direccio();
  select * into c from public.contracts where id = p_contract_id for update;
  if not found then raise exception 'Contracte inexistent' using errcode = 'P0002'; end if;
  if c.status <> 'en_revisio' then
    raise exception 'El contracte no està en revisió' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  if c.total_cents is null then
    raise exception 'Cal confirmar l''import total del contracte' using errcode = 'P0001', hint = 'total_required';
  end if;
  if not exists (select 1 from public.contract_milestones where contract_id = p_contract_id) then
    raise exception 'El contracte no té cap fita' using errcode = 'P0001', hint = 'no_milestones';
  end if;
  if exists (select 1 from public.contract_milestones where contract_id = p_contract_id and (not confirmed or vat_rate_bp is null)) then
    raise exception 'Totes les fites han d''estar confirmades i tenir el tipus d''IVA' using errcode = 'P0001', hint = 'unconfirmed_milestones';
  end if;
  if exists (select 1 from public.contract_discrepancies where contract_id = p_contract_id and status = 'oberta') then
    raise exception 'Hi ha discrepàncies obertes' using errcode = 'P0001', hint = 'open_discrepancies';
  end if;
  select sum(amount_cents) into v_sum from public.contract_milestones where contract_id = p_contract_id;
  if v_sum <> c.total_cents then
    raise exception 'La suma de les fites no coincideix amb el total del contracte' using errcode = 'P0001',
      hint = 'sum_mismatch', detail = format('%s,%s', v_sum, c.total_cents);
  end if;
  perform set_config('app.contract_tx', 'on', true);
  update public.contracts set status = 'substituit' where project_id = c.project_id and status = 'validat';
  update public.contracts set status = 'validat', validated_by = auth.uid(), validated_at = now() where id = p_contract_id;
  perform set_config('app.contract_tx', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- Auditoria (registre de correccions) i permisos
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['vat_rates','concept_types','invoice_series','quotes','quote_versions','quote_lines',
                           'contracts','contract_milestones','contract_discrepancies']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

alter table public.vat_rates              enable row level security;
alter table public.concept_types          enable row level security;
alter table public.invoice_series         enable row level security;
alter table public.quotes                 enable row level security;
alter table public.quote_versions         enable row level security;
alter table public.quote_lines            enable row level security;
alter table public.contracts              enable row level security;
alter table public.contract_extractions   enable row level security;
alter table public.contract_milestones    enable row level security;
alter table public.contract_discrepancies enable row level security;

-- Configuració: lectura per a l'equip intern; escriptura direcció
create policy vat_rates_read on public.vat_rates for select to authenticated using (true);
create policy vat_rates_dir on public.vat_rates for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy concept_types_read on public.concept_types for select to authenticated using (true);
create policy concept_types_dir on public.concept_types for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy invoice_series_dir on public.invoice_series for all to authenticated using (app.is_direccio()) with check (app.is_direccio());

-- Pressupostos: direcció; el client només veu la versió acceptada del seu projecte
create policy quotes_dir on public.quotes for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy quotes_client on public.quotes for select to authenticated
  using (accepted_version_id is not null and app.is_project_client(project_id));
create policy quote_versions_dir_select on public.quote_versions for select to authenticated using (app.is_direccio());
create policy quote_versions_dir_update on public.quote_versions for update to authenticated
  using (app.is_direccio()) with check (app.is_direccio());
create policy quote_versions_client on public.quote_versions for select to authenticated
  using (status = 'acceptat' and app.is_project_client(project_id));
create policy quote_lines_dir on public.quote_lines for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy quote_lines_client on public.quote_lines for select to authenticated using (
  exists (select 1 from public.quote_versions v where v.id = version_id and v.status = 'acceptat' and app.is_project_client(v.project_id)));

-- Contractes: només direcció
create policy contracts_dir_select on public.contracts for select to authenticated using (app.is_direccio());
create policy contracts_dir_update on public.contracts for update to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy contract_extractions_dir on public.contract_extractions for select to authenticated using (app.is_direccio());
create policy contract_milestones_dir on public.contract_milestones for all to authenticated
  using (app.is_direccio()) with check (app.is_direccio());
create policy contract_discrepancies_dir_select on public.contract_discrepancies for select to authenticated using (app.is_direccio());
create policy contract_discrepancies_dir_update on public.contract_discrepancies for update to authenticated
  using (app.is_direccio()) with check (app.is_direccio());

revoke all on public.vat_rates, public.concept_types, public.invoice_series, public.quotes, public.quote_versions,
  public.quote_lines, public.contracts, public.contract_extractions, public.contract_milestones,
  public.contract_discrepancies, public.quote_version_totals from anon, authenticated;
grant select on public.vat_rates, public.concept_types, public.quotes, public.quote_versions, public.quote_lines,
  public.contracts, public.contract_extractions, public.contract_milestones, public.contract_discrepancies,
  public.quote_version_totals to authenticated;
grant insert, update, delete on public.vat_rates, public.concept_types, public.quote_lines, public.contract_milestones to authenticated;
grant select, insert, update on public.invoice_series to authenticated;
-- Versions, contractes i discrepàncies: només camps editables; els estats canvien amb les funcions
grant update (title) on public.quotes to authenticated;
grant update (locale, intro, notes) on public.quote_versions to authenticated;
grant update (title, quote_version_id, document_date, signed_date, total_cents, data) on public.contracts to authenticated;
grant update (status, resolution, resolved_by, resolved_at) on public.contract_discrepancies to authenticated;
grant all on public.vat_rates, public.concept_types, public.invoice_series, public.quotes, public.quote_versions,
  public.quote_lines, public.contracts, public.contract_extractions, public.contract_milestones,
  public.contract_discrepancies, public.quote_version_totals to service_role;

revoke all on function app.guard_quote_version(), app.guard_quote_line(), app.require_direccio(), app.next_quote_code(),
  app.copy_quote_lines(uuid, uuid), app.guard_contract_child(), app.guard_contract() from public;
revoke all on function public.create_quote(uuid, text, public.app_locale), public.new_quote_version(uuid),
  public.duplicate_quote(uuid, uuid, text), public.send_quote_version(uuid, date, date), public.set_quote_outcome(uuid, text, date),
  public.attach_quote_pdf(uuid, uuid), public.create_contract(uuid, uuid, text, uuid),
  public.record_contract_extraction(uuid, text, text, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.merge_contract_milestones(uuid[]), public.split_contract_milestone(uuid, bigint[]), public.validate_contract(uuid)
  from public, anon;
grant execute on function public.create_quote(uuid, text, public.app_locale), public.new_quote_version(uuid),
  public.duplicate_quote(uuid, uuid, text), public.send_quote_version(uuid, date, date), public.set_quote_outcome(uuid, text, date),
  public.attach_quote_pdf(uuid, uuid), public.create_contract(uuid, uuid, text, uuid),
  public.record_contract_extraction(uuid, text, text, text, integer, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.merge_contract_milestones(uuid[]), public.split_contract_milestone(uuid, bigint[]), public.validate_contract(uuid)
  to authenticated, service_role;
grant execute on function app.require_direccio() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Dades de l'empresa per als documents (editables a Administració; mai al codi)
-- El NIF i l'IBAN es deixen buits: els ha d'introduir direcció.
-- ---------------------------------------------------------------------
create table public.company_settings (
  id                     boolean primary key default true check (id),
  legal_name             text not null,
  trade_name             text not null default 'ModularDom',
  tax_id                 text,
  address                text,
  phone                  text,
  email                  text,
  website                text,
  iban                   text,
  quote_validity_months  smallint not null default 1 check (quote_validity_months between 0 and 24),
  quote_conditions_ca    text,
  quote_conditions_es    text,
  updated_at             timestamptz not null default now()
);
insert into public.company_settings (legal_name, phone, email, website, quote_conditions_ca, quote_conditions_es) values
  ('MODULARDOM OBRAS Y REFORMAS, S.L.', '684 784 887', 'info@modulardom.com', 'www.modulardom.com',
   'Imports sense IVA llevat que s''indiqui el contrari. Aquesta proposta econòmica no inclou memòria de qualitats.',
   'Importes expresados sin IVA salvo indicación contraria. Esta propuesta económica no incluye memoria de calidades.');
create trigger company_settings_touch before update on public.company_settings
  for each row execute function app.touch_updated_at();
create trigger company_settings_audit after insert or update or delete on public.company_settings
  for each row execute function app.audit_row();
alter table public.company_settings enable row level security;
create policy company_settings_dir on public.company_settings for all to authenticated
  using (app.is_direccio()) with check (app.is_direccio());
revoke all on public.company_settings from anon, authenticated;
grant select, update on public.company_settings to authenticated;
grant all on public.company_settings to service_role;

-- Desa l'esborrany sencer (capçalera + partides) en una sola transacció
-- p_lines: [{chapter, kind, concept_type, description, quantity, unit, unit_price_cents, discount_bp, vat_rate_bp}]
create or replace function public.save_quote_draft(p_version_id uuid, p_locale public.app_locale, p_intro text, p_notes text, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  perform app.require_direccio();
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  if v.status <> 'esborrany' then
    raise exception 'Aquesta versió del pressupost ja s''ha enviat i no es pot modificar: crea''n una versió nova'
      using errcode = '42501', hint = 'quote_locked';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 500 then
    raise exception 'Partides no vàlides' using errcode = '22023';
  end if;
  update public.quote_versions set locale = p_locale, intro = nullif(trim(p_intro), ''), notes = nullif(trim(p_notes), '')
   where id = p_version_id;
  delete from public.quote_lines where version_id = p_version_id;
  insert into public.quote_lines (version_id, position, chapter, kind, concept_type, description, quantity, unit,
                                  unit_price_cents, discount_bp, vat_rate_bp)
  select p_version_id, ord::int, coalesce(l->>'chapter', ''), l->>'kind', nullif(l->>'concept_type', ''), l->>'description',
         (l->>'quantity')::numeric, coalesce(nullif(l->>'unit', ''), 'u'), (l->>'unit_price_cents')::bigint,
         coalesce((l->>'discount_bp')::int, 0), (l->>'vat_rate_bp')::int
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
end $$;
revoke all on function public.save_quote_draft(uuid, public.app_locale, text, text, jsonb) from public, anon;
grant execute on function public.save_quote_draft(uuid, public.app_locale, text, text, jsonb) to authenticated, service_role;

-- Reordenar una fita (amunt/avall) de forma atòmica
create or replace function public.move_contract_milestone(p_id uuid, p_dir integer)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.contract_milestones; o public.contract_milestones;
begin
  perform app.require_direccio();
  select * into m from public.contract_milestones where id = p_id;
  if not found then raise exception 'Fita inexistent' using errcode = 'P0002'; end if;
  select * into o from public.contract_milestones where contract_id = m.contract_id
     and case when p_dir < 0 then position < m.position else position > m.position end
   order by case when p_dir < 0 then -position else position end limit 1;
  if not found then return; end if;
  update public.contract_milestones set position = o.position where id = m.id;
  update public.contract_milestones set position = m.position where id = o.id;
end $$;
revoke all on function public.move_contract_milestone(uuid, integer) from public, anon;
grant execute on function public.move_contract_milestone(uuid, integer) to authenticated, service_role;
