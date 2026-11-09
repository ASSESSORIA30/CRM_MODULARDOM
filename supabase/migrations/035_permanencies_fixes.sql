-- =====================================================================================================================
-- 035 · Correcció de permanències del catàleg (regla comercial interna: fixes 3.0TD i 6.1TD amb permanència)
--
-- Què fa: a les versions de tarifa d'ELECTRICITAT, de preu fix (fix24h o periodes) i 3.0TD/6.1TD (o les tarifes que
-- Direcció hagi configurat a la regla «permanencia»), que NO tenen cap dada de permanència ni excepció, posa
--   data.permanence = { status: "amb", months: <els que ja constaven o null>, source: "Regla comercial interna…" }
-- Què NO fa:
--   · No toca preus, potències, marges, comissions, descomptes, vigència ni cap altra condició.
--   · No inventa durada ni penalització (months queda null si no constava).
--   · No canvia les que diuen expressament «sense permanència»: queden pendents de revisió administrativa (el CRM ho avisa).
--   · No toca les versions usades en propostes emeses (són immutables); el CRM ja les mostra amb la regla.
--   · No toca 2.0TD, gas, indexades ni mixtes.
-- Idempotent. Còpia de seguretat de cada valor anterior a public.tariff_permanence_fix_log (per poder-ho desfer).
-- =====================================================================================================================

create table if not exists public.tariff_permanence_fix_log (
  version_id uuid primary key references public.tariff_versions (id) on delete cascade,
  previous_permanence jsonb,
  previous_months jsonb,
  fixed_at timestamptz not null default now()
);
alter table public.tariff_permanence_fix_log enable row level security;  -- sense polítiques: només servidor/SQL

do $$
declare
  v_rule jsonb := coalesce((select value from public.sec_settings where key = 'permanencia'), '{"enabled": true, "tariffs": ["3.0TD", "6.1TD"], "contractTypes": ["fix24h", "periodes"]}'::jsonb);
  v_src constant text := 'Regla comercial interna d''Assessoria 3.0: tarifa fixa 3.0TD/6.1TD amb permanència (durada i penalització segons les condicions de la comercialitzadora)';
  v_n integer;
begin
  if coalesce((v_rule->>'enabled')::boolean, true) is not true then
    raise notice 'Regla de permanència desactivada: no es corregeix res';
    return;
  end if;

  with tariffs as (
    select upper(regexp_replace(t, '\s', '', 'g')) as t
      from jsonb_array_elements_text(coalesce(v_rule->'tariffs', '["3.0TD","6.1TD"]'::jsonb)) t
  ), ctypes as (
    select jsonb_array_elements_text(coalesce(v_rule->'contractTypes', '["fix24h","periodes"]'::jsonb)) as c
  ), target as (
    select v.id, v.data
      from public.tariff_versions v
     where v.used_at is null
       and v.status in ('activa', 'esborrany')
       and v.data->>'energyType' = 'luz'
       and v.data->>'contractType' in (select c from ctypes)
       -- mateixa normalització que el CRM: «3.0 TD», «3,0TD», «3.0» → 3.0TD
       and (select regexp_replace(upper(regexp_replace(coalesce(v.data->>'accessTariff', ''), '\s', '', 'g')), '^.*?([236])[.,]?([0-4]).*$', '\1.\2TD')) in (select t from tariffs)
       -- cap dada de permanència: ni detall, ni mesos, ni excepció
       and coalesce(v.data->'permanence'->>'status', 'no_informada') = 'no_informada'
       and coalesce(nullif(v.data->'permanence'->>'exception', ''), '') = ''
       and coalesce((v.data->>'permanenceMonths')::numeric, 0) <= 0
  ), logged as (
    insert into public.tariff_permanence_fix_log (version_id, previous_permanence, previous_months)
    select id, data->'permanence', data->'permanenceMonths' from target
    on conflict (version_id) do nothing
    returning version_id
  )
  update public.tariff_versions v
     set data = jsonb_set(v.data, '{permanence}', jsonb_build_object(
           'status', 'amb', 'months', null, 'startNote', null, 'cancellation', null,
           'penalty', v.data->'penalty', 'source', v_src, 'exception', null))
    from target t
   where v.id = t.id;
  get diagnostics v_n = row_count;
  raise notice 'Versions corregides: %', v_n;
end $$;
