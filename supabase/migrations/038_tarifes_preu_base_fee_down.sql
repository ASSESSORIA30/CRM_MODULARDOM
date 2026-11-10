-- 038 · REVERSIÓ: treu només el que va afegir la 038 (cap taula ni relació anterior).
-- El JSON de cada tarifa (`tariff_versions.data.pricing`) i de cada comparativa (`comparisons.snapshot`) es conserva:
-- les tarifes BASE + FEE continuen tenint el preu final calculat a `data.energy`, de manera que el CRM antic les llegeix
-- com a preus fixos finals. Les instantànies de `comparison_pricing_snapshots` es perden (el snapshot de la comparativa no).
drop table if exists public.comparison_pricing_snapshots;
drop function if exists public.comparison_pricing_snapshots_guard();

drop index if exists public.fin_rules_remuneration_idx;
alter table public.fin_rules drop constraint if exists fin_rules_remuneration_model_chk;
alter table public.fin_rules drop column if exists tariff_product_id;
alter table public.fin_rules drop column if exists remuneration_model;

drop index if exists public.tariff_versions_pricing_model_idx;
alter table public.tariff_versions drop constraint if exists tariff_versions_pricing_model_chk;
alter table public.tariff_versions drop constraint if exists tariff_versions_fee_mode_chk;
alter table public.tariff_versions drop constraint if exists tariff_versions_fee_unit_chk;
alter table public.tariff_versions drop constraint if exists tariff_versions_fee_allowed_chk;
alter table public.tariff_versions drop constraint if exists tariff_versions_fee_limits_chk;
alter table public.tariff_versions drop column if exists fee_terms_source;
alter table public.tariff_versions drop column if exists fee_configuration_version;
alter table public.tariff_versions drop column if exists final_energy_prices_calculated;
alter table public.tariff_versions drop column if exists fee_allowed;
alter table public.tariff_versions drop column if exists fee_input_unit;
alter table public.tariff_versions drop column if exists contract_max_fee;
alter table public.tariff_versions drop column if exists recommended_fee;
alter table public.tariff_versions drop column if exists default_fee_values;
alter table public.tariff_versions drop column if exists default_fee_mode;
alter table public.tariff_versions drop column if exists base_energy_prices;
alter table public.tariff_versions drop column if exists pricing_model;

select '038 revertida' as comprovacio, count(*) as columnes_restants from information_schema.columns
  where table_schema = 'public' and table_name = 'tariff_versions' and column_name in ('pricing_model', 'default_fee_values');
-- Resultat esperat: 0
