-- 035 · REVERSIÓ: retorna la permanència anterior a les versions corregides (només les no usades en propostes).
update public.tariff_versions v
   set data = case when l.previous_permanence is null then v.data - 'permanence' else jsonb_set(v.data, '{permanence}', l.previous_permanence) end
  from public.tariff_permanence_fix_log l
 where v.id = l.version_id and v.used_at is null;
drop table if exists public.tariff_permanence_fix_log;
