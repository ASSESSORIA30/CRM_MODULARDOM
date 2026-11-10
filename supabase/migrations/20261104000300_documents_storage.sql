-- =====================================================================
-- 0300 · Documents i Supabase Storage privat
-- Tots els buckets són PRIVATS. Els fitxers es serveixen només amb URLs
-- signades de curta durada generades al servidor.
--
-- Convenció de rutes dins de cada bucket:
--   p/<project_id>/<uuid>-<nom-fitxer>   documents d'un projecte
--   c/<client_id>/<uuid>-<nom-fitxer>    documents d'un client (p. ex. DNI)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('contractes',   'contractes',   false, 26214400,
     array['application/pdf',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'image/jpeg','image/png']),
  ('pressupostos', 'pressupostos', false, 26214400,
     array['application/pdf',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('factures',     'factures',     false, 26214400,
     array['application/pdf','image/jpeg','image/png']),
  ('planols',      'planols',      false, 104857600,
     array['application/pdf','image/vnd.dwg','application/acad','application/x-dwg',
           'image/vnd.dxf','application/dxf','image/jpeg','image/png']),
  ('fotografies',  'fotografies',  false, 20971520,
     array['image/jpeg','image/png','image/webp','image/heic','image/heif']),
  ('documents',    'documents',    false, 26214400,
     array['application/pdf','image/jpeg','image/png',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- Metadades de documents (versionat, estat i visibilitat per rol)
-- ---------------------------------------------------------------------
create table public.documents (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid references public.projects (id) on delete restrict,
  client_id              uuid references public.clients (id) on delete restrict,
  bucket_id              text not null check (bucket_id in
                           ('contractes','pressupostos','factures','planols','fotografies','documents')),
  storage_path           text not null,
  category               text not null check (category in (
                           'identificacio','pressupost','contracte','annex','avantprojecte',
                           'projecte_tecnic','visat','llicencia','planol','memoria','factura',
                           'justificant_pagament','certificacio','extra','fotografia',
                           'acta_entrega','altres')),
  title                  text not null,
  mime_type              text,
  size_bytes             bigint check (size_bytes is null or size_bytes >= 0),
  version                integer not null default 1 check (version >= 1),
  previous_version_id    uuid references public.documents (id) on delete restrict,
  status                 text not null default 'pendent_revisio'
                           check (status in ('pendent_revisio','vigent','substituit','arxivat')),
  uploaded_by            uuid references public.profiles (id) on delete set null,
  -- Visibilitat: privat per defecte; només direcció l'obre.
  visible_to_architect   boolean not null default false,
  visible_to_constructor boolean not null default false,
  published_to_client    boolean not null default false,
  published_by           uuid references public.profiles (id) on delete set null,
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint documents_owner check (project_id is not null or client_id is not null),
  constraint documents_path_uq unique (bucket_id, storage_path),
  constraint documents_path_matches_owner check (
    (project_id is not null and storage_path like 'p/' || project_id::text || '/%')
    or (project_id is null and storage_path like 'c/' || client_id::text || '/%'))
);
create index documents_project_idx on public.documents (project_id);
create index documents_client_idx on public.documents (client_id);
create trigger documents_touch before update on public.documents
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Regles de lectura de documents
-- ---------------------------------------------------------------------
create or replace function app.can_read_document(p_document_id uuid)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  d       public.documents%rowtype;
  v_prole public.project_member_role;
begin
  if app.is_direccio() then
    return true;
  end if;

  select * into d from public.documents where id = p_document_id;
  if not found then
    return false;
  end if;

  -- Documents de client sense projecte: només el mateix client, si està publicat
  if d.project_id is null then
    return d.published_to_client and exists (
      select 1 from public.client_users cu
      join public.profiles p on p.id = cu.profile_id
      where cu.client_id = d.client_id and cu.profile_id = auth.uid()
        and p.is_active and p.role = 'client');
  end if;

  v_prole := app.project_role(d.project_id);
  if v_prole is null then
    return false;                         -- no assignat o inactiu
  end if;

  -- Bloquejos durs per bucket, independents de les marques de visibilitat
  if d.bucket_id = 'factures' and v_prole <> 'client' then
    return false;                         -- facturació: mai per a arquitecte/constructor
  end if;
  if d.bucket_id in ('contractes', 'pressupostos') and v_prole = 'constructor' then
    return false;                         -- informació comercial: mai per al constructor
  end if;

  if d.uploaded_by = auth.uid() then
    return true;                          -- qui l'ha pujat el pot veure
  end if;

  return case v_prole
    when 'arquitecte'  then d.visible_to_architect
    when 'constructor' then d.visible_to_constructor
    when 'client'      then d.published_to_client and d.status = 'vigent'
  end;
end $$;

-- Extreu el project_id d'una ruta p/<uuid>/... (null si el format no és vàlid)
create or replace function app.path_project_id(p_name text)
returns uuid
language plpgsql immutable set search_path = '' as $$
declare
  parts text[] := string_to_array(p_name, '/');
begin
  if array_length(parts, 1) < 3 or parts[1] <> 'p' then
    return null;
  end if;
  return parts[2]::uuid;
exception when invalid_text_representation then
  return null;
end $$;

-- Buckets on cada rol extern pot pujar fitxers
create or replace function app.can_upload_to(p_bucket text, p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.project_role(app.path_project_id(p_name))
    when 'arquitecte'  then p_bucket in ('planols', 'fotografies', 'documents')
    when 'constructor' then p_bucket in ('fotografies', 'documents')
    else false
  end
$$;

revoke all on function app.can_read_document(uuid), app.path_project_id(text),
  app.can_upload_to(text, text) from public;
grant execute on function app.can_read_document(uuid), app.path_project_id(text),
  app.can_upload_to(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- RLS de la taula documents
-- ---------------------------------------------------------------------
alter table public.documents enable row level security;
grant select, insert, update, delete on public.documents to authenticated;
grant all on public.documents to service_role;
revoke all on public.documents from anon;

create policy documents_direccio_all on public.documents
  for all to authenticated using (app.is_direccio()) with check (app.is_direccio());

create policy documents_read on public.documents
  for select to authenticated using (app.can_read_document(id));

-- Arquitecte i constructor poden registrar els seus fitxers, sempre
-- privats i pendents de revisió (direcció decideix què es publica).
create policy documents_external_insert on public.documents
  for insert to authenticated with check (
    project_id is not null
    and uploaded_by = auth.uid()
    and status = 'pendent_revisio'
    and not visible_to_architect
    and not visible_to_constructor
    and not published_to_client
    and published_by is null
    and app.can_upload_to(bucket_id, storage_path));
-- (sense polítiques UPDATE/DELETE per a externs: només direcció)

-- ---------------------------------------------------------------------
-- RLS de storage.objects
-- ---------------------------------------------------------------------
create policy "modulardom: direccio gestiona tots els fitxers"
  on storage.objects for all to authenticated
  using (bucket_id in ('contractes','pressupostos','factures','planols','fotografies','documents')
         and app.is_direccio())
  with check (bucket_id in ('contractes','pressupostos','factures','planols','fotografies','documents')
              and app.is_direccio());

create policy "modulardom: lectura segons document autoritzat"
  on storage.objects for select to authenticated
  using (exists (
    select 1 from public.documents d
    where d.bucket_id = storage.objects.bucket_id
      and d.storage_path = storage.objects.name
      and app.can_read_document(d.id)));

create policy "modulardom: pujada per arquitecte i constructor assignats"
  on storage.objects for insert to authenticated
  with check (app.can_upload_to(bucket_id, name));
