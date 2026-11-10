-- Missatges generals del projecte
\set ON_ERROR_STOP on
\set QUIET on
reset role;
\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_cliB  '00000000-0000-0000-0000-000000000006'
\set u_arq2  '00000000-0000-0000-0000-000000000012'
\set u_cliC  '00000000-0000-0000-0000-000000000021'
\set u_cliC2 '00000000-0000-0000-0000-000000000022'
select id as pav from public.projects where title like 'Client Avantprojecte%' \gset

\warn '--- Missatges generals'
select tests.login(:'u_cliC');
insert into public.comments (project_id, body, visibility) values (:'pav', 'Hola, quan tindrem la nova versió?', 'intern');
select tests.expect('el missatge general del client és compartit',
  (select count(*) from public.comments where project_id = :'pav' and document_id is null and item_id is null and annotation_id is null and visibility = 'compartit'), 1);
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte el veu', (select count(*) from public.comments where body = 'Hola, quan tindrem la nova versió?'), 1);
insert into public.comments (project_id, body, visibility) values (:'pav', 'Nota interna general', 'intern');
reset role;
select tests.login(:'u_cliC2');
select tests.expect('el cotitular veu el missatge', (select count(*) from public.comments where body = 'Hola, quan tindrem la nova versió?'), 1);
select tests.expect('el client no veu notes internes generals', (select count(*) from public.comments where body = 'Nota interna general'), 0);
reset role;
select tests.login(:'u_cliB');
select tests.expect('un aliè no veu els missatges', (select count(*) from public.comments where project_id = :'pav'), 0);
select tests.expect_error('ni en pot escriure', format($$insert into public.comments (project_id, body) values (%L, 'intrus')$$, :'pav'));
reset role;
select tests.expect('l''arquitecte i direcció reben l''avís',
  (select count(*) from public.notifications n join public.comments c on n.dedupe_key = 'comment:' || c.id
    where c.body = 'Hola, quan tindrem la nova versió?' and n.user_id in (:'u_arq2', :'u_dir')), 2);
\warn '=== PROVES MISSATGES SUPERADES ==='
