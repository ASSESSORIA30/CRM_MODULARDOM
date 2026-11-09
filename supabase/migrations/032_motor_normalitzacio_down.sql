-- DESFÀ la 032 (només si cal tornar enrere). No esborra cap regla: si n'hi ha de tipus «per_kw», s'atura.
do $$
begin
  if exists (select 1 from public.fin_rules where kind = 'per_kw') then
    raise exception 'Hi ha regles de tipus per_kw: retira-les o canvia-les abans de desfer la 032';
  end if;
  alter table public.fin_rules drop constraint if exists fin_rules_kind_v4;
  alter table public.fin_rules drop constraint if exists fin_rules_unit_v4;
  alter table public.fin_rules drop constraint if exists fin_rules_unit_list_v2;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_unit_check') then
    alter table public.fin_rules add constraint fin_rules_unit_check check (unit in ('eur', 'eur_mwh', 'pct'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_kind_v3') then
    alter table public.fin_rules add constraint fin_rules_kind_v3 check (kind in ('fix_contracte', 'per_mwh', 'energia_potencia', 'pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'trams_volum', 'bonificacio', 'regularitzacio', 'retrocessio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_unit_v3') then
    alter table public.fin_rules add constraint fin_rules_unit_v3 check (unit = case when kind in ('pct_marge', 'pct_increment_preu', 'pct_comissio_rebuda', 'pct_energia', 'pct_potencia', 'retrocessio') then 'pct' when kind in ('per_mwh', 'energia_potencia') then 'eur_mwh' else 'eur' end);
  end if;
end $$;
select 'desfet' as estat;
