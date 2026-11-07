-- =====================================================================
-- Proves del mòdul d'avantprojecte: documents compartits i interns,
-- versions, publicació validada, rondes (màxim 3 + excepcions),
-- punts, anotacions, comentaris, mencions, inspiració i extres.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
reset role;
select set_config('request.jwt.claims', '{}', false);

\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_cliB  '00000000-0000-0000-0000-000000000006'
\set u_arq2  '00000000-0000-0000-0000-000000000012'
\set u_cliC  '00000000-0000-0000-0000-000000000021'
\set u_cliC2 '00000000-0000-0000-0000-000000000022'

insert into auth.users (id, email, raw_app_meta_data) values
  (:'u_cliC',  'client.c@example.test',  '{"role":"client"}'),
  (:'u_cliC2', 'client.c2@example.test', '{"role":"client"}');
update public.profiles set is_active = true where id in (:'u_cliC', :'u_cliC2');

select tests.login(:'u_dir');
select public.create_lead(null, 'Client Avantprojecte', null, null, 'ca', null, 'Municipi', 150, null, null,
                          'normal', null, null, null) as pav \gset
reset role;
insert into public.project_members (project_id, profile_id, member_role) values
  (:'pav', :'u_arq2', 'arquitecte'), (:'pav', :'u_cliC', 'client'), (:'pav', :'u_cliC2', 'client');

\set path_insp 'p/' :pav '/inspiracio-cuina.jpg'
\set path_v1   'p/' :pav '/avantprojecte-v1.pdf'
\set path_v2   'p/' :pav '/avantprojecte-v2.pdf'
\set path_int  'p/' :pav '/nota-interna.pdf'

\warn '--- 1. Pujada de documents pels tres rols i separació intern / compartit'
select tests.login(:'u_cliC');
insert into storage.objects (bucket_id, name) values ('avantprojecte', :'path_insp');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, room_tag)
  values ('f0000000-0000-0000-0000-000000000001', :'pav', 'avantprojecte', :'path_insp', 'inspiracio', 'Cuina de referència', :'u_cliC', 'cuina');
select tests.expect('el document del client queda compartit',
  (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000001' and visibility = 'compartit'), 1);
select tests.expect_error('el client no pot pujar versions oficials',
  format($$insert into public.documents (project_id, bucket_id, storage_path, category, title, uploaded_by)
           values (%L, 'avantprojecte', %L, 'avantprojecte', 'Fals', %L)$$, :'pav', 'p/' || :'pav' || '/fals.pdf', :'u_cliC'));
reset role;

select tests.login(:'u_arq2');
insert into storage.objects (bucket_id, name) values ('avantprojecte', :'path_v1');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, visibility)
  values ('f0000000-0000-0000-0000-000000000002', :'pav', 'avantprojecte', :'path_v1', 'avantprojecte', 'Avantprojecte', :'u_arq2', 'intern');
select tests.expect('l''arquitecte veu la inspiració del client', (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000001'), 1);
select tests.expect_error('l''arquitecte no pot publicar directament',
  format($$insert into public.documents (project_id, bucket_id, storage_path, category, title, uploaded_by, visibility)
           values (%L, 'avantprojecte', %L, 'planol', 'X', %L, 'publicat')$$, :'pav', 'p/' || :'pav' || '/x.pdf', :'u_arq2'));
reset role;

select tests.login(:'u_dir');
insert into storage.objects (bucket_id, name) values ('avantprojecte', :'path_int');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, visibility)
  values ('f0000000-0000-0000-0000-000000000003', :'pav', 'avantprojecte', :'path_int', 'observacions', 'Nota interna', :'u_dir', 'intern');
reset role;

select tests.login(:'u_cliC2');
select tests.expect('el cotitular veu la inspiració compartida', (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000001'), 1);
select tests.expect('el client no veu documents interns ni en revisió', (select count(*) from public.documents where visibility in ('intern','revisio')), 0);
select tests.expect('URL directa: el client no obté el fitxer intern', (select count(*) from storage.objects where name in (:'path_v1', :'path_int')), 0);
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte veu els interns de direcció', (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000003'), 1);
reset role;
select tests.login(:'u_cliB');
select tests.expect('un client d''un altre projecte no veu res', (select count(*) from public.documents where project_id = :'pav'), 0);
select tests.expect('ni els fitxers', (select count(*) from storage.objects where name like 'p/' || :'pav' || '/%'), 0);
select tests.expect_error('ni hi pot pujar fitxers', format($$insert into storage.objects (bucket_id, name) values ('avantprojecte', %L)$$, 'p/' || :'pav' || '/intrus.jpg'));
reset role;

\warn '--- 2. Publicació validada per direcció'
select tests.login(:'u_arq2');
select public.request_document_publication('f0000000-0000-0000-0000-000000000002');
select tests.expect_error('l''arquitecte no pot validar la publicació', $$select public.publish_document('f0000000-0000-0000-0000-000000000002')$$);
reset role;
select tests.login(:'u_cliC');
select tests.expect('pendent de revisió: encara no visible al client', (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000002'), 0);
reset role;
select tests.login(:'u_dir');
select public.publish_document('f0000000-0000-0000-0000-000000000002');
reset role;
select tests.login(:'u_cliC');
select tests.expect('publicada: visible al client', (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000002' and status = 'vigent'), 1);
select tests.expect('i el fitxer també', (select count(*) from storage.objects where name = :'path_v1'), 1);
select tests.expect('el client rep l''avís de nova versió', (select count(*) from public.notifications where kind = 'versio_publicada'), 1);
reset role;

\warn '--- 3. Historial de versions'
select tests.login(:'u_arq2');
insert into storage.objects (bucket_id, name) values ('avantprojecte', :'path_v2');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, visibility, version, previous_version_id)
  values ('f0000000-0000-0000-0000-000000000004', :'pav', 'avantprojecte', :'path_v2', 'avantprojecte', 'Avantprojecte', :'u_arq2',
          'revisio', 2, 'f0000000-0000-0000-0000-000000000002');
reset role;
select tests.login(:'u_dir');
select public.publish_document('f0000000-0000-0000-0000-000000000004');
select tests.expect('les dues versions comparteixen grup', (select count(distinct group_id) from public.documents where id in ('f0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000004')), 1);
select tests.expect('la v1 passa a substituïda', (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000002' and status = 'substituit'), 1);
select tests.expect_error('no es pot sobreescriure una versió publicada',
  $$update public.documents set storage_path = storage_path || '.nou' where id = 'f0000000-0000-0000-0000-000000000002'$$);
select tests.expect_error('no es pot eliminar una versió publicada',
  $$delete from public.documents where id = 'f0000000-0000-0000-0000-000000000002'$$);
reset role;
select tests.login(:'u_cliC');
select tests.expect('el client veu la versió anterior i l''actual', (select count(*) from public.documents where category = 'avantprojecte'), 2);
select tests.expect('i identifica la vigent', (select count(*) from public.documents where category = 'avantprojecte' and status = 'vigent' and version = 2), 1);
reset role;

\warn '--- 4. Esborrany: múltiples punts, edició i IA sense consumir rondes'
select tests.login(:'u_cliC');
select public.open_revision_draft(:'pav') as d1 \gset
select tests.expect('obrir de nou retorna el mateix esborrany', (select (public.open_revision_draft(:'pav') = :'d1')::int), 1);
insert into public.revision_items (id, draft_id, project_id, position, title, description, room, source_excerpt) values
  ('b0000000-0000-0000-0000-000000000001', :'d1', :'pav', 1, 'Ampliar la cuina', 'Ampliar la cuina', 'Cuina', 'ampliar la cuina'),
  ('b0000000-0000-0000-0000-000000000002', :'d1', :'pav', 2, 'Canviar la porta del bany', 'Canviar la porta', 'Bany', 'canviar la porta del bany'),
  ('b0000000-0000-0000-0000-000000000003', :'d1', :'pav', 3, 'Finestra del menjador més gran', 'Finestra més gran', 'Menjador', 'fer la finestra del menjador més gran'),
  ('b0000000-0000-0000-0000-000000000004', :'d1', :'pav', 4, 'Punt per eliminar', '', null, null);
update public.revision_items set description = 'Ampliar la cuina cap al menjador', position = 2 where id = 'b0000000-0000-0000-0000-000000000001';
update public.revision_items set position = 1 where id = 'b0000000-0000-0000-0000-000000000002';
delete from public.revision_items where id = 'b0000000-0000-0000-0000-000000000004';
select tests.expect_error('el client no pot fixar l''estat tècnic d''un punt',
  $$update public.revision_items set status = 'viable' where id = 'b0000000-0000-0000-0000-000000000001'$$);
select public.save_draft_analysis(:'d1', 'Vull ampliar la cuina, canviar la porta del bany i fer la finestra del menjador més gran.', '{"items":[]}', 'prova');
select public.save_draft_analysis(:'d1', 'Vull ampliar la cuina, canviar la porta del bany i fer la finestra del menjador més gran.', '{"items":[]}', 'prova');
select tests.expect('3 punts a l''esborrany', (select count(*) from public.revision_items where draft_id = :'d1'), 3);
select tests.expect('l''IA i les edicions no consumeixen rondes', (select used from public.revision_round_status(:'pav')), 0);
reset role;
select tests.login(:'u_cliC2');
select tests.expect('el cotitular veu el mateix esborrany', (select count(*) from public.revision_items where draft_id = :'d1'), 3);
reset role;

\warn '--- 5. Anotacions sobre el plànol (versió exacta, coordenades normalitzades)'
select tests.login(:'u_cliC');
insert into public.plan_annotations (id, project_id, document_id, page, kind, x, y, w, h, body, draft_id, item_id) values
  ('c0000000-0000-0000-0000-000000000001', :'pav', 'f0000000-0000-0000-0000-000000000004', 2, 'punt', 0.41250000, 0.73100000, null, null, 'Vull que aquesta finestra sigui més ampla', :'d1', 'b0000000-0000-0000-0000-000000000003'),
  ('c0000000-0000-0000-0000-000000000002', :'pav', 'f0000000-0000-0000-0000-000000000004', 2, 'rectangle', 0.10000000, 0.20000000, 0.30000000, 0.25000000, 'Zona de la cuina', :'d1', 'b0000000-0000-0000-0000-000000000001');
select tests.expect('coordenades guardades exactes',
  (select count(*) from public.plan_annotations where id = 'c0000000-0000-0000-0000-000000000001' and x = 0.4125 and y = 0.731 and page = 2), 1);
select tests.expect_error('rectangle fora del plànol',
  format($$insert into public.plan_annotations (project_id, document_id, kind, x, y, w, h) values (%L, 'f0000000-0000-0000-0000-000000000004', 'rectangle', 0.9, 0.1, 0.2, 0.1)$$, :'pav'));
select tests.expect_error('punt amb mides',
  format($$insert into public.plan_annotations (project_id, document_id, kind, x, y, w, h) values (%L, 'f0000000-0000-0000-0000-000000000004', 'punt', 0.5, 0.5, 0.1, 0.1)$$, :'pav'));
select tests.expect_error('no es pot anotar un document intern',
  format($$insert into public.plan_annotations (project_id, document_id, kind, x, y) values (%L, 'f0000000-0000-0000-0000-000000000003', 'punt', 0.5, 0.5)$$, :'pav'));
select tests.expect_error('no es pot moure un marcador a una altra pàgina',
  $$update public.plan_annotations set page = 1 where id = 'c0000000-0000-0000-0000-000000000001'$$);

\warn '--- 6. Fotografia d''inspiració vinculada a diversos punts sense duplicar-la'
insert into public.document_links (project_id, document_id, item_id, description) values
  (:'pav', 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Així m''agradaria la cuina'),
  (:'pav', 'f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'Llum com aquesta');
insert into public.document_links (project_id, document_id, annotation_id) values
  (:'pav', 'f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002');
select tests.expect('un sol fitxer, tres vincles', (select count(*) from public.document_links where document_id = 'f0000000-0000-0000-0000-000000000001'), 3);
select tests.expect('el fitxer no es duplica', (select count(*) from public.documents where storage_path = :'path_insp'), 1);
select tests.expect_error('no es pot vincular un document intern',
  format($$insert into public.document_links (project_id, document_id, item_id) values (%L, 'f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001')$$, :'pav'));

\warn '--- 7. Enviament de la ronda 1: transaccional i idempotent'
select public.submit_revision_round(:'d1', 'a1000000-0000-0000-0000-000000000001') as r1 \gset
select tests.expect('doble clic amb la mateixa clau: mateixa ronda',
  (select (public.submit_revision_round(:'d1', 'a1000000-0000-0000-0000-000000000001') = :'r1')::int), 1);
select tests.expect_error('segon enviament del mateix esborrany',
  format($$select public.submit_revision_round(%L, 'a1000000-0000-0000-0000-000000000002')$$, :'d1'));
select tests.expect('només s''ha consumit una ronda', (select used from public.revision_round_status(:'pav')), 1);
select tests.expect('ronda número 1', (select number from public.revision_rounds where id = :'r1'), 1);
select tests.expect('instantània dels 3 punts confirmats', (select jsonb_array_length(confirmed_items) from public.revision_rounds where id = :'r1'), 3);
select tests.expect('es conserva el text original', (select count(*) from public.revision_rounds where id = :'r1' and original_text like 'Vull ampliar%'), 1);
select tests.expect('els marcadors queden associats a la ronda', (select count(*) from public.plan_annotations where round_id = :'r1'), 2);
update public.revision_items set title = 'Canvi' where id = 'b0000000-0000-0000-0000-000000000001';
delete from public.revision_items where id = 'b0000000-0000-0000-0000-000000000001';
select tests.expect('un punt enviat no es pot editar ni eliminar pel client (RLS l''ignora)',
  (select count(*) from public.revision_items where id = 'b0000000-0000-0000-0000-000000000001' and title = 'Ampliar la cuina'), 1);
reset role;
select tests.expect('una tasca per punt per a l''arquitecte',
  (select count(*) from public.tasks where revision_item_id is not null and assigned_to = :'u_arq2'), 3);
select tests.expect('l''arquitecte rep l''avís de ronda enviada',
  (select count(*) from public.notifications where user_id = :'u_arq2' and kind = 'ronda_enviada'), 1);

\warn '--- 8. Resposta de l''arquitecte i del client sense consumir rondes'
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte veu el marcador del client', (select count(*) from public.plan_annotations where id = 'c0000000-0000-0000-0000-000000000001'), 1);
select public.respond_revision_item('b0000000-0000-0000-0000-000000000001', 'no_viable',
  'El mur és estructural', 'Ampliar cap al rebost en lloc del menjador', true);
insert into public.plan_annotations (id, project_id, document_id, page, kind, x, y, w, h, body, parent_id, item_id) values
  ('c0000000-0000-0000-0000-000000000003', :'pav', 'f0000000-0000-0000-0000-000000000004', 2, 'rectangle', 0.05, 0.20, 0.10, 0.25, 'Zona alternativa: rebost', 'c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001');
insert into public.plan_annotations (project_id, document_id, page, kind, x, y, body, visibility) values
  (:'pav', 'f0000000-0000-0000-0000-000000000004', 2, 'punt', 0.5, 0.5, 'Revisar càrregues (intern)', 'intern');
insert into public.comments (project_id, item_id, body, visibility) values (:'pav', 'b0000000-0000-0000-0000-000000000001', 'Nota interna: consultar estructurista', 'intern') returning id as c_int \gset
select public.respond_revision_item('b0000000-0000-0000-0000-000000000002', 'incorporat', 'Porta corredissa incorporada', null, false);
select tests.expect('proposar alternativa la deixa pendent de resposta',
  (select count(*) from public.revision_items where id = 'b0000000-0000-0000-0000-000000000001' and alternative_status = 'proposada' and economic_decision = 'pendent'), 1);
select tests.expect('la tasca del punt incorporat es tanca',
  (select count(*) from public.tasks where revision_item_id = 'b0000000-0000-0000-0000-000000000002' and status = 'feta'), 1);
reset role;
select tests.expect('direcció rep l''avís de valoració econòmica',
  (select count(*) from public.notifications where user_id = :'u_dir' and kind = 'valoracio_economica'), 1);

select tests.login(:'u_cliC');
select tests.expect('el client veu la resposta tècnica', (select count(*) from public.revision_items where id = 'b0000000-0000-0000-0000-000000000001' and assessment = 'El mur és estructural'), 1);
select tests.expect('el client veu el marcador de resposta', (select count(*) from public.plan_annotations where id = 'c0000000-0000-0000-0000-000000000003'), 1);
select tests.expect('el client no veu anotacions internes', (select count(*) from public.plan_annotations where visibility = 'intern'), 0);
select tests.expect('el client no veu comentaris interns', (select count(*) from public.comments where visibility = 'intern'), 0);
select public.client_respond_item('b0000000-0000-0000-0000-000000000001', 'demanar_aclariment', 'Quant espai guanyaríem?');
select public.client_respond_item('b0000000-0000-0000-0000-000000000001', 'acceptar_alternativa', null);
select public.client_respond_item('b0000000-0000-0000-0000-000000000002', 'revisat', null);
insert into public.comments (project_id, item_id, body, visibility) values (:'pav', 'b0000000-0000-0000-0000-000000000003', 'Pot ser una finestra corredissa?', 'intern') returning id as c_cli \gset
select tests.expect('el comentari del client sempre és compartit', (select count(*) from public.comments where id = :'c_cli' and visibility = 'compartit'), 1);
select tests.expect_error('el client no pot respondre una nota interna',
  format($$insert into public.comments (project_id, item_id, parent_id, body) values (%L, 'b0000000-0000-0000-0000-000000000001', %L, 'hola')$$, :'pav', :'c_int'));
select tests.expect('alternativa acceptada amb data i identitat',
  (select count(*) from public.revision_confirmations where item_id = 'b0000000-0000-0000-0000-000000000001' and kind = 'alternativa_acceptada' and profile_id = :'u_cliC'), 1);
select tests.expect('respostes i aclariments no consumeixen rondes', (select used from public.revision_round_status(:'pav')), 1);
select tests.expect('comentari per punt: fil compartit', (select count(*) from public.comments where item_id = 'b0000000-0000-0000-0000-000000000001'), 1);
insert into public.comments (project_id, document_id, body) values (:'pav', 'f0000000-0000-0000-0000-000000000004', 'Comentari sobre la v2');
select tests.expect('comentari per document', (select count(*) from public.comments where document_id = 'f0000000-0000-0000-0000-000000000004'), 1);
select tests.expect_error('no es pot comentar un document intern',
  format($$insert into public.comments (project_id, document_id, body) values (%L, 'f0000000-0000-0000-0000-000000000003', 'x')$$, :'pav'));
reset role;

select tests.login(:'u_arq2');
select tests.expect_error('no es pot mencionar el client en una nota interna',
  format($$insert into public.comment_mentions (comment_id, profile_id) values (%L, %L)$$, :'c_int', :'u_cliC'));
select tests.expect('l''arquitecte rep l''acceptació de l''alternativa', (select count(*) from public.notifications where kind = 'alternativa_acceptada'), 1);
reset role;

\warn '--- 9. Integració amb extres: decisió econòmica de direcció'
select tests.login(:'u_arq2');
select tests.expect_error('l''arquitecte no decideix la part econòmica',
  $$select public.decide_item_economics('b0000000-0000-0000-0000-000000000001', 'pressupostar')$$);
reset role;
select tests.login(:'u_dir');
select public.decide_item_economics('b0000000-0000-0000-0000-000000000001', 'pressupostar');
select tests.expect('decisió registrada sense crear factures',
  (select count(*) from public.revision_items where id = 'b0000000-0000-0000-0000-000000000001' and economic_decision = 'pressupostar'), 1);
reset role;

\warn '--- 10. Tres rondes com a màxim i bloqueig de la quarta'
select tests.login(:'u_cliC');
select public.open_revision_draft(:'pav') as d2 \gset
insert into public.revision_items (draft_id, project_id, position, title) values (:'d2', :'pav', 1, 'Canvi ronda 2');
select public.submit_revision_round(:'d2', 'a2000000-0000-0000-0000-000000000001') as r2 \gset
select public.open_revision_draft(:'pav') as d3 \gset
insert into public.revision_items (draft_id, project_id, position, title) values (:'d3', :'pav', 1, 'Canvi ronda 3');
select public.submit_revision_round(:'d3', 'a3000000-0000-0000-0000-000000000001') as r3 \gset
select tests.expect('tres rondes utilitzades', (select used from public.revision_round_status(:'pav')), 3);
select tests.expect('cap disponible', (select available from public.revision_round_status(:'pav')), 0);
select public.open_revision_draft(:'pav') as d4 \gset
insert into public.revision_items (draft_id, project_id, position, title) values (:'d4', :'pav', 1, 'Quarta petició');
select tests.expect_error('la quarta ronda queda bloquejada',
  format($$select public.submit_revision_round(%L, 'a4000000-0000-0000-0000-000000000001')$$, :'d4'));
select tests.expect('després de 3 rondes es continuen veient documents', (select (count(*) > 0)::int from public.documents where project_id = :'pav'), 1);
insert into public.comments (project_id, item_id, body) values (:'pav', 'b0000000-0000-0000-0000-000000000003', 'Puc continuar parlant?');
select tests.expect('i es pot continuar conversant', (select count(*) from public.comments where body = 'Puc continuar parlant?'), 1);
reset role;
select tests.expect('el cotitular i direcció reben l''avís de rondes esgotades',
  (select count(*) from public.notifications where kind = 'rondes_esgotades' and user_id in (:'u_cliC2', :'u_dir')), 2);
select tests.login(:'u_cliC');
select tests.expect_error('el client no es pot autoritzar una excepció', format($$select public.grant_revision_round(%L, 'Si us plau')$$, :'pav'));
reset role;

\warn '--- 11. Excepció autoritzada per direcció'
select tests.login(:'u_dir');
select tests.expect_error('l''excepció requereix motiu', format($$select public.grant_revision_round(%L, ' ')$$, :'pav'));
select public.grant_revision_round(:'pav', 'Canvi de normativa municipal');
reset role;
select tests.login(:'u_cliC');
select public.submit_revision_round(:'d4', 'a4000000-0000-0000-0000-000000000002') as r4 \gset
select tests.expect('quarta ronda com a excepció', (select count(*) from public.revision_rounds where id = :'r4' and number = 4 and is_exception), 1);
reset role;

\warn '--- 12. Aprovació formal i relació de punts per versió'
\set path_v3 'p/' :pav '/avantprojecte-v3.pdf'
select tests.login(:'u_arq2');
select tests.expect_error('la relació de punts no es pot canviar en una versió ja publicada',
  $$insert into public.version_item_resolutions (document_id, item_id, resolution) values
    ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'incorporat')$$);
insert into storage.objects (bucket_id, name) values ('avantprojecte', :'path_v3');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, visibility, version, previous_version_id)
  values ('f0000000-0000-0000-0000-000000000005', :'pav', 'avantprojecte', :'path_v3', 'avantprojecte', 'Avantprojecte', :'u_arq2',
          'intern', 3, 'f0000000-0000-0000-0000-000000000004');
insert into public.version_item_resolutions (document_id, item_id, resolution, note) values
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'incorporat', null),
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'alternativa', 'Ampliació cap al rebost'),
  ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000003', 'pendent', null);
reset role;
select tests.login(:'u_cliC');
select tests.expect('la relació de punts de la v3 no és visible fins que es publiqui', (select count(*) from public.version_item_resolutions), 0);
reset role;
select tests.login(:'u_cliC');
select public.confirm_document('f0000000-0000-0000-0000-000000000004', 'avantprojecte_aprovat', 'Conforme');
select tests.expect('aprovació registrada', (select count(*) from public.documents where id = 'f0000000-0000-0000-0000-000000000004' and approved_by = :'u_cliC'), 1);
select tests.expect_error('no es pot aprovar una versió substituïda',
  $$select public.confirm_document('f0000000-0000-0000-0000-000000000002', 'avantprojecte_aprovat')$$);
reset role;
select tests.login(:'u_dir');
select tests.expect_error('un avantprojecte aprovat no es pot despublicar',
  $$update public.documents set visibility = 'intern' where id = 'f0000000-0000-0000-0000-000000000004'$$);
select public.close_revision_round(:'r1');
select tests.expect('ronda tancada per direcció', (select count(*) from public.revision_rounds where id = :'r1' and status = 'tancada'), 1);
reset role;

\warn '--- 13. Accés privat per projecte'
select tests.login(:'u_cliB');
select tests.expect('altre client: 0 punts',       (select count(*) from public.revision_items where project_id = :'pav'), 0);
select tests.expect('altre client: 0 anotacions',  (select count(*) from public.plan_annotations where project_id = :'pav'), 0);
select tests.expect('altre client: 0 comentaris',  (select count(*) from public.comments where project_id = :'pav'), 0);
select tests.expect('altre client: 0 rondes',      (select count(*) from public.revision_rounds where project_id = :'pav'), 0);
select tests.expect('altre client: 0 vincles',     (select count(*) from public.document_links where project_id = :'pav'), 0);
select tests.expect_error('regressió: un usuari aliè no pot marcar passos tècnics d''un projecte',
  format($$select public.set_project_step(%L, 5::smallint, 'fet')$$, :'pav'));
select tests.expect_error('regressió: un usuari aliè no pot respondre punts',
  $$select public.respond_revision_item('b0000000-0000-0000-0000-000000000003', 'viable', 'x', null, false)$$);
select tests.expect_error('regressió: un usuari aliè no pot demanar publicacions',
  $$select public.request_document_publication('f0000000-0000-0000-0000-000000000005')$$);
select tests.expect_error('altre client no pot obrir esborranys', format($$select public.open_revision_draft(%L)$$, :'pav'));
select tests.expect_error('altre client no pot anotar', format($$insert into public.plan_annotations (project_id, document_id, kind, x, y) values (%L, 'f0000000-0000-0000-0000-000000000004', 'punt', 0.5, 0.5)$$, :'pav'));
reset role;

\warn '=== PROVES AVANTPROJECTE SUPERADES ==='

\warn '--- 14. Noms dels participants (sense emails ni dades d''altres projectes)'
select tests.login(:'u_cliC');
select tests.expect('el client veu els noms dels participants del seu projecte',
  (select (count(*) >= 4)::int from public.project_people(:'pav')), 1);
select tests.expect('inclou l''arquitecte assignat', (select count(*) from public.project_people(:'pav') where id = :'u_arq2'), 1);
reset role;
select tests.login(:'u_cliB');
select tests.expect('un aliè no obté cap nom', (select count(*) from public.project_people(:'pav')), 0);
reset role;
\warn '=== PROVES PARTICIPANTS SUPERADES ==='
