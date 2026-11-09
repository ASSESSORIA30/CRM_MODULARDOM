-- =====================================================================================================
-- 032 · MOTOR ÚNIC DE NORMALITZACIÓ I VALIDACIÓ DE TARIFES · comissió per potència (€/kW)
-- =====================================================================================================
-- Additiva i idempotent. NO esborra cap taula, relació ni dada. Reversible amb 032_motor_normalitzacio_down.sql.
--   · Nou tipus de regla de comissió «per_kw» (€/kW sobre la potència que indica el document: suma de períodes,
--     P1 o la màxima, desada a conditions.power_basis). Sense base declarada, el CRM no calcula (pendent de configuració).
--   · Es substitueixen NOMÉS les restriccions de llista de tipus i d'unitat de fin_rules (v3 → v4), ampliades.
--   · Les tarifes del catàleg (tariff_versions.data, jsonb) no necessiten cap columna nova: les unitats originals i
--     les conversions ja hi viuen (data.units). El reprocessament crea versions noves en esborrany.
-- =====================================================================================================

do $$
declare c record;
begin
  -- la llista simple d'unitats de la 011 («unit in ('eur', 'eur_mwh', 'pct')») s'amplia amb 'eur_kw'
  for c in select conname from pg_constraint where conrelid = 'public.fin_rules'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%eur_mwh%' and pg_get_constraintdef(oid) not like '%kind%' and conname <> 'fin_rules_unit_list_v2' loop
    execute format('alter table public.fin_rules drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_unit_list_v2') then
    alter table public.fin_rules add constraint fin_rules_unit_list_v2 check (unit in ('eur', 'eur_mwh', 'eur_kw', 'pct'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_kind_v4') then
    alter table public.fin_rules drop constraint if exists fin_rules_kind_v3;
    alter table public.fin_rules add constraint fin_rules_kind_v4 check (kind in ('fix_contracte', 'per_mwh', 'per_kw', 'energia_potencia', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'trams_volum', 'bonificacio', 'regularitzacio', 'retrocessio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_unit_v4') then
    alter table public.fin_rules drop constraint if exists fin_rules_unit_v3;
    alter table public.fin_rules add constraint fin_rules_unit_v4 check (unit = case when kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'retrocessio') then 'pct' when kind in ('per_mwh', 'energia_potencia') then 'eur_mwh' when kind = 'per_kw' then 'eur_kw' else 'eur' end);
  end if;
end $$;

comment on column public.fin_rules.conditions is 'Condicions de la regla. power_basis (per_kw / energia_potencia): suma_kw_periodes | kw_p1 | kw_max. Sense base declarada, la comissió de potència no es calcula.';

-- comprovació: les tres restriccions noves han d'existir (resultat esperat: 3)
select count(*) as restriccions_032 from pg_constraint where conname in ('fin_rules_kind_v4', 'fin_rules_unit_v4', 'fin_rules_unit_list_v2');
