-- =====================================================================
-- Proves FASE 1 CRM: pipeline amb validacions, passos, duplicats,
-- tasques, calendari i notificacions. Reutilitza schema `tests` i dades de 01.
-- =====================================================================
\set ON_ERROR_STOP on
\set QUIET on
reset role;
select set_config('request.jwt.claims', '{}', false);

\set u_dir  '00000000-0000-0000-0000-000000000001'
\set u_cliA '00000000-0000-0000-0000-000000000005'
\set u_arq2 '00000000-0000-0000-0000-000000000012'
\set u_dir2 '00000000-0000-0000-0000-000000000013'

insert into auth.users (id, email, raw_app_meta_data) values
  (:'u_arq2', 'arquitecte2@example.test', '{"role":"arquitecte"}'),
  (:'u_dir2', 'direccio2@example.test',   '{"role":"direccio"}');
update public.profiles set is_active = true where id in (:'u_arq2', :'u_dir2');

\warn '--- 1. Alta de lead transaccional'
select tests.login(:'u_dir');
select public.create_lead(null, 'Client Pipeline Prova', 'pipeline@example.test', '+34 600 111 222', 'ca',
                          'web', 'Municipi Prova', 180, 35000000, null, 'alta', 'Trucar', current_date + 2, null) as lead \gset
select tests.expect('lead creat a l''etapa Lead nou', (select count(*) from public.projects where id = :'lead' and status = 'lead'), 1);
select tests.expect('11 passos creats',              (select count(*) from public.project_steps where project_id = :'lead'), 11);
select tests.expect('titular principal vinculat',     (select count(*) from public.project_holders where project_id = :'lead' and is_primary), 1);
select tests.expect('estimació en cèntims desada',    (select estimated_sale_cents from public.project_financials where project_id = :'lead'), 35000000);
select tests.expect('codi MD-AAAA-NNNN',              (select count(*) from public.projects where id = :'lead' and code ~ '^MD-\d{4}-\d{4}$'), 1);
select tests.expect('historial inicial',              (select count(*) from public.project_stage_history where project_id = :'lead'), 1);
reset role;
select tests.expect('l''altra direcció rep avís de lead nou (i el creador no)',
  (select count(*) from public.notifications where kind = 'lead_nou' and dedupe_key = 'lead:' || :'lead' and user_id = :'u_dir2'), 1);
select tests.expect('el creador no es notifica a si mateix',
  (select count(*) from public.notifications where dedupe_key = 'lead:' || :'lead' and user_id = :'u_dir'), 0);
select tests.login(:'u_dir');

\warn '--- 2. El drag-and-drop no pot esquivar validacions'
select tests.expect_error('saltar a Contractat sense passos',
  format($$select public.move_project_stage(%L, 'contractat')$$, :'lead'));
select tests.expect_error('canviar status directament',
  format($$update public.projects set status = 'en_obra' where id = %L$$, :'lead'));
select tests.expect_error('crear un projecte directament en obra',
  $$insert into public.projects (title, status) values ('Directe', 'en_obra')$$);
select tests.expect_error('finalitzar sense estar en obra',
  format($$select public.move_project_stage(%L, 'finalitzat')$$, :'lead'));
select public.set_project_step(:'lead', 1::smallint, 'fet');
select public.move_project_stage(:'lead', 'pressupost');
select tests.expect('amb el pas 1 fet passa a Pressupost', (select count(*) from public.projects where id = :'lead' and status = 'pressupost'), 1);
select tests.expect_error('Avantprojecte sense visita al terreny',
  format($$select public.move_project_stage(%L, 'avantprojecte')$$, :'lead'));
select public.set_project_step(:'lead', 2::smallint, 'fet');
select public.set_project_step(:'lead', 4::smallint, 'fet');
select public.set_project_step(:'lead', 3::smallint, 'no_aplica');
select public.move_project_stage(:'lead', 'avantprojecte');
select tests.expect_error('desmarcar un pas obligatori de l''etapa actual',
  format($$select public.set_project_step(%L, 2::smallint, 'pendent')$$, :'lead'));
select tests.expect_error('no_aplica només per al pas 3',
  format($$select public.set_project_step(%L, 5::smallint, 'no_aplica')$$, :'lead'));

\warn '--- 3. Perdut i reobertura'
select tests.expect_error('perdut sense motiu', format($$select public.move_project_stage(%L, 'perdut', '  ')$$, :'lead'));
select public.move_project_stage(:'lead', 'perdut', 'Pressupost massa alt');
select tests.expect('motiu de pèrdua desat', (select count(*) from public.projects where id = :'lead' and lost_reason = 'Pressupost massa alt'), 1);
select public.move_project_stage(:'lead', 'avantprojecte', 'Reobert pel client');
reset role;

\warn '--- 4. Arquitecte: passos tècnics sí, signatura i etapes no'
insert into public.project_members (project_id, profile_id, member_role) values (:'lead', :'u_arq2', 'arquitecte');
select tests.login(:'u_arq2');
select public.set_project_step(:'lead', 5::smallint, 'fet', 'Avantprojecte lliurat');
select tests.expect('arquitecte marca l''avantprojecte', (select count(*) from public.project_steps where project_id = :'lead' and step = 5 and status = 'fet'), 1);
select tests.expect_error('arquitecte no pot marcar la signatura (pas 6)',
  format($$select public.set_project_step(%L, 6::smallint, 'fet')$$, :'lead'));
select tests.expect_error('arquitecte no pot moure etapes',
  format($$select public.move_project_stage(%L, 'contractat')$$, :'lead'));
select tests.expect('arquitecte veu l''historial d''etapes', (select (count(*) >= 4)::int from public.project_stage_history where project_id = :'lead'), 1);
select tests.expect('arquitecte no veu l''estimació econòmica', (select count(*) from public.project_financials where project_id = :'lead'), 0);
reset role;

\warn '--- 5. Contractat i inici d''obra'
select tests.login(:'u_dir');
select public.set_project_step(:'lead', 6::smallint, 'fet');
select public.move_project_stage(:'lead', 'contractat');
select tests.expect('data de contractació registrada', (select count(*) from public.projects where id = :'lead' and contracted_at is not null), 1);
select public.move_project_stage(:'lead', 'projecte_llicencia');
select tests.expect_error('En obra sense llicència',
  format($$select public.move_project_stage(%L, 'en_obra')$$, :'lead'));
select public.set_project_step(:'lead', s::smallint, 'fet') from generate_series(7, 10) s;
select public.move_project_stage(:'lead', 'en_obra');
select tests.expect('inici d''obra marca el pas 11', (select count(*) from public.project_steps where project_id = :'lead' and step = 11 and status = 'fet'), 1);
select public.move_project_stage(:'lead', 'finalitzat');
select tests.expect('historial complet de canvis', (select count(*) from public.project_stage_history where project_id = :'lead'), 9);

\warn '--- 6. Detecció de duplicats'
select tests.expect('duplicat per telèfon amb format diferent',
  (select count(*) from public.find_client_duplicates('Altre nom', null, '600111222', null) where reason = 'telefon'), 1);
select tests.expect('duplicat per nom semblant: el més probable primer (accents i majúscules)',
  (select count(*) from (select display_name from public.find_client_duplicates('client pipeline próva', null, null, null) limit 1) x
    where display_name = 'Client Pipeline Prova'), 1);
select tests.expect('duplicat per email',
  (select count(*) from public.find_client_duplicates(null, 'PIPELINE@example.test', null, null) where reason = 'email'), 1);
reset role;
select tests.login(:'u_arq2');
select tests.expect('duplicats: només direcció', (select count(*) from public.find_client_duplicates(null, 'pipeline@example.test', null, null)), 0);
reset role;

\warn '--- 7. Tasques'
select tests.login(:'u_dir');
insert into public.tasks (id, title, project_id, assigned_to, due_date, kind)
  values ('e0000000-0000-0000-0000-000000000001', 'Revisar plànols', :'lead', :'u_arq2', current_date - 1, 'tecnica');
update public.tasks set assigned_to = :'u_arq2' where id = 'e0000000-0000-0000-0000-000000000001';
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''assignat veu la tasca', (select count(*) from public.tasks), 1);
select tests.expect('notificació d''assignació sense duplicats', (select count(*) from public.notifications where kind = 'tasca_assignada'), 1);
select tests.expect('recordatori de tasca vençuda generat', public.refresh_my_notifications(), 1);
select tests.expect('el recordatori no es duplica',         public.refresh_my_notifications(), 0);
select tests.expect_error('l''assignat no pot canviar el títol',
  $$update public.tasks set title = 'Altre' where id = 'e0000000-0000-0000-0000-000000000001'$$);
update public.tasks set status = 'feta' where id = 'e0000000-0000-0000-0000-000000000001';
select tests.expect('completar registra data i usuari',
  (select count(*) from public.tasks where status = 'feta' and completed_at is not null and completed_by = :'u_arq2'), 1);
reset role;
select tests.login(:'u_cliA');
select tests.expect('un client no veu tasques internes', (select count(*) from public.tasks), 0);
reset role;

\warn '--- 8. Calendari'
select tests.login(:'u_dir');
insert into public.calendar_events (title, kind, starts_at, project_id, responsible_id)
  values ('Visita terreny', 'visita_terreny', now() + interval '30 minutes', :'lead', :'u_arq2');
insert into public.calendar_events (title, kind, starts_at, project_id, status, visible_to_client)
  values ('Visita d''obra amb client', 'reunio_obra', now() + interval '3 days',
          'a0000000-0000-0000-0000-000000000001', 'confirmat', true);
insert into public.calendar_events (title, kind, starts_at, project_id, status, visible_to_client)
  values ('Reunió interna', 'reunio_obra', now() + interval '3 days',
          'a0000000-0000-0000-0000-000000000001', 'previst', false);
reset role;
select tests.login(:'u_arq2');
select tests.expect('responsable veu la seva cita', (select count(*) from public.calendar_events), 1);
select tests.expect('avís de cita assignada', (select count(*) from public.notifications where kind = 'visita'), 1);
reset role;
select tests.login(:'u_cliA');
select tests.expect('client veu només visites confirmades i publicades del seu projecte', (select count(*) from public.calendar_events), 1);
reset role;

\warn '--- 9. Notificacions'
select tests.login(:'u_arq2');
select tests.expect_error('no es poden crear notificacions des del client',
  format($$insert into public.notifications (user_id, kind, title) values (%L, 'x', 'x')$$, :'u_arq2'));
select tests.expect_error('no es pot canviar el text d''una notificació',
  $$update public.notifications set title = 'x'$$);
update public.notifications set read_at = now();
select tests.expect('es poden marcar com a llegides', (select count(*) from public.notifications where read_at is null), 0);
reset role;
select tests.login(:'u_cliA');
select tests.expect('cadascú només veu les seves', (select count(*) from public.notifications where user_id = :'u_arq2'), 0);
reset role;

\warn '--- 10. Seguretat addicional'
select tests.login(:'u_dir2');
update public.profiles set is_active = false where id = :'u_dir2';
reset role;
select tests.login(:'u_dir');
select tests.expect_error('no es pot desactivar l''última direcció',
  format($$update public.profiles set is_active = false where id = %L$$, :'u_dir'));
reset role;
select tests.login_anon();
select tests.expect_error('anònim no pot crear leads',
  $$select public.create_lead(null, 'X', null, null, 'ca', null, null, null, null, null, null, null, null, null)$$);
reset role;

\warn '=== PROVES CRM FASE 1 SUPERADES ==='
