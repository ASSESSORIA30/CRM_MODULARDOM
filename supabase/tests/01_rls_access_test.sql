-- =====================================================================
-- Proves d'accés RLS — MODULARDOM CRM
-- Dades 100% fictícies i anonimitzades. Executar amb scripts/test-db-local.sh
-- Qualsevol fallada atura l'execució (ON_ERROR_STOP).
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema tests;
grant usage on schema tests to public;

create function tests.expect(label text, actual bigint, expected bigint) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FALLADA: % (obtingut %, esperat %)', label, actual, expected;
  end if;
  raise notice 'OK  %', label;
end $$;

create function tests.expect_error(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'OK  % [bloquejat: %]', label, sqlerrm;
    return;
  end;
  raise exception 'FALLADA: % (l''operació NO ha estat bloquejada)', label;
end $$;

create function tests.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

create function tests.login_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  perform set_config('role', 'anon', false);
end $$;

create function tests.login_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  perform set_config('role', 'service_role', false);
end $$;

grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------------
-- Dades de prova (com a superusuari)
-- ---------------------------------------------------------------------
\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_arq   '00000000-0000-0000-0000-000000000002'
\set u_cons  '00000000-0000-0000-0000-000000000003'
\set u_cons2 '00000000-0000-0000-0000-000000000004'
\set u_cliA  '00000000-0000-0000-0000-000000000005'
\set u_cliB  '00000000-0000-0000-0000-000000000006'
\set u_nou   '00000000-0000-0000-0000-000000000009'
\set co1 '10000000-0000-0000-0000-000000000001'
\set co2 '10000000-0000-0000-0000-000000000002'
\set p1  'a0000000-0000-0000-0000-000000000001'
\set p2  'a0000000-0000-0000-0000-000000000002'
\set c1  'c0000000-0000-0000-0000-000000000001'
\set c2  'c0000000-0000-0000-0000-000000000002'

insert into auth.users (id, email, raw_app_meta_data) values
  (:'u_dir',   'direccio@example.test',   '{"role":"direccio"}'),
  (:'u_arq',   'arquitecte@example.test', '{"role":"arquitecte"}'),
  (:'u_cons',  'constructor@example.test','{"role":"constructor"}'),
  (:'u_cons2', 'constructor2@example.test','{"role":"constructor"}'),
  (:'u_cliA',  'client.a@example.test',   '{"role":"client"}'),
  (:'u_cliB',  'client.b@example.test',   '{"role":"client"}');

insert into public.companies (id, name) values
  (:'co1', 'Constructora Prova 1 SL'), (:'co2', 'Constructora Prova 2 SL');

-- Activació per direcció (simulada com a superusuari)
update public.profiles set is_active = true;
update public.profiles set role = 'constructor', company_id = :'co1' where id = :'u_cons';
update public.profiles set role = 'constructor', company_id = :'co2' where id = :'u_cons2';

insert into public.clients (id, display_name, tax_id) values
  (:'c1', 'Client Prova A', 'X0000000A'), (:'c2', 'Client Prova B', 'X0000000B');
insert into public.client_users values (:'c1', :'u_cliA'), (:'c2', :'u_cliB');

insert into public.projects (id, code, title, status) values
  (:'p1', 'MD-TEST-001', 'Habitatge prova 1', 'en_obra'),
  (:'p2', 'MD-TEST-002', 'Habitatge prova 2', 'en_obra');
insert into public.project_holders values (:'p1', :'c1', true), (:'p2', :'c2', true);
insert into public.project_members (project_id, profile_id, member_role) values
  (:'p1', :'u_arq',   'arquitecte'),
  (:'p1', :'u_cons',  'constructor'),
  (:'p1', :'u_cliA',  'client'),
  (:'p2', :'u_cons2', 'constructor'),
  (:'p2', :'u_cliB',  'client');
insert into public.project_financials values
  (:'p1', 10000000, 8000000, now()), (:'p2', 20000000, 15000000, now());

insert into public.documents (id, project_id, bucket_id, storage_path, category, title, status,
                              visible_to_architect, visible_to_constructor, published_to_client, uploaded_by) values
  ('d0000000-0000-0000-0000-000000000001', :'p1', 'planols',     'p/' || :'p1' || '/planta.pdf',   'planol',    'Planta',        'vigent', true,  true,  false, :'u_dir'),
  ('d0000000-0000-0000-0000-000000000002', :'p1', 'factures',    'p/' || :'p1' || '/f001.pdf',     'factura',   'Factura 1',     'vigent', true,  true,  true,  :'u_dir'),
  ('d0000000-0000-0000-0000-000000000003', :'p2', 'factures',    'p/' || :'p2' || '/f002.pdf',     'factura',   'Factura 2',     'vigent', false, false, true,  :'u_dir'),
  ('d0000000-0000-0000-0000-000000000004', :'p1', 'contractes',  'p/' || :'p1' || '/contracte.pdf','contracte', 'Contracte',     'vigent', true,  true,  true,  :'u_dir'),
  ('d0000000-0000-0000-0000-000000000005', :'p1', 'fotografies', 'p/' || :'p1' || '/foto1.jpg',    'fotografia','Foto obra',     'pendent_revisio', false, false, false, :'u_cons'),
  ('d0000000-0000-0000-0000-000000000006', :'p1', 'documents',   'p/' || :'p1' || '/llicencia.pdf','llicencia', 'Llicència esb.', 'pendent_revisio', false, false, true, :'u_dir');
insert into storage.objects (bucket_id, name)
  select bucket_id, storage_path from public.documents;

\warn '--- 1. Constructor intenta accedir a una obra no assignada'
select tests.login(:'u_cons');
select tests.expect('constructor veu només 1 projecte',      (select count(*) from public.projects), 1);
select tests.expect('constructor no veu el projecte P2',     (select count(*) from public.projects where id = :'p2'), 0);
select tests.expect('constructor no veu documents de P2',    (select count(*) from public.documents where project_id = :'p2'), 0);
select tests.expect('constructor veu el plànol autoritzat',  (select count(*) from public.documents where id = 'd0000000-0000-0000-0000-000000000001'), 1);
select tests.expect('constructor no veu contractes (encara que marcats)', (select count(*) from public.documents where bucket_id = 'contractes'), 0);
select tests.expect('constructor no veu factures',           (select count(*) from public.documents where bucket_id = 'factures'), 0);
select tests.expect('constructor veu la seva foto pujada',   (select count(*) from public.documents where id = 'd0000000-0000-0000-0000-000000000005'), 1);
select tests.expect('constructor no veu cap client',         (select count(*) from public.clients), 0);
select tests.expect('constructor no veu leads/financials',   (select count(*) from public.project_financials), 0);
select tests.expect('storage: constructor només 2 fitxers',  (select count(*) from storage.objects), 2);
select tests.expect_error('constructor no pot pujar a P2',
  $$insert into storage.objects (bucket_id, name) values ('fotografies', 'p/a0000000-0000-0000-0000-000000000002/x.jpg')$$);
select tests.expect_error('constructor no pot pujar al bucket contractes',
  $$insert into storage.objects (bucket_id, name) values ('contractes', 'p/a0000000-0000-0000-0000-000000000001/x.pdf')$$);
insert into storage.objects (bucket_id, name) values ('fotografies', 'p/' || :'p1' || '/foto2.jpg');
select tests.expect('constructor pot pujar fotos a la seva obra', 1, 1);
select tests.expect_error('constructor no pot publicar directament al client',
  $$insert into public.documents (project_id, bucket_id, storage_path, category, title, uploaded_by, published_to_client)
    values ('a0000000-0000-0000-0000-000000000001', 'fotografies', 'p/a0000000-0000-0000-0000-000000000001/foto2.jpg',
            'fotografia', 'Foto', '00000000-0000-0000-0000-000000000003', true)$$);
insert into public.documents (project_id, bucket_id, storage_path, category, title, uploaded_by)
  values (:'p1', 'fotografies', 'p/' || :'p1' || '/foto2.jpg', 'fotografia', 'Foto 2', :'u_cons');
select tests.expect('constructor registra foto pendent de revisió', 1, 1);
update public.documents set published_to_client = true where id = 'd0000000-0000-0000-0000-000000000005';
reset role;
select tests.expect('constructor no pot autopublicar (update ignorat)',
  (select count(*) from public.documents where id = 'd0000000-0000-0000-0000-000000000005' and published_to_client), 0);

\warn '--- 2. Client intenta consultar la factura d''un altre client'
select tests.login(:'u_cliA');
select tests.expect('client A veu la seva factura',          (select count(*) from public.documents where id = 'd0000000-0000-0000-0000-000000000002'), 1);
select tests.expect('client A NO veu la factura del client B',(select count(*) from public.documents where id = 'd0000000-0000-0000-0000-000000000003'), 0);
select tests.expect('storage: client A no obté el fitxer de B',(select count(*) from storage.objects where name like 'p/' || :'p2' || '%'), 0);
select tests.expect('client A no veu document no vigent',    (select count(*) from public.documents where id = 'd0000000-0000-0000-0000-000000000006'), 0);
select tests.expect('client A no veu fotos no aprovades',    (select count(*) from public.documents where bucket_id = 'fotografies'), 0);
select tests.expect('client A només veu la seva fitxa',      (select count(*) from public.clients), 1);
select tests.expect('client A no veu marges',                (select count(*) from public.project_financials), 0);
update public.projects set status = 'finalitzat';
reset role;
select tests.expect('client A no pot modificar projectes',   (select count(*) from public.projects where status = 'finalitzat'), 0);

\warn '--- 3. Arquitecte intenta accedir a marges econòmics'
select tests.login(:'u_arq');
select tests.expect('arquitecte no veu project_financials',  (select count(*) from public.project_financials), 0);
select tests.expect_error('arquitecte no pot inserir financials',
  $$insert into public.project_financials (project_id, estimated_sale_cents) values ('a0000000-0000-0000-0000-000000000001', 1)$$);
select tests.expect('arquitecte no veu factures',            (select count(*) from public.documents where bucket_id = 'factures'), 0);
select tests.expect('arquitecte veu el titular del seu projecte', (select count(*) from public.clients), 1);
select tests.expect('arquitecte no veu l''auditoria',         (select count(*) from public.audit_log), 0);
select tests.expect_error('arquitecte no pot autopromocionar-se a direcció',
  $$update public.profiles set role = 'direccio' where id = '00000000-0000-0000-0000-000000000002'$$);
update public.profiles set full_name = 'Arquitecte Prova', locale = 'es' where id = :'u_arq';
reset role;
select tests.expect('arquitecte pot canviar nom i idioma',
  (select count(*) from public.profiles where id = :'u_arq' and locale = 'es'), 1);

\warn '--- 4. Direcció té accés total'
select tests.login(:'u_dir');
select tests.expect('direcció veu tots els projectes',       (select count(*) from public.projects), 2);
select tests.expect('direcció veu tots els financials',      (select count(*) from public.project_financials), 2);
select tests.expect('direcció veu tots els documents',       (select count(*) from public.documents), 7);
select tests.expect('direcció veu l''auditoria',               (select (count(*) > 0)::int from public.audit_log), 1);

\warn '--- 5. Es desactiva l''accés d''un constructor extern'
update public.profiles set is_active = false where id = :'u_cons';
reset role;
select tests.login(:'u_cons');
select tests.expect('constructor desactivat: 0 projectes',   (select count(*) from public.projects), 0);
select tests.expect('constructor desactivat: 0 documents',   (select count(*) from public.documents), 0);
select tests.expect('constructor desactivat: 0 fitxers',     (select count(*) from storage.objects), 0);
reset role;

\warn '--- 6. Revocació d''una assignació de projecte'
select tests.login(:'u_dir');
update public.project_members set revoked_at = now() where profile_id = :'u_arq';
reset role;
select tests.login(:'u_arq');
select tests.expect('arquitecte revocat: 0 projectes',       (select count(*) from public.projects), 0);
select tests.expect('arquitecte revocat: 0 clients',         (select count(*) from public.clients), 0);
reset role;

\warn '--- 7. Usuari nou registrat sense activar'
insert into auth.users (id, email, raw_app_meta_data) values (:'u_nou', 'nou@example.test', '{"role":"direccio"}');
select tests.login(:'u_nou');
select tests.expect('usuari nou inactiu: no és direcció',    (select app.is_direccio()::int), 0);
select tests.expect('usuari nou inactiu: 0 projectes',       (select count(*) from public.projects), 0);
reset role;

\warn '--- 8. Anònim i service_role'
select tests.login_anon();
select tests.expect_error('anon no pot llegir projectes', $$select count(*) from public.projects$$);
select tests.expect_error('anon no pot llegir clients',   $$select count(*) from public.clients$$);
reset role;
select tests.login_service();
select tests.expect_error('service_role no pot esborrar l''auditoria', $$delete from public.audit_log$$);
reset role;

\warn '=== PROVES RLS SUPERADES ==='
