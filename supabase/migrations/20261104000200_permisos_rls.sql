-- =====================================================================
-- 0200 · Funcions d'autorització i polítiques Row Level Security
-- Principi: tot denegat per defecte; cada accés s'obre explícitament.
-- Un usuari inactiu (is_active = false) perd l'accés immediatament.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Funcions auxiliars (SECURITY DEFINER per evitar recursió d'RLS)
-- ---------------------------------------------------------------------
create or replace function app.current_role()
returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
$$;

create or replace function app.is_direccio()
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_role() = 'direccio', false)
$$;

-- Rol de l'usuari actual dins d'un projecte concret (null si no hi té accés)
create or replace function app.project_role(p_project_id uuid)
returns public.project_member_role
language sql stable security definer set search_path = '' as $$
  select pm.member_role
  from public.project_members pm
  join public.profiles p on p.id = pm.profile_id
  where pm.project_id = p_project_id
    and pm.profile_id = auth.uid()
    and pm.revoked_at is null
    and p.is_active
    -- el rol de l'assignació ha de coincidir amb el rol global de l'usuari
    and p.role::text = pm.member_role::text
  limit 1
$$;

create or replace function app.has_project_access(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_direccio() or app.project_role(p_project_id) is not null
$$;

-- Clients visibles per a l'usuari actual
create or replace function app.can_see_client(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_direccio()
    -- el mateix client (usuari del portal actiu)
    or exists (
      select 1 from public.client_users cu
      join public.profiles p on p.id = cu.profile_id
      where cu.client_id = p_client_id and cu.profile_id = auth.uid()
        and p.is_active and p.role = 'client')
    -- l'arquitecte veu els titulars dels projectes assignats
    or exists (
      select 1 from public.project_holders ph
      where ph.client_id = p_client_id
        and app.project_role(ph.project_id) = 'arquitecte')
$$;

revoke all on all functions in schema app from public;
grant execute on function app.current_role(), app.is_direccio(),
  app.project_role(uuid), app.has_project_access(uuid), app.can_see_client(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Protecció contra escalada de privilegis al perfil propi
-- ---------------------------------------------------------------------
create or replace function app.guard_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Contextos de confiança: service_role (servidor), SQL directe sense JWT
  -- (migracions / SQL Editor) i direcció.
  if coalesce(auth.role(), 'service_role') = 'service_role' or app.is_direccio() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.company_id is distinct from old.company_id
     or new.email is distinct from old.email
     or new.id is distinct from old.id then
    raise exception 'Només direcció pot modificar rol, estat, empresa o email'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function app.guard_profile_update();

-- ---------------------------------------------------------------------
-- Privilegis de taula: anon no té res; authenticated passa per RLS
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------
-- RLS activat a totes les taules
-- ---------------------------------------------------------------------
alter table public.companies          enable row level security;
alter table public.profiles           enable row level security;
alter table public.clients            enable row level security;
alter table public.client_users       enable row level security;
alter table public.projects           enable row level security;
alter table public.project_holders    enable row level security;
alter table public.project_members    enable row level security;
alter table public.project_financials enable row level security;

-- companies
create policy companies_direccio_all on public.companies
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy companies_own_select on public.companies
  for select to authenticated using (
    id = (select p.company_id from public.profiles p where p.id = auth.uid() and p.is_active));

-- profiles
create policy profiles_direccio_all on public.profiles
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy profiles_self_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles
  for update to authenticated using (id = auth.uid() and is_active)
  with check (id = auth.uid());

-- clients
create policy clients_direccio_all on public.clients
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy clients_visible_select on public.clients
  for select to authenticated using (app.can_see_client(id));

-- client_users
create policy client_users_direccio_all on public.client_users
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy client_users_self_select on public.client_users
  for select to authenticated using (profile_id = auth.uid());

-- projects
create policy projects_direccio_all on public.projects
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy projects_member_select on public.projects
  for select to authenticated using (app.project_role(id) is not null);

-- project_holders
create policy project_holders_direccio_all on public.project_holders
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy project_holders_member_select on public.project_holders
  for select to authenticated using (app.project_role(project_id) in ('arquitecte', 'client'));

-- project_members
create policy project_members_direccio_all on public.project_members
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
create policy project_members_self_select on public.project_members
  for select to authenticated using (profile_id = auth.uid());

-- project_financials: NOMÉS direcció
create policy project_financials_direccio_all on public.project_financials
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());
