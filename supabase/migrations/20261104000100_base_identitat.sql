-- =====================================================================
-- 0100 · Base d'identitat i accés — MODULARDOM CRM
-- Projecte Supabase exclusiu `modulardom-crm`. No comparteix res amb
-- Assessoria 3.0.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Esquema intern per a funcions auxiliars (no exposat a l'API REST)
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tipus
-- ---------------------------------------------------------------------
create type public.app_role as enum ('direccio', 'arquitecte', 'constructor', 'client');
create type public.app_locale as enum ('ca', 'es');
create type public.project_member_role as enum ('arquitecte', 'constructor', 'client');

-- ---------------------------------------------------------------------
-- Funció genèrica updated_at
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Empreses externes (constructors). N'hi pot haver més d'una.
-- ---------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  tax_id      text,
  kind        text not null default 'constructor' check (kind in ('constructor')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger companies_touch before update on public.companies
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Perfils d'usuari (1:1 amb auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  role        public.app_role not null default 'client',
  locale      public.app_locale not null default 'ca',
  company_id  uuid references public.companies (id) on delete restrict,
  -- Un usuari nou NO té accés fins que direcció l'activa.
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint constructor_needs_company
    check (role <> 'constructor' or company_id is not null)
);
create index profiles_role_idx on public.profiles (role);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- Crea el perfil automàticament quan es crea l'usuari d'Auth.
-- El rol només es llegeix d'app_metadata (no modificable per l'usuari).
create or replace function app.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role;
begin
  begin
    v_role := coalesce((new.raw_app_meta_data ->> 'role')::public.app_role, 'client');
  exception when invalid_text_representation then
    v_role := 'client';
  end;
  insert into public.profiles (id, email, full_name, role, locale, is_active)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    -- constructor requereix empresa: es crea com a client inactiu i direcció l'ajusta
    case when v_role = 'constructor' then 'client' else v_role end,
    case when new.raw_user_meta_data ->> 'locale' = 'es' then 'es'::public.app_locale
         else 'ca'::public.app_locale end,
    false
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Clients (persones o empreses). Un client pot tenir diversos projectes.
-- ---------------------------------------------------------------------
create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'persona' check (kind in ('persona', 'empresa')),
  display_name    text not null check (length(trim(display_name)) > 0),
  tax_id          text,                      -- NIF / NIE / CIF
  email           text,
  phone           text,
  address         text,
  locale          public.app_locale not null default 'ca',
  notes           text,
  lead_source     text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index clients_tax_id_uq on public.clients (upper(tax_id)) where tax_id is not null;
create index clients_email_idx on public.clients (lower(email));
create trigger clients_touch before update on public.clients
  for each row execute function app.touch_updated_at();

-- Vincle usuari del portal ↔ fitxa de client (activat per direcció)
create table public.client_users (
  client_id   uuid not null references public.clients (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (client_id, profile_id)
);

-- ---------------------------------------------------------------------
-- Projectes / habitatges
-- ---------------------------------------------------------------------
create table public.projects (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  title             text not null,
  municipality      text,
  plot_address      text,
  cadastral_ref     text,
  status            text not null default 'lead'
                    check (status in ('lead','pressupost','avantprojecte','contractat',
                                      'projecte_llicencia','en_obra','finalitzat','perdut')),
  surface_m2        numeric(10,2) check (surface_m2 is null or surface_m2 > 0),
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger projects_touch before update on public.projects
  for each row execute function app.touch_updated_at();

-- Titulars del projecte (dos o més titulars possibles)
create table public.project_holders (
  project_id  uuid not null references public.projects (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete restrict,
  is_primary  boolean not null default false,
  primary key (project_id, client_id)
);
create unique index project_holders_one_primary
  on public.project_holders (project_id) where is_primary;

-- Assignacions d'usuaris als projectes (arquitecte, constructor, client)
create table public.project_members (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  member_role  public.project_member_role not null,
  granted_by   uuid references public.profiles (id) on delete set null,
  granted_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  constraint revoked_after_granted check (revoked_at is null or revoked_at >= granted_at)
);
create unique index project_members_active_uq
  on public.project_members (project_id, profile_id) where revoked_at is null;
create index project_members_profile_idx on public.project_members (profile_id) where revoked_at is null;

-- ---------------------------------------------------------------------
-- Dades econòmiques sensibles: taula separada, només direcció.
-- (Les fases 2 i 4 hi afegiran pressupostos, costos i marges.)
-- Imports en cèntims enters.
-- ---------------------------------------------------------------------
create table public.project_financials (
  project_id              uuid primary key references public.projects (id) on delete cascade,
  estimated_sale_cents    bigint check (estimated_sale_cents is null or estimated_sale_cents >= 0),
  estimated_cost_cents    bigint check (estimated_cost_cents is null or estimated_cost_cents >= 0),
  updated_at              timestamptz not null default now()
);
create trigger project_financials_touch before update on public.project_financials
  for each row execute function app.touch_updated_at();
