-- =====================================================================
-- 1100 · Pressupostos v2 (només amplia; no elimina ni canvia dades)
-- · Catàleg central de tarifes del configurador (versions, entrada en vigor, publicació a la web)
-- · Partides incloses / opcionals / pendents de valoració / excloses; preus manuals traçables
-- · Pressupostos importats (PDF, Excel, Word) amb lectura IA i conversió a editable
-- · Publicació al client, pressupost vigent, decisions del client
-- · Extres amb seguiment complet: estats, acceptació, annex, costos, marge i cobraments
-- · Arquitecte: preparar pressupostos dels seus projectes. Constructor: partides autoritzades.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tarifes del configurador
-- ---------------------------------------------------------------------
create table public.tariff_versions (
  id               uuid primary key default gen_random_uuid(),
  number           integer not null unique check (number > 0),
  status           text not null default 'esborrany' check (status in ('esborrany', 'aprovada', 'arxivada')),
  params           jsonb not null check (jsonb_typeof(params) = 'object'),
  effective_from   date,
  notes            text,
  based_on         uuid references public.tariff_versions (id) on delete set null,
  approved_by      uuid references public.profiles (id) on delete set null,
  approved_at      timestamptz,
  published_web_at timestamptz,
  published_web_by uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint approved_has_date check (status = 'esborrany' or effective_from is not null)
);
create unique index tariff_versions_one_draft on public.tariff_versions ((true)) where status = 'esborrany';
create trigger tariff_versions_touch before update on public.tariff_versions for each row execute function app.touch_updated_at();

-- Una tarifa aprovada no es modifica mai: els canvis creen una versió nova
create or replace function app.guard_tariff()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.tariff_tx', true), 'off') = 'on' then return new; end if;
  if old.status <> 'esborrany' or new.status <> old.status or new.published_web_at is distinct from old.published_web_at
     or new.number <> old.number or new.approved_at is distinct from old.approved_at then
    raise exception 'Una tarifa aprovada no es pot modificar: crea''n una versió nova' using errcode = '42501', hint = 'tariff_locked';
  end if;
  return new;
end $$;
create trigger tariff_versions_guard before update on public.tariff_versions for each row execute function app.guard_tariff();
create or replace function app.guard_tariff_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'esborrany' then
    raise exception 'Una tarifa aprovada no es pot eliminar' using errcode = '42501', hint = 'tariff_locked';
  end if;
  return old;
end $$;
create trigger tariff_versions_guard_delete before delete on public.tariff_versions for each row execute function app.guard_tariff_delete();

-- Tarifa inicial = la de www.modulardom.com/presupuesto (config.js v3), amb els honoraris
-- d'arquitecte decidits per direcció el 17/11/2026: 130 €/m² + 1.800 €.
insert into public.tariff_versions (number, status, params, effective_from, notes, approved_at) values (1, 'aprovada', $json$
{"construccio_m2":993,"fonamentacio_m2":120,"arquitecte_m2":130,"arquitecte_fix":1800,"escomeses":3500,"metres_minims":100,
 "iva_obra_pct":10,"iva_arquitecte_pct":21,
 "intern":{"habitacio":6500,"bany":7500,"safareig":4500,"suite_bany":9800,"suite_bany_vestidor":14500},
 "distribucio_descompte_pct":50,
 "garatge":{"primer_vehicle":20000,"vehicle_addicional":15000,"max_vehicles":4},
 "cuina":{"basica":4500,"illa":10000},
 "installacions_m2":{"aerotermia":{"nom":{"ca":"Aerotèrmia","es":"Aerotermia"},"preu_m2":140},
                     "aireConductos":{"nom":{"ca":"Aire conductes","es":"Aire por conductos"},"preu_m2":70}},
 "extres":{"piscina":{"nom":{"ca":"Piscina","es":"Piscina"},"preu":22000},
           "porche":{"nom":{"ca":"Porxo","es":"Porche"},"preu":8000},
           "placasSolares":{"nom":{"ca":"Plaques solars","es":"Placas solares"},"preu":6500}},
 "opcions":{"habitacions":[1,2,3,4,5,6],"banys":[1,2,3,4]}}
$json$::jsonb, '2026-11-17', 'Tarifa de la web (config.js v3). Honoraris d''arquitecte: 130 €/m² + 1.800 €.', now());

-- Tarifa vigent al CRM en una data (pressupostos nous)
create or replace function public.tariff_in_force(p_date date default null)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.tariff_versions
   where status = 'aprovada' and effective_from <= coalesce(p_date, (now() at time zone 'Europe/Madrid')::date)
   order by effective_from desc, number desc limit 1
$$;

create or replace function public.new_tariff_draft()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_src public.tariff_versions; v_id uuid;
begin
  perform app.require_direccio();
  if exists (select 1 from public.tariff_versions where status = 'esborrany') then
    raise exception 'Ja hi ha un esborrany de tarifa obert' using errcode = 'P0001', hint = 'draft_exists';
  end if;
  select * into v_src from public.tariff_versions where status = 'aprovada' order by number desc limit 1;
  insert into public.tariff_versions (number, params, based_on, created_by)
  values ((select coalesce(max(number), 0) + 1 from public.tariff_versions), v_src.params, v_src.id, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.approve_tariff(p_id uuid, p_effective_from date, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_direccio();
  if p_effective_from is null then raise exception 'Cal la data d''entrada en vigor' using errcode = '22023', hint = 'invalid_dates'; end if;
  perform set_config('app.tariff_tx', 'on', true);
  update public.tariff_versions set status = 'aprovada', effective_from = p_effective_from, notes = nullif(trim(p_notes), ''),
         approved_by = auth.uid(), approved_at = now()
   where id = p_id and status = 'esborrany';
  if not found then raise exception 'Només es pot aprovar l''esborrany' using errcode = 'P0001', hint = 'invalid_state'; end if;
  perform set_config('app.tariff_tx', 'off', true);
end $$;

-- Publicar a la web: acció explícita de direcció. Només tarifes aprovades i ja en vigor.
create or replace function public.publish_tariff_to_web(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_direccio();
  perform set_config('app.tariff_tx', 'on', true);
  update public.tariff_versions set published_web_at = now(), published_web_by = auth.uid()
   where id = p_id and status = 'aprovada' and effective_from <= (now() at time zone 'Europe/Madrid')::date;
  if not found then
    raise exception 'Només es pot publicar una tarifa aprovada i ja en vigor' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  perform set_config('app.tariff_tx', 'off', true);
end $$;

-- Tarifa publicada a la web (lectura pública, sense dades personals)
create or replace function public.web_published_tariff()
returns table (number integer, effective_from date, published_at timestamptz, params jsonb)
language sql stable security definer set search_path = '' as $$
  select number, effective_from, published_web_at, params from public.tariff_versions
   where published_web_at is not null and status = 'aprovada'
   order by published_web_at desc limit 1
$$;

-- ---------------------------------------------------------------------
-- Ampliació de pressupostos
-- ---------------------------------------------------------------------
alter table public.company_settings add column client_quote_decisions boolean not null default false;

alter table public.quote_versions
  add column tariff_version_id   uuid references public.tariff_versions (id) on delete restrict,
  add column configurator_input  jsonb,
  add column configurator_result jsonb,
  add column exclusions          text,
  add column payment_terms       text,
  add column published_to_client boolean not null default false,
  add column published_at        timestamptz,
  add column published_by        uuid references public.profiles (id) on delete set null,
  add column is_current          boolean not null default false,
  add column client_decision     text check (client_decision in ('acceptat', 'rebutjat')),
  add column client_decided_at   timestamptz,
  add column client_decided_by   uuid references public.profiles (id) on delete set null,
  add constraint draft_not_published check (status <> 'esborrany' or not published_to_client);
create unique index quote_versions_one_current on public.quote_versions (project_id) where is_current;

alter table public.quote_lines
  add column status                   text not null default 'inclosa'
                                      check (status in ('inclosa', 'opcional', 'pendent_valoracio', 'exclosa')),
  add column catalog_key              text,
  add column catalog_unit_price_cents bigint,
  add column price_overridden         boolean generated always as
                                      (catalog_unit_price_cents is not null and unit_price_cents <> catalog_unit_price_cents) stored,
  add column needs_review             boolean not null default false,
  add column source_ref               text,
  add column constructor_visible      boolean not null default false;

-- Les versions acceptades ja eren visibles al client: es mantenen publicades
do $$ begin
  perform set_config('app.quote_tx', 'on', true);
  update public.quote_versions set published_to_client = true, published_at = coalesce(accepted_at, now()) where status = 'acceptat';
  perform set_config('app.quote_tx', 'off', true);
end $$;

-- Totals: només sumen les partides incloses. Les opcionals es mostren a part.
drop view public.quote_version_totals;
create view public.quote_version_totals with (security_invoker = true) as
with inc as (
  select * from public.quote_lines where status = 'inclosa'
), per_rate as (
  select version_id, vat_rate_bp, sum(amount_cents) as base_cents from inc group by version_id, vat_rate_bp
), t as (
  select v.id as version_id,
    coalesce((select sum(amount_cents) from inc l where l.version_id = v.id and l.kind = 'base'), 0)::bigint            as base_cents,
    coalesce((select sum(amount_cents) from inc l where l.version_id = v.id and l.kind = 'extra_inicial'), 0)::bigint   as extras_initial_cents,
    coalesce((select sum(amount_cents) from inc l where l.version_id = v.id and l.kind = 'extra_posterior'), 0)::bigint as extras_later_cents,
    coalesce((select sum(amount_cents) from inc l where l.version_id = v.id and l.kind = 'descompte'), 0)::bigint       as discount_cents,
    coalesce((select sum(base_cents) from per_rate p where p.version_id = v.id), 0)::bigint                             as taxable_cents,
    coalesce((select sum(round(base_cents * vat_rate_bp / 10000.0)) from per_rate p where p.version_id = v.id), 0)::bigint as vat_cents,
    coalesce((select jsonb_agg(jsonb_build_object('rate_bp', vat_rate_bp, 'base_cents', base_cents,
                       'vat_cents', round(base_cents * vat_rate_bp / 10000.0)::bigint) order by vat_rate_bp)
              from per_rate p where p.version_id = v.id), '[]'::jsonb)                                                as vat_breakdown,
    coalesce((select sum(amount_cents) from public.quote_lines l where l.version_id = v.id and l.status = 'opcional'), 0)::bigint as optional_cents,
    (select count(*) from public.quote_lines l where l.version_id = v.id and l.status = 'pendent_valoracio')::integer   as pending_valuation
  from public.quote_versions v
)
select t.*, t.taxable_cents + t.vat_cents as total_cents from t;
revoke all on public.quote_version_totals from anon, authenticated;
grant select on public.quote_version_totals to authenticated;
grant all on public.quote_version_totals to service_role;

-- Qui pot preparar pressupostos: direcció, o l'arquitecte assignat al projecte
create or replace function app.can_prepare_quote(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_direccio() or coalesce(app.project_role(p_project_id)::text = 'arquitecte', false)
$$;
create or replace function app.require_quote_preparer(p_project_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_prepare_quote(p_project_id) then
    raise exception 'No tens permís per preparar pressupostos d''aquest projecte' using errcode = '42501';
  end if;
end $$;

create or replace function app.copy_quote_lines(p_from uuid, p_to uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.quote_lines (version_id, position, chapter, kind, concept_type, description, quantity, unit,
                                  unit_price_cents, discount_bp, vat_rate_bp, status, catalog_key, catalog_unit_price_cents,
                                  needs_review, source_ref, constructor_visible)
  select p_to, position, chapter, kind, concept_type, description, quantity, unit, unit_price_cents, discount_bp, vat_rate_bp,
         status, catalog_key, catalog_unit_price_cents, needs_review, source_ref, constructor_visible
  from public.quote_lines where version_id = p_from order by position;
$$;

-- Crear / versionar: també l'arquitecte del projecte
create or replace function public.create_quote(p_project_id uuid, p_title text, p_locale public.app_locale default 'es')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_quote uuid; v_version uuid;
begin
  perform app.require_quote_preparer(p_project_id);
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Projecte inexistent' using errcode = 'P0002';
  end if;
  insert into public.quotes (project_id, code, title, created_by)
  values (p_project_id, app.next_quote_code(), trim(p_title), auth.uid()) returning id into v_quote;
  insert into public.quote_versions (quote_id, project_id, version, locale, created_by)
  values (v_quote, p_project_id, 1, p_locale, auth.uid()) returning id into v_version;
  return v_version;
end $$;

create or replace function public.new_quote_version(p_quote_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_last public.quote_versions; v_new uuid; v_project uuid;
begin
  select project_id into v_project from public.quotes where id = p_quote_id for update;
  if not found then raise exception 'Pressupost inexistent' using errcode = 'P0002'; end if;
  perform app.require_quote_preparer(v_project);
  if exists (select 1 from public.quote_versions where quote_id = p_quote_id and status = 'esborrany') then
    raise exception 'Ja hi ha un esborrany obert d''aquest pressupost' using errcode = 'P0001', hint = 'draft_exists';
  end if;
  if exists (select 1 from public.quote_versions where quote_id = p_quote_id and status = 'acceptat') then
    raise exception 'El pressupost ja està acceptat: els canvis posteriors es tramiten com a extres'
      using errcode = 'P0001', hint = 'quote_accepted';
  end if;
  select * into v_last from public.quote_versions where quote_id = p_quote_id order by version desc limit 1;
  insert into public.quote_versions (quote_id, project_id, version, locale, intro, notes, exclusions, payment_terms, source,
                                     tariff_version_id, configurator_input, configurator_result, created_by)
  values (p_quote_id, v_last.project_id, v_last.version + 1, v_last.locale, v_last.intro, v_last.notes, v_last.exclusions,
          v_last.payment_terms, v_last.source, v_last.tariff_version_id, v_last.configurator_input, v_last.configurator_result, auth.uid())
  returning id into v_new;
  perform app.copy_quote_lines(v_last.id, v_new);
  return v_new;
end $$;

create or replace function public.duplicate_quote(p_version_id uuid, p_project_id uuid, p_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_src public.quote_versions; v_new uuid;
begin
  select * into v_src from public.quote_versions where id = p_version_id;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  perform app.require_quote_preparer(v_src.project_id);
  v_new := public.create_quote(p_project_id, p_title, v_src.locale);
  update public.quote_versions set intro = v_src.intro, notes = v_src.notes, exclusions = v_src.exclusions,
         payment_terms = v_src.payment_terms, source = 'duplicat' where id = v_new;
  perform app.copy_quote_lines(p_version_id, v_new);
  return v_new;
end $$;

-- Desar l'esborrany sencer (versió ampliada). Un preu de catàleg modificat només el pot fixar direcció.
-- p_lines: [{chapter, kind, concept_type, description, quantity, unit, unit_price_cents, discount_bp, vat_rate_bp,
--            status, catalog_key, catalog_unit_price_cents, needs_review, source_ref, constructor_visible}]
create or replace function public.save_quote_draft(p_version_id uuid, p_locale public.app_locale, p_intro text, p_notes text,
  p_exclusions text, p_payment_terms text, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  perform app.require_quote_preparer(v.project_id);
  if v.status <> 'esborrany' then
    raise exception 'Aquesta versió del pressupost ja s''ha enviat i no es pot modificar: crea''n una versió nova'
      using errcode = '42501', hint = 'quote_locked';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 500 then
    raise exception 'Partides no vàlides' using errcode = '22023';
  end if;
  if not app.is_direccio() and exists (
      select 1 from jsonb_array_elements(p_lines) l
       where nullif(l->>'catalog_unit_price_cents', '') is not null
         and (l->>'unit_price_cents')::bigint <> (l->>'catalog_unit_price_cents')::bigint) then
    raise exception 'Modificar un preu de catàleg requereix autorització de direcció' using errcode = '42501', hint = 'override_requires_admin';
  end if;
  update public.quote_versions set locale = p_locale, intro = nullif(trim(p_intro), ''), notes = nullif(trim(p_notes), ''),
         exclusions = nullif(trim(p_exclusions), ''), payment_terms = nullif(trim(p_payment_terms), '')
   where id = p_version_id;
  delete from public.quote_lines where version_id = p_version_id;
  insert into public.quote_lines (version_id, position, chapter, kind, concept_type, description, quantity, unit,
                                  unit_price_cents, discount_bp, vat_rate_bp, status, catalog_key, catalog_unit_price_cents,
                                  needs_review, source_ref, constructor_visible)
  select p_version_id, ord::int, coalesce(l->>'chapter', ''), l->>'kind', nullif(l->>'concept_type', ''), l->>'description',
         (l->>'quantity')::numeric, coalesce(nullif(l->>'unit', ''), 'u'), (l->>'unit_price_cents')::bigint,
         coalesce((l->>'discount_bp')::int, 0), (l->>'vat_rate_bp')::int, coalesce(nullif(l->>'status', ''), 'inclosa'),
         nullif(l->>'catalog_key', ''), nullif(l->>'catalog_unit_price_cents', '')::bigint,
         coalesce((l->>'needs_review')::boolean, false), nullif(l->>'source_ref', ''), coalesce((l->>'constructor_visible')::boolean, false)
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);
end $$;

-- La versió antiga (5 paràmetres) desa amb els valors actuals d'exclusions i condicions
create or replace function public.save_quote_draft(p_version_id uuid, p_locale public.app_locale, p_intro text, p_notes text, p_lines jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  select * into v from public.quote_versions where id = p_version_id;
  perform public.save_quote_draft(p_version_id, p_locale, p_intro, p_notes, v.exclusions, v.payment_terms, p_lines);
end $$;

-- Pressupost creat amb el configurador: guarda la tarifa, l'entrada i el resultat tal com es van calcular
create or replace function public.set_configurator_snapshot(p_version_id uuid, p_tariff_id uuid, p_input jsonb, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  perform app.require_quote_preparer(v.project_id);
  if v.status <> 'esborrany' then raise exception 'Versió congelada' using errcode = '42501', hint = 'quote_locked'; end if;
  if not exists (select 1 from public.tariff_versions where id = p_tariff_id and status = 'aprovada') then
    raise exception 'Tarifa no vàlida' using errcode = '22023';
  end if;
  update public.quote_versions set tariff_version_id = p_tariff_id, configurator_input = p_input, configurator_result = p_result,
         source = 'configurador' where id = p_version_id;
end $$;

-- Publicar al client / retirar-ne la publicació (mai un esborrany)
create or replace function public.publish_quote_version(p_version_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  perform app.require_direccio();
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  if v.status = 'esborrany' and p_published then
    raise exception 'Un esborrany no es pot publicar al client' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  perform set_config('app.quote_tx', 'on', true);
  update public.quote_versions set published_to_client = p_published,
         published_at = case when p_published then now() else published_at end,
         published_by = case when p_published then auth.uid() else published_by end
   where id = p_version_id;
  perform set_config('app.quote_tx', 'off', true);
  if p_published then
    perform app.notify_project(v.project_id, array['client'], 'pressupost_publicat', 'Nou pressupost disponible',
      '/portal/' || v.project_id || '?apartat=pressupostos', 'pressupost:' || p_version_id);
  end if;
end $$;

-- Pressupost vigent del projecte
create or replace function public.set_current_quote(p_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  perform app.require_direccio();
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found then raise exception 'Versió inexistent' using errcode = 'P0002'; end if;
  if v.status in ('esborrany', 'rebutjat') then
    raise exception 'Només una versió enviada o acceptada pot ser la vigent' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  perform set_config('app.quote_tx', 'on', true);
  update public.quote_versions set is_current = false where project_id = v.project_id and is_current and id <> p_version_id;
  update public.quote_versions set is_current = true where id = p_version_id;
  perform set_config('app.quote_tx', 'off', true);
end $$;

-- Decisió del client des del portal (si direcció ho ha habilitat)
create or replace function public.client_decide_quote(p_version_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.quote_versions;
begin
  select * into v from public.quote_versions where id = p_version_id for update;
  if not found or not app.is_project_client(v.project_id) or not v.published_to_client then
    raise exception 'No tens accés a aquest pressupost' using errcode = '42501';
  end if;
  if not coalesce((select client_quote_decisions from public.company_settings), false) then
    raise exception 'L''acceptació des del portal no està habilitada' using errcode = 'P0001', hint = 'decisions_disabled';
  end if;
  if v.status <> 'enviat' or p_decision not in ('acceptat', 'rebutjat') then
    raise exception 'Aquest pressupost ja no admet resposta' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  perform set_config('app.quote_tx', 'on', true);
  update public.quote_versions
     set status = p_decision, client_decision = p_decision, client_decided_at = now(), client_decided_by = auth.uid(),
         accepted_at = case when p_decision = 'acceptat' then now() end,
         accepted_on = case when p_decision = 'acceptat' then (now() at time zone 'Europe/Madrid')::date end,
         accepted_by = case when p_decision = 'acceptat' then auth.uid() end
   where id = p_version_id;
  if p_decision = 'acceptat' then
    update public.quotes set accepted_version_id = p_version_id where id = v.quote_id;
  end if;
  perform set_config('app.quote_tx', 'off', true);
  perform app.notify_direccio('pressupost_resposta', case when p_decision = 'acceptat' then 'Pressupost acceptat pel client' else 'Pressupost rebutjat pel client' end,
    null, '/pressupostos/' || p_version_id, 'pressupost-resposta:' || p_version_id, auth.uid());
end $$;

-- Constructor: només les partides marcades com a visibles del pressupost vigent o acceptat, sense imports
create or replace function public.constructor_quote_scope(p_project_id uuid)
returns table (chapter text, description text, quantity numeric, unit text)
language sql stable security definer set search_path = '' as $$
  select l.chapter, l.description, l.quantity, l.unit
    from public.quote_lines l join public.quote_versions v on v.id = l.version_id
   where v.project_id = p_project_id and l.constructor_visible and l.status = 'inclosa'
     and (v.is_current or v.status = 'acceptat')
     and (app.is_direccio() or coalesce(app.project_role(p_project_id)::text = 'constructor', false))
   order by v.version desc, l.position
$$;

-- ---------------------------------------------------------------------
-- Pressupostos importats
-- ---------------------------------------------------------------------
insert into public.upload_rules (bucket_id, extension, mime_type, max_bytes, previewable) values
  ('pressupostos', 'pdf',  'application/pdf', 26214400, true),
  ('pressupostos', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 26214400, false),
  ('pressupostos', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 26214400, false)
on conflict (bucket_id, extension) do nothing;

create table public.quote_imports (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete restrict,
  document_id      uuid not null references public.documents (id) on delete restrict,
  title            text not null,
  declared_status  text not null default 'esborrany' check (declared_status in ('esborrany', 'enviat', 'aprovat', 'rebutjat')),
  status           text not null default 'pujat' check (status in ('pujat', 'analitzat', 'convertit', 'descartat')),
  extraction       jsonb,
  provider         text,
  model            text,
  analyzed_at      timestamptz,
  analyzed_by      uuid references public.profiles (id) on delete set null,
  quote_version_id uuid references public.quote_versions (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index quote_imports_project_idx on public.quote_imports (project_id);
create trigger quote_imports_touch before update on public.quote_imports for each row execute function app.touch_updated_at();
alter table public.quote_versions add column origin_import_id uuid references public.quote_imports (id) on delete set null;

create or replace function public.register_quote_import(p_project_id uuid, p_document_id uuid, p_title text, p_declared_status text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_quote_preparer(p_project_id);
  if not exists (select 1 from public.documents where id = p_document_id and project_id = p_project_id and bucket_id = 'pressupostos') then
    raise exception 'El document ha de ser un pressupost d''aquest projecte' using errcode = '22023', hint = 'invalid_document';
  end if;
  insert into public.quote_imports (project_id, document_id, title, declared_status, created_by)
  values (p_project_id, p_document_id, trim(p_title), p_declared_status, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.record_quote_import_analysis(p_import_id uuid, p_provider text, p_model text, p_extraction jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.quote_imports;
begin
  select * into i from public.quote_imports where id = p_import_id for update;
  if not found then raise exception 'Importació inexistent' using errcode = 'P0002'; end if;
  perform app.require_quote_preparer(i.project_id);
  if i.status in ('convertit', 'descartat') then raise exception 'Importació tancada' using errcode = 'P0001', hint = 'invalid_state'; end if;
  update public.quote_imports set status = 'analitzat', extraction = p_extraction, provider = p_provider, model = p_model,
         analyzed_at = now(), analyzed_by = auth.uid() where id = p_import_id;
end $$;

-- Converteix la previsualització validada en un pressupost editable (esborrany). No pot quedar cap
-- partida marcada per revisar. El document original es manté intacte i vinculat.
create or replace function public.convert_quote_import(p_import_id uuid, p_title text, p_locale public.app_locale,
  p_intro text, p_notes text, p_exclusions text, p_payment_terms text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.quote_imports; v_version uuid;
begin
  select * into i from public.quote_imports where id = p_import_id for update;
  if not found then raise exception 'Importació inexistent' using errcode = 'P0002'; end if;
  perform app.require_quote_preparer(i.project_id);
  if i.status in ('convertit', 'descartat') then raise exception 'Importació tancada' using errcode = 'P0001', hint = 'invalid_state'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'El pressupost no té cap partida' using errcode = 'P0001', hint = 'empty_quote';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l->>'needs_review')::boolean, false)) then
    raise exception 'Hi ha partides pendents de revisar' using errcode = 'P0001', hint = 'needs_review';
  end if;
  v_version := public.create_quote(i.project_id, p_title, p_locale);
  update public.quote_versions set source = 'importat', origin_import_id = p_import_id where id = v_version;
  perform public.save_quote_draft(v_version, p_locale, p_intro, p_notes, p_exclusions, p_payment_terms, p_lines);
  update public.quote_imports set status = 'convertit', quote_version_id = v_version where id = p_import_id;
  return v_version;
end $$;

-- ---------------------------------------------------------------------
-- Extres amb seguiment econòmic
-- ---------------------------------------------------------------------
create table public.project_extras (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects (id) on delete restrict,
  code                   text not null,
  title                  text not null check (length(trim(title)) > 0),
  description            text,
  amount_cents           bigint not null check (amount_cents >= 0),
  vat_rate_bp            integer not null references public.vat_rates (rate_bp),
  concept_type           text references public.concept_types (code),
  status                 text not null default 'proposat' check (status in
                         ('proposat', 'pendent_aprovacio', 'aprovat', 'rebutjat', 'incorporat', 'executat', 'facturat', 'cobrat')),
  source_quote_line_id   uuid references public.quote_lines (id) on delete set null,
  source_version_id      uuid references public.quote_versions (id) on delete set null,
  included_in_version_id uuid references public.quote_versions (id) on delete set null,
  contract_id            uuid references public.contracts (id) on delete set null,
  annex_document_id      uuid references public.documents (id) on delete set null,
  accepted_on            date,
  accepted_at            timestamptz,
  accepted_by            uuid references public.profiles (id) on delete set null,
  accepted_via           text check (accepted_via in ('direccio', 'portal')),
  accepted_version_id    uuid references public.quote_versions (id) on delete set null,
  estimated_cost_cents   bigint check (estimated_cost_cents is null or estimated_cost_cents >= 0),
  payment_terms          text,
  visible_to_client      boolean not null default false,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (project_id, code)
);
create unique index project_extras_from_line on public.project_extras (source_quote_line_id) where source_quote_line_id is not null;
create index project_extras_project_idx on public.project_extras (project_id);
create trigger project_extras_touch before update on public.project_extras for each row execute function app.touch_updated_at();

create table public.project_extra_events (
  id          uuid primary key default gen_random_uuid(),
  extra_id    uuid not null references public.project_extras (id) on delete cascade,
  from_status text,
  to_status   text not null,
  event_date  date,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index project_extra_events_idx on public.project_extra_events (extra_id, created_at);

create table public.project_extra_costs (
  id           uuid primary key default gen_random_uuid(),
  extra_id     uuid not null references public.project_extras (id) on delete cascade,
  supplier     text,
  description  text not null check (length(trim(description)) > 0),
  amount_cents bigint not null check (amount_cents >= 0),
  cost_date    date not null,
  document_id  uuid references public.documents (id) on delete set null,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index project_extra_costs_idx on public.project_extra_costs (extra_id);

create table public.project_extra_milestones (
  id                uuid primary key default gen_random_uuid(),
  extra_id          uuid not null references public.project_extras (id) on delete cascade,
  position          integer not null,
  concept           text not null check (length(trim(concept)) > 0),
  amount_cents      bigint not null check (amount_cents > 0),
  trigger_condition text,
  billing_status    text not null default 'pendent' check (billing_status in ('pendent', 'facturada', 'cobrada')),
  created_at        timestamptz not null default now()
);
create index project_extra_milestones_idx on public.project_extra_milestones (extra_id, position);

-- Un extra aprovat no canvia d'import ni de condicions (només costos i estat)
create or replace function app.guard_extra()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.extra_tx', true), 'off') = 'on' then return new; end if;
  if new.status <> old.status or new.accepted_at is distinct from old.accepted_at or new.project_id <> old.project_id
     or new.included_in_version_id is distinct from old.included_in_version_id then
    raise exception 'Els canvis d''estat es fan amb el flux d''aprovació' using errcode = '42501', hint = 'invalid_transition';
  end if;
  if old.status not in ('proposat', 'pendent_aprovacio')
     and (new.amount_cents <> old.amount_cents or new.vat_rate_bp <> old.vat_rate_bp or new.title <> old.title
          or new.description is distinct from old.description or new.payment_terms is distinct from old.payment_terms) then
    raise exception 'Un extra aprovat no es pot modificar' using errcode = '42501', hint = 'extra_locked';
  end if;
  return new;
end $$;
create trigger project_extras_guard before update on public.project_extras for each row execute function app.guard_extra();

create or replace function app.guard_extra_milestone()
returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  if coalesce(current_setting('app.extra_tx', true), 'off') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
  select status into v_status from public.project_extras where id = case when tg_op = 'DELETE' then old.extra_id else new.extra_id end;
  if v_status not in ('proposat', 'pendent_aprovacio', 'aprovat') and not (tg_op = 'UPDATE' and new.billing_status <> old.billing_status
       and new.amount_cents = old.amount_cents and new.concept = old.concept) then
    raise exception 'Les fites d''un extra incorporat no es poden modificar' using errcode = '42501', hint = 'extra_locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger project_extra_milestones_guard before insert or update or delete on public.project_extra_milestones
  for each row execute function app.guard_extra_milestone();

create or replace function public.create_project_extra(p_project_id uuid, p_title text, p_description text, p_amount_cents bigint,
  p_vat_rate_bp integer, p_concept_type text, p_source_line_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_n integer; v_line record;
begin
  perform app.require_direccio();
  if p_source_line_id is not null then
    select l.*, v.project_id as v_project, v.status as v_status into v_line
      from public.quote_lines l join public.quote_versions v on v.id = l.version_id where l.id = p_source_line_id;
    if not found or v_line.v_project <> p_project_id then
      raise exception 'Partida no vàlida' using errcode = '22023';
    end if;
    if v_line.status not in ('opcional', 'pendent_valoracio') then
      raise exception 'Només una partida opcional o pendent de valoració es pot convertir en extra' using errcode = 'P0001', hint = 'line_not_optional';
    end if;
  end if;
  perform 1 from public.projects where id = p_project_id for update;
  select count(*) + 1 into v_n from public.project_extras where project_id = p_project_id;
  insert into public.project_extras (project_id, code, title, description, amount_cents, vat_rate_bp, concept_type,
                                     source_quote_line_id, source_version_id, created_by)
  values (p_project_id, 'EX-' || lpad(v_n::text, 2, '0'), trim(p_title), nullif(trim(p_description), ''), p_amount_cents,
          p_vat_rate_bp, p_concept_type, p_source_line_id, case when p_source_line_id is not null then v_line.version_id end, auth.uid())
  returning id into v_id;
  insert into public.project_extra_events (extra_id, to_status, note, created_by) values (v_id, 'proposat', null, auth.uid());
  return v_id;
end $$;

-- Flux d'estats. Aprovar ≠ facturar ≠ cobrar: són estats diferents i successius.
create or replace function app.set_extra_status_internal(p_id uuid, p_status text, p_date date, p_note text, p_via text,
  p_annex_document_id uuid, p_contract_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.project_extras; v_ok boolean; v_ms bigint;
begin
  select * into e from public.project_extras where id = p_id for update;
  if not found then raise exception 'Extra inexistent' using errcode = 'P0002'; end if;
  v_ok := case e.status
    when 'proposat'          then p_status in ('pendent_aprovacio', 'aprovat', 'rebutjat')
    when 'pendent_aprovacio' then p_status in ('aprovat', 'rebutjat', 'proposat')
    when 'rebutjat'          then p_status = 'proposat'
    when 'aprovat'           then p_status = 'incorporat'
    when 'incorporat'        then p_status = 'executat'
    when 'executat'          then p_status = 'facturat'
    when 'facturat'          then p_status = 'cobrat'
    else false end;
  if not v_ok then
    raise exception 'Canvi d''estat no permès (% → %)', e.status, p_status using errcode = 'P0001', hint = 'invalid_transition';
  end if;
  if p_status = 'aprovat' and p_date is null then
    raise exception 'Cal la data d''acceptació' using errcode = '22023', hint = 'invalid_dates';
  end if;
  if p_status = 'rebutjat' and length(trim(coalesce(p_note, ''))) = 0 and p_via = 'direccio' then
    raise exception 'Indica el motiu' using errcode = '22023', hint = 'resolution_required';
  end if;
  if p_status = 'incorporat' then
    if p_annex_document_id is null and p_contract_id is null then
      raise exception 'Cal vincular l''annex o la modificació del contracte' using errcode = 'P0001', hint = 'annex_required';
    end if;
    if p_annex_document_id is not null and not exists (select 1 from public.documents where id = p_annex_document_id and project_id = e.project_id) then
      raise exception 'Document no vàlid' using errcode = '22023';
    end if;
    if p_contract_id is not null and not exists (select 1 from public.contracts where id = p_contract_id and project_id = e.project_id) then
      raise exception 'Contracte no vàlid' using errcode = '22023';
    end if;
    select coalesce(sum(amount_cents), 0) into v_ms from public.project_extra_milestones where extra_id = p_id;
    if v_ms <> e.amount_cents then
      raise exception 'Les fites de cobrament de l''extra han de sumar el seu import' using errcode = 'P0001', hint = 'sum_mismatch';
    end if;
  end if;
  perform set_config('app.extra_tx', 'on', true);
  update public.project_extras set status = p_status,
         accepted_on = case when p_status = 'aprovat' then p_date when p_status in ('rebutjat', 'proposat') then null else accepted_on end,
         accepted_at = case when p_status = 'aprovat' then now() when p_status in ('rebutjat', 'proposat') then null else accepted_at end,
         accepted_by = case when p_status = 'aprovat' then auth.uid() when p_status in ('rebutjat', 'proposat') then null else accepted_by end,
         accepted_via = case when p_status = 'aprovat' then p_via when p_status in ('rebutjat', 'proposat') then null else accepted_via end,
         annex_document_id = case when p_status = 'incorporat' then p_annex_document_id else annex_document_id end,
         contract_id = case when p_status = 'incorporat' then p_contract_id else contract_id end,
         visible_to_client = case when p_status = 'pendent_aprovacio' then true else visible_to_client end
   where id = p_id;
  if p_status in ('facturat', 'cobrat') then
    update public.project_extra_milestones set billing_status = case when p_status = 'cobrat' then 'cobrada' else 'facturada' end
     where extra_id = p_id and (p_status = 'cobrat' or billing_status = 'pendent');
  end if;
  perform set_config('app.extra_tx', 'off', true);
  insert into public.project_extra_events (extra_id, from_status, to_status, event_date, note, created_by)
  values (p_id, e.status, p_status, p_date, nullif(trim(p_note), ''), auth.uid());
end $$;

create or replace function public.set_extra_status(p_id uuid, p_status text, p_date date, p_note text,
  p_annex_document_id uuid default null, p_contract_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_direccio();
  perform app.set_extra_status_internal(p_id, p_status, p_date, p_note, 'direccio', p_annex_document_id, p_contract_id);
end $$;

create or replace function public.client_decide_extra(p_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.project_extras;
begin
  select * into e from public.project_extras where id = p_id;
  if not found or not app.is_project_client(e.project_id) or not e.visible_to_client then
    raise exception 'No tens accés a aquest extra' using errcode = '42501';
  end if;
  if not coalesce((select client_quote_decisions from public.company_settings), false) then
    raise exception 'L''acceptació des del portal no està habilitada' using errcode = 'P0001', hint = 'decisions_disabled';
  end if;
  if e.status <> 'pendent_aprovacio' or p_decision not in ('aprovat', 'rebutjat') then
    raise exception 'Aquest extra ja no admet resposta' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  perform app.set_extra_status_internal(p_id, p_decision, (now() at time zone 'Europe/Madrid')::date,
    case when p_decision = 'rebutjat' then 'Rebutjat pel client des del portal' else 'Acceptat pel client des del portal' end, 'portal', null, null);
  perform app.notify_direccio('extra_resposta', case when p_decision = 'aprovat' then 'Extra acceptat pel client: ' else 'Extra rebutjat pel client: ' end || e.title,
    null, '/projectes/' || e.project_id || '/extres', 'extra-resposta:' || p_id || ':' || p_decision, auth.uid());
end $$;

-- Si una versió posterior del pressupost ja inclou l'extra, se'n marca la inclusió perquè no es comptin dos cops
create or replace function public.mark_extra_included(p_id uuid, p_version_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.project_extras;
begin
  perform app.require_direccio();
  select * into e from public.project_extras where id = p_id for update;
  if not found then raise exception 'Extra inexistent' using errcode = 'P0002'; end if;
  if p_version_id is not null and not exists (select 1 from public.quote_versions where id = p_version_id and project_id = e.project_id and status <> 'esborrany') then
    raise exception 'Versió no vàlida' using errcode = '22023';
  end if;
  perform set_config('app.extra_tx', 'on', true);
  update public.project_extras set included_in_version_id = p_version_id where id = p_id;
  perform set_config('app.extra_tx', 'off', true);
  insert into public.project_extra_events (extra_id, from_status, to_status, note, created_by)
  values (p_id, e.status, e.status, case when p_version_id is null then 'Ja no consta inclòs en cap versió' else 'Inclòs en una versió posterior del pressupost' end, auth.uid());
end $$;

-- Resum econòmic dels extres per projecte (sense duplicar els que ja inclou una versió posterior)
create view public.project_extras_economics with (security_invoker = true) as
select e.project_id,
  coalesce(sum(e.amount_cents) filter (where e.status in ('aprovat','incorporat','executat','facturat','cobrat') and e.included_in_version_id is null), 0)::bigint as approved_cents,
  coalesce(sum(e.amount_cents) filter (where e.status in ('proposat','pendent_aprovacio')), 0)::bigint as pending_cents,
  coalesce(sum(e.amount_cents) filter (where e.status = 'rebutjat'), 0)::bigint as rejected_cents,
  coalesce(sum(e.amount_cents) filter (where e.status in ('facturat','cobrat') and e.included_in_version_id is null), 0)::bigint as invoiced_cents,
  coalesce(sum(e.amount_cents) filter (where e.status = 'cobrat' and e.included_in_version_id is null), 0)::bigint as collected_cents,
  coalesce(sum(e.estimated_cost_cents) filter (where e.status in ('aprovat','incorporat','executat','facturat','cobrat') and e.included_in_version_id is null), 0)::bigint as estimated_cost_cents,
  coalesce(sum(c.total) filter (where e.status in ('aprovat','incorporat','executat','facturat','cobrat') and e.included_in_version_id is null), 0)::bigint as actual_cost_cents
from public.project_extras e
left join lateral (select sum(amount_cents) as total from public.project_extra_costs where extra_id = e.id) c on true
group by e.project_id;

-- ---------------------------------------------------------------------
-- Auditoria i permisos
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['tariff_versions','quote_imports','project_extras','project_extra_costs','project_extra_milestones']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

alter table public.tariff_versions           enable row level security;
alter table public.quote_imports             enable row level security;
alter table public.project_extras            enable row level security;
alter table public.project_extra_events      enable row level security;
alter table public.project_extra_costs       enable row level security;
alter table public.project_extra_milestones  enable row level security;

-- Tarifes: equip intern (direcció i arquitectes) llegeix; direcció edita l'esborrany
create policy tariff_read on public.tariff_versions for select to authenticated
  using (app.is_direccio() or app.current_role()::text = 'arquitecte');
create policy tariff_dir_update on public.tariff_versions for update to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy tariff_dir_delete on public.tariff_versions for delete to authenticated using (app.is_direccio());

-- Pressupostos: arquitecte del projecte (lectura). El client només veu les versions publicades.
drop policy quotes_client on public.quotes;
drop policy quote_versions_client on public.quote_versions;
drop policy quote_lines_client on public.quote_lines;
create policy quotes_arch on public.quotes for select to authenticated using (app.can_prepare_quote(project_id));
create policy quotes_client on public.quotes for select to authenticated using (
  app.is_project_client(project_id) and exists (select 1 from public.quote_versions v where v.quote_id = quotes.id and v.published_to_client and v.status <> 'esborrany'));
create policy quote_versions_arch on public.quote_versions for select to authenticated using (app.can_prepare_quote(project_id));
create policy quote_versions_client on public.quote_versions for select to authenticated
  using (published_to_client and status <> 'esborrany' and app.is_project_client(project_id));
create policy quote_lines_arch on public.quote_lines for select to authenticated using (
  exists (select 1 from public.quote_versions v where v.id = version_id and app.can_prepare_quote(v.project_id)));
create policy quote_lines_client on public.quote_lines for select to authenticated using (
  status <> 'exclosa' and exists (select 1 from public.quote_versions v where v.id = version_id and v.published_to_client
    and v.status <> 'esborrany' and app.is_project_client(v.project_id)));

create policy quote_imports_read on public.quote_imports for select to authenticated using (app.can_prepare_quote(project_id));
create policy quote_imports_dir_update on public.quote_imports for update to authenticated using (app.is_direccio()) with check (app.is_direccio());

-- Extres: direcció tot; arquitecte del projecte i client (els que se li han presentat) llegeixen. Costos: només direcció.
create policy extras_dir on public.project_extras for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy extras_arch on public.project_extras for select to authenticated using (coalesce(app.project_role(project_id)::text = 'arquitecte', false));
create policy extras_client on public.project_extras for select to authenticated using (visible_to_client and app.is_project_client(project_id));
create policy extra_events_dir on public.project_extra_events for select to authenticated using (app.is_direccio());
create policy extra_costs_dir on public.project_extra_costs for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy extra_milestones_dir on public.project_extra_milestones for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy extra_milestones_client on public.project_extra_milestones for select to authenticated using (
  exists (select 1 from public.project_extras e where e.id = extra_id and e.visible_to_client and app.is_project_client(e.project_id)));

revoke all on public.tariff_versions, public.quote_imports, public.project_extras, public.project_extra_events,
  public.project_extra_costs, public.project_extra_milestones, public.project_extras_economics from anon, authenticated;
grant select on public.tariff_versions, public.quote_imports, public.project_extras, public.project_extra_events,
  public.project_extra_costs, public.project_extra_milestones, public.project_extras_economics to authenticated;
grant update (params, notes) on public.tariff_versions to authenticated;
grant delete on public.tariff_versions to authenticated;
grant update (title, declared_status, status) on public.quote_imports to authenticated;
grant update (title, description, amount_cents, vat_rate_bp, concept_type, estimated_cost_cents, payment_terms, visible_to_client)
  on public.project_extras to authenticated;
grant insert, delete on public.project_extra_costs to authenticated;
grant insert, update, delete on public.project_extra_milestones to authenticated;
grant all on public.tariff_versions, public.quote_imports, public.project_extras, public.project_extra_events,
  public.project_extra_costs, public.project_extra_milestones, public.project_extras_economics to service_role;
grant update (exclusions, payment_terms) on public.quote_versions to authenticated;
grant update (client_quote_decisions) on public.company_settings to authenticated;

revoke all on function app.guard_tariff(), app.guard_tariff_delete(), app.guard_extra(), app.guard_extra_milestone(),
  app.set_extra_status_internal(uuid, text, date, text, text, uuid, uuid) from public;
grant execute on function app.can_prepare_quote(uuid), app.require_quote_preparer(uuid) to authenticated, service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'public.tariff_in_force(date)', 'public.new_tariff_draft()', 'public.approve_tariff(uuid, date, text)', 'public.publish_tariff_to_web(uuid)',
    'public.save_quote_draft(uuid, public.app_locale, text, text, text, text, jsonb)', 'public.set_configurator_snapshot(uuid, uuid, jsonb, jsonb)',
    'public.publish_quote_version(uuid, boolean)', 'public.set_current_quote(uuid)', 'public.client_decide_quote(uuid, text)',
    'public.constructor_quote_scope(uuid)', 'public.register_quote_import(uuid, uuid, text, text)',
    'public.record_quote_import_analysis(uuid, text, text, jsonb)',
    'public.convert_quote_import(uuid, text, public.app_locale, text, text, text, text, jsonb)',
    'public.create_project_extra(uuid, text, text, bigint, integer, text, uuid)', 'public.set_extra_status(uuid, text, date, text, uuid, uuid)',
    'public.client_decide_extra(uuid, text)', 'public.mark_extra_included(uuid, uuid)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
-- Tarifa publicada: lectura pública (la web la necessita; no conté dades personals)
revoke all on function public.web_published_tariff() from public;
grant execute on function public.web_published_tariff() to anon, authenticated, service_role;
