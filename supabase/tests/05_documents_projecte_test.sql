-- Contracte signat i factures: visibles per al client només quan direcció els publica
\set ON_ERROR_STOP on
\set QUIET on
reset role;
\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_cliB  '00000000-0000-0000-0000-000000000006'
\set u_arq2  '00000000-0000-0000-0000-000000000012'
\set u_cliC  '00000000-0000-0000-0000-000000000021'
select id as pav from public.projects where title like 'Client Avantprojecte%' \gset
\set p_ctr 'p/' :pav '/contracte-signat.pdf'
\set p_fac 'p/' :pav '/factura-26-001.pdf'

\warn '--- Contracte i factures del projecte'
select tests.login(:'u_dir');
insert into storage.objects (bucket_id, name) values ('contractes', :'p_ctr'), ('factures', :'p_fac');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, status) values
  ('e1000000-0000-0000-0000-000000000001', :'pav', 'contractes', :'p_ctr', 'contracte', 'Contracte signat', :'u_dir', 'vigent'),
  ('e1000000-0000-0000-0000-000000000002', :'pav', 'factures',   :'p_fac', 'factura',   'Factura 26-001',   :'u_dir', 'vigent');
reset role;
select tests.login(:'u_cliC');
select tests.expect('sense publicar: el client no veu el contracte ni la factura',
  (select count(*) from public.documents where id in ('e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002')), 0);
select tests.expect_error('el client no pot pujar factures', format($$insert into storage.objects (bucket_id, name) values ('factures', %L)$$, 'p/' || :'pav' || '/falsa.pdf'));
reset role;
select tests.login(:'u_dir');
update public.documents set published_to_client = true, published_at = now(), published_by = :'u_dir'
 where id in ('e1000000-0000-0000-0000-000000000001','e1000000-0000-0000-0000-000000000002');
reset role;
select tests.login(:'u_cliC');
select tests.expect('publicats: el client veu el contracte i la factura', (select count(*) from public.documents where bucket_id in ('contractes','factures')), 2);
select tests.expect('i en pot obrir els fitxers', (select count(*) from storage.objects where name in (:'p_ctr', :'p_fac')), 2);
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte no veu factures', (select count(*) from public.documents where bucket_id = 'factures'), 0);
reset role;
select tests.login(:'u_cliB');
select tests.expect('un altre client no veu res', (select count(*) from public.documents where project_id = :'pav' and bucket_id in ('contractes','factures')), 0);
reset role;
select tests.expect('regles de pujada per a contractes i factures', (select count(*) from public.upload_rules where bucket_id in ('contractes','factures')), 9);
\warn '=== PROVES DOCUMENTS DEL PROJECTE SUPERADES ==='
