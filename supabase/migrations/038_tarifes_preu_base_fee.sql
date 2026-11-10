-- =====================================================================================================================
-- 038 · Tarifes PREU BASE + FEE i INDEXADA + MARGE (Fase 15)
--
--   tariff_versions               columnes del model de preu (desnormalitzades del JSON `data.pricing`, que és la font):
--                                 model (FIXED_FINAL / FIXED_BASE_FEE / INDEXED / INDEXED_BASE_FEE), preus base, FEE per
--                                 defecte, FEE recomanat, màxim contractual, unitat d'entrada, preus finals calculats…
--                                 No es converteix cap tarifa existent: les columnes queden buides (= model no informat).
--   fin_rules                     model de remuneració del FEE (capa proveïdor) i tarifa concreta, sense taula paral·lela.
--   comparison_pricing_snapshots  instantània de cada comparativa: preus base, FEE aplicat, preus finals, consums,
--                                 marge teòric, cost anual i remuneració estimada. Dades econòmiques: només Direcció i
--                                 Administració autoritzada (economia). Les files d'una comparativa emesa són immutables.
-- Idempotent. Imports en numeric (mai coma flotant). Reversió: 038_tarifes_preu_base_fee_down.sql.
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------- tariff_versions
alter table public.tariff_versions add column if not exists pricing_model text;
alter table public.tariff_versions add column if not exists base_energy_prices jsonb;
alter table public.tariff_versions add column if not exists default_fee_mode text;
alter table public.tariff_versions add column if not exists default_fee_values jsonb;
alter table public.tariff_versions add column if not exists recommended_fee numeric(14, 9);
alter table public.tariff_versions add column if not exists contract_max_fee numeric(14, 9);
alter table public.tariff_versions add column if not exists fee_input_unit text;
alter table public.tariff_versions add column if not exists fee_allowed text;
alter table public.tariff_versions add column if not exists final_energy_prices_calculated jsonb;
alter table public.tariff_versions add column if not exists fee_configuration_version integer;
alter table public.tariff_versions add column if not exists fee_terms_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tariff_versions_pricing_model_chk') then
    alter table public.tariff_versions add constraint tariff_versions_pricing_model_chk
      check (pricing_model is null or pricing_model in ('FIXED_FINAL', 'FIXED_BASE_FEE', 'INDEXED', 'INDEXED_BASE_FEE'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tariff_versions_fee_mode_chk') then
    alter table public.tariff_versions add constraint tariff_versions_fee_mode_chk check (default_fee_mode is null or default_fee_mode in ('unic', 'periodes'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tariff_versions_fee_unit_chk') then
    alter table public.tariff_versions add constraint tariff_versions_fee_unit_chk check (fee_input_unit is null or fee_input_unit in ('eur_kwh', 'eur_mwh'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tariff_versions_fee_allowed_chk') then
    alter table public.tariff_versions add constraint tariff_versions_fee_allowed_chk check (fee_allowed is null or fee_allowed in ('si', 'no', 'pendent'));
  end if;
  -- el FEE recomanat és una recomanació interna; el màxim contractual és un límit real (mai negatius)
  if not exists (select 1 from pg_constraint where conname = 'tariff_versions_fee_limits_chk') then
    alter table public.tariff_versions add constraint tariff_versions_fee_limits_chk
      check ((recommended_fee is null or recommended_fee >= 0) and (contract_max_fee is null or contract_max_fee >= 0) and (fee_configuration_version is null or fee_configuration_version >= 1));
  end if;
end $$;
create index if not exists tariff_versions_pricing_model_idx on public.tariff_versions (pricing_model) where pricing_model is not null;

-- ---------------------------------------------------------------------------------------------------- fin_rules
alter table public.fin_rules add column if not exists remuneration_model text;
alter table public.fin_rules add column if not exists tariff_product_id uuid references public.tariff_products (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_remuneration_model_chk') then
    alter table public.fin_rules add constraint fin_rules_remuneration_model_chk check (
      remuneration_model is null or (layer = 'proveidor' and remuneration_model in ('fee_integre', 'pct_fee', 'fix_contracte', 'per_kwh', 'per_mwh', 'per_kw', 'mixta', 'personalitzada')));
  end if;
end $$;
create index if not exists fin_rules_remuneration_idx on public.fin_rules (lower(retailer), status) where remuneration_model is not null;

-- ---------------------------------------------------------------------------------------------------- comparison_pricing_snapshots
create table if not exists public.comparison_pricing_snapshots (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons (id) on delete cascade,
  tariff_version_id uuid references public.tariff_versions (id) on delete set null,
  tariff_product_id uuid references public.tariff_products (id) on delete set null,
  pricing_model text not null check (pricing_model in ('FIXED_FINAL', 'FIXED_BASE_FEE', 'INDEXED', 'INDEXED_BASE_FEE')),
  original_base_prices_snapshot jsonb,
  applied_fee_snapshot jsonb,
  final_prices_snapshot jsonb not null,
  annual_consumption_by_period jsonb not null,
  energy_margin numeric(14, 2),
  calculated_annual_cost numeric(14, 2),
  saving numeric(14, 2),
  estimated_remuneration numeric(14, 2),
  remuneration_status text check (remuneration_status is null or remuneration_status in ('estimada', 'simulacio', 'pendent_configurar')),
  remuneration_detail jsonb,
  calculation_version text not null,
  locked boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists comparison_pricing_snapshots_cmp_idx on public.comparison_pricing_snapshots (comparison_id);

-- una instantània d'una comparativa emesa no es modifica ni s'esborra (la comparativa pot desaparèixer en cascada)
create or replace function public.comparison_pricing_snapshots_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.locked then
    raise exception 'Instantània de preus d''una comparativa emesa: és immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' and old.locked and pg_trigger_depth() = 1 and exists (select 1 from public.comparisons c where c.id = old.comparison_id) then
    raise exception 'Instantània de preus d''una comparativa emesa: no es pot esborrar' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists comparison_pricing_snapshots_guard_trg on public.comparison_pricing_snapshots;
create trigger comparison_pricing_snapshots_guard_trg before update or delete on public.comparison_pricing_snapshots
  for each row execute function public.comparison_pricing_snapshots_guard();

alter table public.comparison_pricing_snapshots enable row level security;
-- lectura: Direcció o Administració amb permís d'economia. L'escriptura la fa només el servidor (sense política d'escriptura).
drop policy if exists p_comparison_pricing_snapshots_select on public.comparison_pricing_snapshots;
create policy p_comparison_pricing_snapshots_select on public.comparison_pricing_snapshots for select to authenticated using (
  public.is_admin() or (public.is_staff() and public.has_perm('economia', 'read'))
);

-- ---------------------------------------------------------------------------------------------------- comprovació
select '038 · columnes de tariff_versions' as comprovacio, count(*) as n from information_schema.columns
  where table_schema = 'public' and table_name = 'tariff_versions'
    and column_name in ('pricing_model', 'base_energy_prices', 'default_fee_mode', 'default_fee_values', 'recommended_fee', 'contract_max_fee', 'fee_input_unit', 'fee_allowed', 'final_energy_prices_calculated', 'fee_configuration_version', 'fee_terms_source')
union all select '038 · columnes de fin_rules', count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'fin_rules' and column_name in ('remuneration_model', 'tariff_product_id')
union all select '038 · taula comparison_pricing_snapshots', count(*) from information_schema.tables
  where table_schema = 'public' and table_name = 'comparison_pricing_snapshots'
union all select '038 · tarifes existents NO convertides (pricing_model buit)', count(*) from public.tariff_versions where pricing_model is null;
-- Resultat esperat: 11 · 2 · 1 · (totes les tarifes que ja hi havia)
