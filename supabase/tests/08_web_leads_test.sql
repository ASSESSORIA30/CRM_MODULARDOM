-- Integració web: alta de sol·licituds (web_create_lead), idempotència, coincidència de clients,
-- visites pendents, límit de peticions i permisos. Dades fictícies.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
select set_config('request.jwt.claims', '{}', false);
\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_arq2  '00000000-0000-0000-0000-000000000012'
\set u_cliC  '00000000-0000-0000-0000-000000000021'

create function tests.web_payload(p_kind text, p_name text, p_email text, p_phone text, p_ref text, p_cfg boolean default false)
returns jsonb language sql as $$
  select jsonb_build_object(
    'reference', p_ref, 'capturedAt', '2026-11-26T10:00:00.000Z',
    'source', case when p_kind = 'quote' then 'configurador' else 'web' end, 'kind', p_kind, 'page', '/ca/contacte',
    'client', jsonb_build_object('kind', 'persona', 'display_name', p_name, 'email', p_email, 'phone', p_phone, 'locale', 'ca', 'city', 'Bellvís'),
    'project', jsonb_build_object('municipality', 'Bellvís', 'plot_address', 'Partida de prova 1', 'surface_m2', case when p_cfg then 180 end),
    'configurator', case when p_cfg then jsonb_build_object(
        'input', jsonb_build_object('metres', 180, 'habitacions', 3, 'banys', 2, 'suite', 'bano', 'cuina', 'isla', 'vehicles', 1,
                                    'safareig', true, 'installacions', jsonb_build_array('aerotermia'), 'extres', jsonb_build_array('piscina')),
        'visual', jsonb_build_object('floors', 1, 'system', 'cellular', 'facade', 'mineral', 'roof', 'flat', 'volume', 'compact'),
        'tariff', '1', 'totalCents', 25000000) end,
    'notes', 'Terreny: en té' || E'\n' || 'Nota fictícia de prova')
$$;
create function tests.k(n int) returns text language sql as $$ select encode(sha256(('web-test-' || n)::bytea), 'hex') $$;
create function tests.s(n int) returns text language sql as $$ select encode(sha256(('web-sig-' || n)::bytea), 'hex') $$;

select count(*) as clients0 from public.clients \gset
select count(*) as quotes0 from public.quotes \gset

\warn '--- 1. Permisos: només el servidor'
select tests.login_anon();
select tests.expect_error('anònim no pot cridar web_create_lead', format($$select public.web_create_lead(%L, %L, %L::jsonb)$$, tests.k(1), tests.s(1), tests.web_payload('info', 'Anònim Intrús', 'intrus@example.test', null, 'W261126-AAA1')));
select tests.expect_error('anònim no pot inserir a la bústia', $$insert into public.web_lead_intake (idempotency_key) values ('x')$$);
select tests.expect_error('anònim no pot llegir la bústia', $$select count(*) from public.web_lead_intake$$);
select tests.expect_error('anònim no pot crear clients', $$insert into public.clients (kind, display_name) values ('persona', 'Intrús')$$);
select tests.expect_error('anònim no pot gastar el límit de peticions', $$select public.web_rate_hit('leads:global', 1, 60)$$);
reset role;
select tests.login(:'u_dir');
select tests.expect_error('direcció tampoc crida la funció de la integració', format($$select public.web_create_lead(%L, %L, %L::jsonb)$$, tests.k(1), tests.s(1), tests.web_payload('info', 'Direcció', 'dir@example.test', null, 'W261126-AAA1')));
select tests.expect_error('ni escriu a la bústia', $$insert into public.web_lead_intake (idempotency_key) values ('x')$$);
select tests.expect_error('ni la modifica directament', $$update public.web_lead_intake set kind = 'info'$$);
reset role;
select tests.login(:'u_cliC');
select tests.expect_error('un client tampoc', format($$select public.web_create_lead(%L, %L, %L::jsonb)$$, tests.k(1), tests.s(1), tests.web_payload('info', 'Client', 'cli@example.test', null, 'W261126-AAA1')));
reset role;
select tests.expect('res creat pels intents rebutjats', (select count(*) from public.clients), :clients0);

\warn '--- 2. Pressupost amb configuració: client + projecte (lead) + estimació + activitat'
select tests.login_service();
select public.web_create_lead(tests.k(1), tests.s(1), tests.web_payload('quote', 'Web Prova Un', 'Web.Un@Example.test', '+34 611 000 001', 'W261126-AAA1', true)) as r1 \gset
reset role;
select (:'r1'::jsonb ->> 'id')::uuid as i1, (:'r1'::jsonb ->> 'project_id')::uuid as p1, (:'r1'::jsonb ->> 'client_id')::uuid as c1 \gset
select tests.expect('resposta: no duplicat, client nou', (select count(*) where :'r1'::jsonb @> '{"duplicate": false, "outcome": "client_nou", "project_created": true}'), 1);
select tests.expect('client creat amb origen configurador i correu normalitzat', (select count(*) from public.clients where id = :'c1' and lead_source = 'configurador' and email = 'web.un@example.test' and city = 'Bellvís'), 1);
select tests.expect('projecte en estat lead amb les dades del terreny', (select count(*) from public.projects where id = :'p1' and status = 'lead' and municipality = 'Bellvís' and plot_address = 'Partida de prova 1' and surface_m2 = 180 and code like 'MD-%'), 1);
select tests.expect('titular principal', (select count(*) from public.project_holders where project_id = :'p1' and client_id = :'c1' and is_primary), 1);
select tests.expect('estimació orientativa conservada', (select estimated_sale_cents from public.project_financials where project_id = :'p1'), 25000000);
select tests.expect('historial d''etapa', (select count(*) from public.project_stage_history where project_id = :'p1' and to_stage = 'lead'), 1);
select tests.expect('passos del projecte sembrats com en un lead manual', (select count(*) from public.project_steps where project_id = :'p1'), 11);
select tests.expect('configuració sencera desada', (select count(*) from public.web_lead_intake where id = :'i1' and configurator_input @> '{"metres": 180, "suite": "bano", "extres": ["piscina"]}' and configurator_visual ->> 'facade' = 'mineral' and tariff_number = '1' and total_cents = 25000000 and payload ->> 'reference' = 'W261126-AAA1'), 1);
select tests.expect('activitat amb la referència i les notes', (select count(*) from public.activities where project_id = :'p1' and summary like '%W261126-AAA1%' and summary like '%Nota fictícia%'), 1);
select tests.expect('avís «Lead nou» a direcció', (select count(*) from public.notifications where user_id = :'u_dir' and dedupe_key = 'lead:' || :'p1'), 1);
select tests.expect('cap pressupost creat', (select count(*) from public.quotes), :quotes0);

\warn '--- 3. Idempotència i repetició'
select tests.login_service();
select public.web_create_lead(tests.k(1), tests.s(1), tests.web_payload('quote', 'Web Prova Un', 'web.un@example.test', '+34 611 000 001', 'W261126-AAA1', true)) as r1b \gset
select public.web_create_lead(tests.k(99), tests.s(1), tests.web_payload('quote', 'Web Prova Un', 'web.un@example.test', '+34 611 000 001', 'W261126-AAA1', true)) as r1c \gset
reset role;
select tests.expect('mateixa clau: duplicat amb el mateix id', (select count(*) where :'r1b'::jsonb @> jsonb_build_object('duplicate', true, 'id', :'i1')), 1);
select tests.expect('mateixa signatura amb una altra clau (repetició): duplicat', (select count(*) where :'r1c'::jsonb @> jsonb_build_object('duplicate', true, 'id', :'i1')), 1);
select tests.expect('una sola entrada a la bústia', (select count(*) from public.web_lead_intake), 1);
select tests.expect('un sol client', (select count(*) from public.clients), :clients0 + 1);
select tests.expect('una sola activitat', (select count(*) from public.activities where project_id = :'p1'), 1);

\warn '--- 4. Client existent: es conserva i la sol·licitud s''afegeix (visita pendent de confirmació)'
select tests.login_service();
select public.web_create_lead(tests.k(2), tests.s(2), tests.web_payload('visit', 'Un Altre Nom', 'altre@example.test', '611000001', 'W261126-AAA2')) as r2 \gset
reset role;
select (:'r2'::jsonb ->> 'id')::uuid as i2 \gset
select tests.expect('coincideix pel telèfon (9 últims dígits)', (select count(*) where :'r2'::jsonb @> jsonb_build_object('outcome', 'client_existent', 'client_id', :'c1', 'project_id', :'p1', 'project_created', false)), 1);
select tests.expect('les dades del client no es toquen', (select count(*) from public.clients where id = :'c1' and display_name = 'Web Prova Un' and email = 'web.un@example.test'), 1);
select tests.expect('cap client nou', (select count(*) from public.clients), :clients0 + 1);
select tests.expect('visita pendent de confirmació comercial', (select count(*) from public.web_lead_intake where id = :'i2' and visit_status = 'pendent_confirmacio'), 1);
select tests.expect('cap esdeveniment de calendari automàtic', (select count(*) from public.calendar_events where project_id = :'p1'), 0);
select tests.expect('segona activitat al mateix projecte', (select count(*) from public.activities where project_id = :'p1'), 2);
select tests.expect('avisos a direcció (sol·licitud + visita)', (select count(*) from public.notifications where user_id = :'u_dir' and dedupe_key in ('web-intake:' || :'i2', 'web-visit:' || :'i2')), 2);
select tests.expect('acció següent actualitzada', (select count(*) from public.projects where id = :'p1' and next_action = 'Confirmar visita a la casa pilot'), 1);

\warn '--- 5. Coincidències contradictòries: no es fusiona res'
select tests.login_service();
select public.web_create_lead(tests.k(3), tests.s(3), tests.web_payload('info', 'Web Prova Dos', 'web.dos@example.test', '+34 622 000 002', 'W261126-AAA3')) as r3 \gset
-- correu del client Un i telèfon del client Dos
select public.web_create_lead(tests.k(4), tests.s(4), tests.web_payload('mineral', 'Hotel Fictici (Persona Tres)', 'web.un@example.test', '622000002', 'W261126-AAA4')) as r4 \gset
reset role;
select (:'r3'::jsonb ->> 'client_id')::uuid as c2, (:'r4'::jsonb ->> 'client_id')::uuid as c4, (:'r4'::jsonb ->> 'id')::uuid as i4 \gset
select tests.expect('marcat per a revisió', (select count(*) where :'r4'::jsonb @> '{"outcome": "revisio_duplicats", "project_created": true}'), 1);
select tests.expect('client nou, diferent dels dos candidats', (select count(*) from public.clients where id = :'c4' and id not in (:'c1', :'c2')), 1);
select tests.expect('candidats anotats', (select cardinality(match_candidates) from public.web_lead_intake where id = :'i4' and match_candidates @> array[:'c1', :'c2']::uuid[]), 2);
select tests.expect('cap client fusionat', (select count(*) from public.clients where merged_into is not null and id in (:'c1', :'c2', :'c4')), 0);
select tests.expect('avís de possible duplicat', (select count(*) from public.notifications where user_id = :'u_dir' and dedupe_key = 'web-dup:' || :'i4'), 1);
select tests.expect('MINERAL: acció següent pròpia', (select count(*) from public.projects where id = (:'r4'::jsonb ->> 'project_id')::uuid and next_action like '%MINERAL%'), 1);

\warn '--- 6. Dades no vàlides: tot o res'
select tests.login_service();
select tests.expect_error('correu no vàlid', format($$select public.web_create_lead(%L, %L, %L::jsonb)$$, tests.k(5), tests.s(5), tests.web_payload('info', 'Sense Correu', 'no-es-correu', null, 'W261126-AAA5')));
select tests.expect_error('tipus inventat', format($$select public.web_create_lead(%L, %L, %L::jsonb)$$, tests.k(5), tests.s(5), tests.web_payload('altres', 'Tipus Dolent', 'tipus@example.test', null, 'W261126-AAA5')));
select tests.expect_error('clau d''idempotència mal formada', format($$select public.web_create_lead('abc', %L, %L::jsonb)$$, tests.s(5), tests.web_payload('info', 'Clau Dolenta', 'clau@example.test', null, 'W261126-AAA5')));
reset role;
select tests.expect('cap rastre dels intents fallits', (select count(*) from public.clients where email in ('tipus@example.test', 'clau@example.test')) + (select count(*) from public.web_lead_intake where idempotency_key = tests.k(5)), 0);

\warn '--- 7. Qui ho veu al CRM i confirmació de la visita'
select tests.login(:'u_dir');
select tests.expect('direcció veu totes les sol·licituds', (select count(*) from public.web_lead_intake), 4);
select public.review_web_visit(:'i2', 'confirmada');
select tests.expect('visita confirmada per direcció', (select count(*) from public.web_lead_intake where id = :'i2' and visit_status = 'confirmada' and visit_reviewed_by = :'u_dir'), 1);
select tests.expect_error('una sol·licitud que no és visita no es confirma', format($$select public.review_web_visit(%L, 'confirmada')$$, :'i1'));
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte sense assignació no en veu cap', (select count(*) from public.web_lead_intake), 0);
select tests.expect_error('ni pot confirmar visites', format($$select public.review_web_visit(%L, 'descartada')$$, :'i2'));
reset role;
select tests.login(:'u_cliC');
select tests.expect('un client no veu la bústia', (select count(*) from public.web_lead_intake), 0);
reset role;

\warn '--- 8. Límit de peticions persistent'
select tests.login_service();
select tests.expect('dins del límit', (select count(*) from generate_series(1, 3) where public.web_rate_hit('prova:ip', 3, 3600)), 3);
select tests.expect('superat el límit', (select count(*) where public.web_rate_hit('prova:ip', 3, 3600)), 0);
select tests.expect('un altre origen no es veu afectat', (select count(*) where public.web_rate_hit('prova:ip2', 3, 3600)), 1);
reset role;

\warn '--- 9. La tarifa publicada no porta res més que la tarifa'
select tests.expect('cap clau de cost ni marge a la tarifa publicada', (select count(*) from public.web_published_tariff() t, jsonb_object_keys(t.params) k where k ~* '(cost|marge|margin|benefici)'), 0);
select tests.login_anon();
select tests.expect_error('anònim no llegeix la taula de tarifes (esborranys, historial)', $$select count(*) from public.tariff_versions$$);
reset role;
