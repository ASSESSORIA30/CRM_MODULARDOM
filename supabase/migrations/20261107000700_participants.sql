-- =====================================================================
-- 0700 · Noms dels participants d'un projecte
-- L'arquitecte i el client no poden llegir la taula de perfils (només el seu).
-- Aquesta funció retorna NOMÉS nom i rol (mai email ni altres dades) de les
-- persones que participen en un projecte al qual l'usuari té accés.
-- =====================================================================
create or replace function public.project_people(p_project_id uuid)
returns table (id uuid, full_name text, role public.app_role)
language sql stable security definer set search_path = '' as $$
  select p.id, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)), p.role
  from public.profiles p
  where (app.is_staff(p_project_id) or app.is_project_client(p_project_id))
    and p.id in (
      select pm.profile_id from public.project_members pm where pm.project_id = p_project_id
      union
      select d.id from public.profiles d where d.role = 'direccio'
    )
$$;
revoke all on function public.project_people(uuid) from public, anon;
grant execute on function public.project_people(uuid) to authenticated, service_role;
