-- =====================================================================
-- 0600 · Avantprojecte col·laboratiu: espai documental compartit, versions,
-- tres rondes de modificacions, punts, anotacions sobre plànols,
-- fotografies d'inspiració, comentaris i publicació validada per direcció.
-- Reutilitza projectes, perfils, documents, tasques i notificacions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Storage: bucket privat de l'espai d'avantprojecte
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avantprojecte', 'avantprojecte', false, 52428800,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'image/vnd.dwg', 'application/acad', 'application/x-dwg',
         'image/vnd.dxf', 'application/dxf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Direcció gestiona també el nou bucket
drop policy "modulardom: direccio gestiona tots els fitxers" on storage.objects;
create policy "modulardom: direccio gestiona tots els fitxers"
  on storage.objects for all to authenticated
  using (bucket_id in ('contractes','pressupostos','factures','planols','fotografies','documents','avantprojecte')
         and app.is_direccio())
  with check (bucket_id in ('contractes','pressupostos','factures','planols','fotografies','documents','avantprojecte')
              and app.is_direccio());

-- Configuració de tipus i mides permesos (editable per direcció)
create table public.upload_rules (
  bucket_id   text not null,
  extension   text not null check (extension ~ '^[a-z0-9]{2,5}$'),
  mime_type   text not null,
  max_bytes   bigint not null check (max_bytes > 0),
  previewable boolean not null default false,
  primary key (bucket_id, extension)
);
insert into public.upload_rules (bucket_id, extension, mime_type, max_bytes, previewable) values
  ('avantprojecte', 'pdf',  'application/pdf', 52428800, true),
  ('avantprojecte', 'jpg',  'image/jpeg',      20971520, true),
  ('avantprojecte', 'jpeg', 'image/jpeg',      20971520, true),
  ('avantprojecte', 'png',  'image/png',       20971520, true),
  ('avantprojecte', 'webp', 'image/webp',      20971520, true),
  ('avantprojecte', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 26214400, false),
  ('avantprojecte', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 26214400, false),
  ('avantprojecte', 'dwg',  'image/vnd.dwg',   52428800, false),
  ('avantprojecte', 'dxf',  'image/vnd.dxf',   52428800, false);

-- ---------------------------------------------------------------------
-- Documents: noves categories, visibilitat del mòdul, versions i vincles
-- ---------------------------------------------------------------------
alter table public.documents drop constraint documents_bucket_id_check;
alter table public.documents add constraint documents_bucket_id_check check (bucket_id in
  ('contractes','pressupostos','factures','planols','fotografies','documents','avantprojecte'));

alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check check (category in (
  'identificacio','pressupost','contracte','annex','avantprojecte','projecte_tecnic','visat','llicencia',
  'planol','memoria','factura','justificant_pagament','certificacio','extra','fotografia','acta_entrega','altres',
  'inspiracio','distribucio_interior','facanes','instal_lacions','observacions'));

alter table public.documents
  add column group_id      uuid,
  -- intern: arquitecte + direcció · revisio: pendent que direcció la publiqui
  -- publicat: també el client · compartit: pujat pel client (client, arquitecte i direcció)
  add column visibility    text not null default 'intern'
                           check (visibility in ('intern', 'revisio', 'publicat', 'compartit')),
  add column description   text,
  add column room_tag      text check (room_tag in
                           ('cuina','banys','habitacions','sala_estar','facana','jardi','instal_lacions','altres')),
  add column approved_at   timestamptz,
  add column approved_by   uuid references public.profiles (id) on delete set null,
  add column sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$');
update public.documents set group_id = id where group_id is null;
create index documents_group_idx on public.documents (group_id, version desc);

-- ---------------------------------------------------------------------
-- Rondes de modificacions
-- ---------------------------------------------------------------------
alter table public.projects add column revision_rounds_base integer not null default 3
  check (revision_rounds_base between 0 and 20);

create table public.revision_round_grants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  reason      text not null check (length(trim(reason)) > 0),
  granted_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.revision_drafts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects (id) on delete cascade,
  status          text not null default 'esborrany' check (status in ('esborrany', 'enviat', 'descartat')),
  original_text   text,
  ai_extraction   jsonb,
  ai_model        text,
  ai_runs         integer not null default 0,
  ai_analyzed_at  timestamptz,
  created_by      uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index revision_drafts_one_open on public.revision_drafts (project_id) where status = 'esborrany';
create trigger revision_drafts_touch before update on public.revision_drafts
  for each row execute function app.touch_updated_at();

create table public.revision_rounds (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  number           integer not null check (number >= 1),
  is_exception     boolean not null default false,
  draft_id         uuid not null unique references public.revision_drafts (id) on delete restrict,
  idempotency_key  uuid not null unique,
  original_text    text,
  ai_extraction    jsonb,
  confirmed_items  jsonb not null,
  status           text not null default 'oberta' check (status in ('oberta', 'tancada')),
  submitted_by     uuid references public.profiles (id) on delete set null,
  submitted_at     timestamptz not null default now(),
  closed_by        uuid references public.profiles (id) on delete set null,
  closed_at        timestamptz,
  unique (project_id, number)
);

alter table public.documents
  add column round_id uuid references public.revision_rounds (id) on delete set null;

-- ---------------------------------------------------------------------
-- Punts de modificació
-- ---------------------------------------------------------------------
create table public.revision_items (
  id                          uuid primary key default gen_random_uuid(),
  project_id                  uuid not null references public.projects (id) on delete cascade,
  draft_id                    uuid references public.revision_drafts (id) on delete cascade,
  round_id                    uuid references public.revision_rounds (id) on delete restrict,
  position                    integer not null default 0,
  title                       text not null check (length(trim(title)) > 0),
  description                 text not null default '',
  room                        text,
  source_excerpt              text,          -- fragment literal del client que l'origina
  needs_clarification         boolean not null default false,
  ai_notes                    text,          -- ambigüitats detectades (mai decisions)
  status                      text not null default 'pendent' check (status in (
                                'pendent','en_estudi','necessita_aclariment','viable','viable_amb_modificacions',
                                'no_viable','incorporat','descartat')),
  architect_id                uuid references public.profiles (id) on delete set null,
  assessment                  text,
  alternative                 text,
  alternative_status          text not null default 'cap'
                              check (alternative_status in ('cap','proposada','acceptada','rebutjada','aclariment')),
  requires_economic_valuation boolean not null default false,
  economic_decision           text check (economic_decision in ('pendent','pressupostar','sense_cost')),
  extra_ref                   uuid,          -- vincle amb el mòdul d'extres (FASE 4)
  client_reviewed_at          timestamptz,
  client_reviewed_by          uuid references public.profiles (id) on delete set null,
  created_by                  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint items_owner check (draft_id is not null or round_id is not null)
);
create index revision_items_round_idx on public.revision_items (round_id, position);
create index revision_items_draft_idx on public.revision_items (draft_id, position);
create trigger revision_items_touch before update on public.revision_items
  for each row execute function app.touch_updated_at();

alter table public.documents
  add column revision_item_id uuid references public.revision_items (id) on delete set null;
alter table public.tasks
  add column revision_item_id uuid references public.revision_items (id) on delete cascade;
create unique index tasks_one_per_item on public.tasks (revision_item_id) where revision_item_id is not null;

-- Historial visible per als participants (l'auditoria completa és només de direcció)
create table public.revision_item_events (
  id          bigint generated always as identity primary key,
  item_id     uuid not null references public.revision_items (id) on delete cascade,
  kind        text not null,
  from_value  text,
  to_value    text,
  note        text,
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index revision_item_events_item_idx on public.revision_item_events (item_id, created_at);

-- Confirmacions del client (amb data i identitat)
create table public.revision_confirmations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  item_id     uuid references public.revision_items (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  kind        text not null check (kind in ('punt_revisat','alternativa_acceptada','alternativa_rebutjada',
                                            'aclariment_demanat','versio_revisada','avantprojecte_aprovat')),
  note        text,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint confirmation_target check (item_id is not null or document_id is not null)
);

-- Relació de punts per a cada nova versió de l'avantprojecte
create table public.version_item_resolutions (
  document_id uuid not null references public.documents (id) on delete cascade,
  item_id     uuid not null references public.revision_items (id) on delete cascade,
  resolution  text not null check (resolution in ('incorporat','parcial','pendent','rebutjat','alternativa')),
  note        text,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (document_id, item_id)
);

-- ---------------------------------------------------------------------
-- Anotacions sobre plànols (coordenades normalitzades 0..1, versió exacta)
-- ---------------------------------------------------------------------
create table public.plan_annotations (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects (id) on delete cascade,
  document_id        uuid not null references public.documents (id) on delete restrict,
  page               integer not null default 1 check (page >= 1),
  kind               text not null check (kind in ('punt', 'rectangle')),
  x                  numeric(9,8) not null check (x between 0 and 1),
  y                  numeric(9,8) not null check (y between 0 and 1),
  w                  numeric(9,8) check (w > 0 and w <= 1),
  h                  numeric(9,8) check (h > 0 and h <= 1),
  body               text not null default '',
  visibility         text not null default 'compartit' check (visibility in ('compartit', 'intern')),
  status             text not null default 'obert' check (status in ('obert', 'resolt')),
  parent_id          uuid references public.plan_annotations (id) on delete cascade,  -- resposta de l'arquitecte
  draft_id           uuid references public.revision_drafts (id) on delete set null,
  round_id           uuid references public.revision_rounds (id) on delete restrict,
  item_id            uuid references public.revision_items (id) on delete set null,
  author_id          uuid references public.profiles (id) on delete set null default auth.uid(),
  author_role        public.app_role,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint annotation_shape check (
    (kind = 'punt' and w is null and h is null)
    or (kind = 'rectangle' and w is not null and h is not null and x + w <= 1.00000001 and y + h <= 1.00000001))
);
create index plan_annotations_doc_idx on public.plan_annotations (document_id, page);
create index plan_annotations_item_idx on public.plan_annotations (item_id);
create trigger plan_annotations_touch before update on public.plan_annotations
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- Comentaris (per document, punt o marcador), mencions i adjunts vinculats
-- ---------------------------------------------------------------------
create table public.comments (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  document_id    uuid references public.documents (id) on delete cascade,
  item_id        uuid references public.revision_items (id) on delete cascade,
  annotation_id  uuid references public.plan_annotations (id) on delete cascade,
  parent_id      uuid references public.comments (id) on delete cascade,
  body           text not null check (length(trim(body)) > 0),
  visibility     text not null default 'compartit' check (visibility in ('compartit', 'intern')),
  resolved_at    timestamptz,
  resolved_by    uuid references public.profiles (id) on delete set null,
  author_id      uuid references public.profiles (id) on delete set null default auth.uid(),
  author_role    public.app_role,
  created_at     timestamptz not null default now(),
  edited_at      timestamptz,
  constraint comment_target check (num_nonnulls(document_id, item_id, annotation_id) >= 1)
);
create index comments_document_idx on public.comments (document_id, created_at);
create index comments_item_idx on public.comments (item_id, created_at);
create index comments_annotation_idx on public.comments (annotation_id, created_at);

create table public.comment_mentions (
  comment_id  uuid not null references public.comments (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (comment_id, profile_id)
);

-- Un fitxer pot vincular-se a diversos punts / marcadors / comentaris sense duplicar-lo
create table public.document_links (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  document_id    uuid not null references public.documents (id) on delete cascade,
  item_id        uuid references public.revision_items (id) on delete cascade,
  annotation_id  uuid references public.plan_annotations (id) on delete cascade,
  comment_id     uuid references public.comments (id) on delete cascade,
  description    text,
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint link_target check (num_nonnulls(item_id, annotation_id, comment_id) = 1)
);
create unique index document_links_uq on public.document_links
  (document_id, coalesce(item_id, annotation_id, comment_id));

-- =====================================================================
-- Funcions d'autorització del mòdul
-- =====================================================================
-- IMPORTANT: retornen sempre true/false (mai NULL). Un NULL dins d'un `if not (...)`
-- de PL/pgSQL no llança l'excepció i deixaria passar l'operació.
create or replace function app.is_staff(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.is_direccio() or coalesce(app.project_role(p_project_id) = 'arquitecte', false)
$$;

create or replace function app.is_project_client(p_project_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(app.project_role(p_project_id) = 'client', false)
$$;

-- Correcció de seguretat de la migració 0500: amb un usuari sense rol al projecte,
-- la condició avaluava a NULL i no bloquejava la modificació dels passos tècnics.
create or replace function public.set_project_step(p_project_id uuid, p_step smallint, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_stage text;
begin
  if not coalesce(app.is_direccio()
          or (app.project_role(p_project_id) = 'arquitecte' and p_step in (5, 7, 8, 9, 10)), false) then
    raise exception 'No tens permís per modificar aquest pas' using errcode = '42501';
  end if;
  if p_status not in ('pendent', 'fet', 'no_aplica') then
    raise exception 'Estat de pas no vàlid' using errcode = '22023';
  end if;
  select status into v_stage from public.projects where id = p_project_id;
  if p_status <> 'fet' and exists (
       select 1 from public.pipeline_stage_requirements
        where stage = v_stage and step = p_step) then
    raise exception 'El pas % és obligatori per a l''etapa actual i no es pot desmarcar', p_step
      using errcode = 'P0001', hint = 'step_required';
  end if;
  update public.project_steps
     set status = p_status,
         done_at = case when p_status = 'fet' then coalesce(done_at, now()) else null end,
         done_by = case when p_status = 'fet' then coalesce(done_by, auth.uid()) else null end,
         notes = coalesce(p_notes, notes)
   where project_id = p_project_id and step = p_step;
  if not found then
    raise exception 'Pas inexistent' using errcode = 'P0002';
  end if;
  update public.projects set last_activity_at = now() where id = p_project_id;
end $$;

-- Regles de lectura de documents: branca específica per al bucket d'avantprojecte
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

  if d.bucket_id = 'avantprojecte' then
    v_prole := app.project_role(d.project_id);
    return case v_prole
      when 'arquitecte' then true
      when 'client' then d.status <> 'arxivat' and d.visibility in ('publicat', 'compartit')
      else false
    end;
  end if;

  if d.project_id is null then
    return d.published_to_client and exists (
      select 1 from public.client_users cu
      join public.profiles p on p.id = cu.profile_id
      where cu.client_id = d.client_id and cu.profile_id = auth.uid()
        and p.is_active and p.role = 'client');
  end if;

  v_prole := app.project_role(d.project_id);
  if v_prole is null then
    return false;
  end if;
  if d.bucket_id = 'factures' and v_prole <> 'client' then
    return false;
  end if;
  if d.bucket_id in ('contractes', 'pressupostos') and v_prole = 'constructor' then
    return false;
  end if;
  if d.uploaded_by = auth.uid() then
    return true;
  end if;
  return case v_prole
    when 'arquitecte'  then d.visible_to_architect
    when 'constructor' then d.visible_to_constructor
    when 'client'      then d.published_to_client and d.status = 'vigent'
  end;
end $$;

create or replace function app.can_upload_to(p_bucket text, p_name text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.project_role(app.path_project_id(p_name))
    when 'arquitecte'  then p_bucket in ('planols', 'fotografies', 'documents', 'avantprojecte')
    when 'constructor' then p_bucket in ('fotografies', 'documents')
    when 'client'      then p_bucket = 'avantprojecte'
    else false
  end
$$;

create or replace function app.item_visible(p_item_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.revision_items i
    left join public.revision_drafts dr on dr.id = i.draft_id
    where i.id = p_item_id
      and (app.is_staff(i.project_id)
           or (app.is_project_client(i.project_id)
               and (i.round_id is not null or dr.status = 'esborrany'))))
$$;

create or replace function app.annotation_visible(p_annotation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.plan_annotations a
    where a.id = p_annotation_id
      and (app.is_staff(a.project_id)
           or (app.is_project_client(a.project_id) and a.visibility = 'compartit'
               and app.can_read_document(a.document_id))))
$$;

create or replace function app.comment_visible(p_comment_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.comments c
    where c.id = p_comment_id
      and (app.is_staff(c.project_id)
           or (app.is_project_client(c.project_id) and c.visibility = 'compartit'
               and (c.document_id is null or app.can_read_document(c.document_id))
               and (c.item_id is null or app.item_visible(c.item_id))
               and (c.annotation_id is null or app.annotation_visible(c.annotation_id)))))
$$;

-- Participants d'un projecte per rol (per a notificacions)
create or replace function app.project_participants(p_project_id uuid, p_roles text[])
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
  where p.is_active and p.role = 'direccio' and 'direccio' = any (p_roles)
  union
  select pm.profile_id from public.project_members pm
  join public.profiles p on p.id = pm.profile_id and p.is_active and p.role::text = pm.member_role::text
  where pm.project_id = p_project_id and pm.revoked_at is null and pm.member_role::text = any (p_roles)
$$;

create or replace function app.notify_project(p_project_id uuid, p_roles text[], p_kind text, p_title text,
                                              p_link text, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare r uuid;
begin
  for r in select * from app.project_participants(p_project_id, p_roles) loop
    if r is distinct from auth.uid() then
      perform app.notify(r, p_kind, p_title, null, p_link, p_dedupe);
    end if;
  end loop;
end $$;

-- =====================================================================
-- Documents: proteccions de visibilitat i immutabilitat
-- =====================================================================
create or replace function app.guard_document_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_trusted boolean := coalesce(auth.role(), 'service_role') = 'service_role' or app.is_direccio();
begin
  if tg_op = 'INSERT' then
    if new.group_id is null then
      new.group_id := coalesce((select group_id from public.documents where id = new.previous_version_id), new.id);
    end if;
    if new.bucket_id = 'avantprojecte' and not v_trusted then
      if app.project_role(new.project_id) = 'client' then
        new.visibility := 'compartit';
        if new.category in ('avantprojecte') then
          raise exception 'El client no pot pujar versions oficials de l''avantprojecte' using errcode = '42501';
        end if;
      elsif new.visibility not in ('intern', 'revisio') then
        raise exception 'Només direcció pot publicar documents al client' using errcode = '42501';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if (old.visibility = 'publicat' or old.approved_at is not null)
       and (new.bucket_id, new.storage_path, new.project_id, new.version, new.group_id, new.previous_version_id, new.sha256)
           is distinct from
           (old.bucket_id, old.storage_path, old.project_id, old.version, old.group_id, old.previous_version_id, old.sha256) then
      raise exception 'Un document publicat o aprovat no es pot sobreescriure: puja una versió nova'
        using errcode = '42501';
    end if;
    if old.approved_at is not null and new.visibility is distinct from old.visibility then
      raise exception 'Un document aprovat no es pot despublicar' using errcode = '42501';
    end if;
  end if;

  if new.bucket_id = 'avantprojecte' then
    new.published_to_client := new.visibility in ('publicat', 'compartit');
  end if;
  return new;
end $$;
create trigger documents_guard_write before insert or update on public.documents
  for each row execute function app.guard_document_write();

create or replace function app.guard_document_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.visibility = 'publicat' or old.approved_at is not null then
    raise exception 'Els documents publicats o aprovats no es poden eliminar (només arxivar)' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger documents_guard_delete before delete on public.documents
  for each row execute function app.guard_document_delete();

-- La política d'inserció anterior no coneixia la columna visibility: es reescriu
drop policy documents_external_insert on public.documents;
create policy documents_external_insert on public.documents
  for insert to authenticated with check (
    project_id is not null
    and uploaded_by = auth.uid()
    and status = 'pendent_revisio'
    and not visible_to_architect
    and not visible_to_constructor
    and published_by is null
    and (not published_to_client or (bucket_id = 'avantprojecte' and visibility = 'compartit'))
    and (case when bucket_id = 'avantprojecte' then visibility in ('intern', 'revisio', 'compartit')
              else visibility = 'intern' end)
    and app.can_upload_to(bucket_id, storage_path)
    and (bucket_id <> 'avantprojecte' or app.project_role(project_id) in ('arquitecte', 'client')));

-- Notificació de document nou a l'espai d'avantprojecte
create or replace function app.on_avantprojecte_document()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_link text := '/projectes/' || new.project_id || '/avantprojecte?doc=' || new.id;
begin
  if new.bucket_id <> 'avantprojecte' or new.project_id is null then return new; end if;
  if new.visibility = 'compartit' then
    perform app.notify_project(new.project_id, array['direccio','arquitecte'], 'document_nou',
      'Document nou del client: ' || new.title, v_link, 'doc:' || new.id);
  elsif new.visibility in ('intern', 'revisio') then
    perform app.notify_project(new.project_id, array['direccio','arquitecte'], 'document_nou',
      'Document nou: ' || new.title, v_link, 'doc:' || new.id);
  elsif new.visibility = 'publicat' then
    perform app.notify_project(new.project_id, array['direccio','arquitecte','client'], 'versio_publicada',
      'Document publicat: ' || new.title, v_link, 'doc-pub:' || new.id);
  end if;
  return new;
end $$;
create trigger documents_notify_avantprojecte after insert on public.documents
  for each row execute function app.on_avantprojecte_document();

-- =====================================================================
-- Publicació i aprovació
-- =====================================================================
create or replace function public.request_document_publication(p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents%rowtype;
begin
  select * into d from public.documents where id = p_document_id for update;
  if not found or d.bucket_id <> 'avantprojecte' or not app.is_staff(d.project_id) then
    raise exception 'No tens permís sobre aquest document' using errcode = '42501';
  end if;
  if d.visibility <> 'intern' then
    raise exception 'Només es poden enviar a revisió documents interns' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.documents set visibility = 'revisio' where id = p_document_id;
  perform app.notify_project(d.project_id, array['direccio'], 'publicacio_pendent',
    'Pendent de validar la publicació: ' || d.title, '/projectes/' || d.project_id || '/avantprojecte?doc=' || d.id,
    'doc-rev:' || d.id);
end $$;

create or replace function public.publish_document(p_document_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents%rowtype;
begin
  if not app.is_direccio() then
    raise exception 'Només direcció pot publicar documents al client' using errcode = '42501';
  end if;
  select * into d from public.documents where id = p_document_id for update;
  if not found or d.bucket_id <> 'avantprojecte' then
    raise exception 'Document inexistent' using errcode = 'P0002';
  end if;
  if d.visibility = 'compartit' then
    raise exception 'Els documents del client ja són compartits' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.documents
     set visibility = 'publicat', status = 'vigent', published_at = now(), published_by = auth.uid()
   where id = p_document_id;
  -- les versions publicades anteriors del mateix document passen a "substituïda" (es conserven)
  update public.documents
     set status = 'substituit'
   where group_id = d.group_id and id <> d.id and visibility = 'publicat' and status = 'vigent';
  perform app.notify_project(d.project_id, array['client','arquitecte'], 'versio_publicada',
    'Nova versió publicada: ' || d.title, '/projectes/' || d.project_id || '/avantprojecte?doc=' || d.id,
    'doc-pub:' || d.id);
end $$;

create or replace function public.reject_document_publication(p_document_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents%rowtype;
begin
  if not app.is_direccio() then
    raise exception 'Només direcció' using errcode = '42501';
  end if;
  select * into d from public.documents where id = p_document_id and visibility = 'revisio' for update;
  if not found then
    raise exception 'El document no està pendent de revisió' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.documents set visibility = 'intern' where id = p_document_id;
  insert into public.comments (project_id, document_id, body, visibility, author_id, author_role)
  values (d.project_id, d.id, coalesce(nullif(trim(p_note), ''), 'Publicació no validada'), 'intern', auth.uid(), 'direccio');
end $$;

-- Confirmacions del client sobre una versió publicada
create or replace function public.confirm_document(p_document_id uuid, p_kind text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.documents%rowtype;
begin
  if p_kind not in ('versio_revisada', 'avantprojecte_aprovat') then
    raise exception 'Tipus de confirmació no vàlid' using errcode = '22023';
  end if;
  select * into d from public.documents where id = p_document_id for update;
  if not found or not app.is_project_client(d.project_id) or d.visibility <> 'publicat' or d.status <> 'vigent' then
    raise exception 'Només el client pot confirmar la versió vigent publicada' using errcode = '42501';
  end if;
  if p_kind = 'avantprojecte_aprovat' and d.category <> 'avantprojecte' then
    raise exception 'Només es pot aprovar un document d''avantprojecte' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  insert into public.revision_confirmations (project_id, document_id, kind, note, profile_id)
  values (d.project_id, d.id, p_kind, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  if p_kind = 'avantprojecte_aprovat' and d.approved_at is null then
    update public.documents set approved_at = now(), approved_by = auth.uid() where id = d.id;
  end if;
  perform app.notify_project(d.project_id, array['direccio','arquitecte'], 'revisio_validada',
    case p_kind when 'avantprojecte_aprovat' then 'Avantprojecte aprovat pel client: ' else 'El client ha revisat: ' end || d.title,
    '/projectes/' || d.project_id || '/avantprojecte?doc=' || d.id, p_kind || ':' || d.id || ':' || auth.uid());
end $$;

-- =====================================================================
-- Rondes: estat, esborrany, enviament transaccional i excepcions
-- =====================================================================
create or replace function public.revision_round_status(p_project_id uuid)
returns table (base integer, granted integer, used integer, available integer)
language sql stable security definer set search_path = '' as $$
  select p.revision_rounds_base,
         (select count(*)::integer from public.revision_round_grants g where g.project_id = p.id),
         (select count(*)::integer from public.revision_rounds r where r.project_id = p.id),
         greatest(0, p.revision_rounds_base
                     + (select count(*)::integer from public.revision_round_grants g where g.project_id = p.id)
                     - (select count(*)::integer from public.revision_rounds r where r.project_id = p.id))
  from public.projects p
  where p.id = p_project_id and (app.is_staff(p.id) or app.is_project_client(p.id))
$$;

-- Obre (o retorna) l'esborrany actual. Crear esborranys no consumeix rondes.
create or replace function public.open_revision_draft(p_project_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (app.is_project_client(p_project_id) or app.is_direccio()) then
    raise exception 'Només el client pot preparar sol·licituds de modificació' using errcode = '42501';
  end if;
  select id into v_id from public.revision_drafts where project_id = p_project_id and status = 'esborrany';
  if v_id is null then
    insert into public.revision_drafts (project_id, created_by) values (p_project_id, auth.uid())
    on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.revision_drafts where project_id = p_project_id and status = 'esborrany';
    end if;
  end if;
  return v_id;
end $$;

-- Desa el text original i el resultat de l'IA (no consumeix rondes)
create or replace function public.save_draft_analysis(p_draft_id uuid, p_original_text text, p_extraction jsonb, p_model text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  select project_id into v_project from public.revision_drafts where id = p_draft_id and status = 'esborrany' for update;
  if v_project is null or not (app.is_project_client(v_project) or app.is_direccio()) then
    raise exception 'Esborrany no disponible' using errcode = '42501';
  end if;
  update public.revision_drafts
     set original_text = p_original_text, ai_extraction = p_extraction, ai_model = p_model,
         ai_runs = ai_runs + 1, ai_analyzed_at = now()
   where id = p_draft_id;
end $$;

-- ENVIAMENT: únic punt on es consumeix una ronda. Transaccional i idempotent.
create or replace function public.submit_revision_round(p_draft_id uuid, p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_existing uuid;
  v_draft    public.revision_drafts%rowtype;
  v_status   record;
  v_round    uuid;
  v_number   integer;
  v_items    jsonb;
  v_arch     uuid;
  r          record;
  v_task     uuid;
begin
  -- Reintent amb la mateixa clau (doble clic): retorna la mateixa ronda
  select id into v_existing from public.revision_rounds where idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_draft from public.revision_drafts where id = p_draft_id for update;
  if not found or not app.is_project_client(v_draft.project_id) then
    raise exception 'Només el client del projecte pot enviar modificacions' using errcode = '42501';
  end if;
  -- Serialitza enviaments simultanis del mateix projecte
  perform 1 from public.projects where id = v_draft.project_id for update;

  select id into v_existing from public.revision_rounds where idempotency_key = p_idempotency_key;
  if v_existing is not null then
    return v_existing;
  end if;
  if v_draft.status <> 'esborrany' then
    raise exception 'Aquesta sol·licitud ja s''ha enviat' using errcode = 'P0001', hint = 'already_submitted';
  end if;
  if not exists (select 1 from public.revision_items where draft_id = p_draft_id) then
    raise exception 'La sol·licitud no té cap punt' using errcode = 'P0001', hint = 'empty_round';
  end if;

  select * into v_status from public.revision_round_status(v_draft.project_id);
  if v_status.available <= 0 then
    raise exception 'S''han esgotat les rondes de modificacions disponibles' using errcode = 'P0001', hint = 'rounds_exhausted';
  end if;
  v_number := v_status.used + 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'position', i.position, 'title', i.title, 'description', i.description, 'room', i.room,
           'source_excerpt', i.source_excerpt, 'needs_clarification', i.needs_clarification,
           'annotations', (select coalesce(jsonb_agg(a.id), '[]'::jsonb) from public.plan_annotations a where a.item_id = i.id),
           'documents', (select coalesce(jsonb_agg(l.document_id), '[]'::jsonb) from public.document_links l where l.item_id = i.id))
         order by i.position), '[]'::jsonb)
    into v_items
    from public.revision_items i where i.draft_id = p_draft_id;

  insert into public.revision_rounds (project_id, number, is_exception, draft_id, idempotency_key,
                                      original_text, ai_extraction, confirmed_items, submitted_by)
  values (v_draft.project_id, v_number, v_number > v_status.base, p_draft_id, p_idempotency_key,
          v_draft.original_text, v_draft.ai_extraction, v_items, auth.uid())
  returning id into v_round;

  update public.revision_drafts set status = 'enviat' where id = p_draft_id;

  select pm.profile_id into v_arch from public.project_members pm
  join public.profiles p on p.id = pm.profile_id and p.is_active and p.role = 'arquitecte'
  where pm.project_id = v_draft.project_id and pm.member_role = 'arquitecte' and pm.revoked_at is null
  order by pm.granted_at limit 1;

  perform set_config('app.item_update', 'on', true);
  update public.revision_items set round_id = v_round, architect_id = v_arch where draft_id = p_draft_id;
  perform set_config('app.item_update', 'off', true);
  update public.plan_annotations set round_id = v_round where draft_id = p_draft_id;
  update public.documents set round_id = v_round
   where id in (select l.document_id from public.document_links l
                join public.revision_items i on i.id = l.item_id where i.draft_id = p_draft_id)
     and round_id is null;

  -- Una tasca per a cada punt
  for r in select id, title, position from public.revision_items where round_id = v_round order by position loop
    insert into public.tasks (title, kind, project_id, assigned_to, priority, revision_item_id, created_by)
    values (format('Ronda %s · punt %s: %s', v_number, r.position, r.title), 'tecnica', v_draft.project_id,
            v_arch, 'normal', r.id, auth.uid())
    returning id into v_task;
    insert into public.revision_item_events (item_id, kind, to_value, actor_id) values (r.id, 'enviat', 'pendent', auth.uid());
  end loop;

  perform app.notify_project(v_draft.project_id, array['direccio','arquitecte'], 'ronda_enviada',
    format('El client ha enviat la ronda %s de modificacions', v_number),
    '/projectes/' || v_draft.project_id || '/avantprojecte?ronda=' || v_number, 'round:' || v_round);
  if v_status.available - 1 = 0 then
    perform app.notify_project(v_draft.project_id, array['direccio','client'], 'rondes_esgotades',
      'S''han utilitzat totes les rondes de modificacions disponibles',
      '/projectes/' || v_draft.project_id || '/avantprojecte', 'rounds-exhausted:' || v_draft.project_id || ':' || v_number);
  end if;
  return v_round;
end $$;

create or replace function public.grant_revision_round(p_project_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_direccio() then
    raise exception 'Només direcció pot autoritzar rondes addicionals' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cal indicar el motiu de l''excepció' using errcode = 'P0001', hint = 'reason_required';
  end if;
  insert into public.revision_round_grants (project_id, reason, granted_by) values (p_project_id, trim(p_reason), auth.uid());
  perform app.notify_project(p_project_id, array['client','arquitecte'], 'ronda_autoritzada',
    'Direcció ha autoritzat una ronda addicional de modificacions', '/projectes/' || p_project_id || '/avantprojecte',
    'grant:' || p_project_id || ':' || now());
end $$;

create or replace function public.close_revision_round(p_round_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  select project_id into v_project from public.revision_rounds where id = p_round_id and status = 'oberta' for update;
  if v_project is null or not app.is_direccio() then
    raise exception 'Només direcció pot tancar una ronda oberta' using errcode = '42501';
  end if;
  update public.revision_rounds set status = 'tancada', closed_at = now(), closed_by = auth.uid() where id = p_round_id;
end $$;

-- =====================================================================
-- Punts: edició del client (esborrany), resposta de l'arquitecte, resposta del client
-- =====================================================================
create or replace function app.guard_revision_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.round_id is not null then
      raise exception 'Els punts d''una ronda enviada no es poden eliminar' using errcode = '42501';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.round_id is not null then
      raise exception 'Els punts es creen sempre en un esborrany' using errcode = '42501';
    end if;
    new.status := 'pendent';
    new.assessment := null; new.alternative := null; new.alternative_status := 'cap';
    new.requires_economic_valuation := false; new.economic_decision := null; new.architect_id := null;
    new.project_id := (select project_id from public.revision_drafts where id = new.draft_id);
    return new;
  end if;
  -- UPDATE directe (sense funcions): només contingut del punt mentre és esborrany
  if coalesce(current_setting('app.item_update', true), 'off') = 'on' then
    return new;
  end if;
  if old.round_id is not null then
    raise exception 'Els punts enviats només es poden modificar amb les accions de revisió' using errcode = '42501';
  end if;
  if (new.status, new.assessment, new.alternative, new.alternative_status, new.requires_economic_valuation,
      new.economic_decision, new.architect_id, new.round_id, new.draft_id, new.project_id)
     is distinct from
     (old.status, old.assessment, old.alternative, old.alternative_status, old.requires_economic_valuation,
      old.economic_decision, old.architect_id, old.round_id, old.draft_id, old.project_id) then
    raise exception 'Només es pot editar el contingut del punt' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger revision_items_guard before insert or update or delete on public.revision_items
  for each row execute function app.guard_revision_item();

-- Resposta tècnica (arquitecte assignat o direcció). No consumeix rondes.
create or replace function public.respond_revision_item(
  p_item_id uuid, p_status text, p_assessment text, p_alternative text, p_requires_economic boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.revision_items%rowtype;
begin
  select * into i from public.revision_items where id = p_item_id for update;
  if not found or i.round_id is null or not app.is_staff(i.project_id) then
    raise exception 'No pots respondre aquest punt' using errcode = '42501';
  end if;
  if p_status not in ('pendent','en_estudi','necessita_aclariment','viable','viable_amb_modificacions',
                      'no_viable','incorporat','descartat') then
    raise exception 'Estat no vàlid' using errcode = '22023';
  end if;
  perform set_config('app.item_update', 'on', true);
  update public.revision_items
     set status = p_status,
         assessment = coalesce(nullif(trim(p_assessment), ''), assessment),
         alternative = case when nullif(trim(p_alternative), '') is not null then trim(p_alternative) else alternative end,
         alternative_status = case
           when nullif(trim(p_alternative), '') is not null and trim(p_alternative) is distinct from alternative then 'proposada'
           else alternative_status end,
         requires_economic_valuation = coalesce(p_requires_economic, requires_economic_valuation),
         economic_decision = case when coalesce(p_requires_economic, false) and economic_decision is null then 'pendent'
                                  else economic_decision end,
         architect_id = coalesce(architect_id, case when app.project_role(project_id) = 'arquitecte' then auth.uid() end)
   where id = p_item_id;
  perform set_config('app.item_update', 'off', true);

  insert into public.revision_item_events (item_id, kind, from_value, to_value, note, actor_id)
  values (p_item_id, 'estat', i.status, p_status, nullif(trim(coalesce(p_assessment, '')), ''), auth.uid());

  perform app.notify_project(i.project_id, array['client'],
    case when p_status = 'necessita_aclariment' then 'consulta_pendent' else 'resposta_punt' end,
    case when p_status = 'necessita_aclariment' then 'L''arquitecte necessita un aclariment: ' else 'Resposta de l''arquitecte: ' end || i.title,
    '/projectes/' || i.project_id || '/avantprojecte?punt=' || i.id, 'item-resp:' || i.id || ':' || p_status);
  if coalesce(p_requires_economic, false) and not i.requires_economic_valuation then
    perform app.notify_project(i.project_id, array['direccio'], 'valoracio_economica',
      'Punt que requereix valoració econòmica: ' || i.title,
      '/projectes/' || i.project_id || '/avantprojecte?punt=' || i.id, 'item-econ:' || i.id);
  end if;
  -- Tasca sincronitzada amb l'estat final del punt
  if p_status in ('incorporat', 'descartat', 'no_viable') then
    update public.tasks set status = 'feta' where revision_item_id = p_item_id and status <> 'feta';
  elsif p_status in ('en_estudi', 'necessita_aclariment', 'viable', 'viable_amb_modificacions') then
    update public.tasks set status = 'en_curs' where revision_item_id = p_item_id and status = 'pendent';
  end if;
  -- Ronda pendent de tancar
  if not exists (select 1 from public.revision_items x where x.round_id = i.round_id
                 and x.status not in ('incorporat', 'descartat', 'no_viable')) then
    perform app.notify_project(i.project_id, array['direccio'], 'ronda_pendent_tancar',
      'Tots els punts de la ronda estan resolts: pendent de tancar',
      '/projectes/' || i.project_id || '/avantprojecte', 'round-close:' || i.round_id);
  end if;
end $$;

-- Resposta del client sobre un punt enviat. No consumeix rondes.
create or replace function public.client_respond_item(p_item_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.revision_items%rowtype;
        v_kind text;
begin
  select * into i from public.revision_items where id = p_item_id for update;
  if not found or i.round_id is null or not app.is_project_client(i.project_id) then
    raise exception 'No pots respondre aquest punt' using errcode = '42501';
  end if;
  v_kind := case p_action
    when 'revisat' then 'punt_revisat'
    when 'acceptar_alternativa' then 'alternativa_acceptada'
    when 'rebutjar_alternativa' then 'alternativa_rebutjada'
    when 'demanar_aclariment' then 'aclariment_demanat'
  end;
  if v_kind is null then
    raise exception 'Acció no vàlida' using errcode = '22023';
  end if;
  if p_action in ('acceptar_alternativa', 'rebutjar_alternativa') and i.alternative_status not in ('proposada', 'aclariment') then
    raise exception 'No hi ha cap alternativa pendent de resposta' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  perform set_config('app.item_update', 'on', true);
  update public.revision_items
     set alternative_status = case p_action
           when 'acceptar_alternativa' then 'acceptada'
           when 'rebutjar_alternativa' then 'rebutjada'
           when 'demanar_aclariment' then case when alternative_status = 'proposada' then 'aclariment' else alternative_status end
           else alternative_status end,
         client_reviewed_at = case when p_action = 'revisat' then now() else client_reviewed_at end,
         client_reviewed_by = case when p_action = 'revisat' then auth.uid() else client_reviewed_by end
   where id = p_item_id;
  perform set_config('app.item_update', 'off', true);

  insert into public.revision_confirmations (project_id, item_id, kind, note, profile_id)
  values (i.project_id, i.id, v_kind, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  insert into public.revision_item_events (item_id, kind, to_value, note, actor_id)
  values (i.id, 'client', v_kind, nullif(trim(coalesce(p_note, '')), ''), auth.uid());
  if nullif(trim(coalesce(p_note, '')), '') is not null then
    insert into public.comments (project_id, item_id, body, visibility, author_id, author_role)
    values (i.project_id, i.id, trim(p_note), 'compartit', auth.uid(), 'client');
  end if;
  perform app.notify_project(i.project_id, array['direccio','arquitecte'],
    case p_action when 'acceptar_alternativa' then 'alternativa_acceptada'
                  when 'demanar_aclariment' then 'consulta_pendent' else 'resposta_client' end,
    case p_action when 'acceptar_alternativa' then 'El client accepta l''alternativa: '
                  when 'rebutjar_alternativa' then 'El client rebutja l''alternativa: '
                  when 'demanar_aclariment' then 'El client demana un aclariment: '
                  else 'El client ha revisat: ' end || i.title,
    '/projectes/' || i.project_id || '/avantprojecte?punt=' || i.id, 'item-client:' || i.id || ':' || p_action || ':' || now());
end $$;

-- Decisió econòmica de direcció (vincle futur amb el mòdul d'extres; no crea factures)
create or replace function public.decide_item_economics(p_item_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_direccio() then
    raise exception 'Només direcció' using errcode = '42501';
  end if;
  if p_decision not in ('pendent', 'pressupostar', 'sense_cost') then
    raise exception 'Decisió no vàlida' using errcode = '22023';
  end if;
  perform set_config('app.item_update', 'on', true);
  update public.revision_items set economic_decision = p_decision where id = p_item_id and requires_economic_valuation;
  perform set_config('app.item_update', 'off', true);
  insert into public.revision_item_events (item_id, kind, to_value, actor_id) values (p_item_id, 'economic', p_decision, auth.uid());
end $$;

-- Historial automàtic de canvis de contingut en esborrany
create or replace function app.log_item_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.round_id is null
     and (new.title, new.description, new.room) is distinct from (old.title, old.description, old.room) then
    insert into public.revision_item_events (item_id, kind, note, actor_id) values (new.id, 'editat', null, auth.uid());
  end if;
  return new;
end $$;
create trigger revision_items_log after update on public.revision_items
  for each row execute function app.log_item_change();

-- =====================================================================
-- Anotacions i comentaris: autoria, coherència de projecte i notificacions
-- =====================================================================
create or replace function app.guard_annotation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_doc_project uuid;
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then return new; end if;
  select project_id into v_doc_project from public.documents where id = new.document_id;
  if v_doc_project is distinct from new.project_id then
    raise exception 'El marcador no correspon al projecte del document' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.author_role := app.current_role();
    new.round_id := null;
    if new.author_role = 'client' then
      new.visibility := 'compartit';
    end if;
  else
    if (new.document_id, new.page, new.project_id, new.author_id, new.author_role) is distinct from
       (old.document_id, old.page, old.project_id, old.author_id, old.author_role) then
      raise exception 'No es pot moure un marcador a un altre document o pàgina' using errcode = '42501';
    end if;
    if old.round_id is not null and not app.is_staff(old.project_id)
       and (new.x, new.y, new.w, new.h, new.body, new.item_id) is distinct from (old.x, old.y, old.w, old.h, old.body, old.item_id) then
      raise exception 'Els marcadors d''una ronda enviada no es poden modificar' using errcode = '42501';
    end if;
  end if;
  if new.item_id is not null and not exists (
       select 1 from public.revision_items i where i.id = new.item_id and i.project_id = new.project_id) then
    raise exception 'El punt no pertany al projecte' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger plan_annotations_guard before insert or update on public.plan_annotations
  for each row execute function app.guard_annotation();

create or replace function app.guard_comment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.author_role := app.current_role();
    if new.author_role = 'client' then new.visibility := 'compartit'; end if;
    -- tots els objectius han de ser del mateix projecte
    if (new.document_id is not null and not exists (select 1 from public.documents where id = new.document_id and project_id = new.project_id))
       or (new.item_id is not null and not exists (select 1 from public.revision_items where id = new.item_id and project_id = new.project_id))
       or (new.annotation_id is not null and not exists (select 1 from public.plan_annotations where id = new.annotation_id and project_id = new.project_id))
       or (new.parent_id is not null and not exists (select 1 from public.comments where id = new.parent_id and project_id = new.project_id)) then
      raise exception 'Comentari fora del projecte' using errcode = '42501';
    end if;
    -- una resposta a un comentari intern és sempre interna
    if new.parent_id is not null and exists (select 1 from public.comments where id = new.parent_id and visibility = 'intern') then
      if new.author_role = 'client' then
        raise exception 'Comentari no disponible' using errcode = '42501';
      end if;
      new.visibility := 'intern';
    end if;
    new.resolved_at := null; new.resolved_by := null;
  else
    if (new.body, new.visibility, new.document_id, new.item_id, new.annotation_id, new.parent_id, new.author_id, new.project_id)
       is distinct from (old.body, old.visibility, old.document_id, old.item_id, old.annotation_id, old.parent_id, old.author_id, old.project_id)
       and old.author_id is distinct from auth.uid() then
      raise exception 'Només l''autor pot editar el comentari' using errcode = '42501';
    end if;
    if new.visibility is distinct from old.visibility then
      raise exception 'No es pot canviar la visibilitat d''un comentari' using errcode = '42501';
    end if;
    if new.body is distinct from old.body then new.edited_at := now(); end if;
    if new.resolved_at is not null and old.resolved_at is null then new.resolved_by := auth.uid(); end if;
  end if;
  return new;
end $$;
create trigger comments_guard before insert or update on public.comments
  for each row execute function app.guard_comment();

create or replace function app.on_comment_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_link text := '/projectes/' || new.project_id || '/avantprojecte'
    || case when new.item_id is not null then '?punt=' || new.item_id
            when new.document_id is not null then '?doc=' || new.document_id else '' end;
  v_parent_author uuid;
begin
  if new.author_role = 'client' then
    perform app.notify_project(new.project_id, array['direccio','arquitecte'], 'comentari',
      'Missatge nou del client', v_link, 'comment:' || new.id);
  elsif new.visibility = 'compartit' then
    perform app.notify_project(new.project_id, array['client'], 'comentari', 'Resposta nova a l''avantprojecte', v_link, 'comment:' || new.id);
  end if;
  if new.parent_id is not null then
    select author_id into v_parent_author from public.comments where id = new.parent_id;
    if v_parent_author is distinct from new.author_id
       and (new.visibility = 'compartit' or exists (select 1 from public.profiles where id = v_parent_author and role <> 'client')) then
      perform app.notify(v_parent_author, 'resposta', 'Han respost el teu comentari', null, v_link, 'reply:' || new.id);
    end if;
  end if;
  return new;
end $$;
create trigger comments_notify after insert on public.comments
  for each row execute function app.on_comment_created();

-- Mencions: només participants autoritzats; en notes internes, mai el client
create or replace function app.guard_mention()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c public.comments%rowtype;
begin
  select * into c from public.comments where id = new.comment_id;
  if c.author_id is distinct from auth.uid() and coalesce(auth.role(), 'service_role') <> 'service_role' then
    raise exception 'Només l''autor pot mencionar' using errcode = '42501';
  end if;
  if new.profile_id not in (select * from app.project_participants(c.project_id, array['direccio','arquitecte','client'])) then
    raise exception 'La persona mencionada no participa en el projecte' using errcode = '42501';
  end if;
  if c.visibility = 'intern' and exists (select 1 from public.profiles where id = new.profile_id and role = 'client') then
    raise exception 'No es pot mencionar el client en una nota interna' using errcode = '42501';
  end if;
  perform app.notify(new.profile_id, 'mencio', 'T''han mencionat en un comentari', null,
    '/projectes/' || c.project_id || '/avantprojecte', 'mention:' || new.comment_id || ':' || new.profile_id);
  return new;
end $$;
create trigger comment_mentions_guard before insert on public.comment_mentions
  for each row execute function app.guard_mention();

create or replace function app.guard_document_link()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then return new; end if;
  new.created_by := auth.uid();
  if not app.can_read_document(new.document_id)
     or not exists (select 1 from public.documents where id = new.document_id and project_id = new.project_id)
     or (new.item_id is not null and not (app.item_visible(new.item_id)
         and exists (select 1 from public.revision_items where id = new.item_id and project_id = new.project_id)))
     or (new.annotation_id is not null and not (app.annotation_visible(new.annotation_id)
         and exists (select 1 from public.plan_annotations where id = new.annotation_id and project_id = new.project_id)))
     or (new.comment_id is not null and not (app.comment_visible(new.comment_id)
         and exists (select 1 from public.comments where id = new.comment_id and project_id = new.project_id))) then
    raise exception 'Vincle no permès' using errcode = '42501';
  end if;
  -- El client només pot vincular a punts del seu esborrany actiu o a converses
  if app.current_role() = 'client' and new.item_id is not null and exists (
       select 1 from public.revision_items where id = new.item_id and round_id is not null) then
    raise exception 'Per afegir documentació a un punt enviat, fes-ho dins del fil de comentaris' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger document_links_guard before insert on public.document_links
  for each row execute function app.guard_document_link();

-- =====================================================================
-- Privilegis i RLS
-- =====================================================================
revoke all on public.upload_rules, public.revision_round_grants, public.revision_drafts, public.revision_rounds,
  public.revision_items, public.revision_item_events, public.revision_confirmations, public.version_item_resolutions,
  public.plan_annotations, public.comments, public.comment_mentions, public.document_links from anon;
grant select on public.upload_rules, public.revision_round_grants, public.revision_rounds,
  public.revision_item_events, public.revision_confirmations to authenticated;
grant select, insert, update, delete on public.upload_rules to authenticated;
grant select, insert, update on public.revision_drafts to authenticated;
grant select, insert, update, delete on public.revision_items, public.plan_annotations, public.document_links to authenticated;
grant select, insert, update on public.comments to authenticated;
grant select, insert, delete on public.comment_mentions, public.version_item_resolutions to authenticated;
grant all on public.upload_rules, public.revision_round_grants, public.revision_drafts, public.revision_rounds,
  public.revision_items, public.revision_item_events, public.revision_confirmations, public.version_item_resolutions,
  public.plan_annotations, public.comments, public.comment_mentions, public.document_links to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.request_document_publication(uuid)', 'public.publish_document(uuid)',
    'public.reject_document_publication(uuid, text)', 'public.confirm_document(uuid, text, text)',
    'public.revision_round_status(uuid)', 'public.open_revision_draft(uuid)',
    'public.save_draft_analysis(uuid, text, jsonb, text)', 'public.submit_revision_round(uuid, uuid)',
    'public.grant_revision_round(uuid, text)', 'public.close_revision_round(uuid)',
    'public.respond_revision_item(uuid, text, text, text, boolean)', 'public.client_respond_item(uuid, text, text)',
    'public.decide_item_economics(uuid, text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
revoke all on function app.is_staff(uuid), app.is_project_client(uuid), app.item_visible(uuid),
  app.annotation_visible(uuid), app.comment_visible(uuid), app.project_participants(uuid, text[]),
  app.notify_project(uuid, text[], text, text, text, text) from public;
grant execute on function app.is_staff(uuid), app.is_project_client(uuid), app.item_visible(uuid),
  app.annotation_visible(uuid), app.comment_visible(uuid) to authenticated, service_role;

alter table public.upload_rules             enable row level security;
alter table public.revision_round_grants    enable row level security;
alter table public.revision_drafts          enable row level security;
alter table public.revision_rounds          enable row level security;
alter table public.revision_items           enable row level security;
alter table public.revision_item_events     enable row level security;
alter table public.revision_confirmations   enable row level security;
alter table public.version_item_resolutions enable row level security;
alter table public.plan_annotations         enable row level security;
alter table public.comments                 enable row level security;
alter table public.comment_mentions         enable row level security;
alter table public.document_links           enable row level security;

create policy upload_rules_read on public.upload_rules for select to authenticated using (app.current_role() is not null);
create policy upload_rules_direccio on public.upload_rules for all to authenticated using (app.is_direccio()) with check (app.is_direccio());

create policy grants_select on public.revision_round_grants for select to authenticated
  using (app.is_staff(project_id) or app.is_project_client(project_id));

create policy drafts_select on public.revision_drafts for select to authenticated
  using (app.is_staff(project_id) or app.is_project_client(project_id));
create policy drafts_client_update on public.revision_drafts for update to authenticated
  using (status = 'esborrany' and app.is_project_client(project_id))
  with check (status = 'esborrany' and app.is_project_client(project_id));

create policy rounds_select on public.revision_rounds for select to authenticated
  using (app.is_staff(project_id) or app.is_project_client(project_id));

-- Les polítiques de lectura s'avaluen sobre les columnes de la fila (no per id), perquè
-- INSERT ... RETURNING funcioni: una funció no veu la fila que s'està inserint.
create policy items_select on public.revision_items for select to authenticated using (
  app.is_staff(project_id)
  or (app.is_project_client(project_id)
      and (round_id is not null
           or exists (select 1 from public.revision_drafts dr where dr.id = draft_id and dr.status = 'esborrany'))));
create policy items_client_insert on public.revision_items for insert to authenticated with check (
  exists (select 1 from public.revision_drafts d where d.id = draft_id and d.status = 'esborrany'
          and (app.is_project_client(d.project_id) or app.is_direccio())));
create policy items_client_update on public.revision_items for update to authenticated
  using (round_id is null and exists (select 1 from public.revision_drafts d where d.id = draft_id and d.status = 'esborrany'
         and (app.is_project_client(d.project_id) or app.is_direccio())))
  with check (round_id is null);
create policy items_client_delete on public.revision_items for delete to authenticated
  using (round_id is null and exists (select 1 from public.revision_drafts d where d.id = draft_id and d.status = 'esborrany'
         and (app.is_project_client(d.project_id) or app.is_direccio())));

create policy item_events_select on public.revision_item_events for select to authenticated using (app.item_visible(item_id));
create policy confirmations_select on public.revision_confirmations for select to authenticated
  using (app.is_staff(project_id) or (app.is_project_client(project_id)));
create policy resolutions_select on public.version_item_resolutions for select to authenticated
  using (app.can_read_document(document_id) and app.item_visible(item_id));
create policy resolutions_staff on public.version_item_resolutions for insert to authenticated
  with check (exists (select 1 from public.documents d where d.id = document_id and app.is_staff(d.project_id)
              and d.visibility in ('intern', 'revisio')));
create policy resolutions_staff_delete on public.version_item_resolutions for delete to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and app.is_staff(d.project_id)
         and d.visibility in ('intern', 'revisio')));

create policy annotations_select on public.plan_annotations for select to authenticated using (
  app.is_staff(project_id)
  or (app.is_project_client(project_id) and visibility = 'compartit' and app.can_read_document(document_id)));
create policy annotations_insert on public.plan_annotations for insert to authenticated with check (
  app.can_read_document(document_id) and (app.is_staff(project_id) or app.is_project_client(project_id)));
create policy annotations_update on public.plan_annotations for update to authenticated
  using (app.is_staff(project_id) or (author_id = auth.uid() and round_id is null))
  with check (app.is_staff(project_id) or (author_id = auth.uid() and round_id is null));
create policy annotations_delete on public.plan_annotations for delete to authenticated
  using (round_id is null and item_id is null and (author_id = auth.uid() or app.is_direccio()));

create policy comments_select on public.comments for select to authenticated using (
  app.is_staff(project_id)
  or (app.is_project_client(project_id) and visibility = 'compartit'
      and (document_id is null or app.can_read_document(document_id))
      and (item_id is null or app.item_visible(item_id))
      and (annotation_id is null or app.annotation_visible(annotation_id))));
create policy comments_insert on public.comments for insert to authenticated with check (
  (app.is_staff(project_id) or (app.is_project_client(project_id) and visibility = 'compartit'))
  and (document_id is null or app.can_read_document(document_id))
  and (item_id is null or app.item_visible(item_id))
  and (annotation_id is null or app.annotation_visible(annotation_id)));
create policy comments_update on public.comments for update to authenticated
  using (app.comment_visible(id) and (author_id = auth.uid() or app.is_staff(project_id)))
  with check (app.is_staff(project_id) or (app.is_project_client(project_id) and visibility = 'compartit'));

create policy mentions_select on public.comment_mentions for select to authenticated using (app.comment_visible(comment_id));
create policy mentions_insert on public.comment_mentions for insert to authenticated with check (app.comment_visible(comment_id));

create policy links_select on public.document_links for select to authenticated using (
  app.can_read_document(document_id)
  and (item_id is null or app.item_visible(item_id))
  and (annotation_id is null or app.annotation_visible(annotation_id))
  and (comment_id is null or app.comment_visible(comment_id)));
create policy links_insert on public.document_links for insert to authenticated with check (
  app.is_staff(project_id) or app.is_project_client(project_id));
create policy links_delete on public.document_links for delete to authenticated using (
  created_by = auth.uid() and (item_id is null or exists (select 1 from public.revision_items i where i.id = item_id and i.round_id is null)));

-- Auditoria
do $$
declare t text;
begin
  foreach t in array array['revision_round_grants','revision_drafts','revision_rounds','revision_items',
                           'revision_confirmations','version_item_resolutions','plan_annotations','comments',
                           'document_links','upload_rules']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;
