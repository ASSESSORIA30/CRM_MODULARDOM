-- =====================================================================================================================
-- 036 · Regles d'unitat apreses (lector de tarifes)
--   tariff_unit_rules  regla persistent: comercialitzadora + subministrament + concepte (+ producte, peatge, plantilla)
--                      i la unitat d'origen confirmada (p. ex. Iberdrola · Gas · Terme fix = €/mes).
--   tariff_rule_runs   cada aplicació/reprocessament amb el resultat verificable (afectades, reprocessades, validades,
--                      pendents i motius). El xat només diu «aplicada» quan el run ha acabat bé.
-- RLS activada i sense polítiques: hi accedeix només el servidor després de comprovar el rol. Idempotent.
-- =====================================================================================================================

create table if not exists public.tariff_unit_rules (
  id uuid primary key default gen_random_uuid(),
  supplier text not null check (length(trim(supplier)) between 1 and 80),
  energy_type text not null check (energy_type in ('luz', 'gas')),
  concept text not null check (concept in ('terme_fix_gas')),
  unit text not null check (unit in ('eur_dia', 'eur_mes', 'eur_any')),
  product text check (product is null or length(product) <= 200),
  access_tariff text check (access_tariff is null or length(access_tariff) <= 20),
  template_id uuid references public.tariff_templates (id) on delete set null,
  template_name text check (template_name is null or length(template_name) <= 200),
  status text not null default 'proposada' check (status in ('proposada', 'aprovada', 'revocada')),
  source text not null default 'xat' check (source in ('xat', 'manual', 'direccio')),
  instruction text check (instruction is null or length(instruction) <= 2000),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_by_name text,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- una sola regla vigent per abast exacte (la nova substitueix l'anterior: s'hi revoca)
create unique index if not exists tariff_unit_rules_scope_uq on public.tariff_unit_rules (
  lower(trim(supplier)), energy_type, concept, coalesce(lower(product), ''), coalesce(upper(access_tariff), ''), coalesce(template_name, '')
) where status <> 'revocada';
create index if not exists tariff_unit_rules_status_idx on public.tariff_unit_rules (status);

create table if not exists public.tariff_rule_runs (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.tariff_unit_rules (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'en_curs' check (status in ('en_curs', 'completada', 'amb_errors')),
  affected integer not null default 0,
  reprocessed integer not null default 0,
  validated integer not null default 0,
  pending integer not null default 0,
  failed integer not null default 0,
  report jsonb,
  run_by uuid references auth.users (id) on delete set null,
  run_by_name text
);
create index if not exists tariff_rule_runs_rule_idx on public.tariff_rule_runs (rule_id, started_at desc);

alter table public.tariff_unit_rules enable row level security;
alter table public.tariff_rule_runs enable row level security;
