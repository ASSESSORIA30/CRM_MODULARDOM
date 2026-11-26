-- Pressupostos del configurador web: versions, duplicats, descàrregues, enllaços, visites i permisos. Dades fictícies.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
select set_config('request.jwt.claims', '{}', false);
\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_arq2  '00000000-0000-0000-0000-000000000012'
\set u_cliC  '00000000-0000-0000-0000-000000000021'

create function tests.h(t text) returns text language sql as $$ select encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;
-- sol·licitud de pressupost amb una configuració de p_metres m²
create function tests.q_lead(p_email text, p_phone text, p_ref text, p_metres int) returns jsonb language sql as $$
  select jsonb_set(tests.web_payload('quote', 'Pressupost Prova', p_email, p_phone, p_ref, true), '{configurator,input,metres}', to_jsonb(p_metres))
$$;
create function tests.q_quote(p_metres int, p_tariff text, p_request text, p_total bigint default 25000000) returns jsonb language sql as $$
  select jsonb_build_object('configHash', tests.h('cfg-' || p_metres), 'tariff', p_tariff, 'requestId', p_request, 'locale', 'ca',
    'lines', jsonb_build_array(jsonb_build_object('key', 'construccio', 'label', jsonb_build_object('ca', 'Construcció', 'es', 'Construcción'), 'amountCents', p_total)),
    'roof', null, 'subtotalCents', p_total, 'vatWorksCents', 0, 'vatArchitectCents', 0, 'totalCents', p_total, 'hasPending', false, 'plot', 'yes')
$$;
create function tests.reg(p_n int, p_email text, p_phone text, p_metres int, p_tariff text, p_request text) returns jsonb language sql as $$
  select public.web_register_quote(tests.h('qk-' || p_n), tests.h('qs-' || p_n), tests.q_lead(p_email, p_phone, 'W261127-Q' || lpad(p_n::text, 3, '0'), p_metres), tests.q_quote(p_metres, p_tariff, p_request))
$$;
select count(*) as quotes0 from public.quotes \gset
select count(*) as clients0 from public.clients \gset

\warn '--- 1. Permisos'
select tests.login_anon();
select tests.expect_error('anònim no registra pressupostos', $$select tests.reg(1, 'pq@example.test', '644000001', 180, '1', 'aaaaaaaa-0000-0000-0000-000000000001')$$);
select tests.expect_error('anònim no llegeix l''historial', $$select count(*) from public.web_quotes$$);
select tests.expect_error('anònim no recupera per enllaç directament', format($$select public.web_recover_quote(%L)$$, repeat('a', 64)));
reset role;
select tests.login(:'u_dir');
select tests.expect_error('direcció no crida la funció de la integració', $$select tests.reg(1, 'pq@example.test', '644000001', 180, '1', 'aaaaaaaa-0000-0000-0000-000000000001')$$);
select tests.expect_error('ningú llegeix els enllaços des de l''API', $$select count(*) from public.web_quote_tokens$$);
reset role;

\warn '--- 2. Primer pressupost: client, oportunitat, versió 1, tasca de seguiment'
select tests.login_service();
select tests.reg(1, 'pq@example.test', '644000001', 180, '1', 'aaaaaaaa-0000-0000-0000-000000000001') as r1 \gset
reset role;
select (:'r1'::jsonb ->> 'id')::uuid as q1, (:'r1'::jsonb ->> 'client_id')::uuid as c1, (:'r1'::jsonb ->> 'project_id')::uuid as p1, :'r1'::jsonb ->> 'token' as t1 \gset
select tests.expect('creat, versió 1, sense PDF encara', (select count(*) where :'r1'::jsonb @> '{"created": true, "version": 1, "pdfStored": false, "reference": "W261127-Q001"}'), 1);
select tests.expect('historial: configuració, tarifa, import, terreny, municipi', (select count(*) from public.web_quotes where id = :'q1' and client_id = :'c1' and project_id = :'p1' and tariff_number = '1' and total_cents = 25000000 and plot = 'yes' and municipality = 'Bellvís' and configurator_input ->> 'metres' = '180' and status = 'nou' and downloads = 1), 1);
select tests.expect('una tasca de seguiment comercial', (select count(*) from public.tasks where project_id = :'p1' and title like 'Seguiment pressupost web%' and kind = 'comercial'), 1);
select tests.expect('cap pressupost definitiu creat', (select count(*) from public.quotes), :quotes0);
select tests.expect('l''enllaç és de 64 hex i només se''n desa el hash', (select count(*) from public.web_quote_tokens where quote_id = :'q1' and token_hash = tests.h(:'t1') and token_hash <> :'t1' and length(:'t1') = 64), 1);

\warn '--- 3. Mateix pressupost i mateixa tarifa: mateixa referència, descàrrega registrada, res duplicat'
select tests.login_service();
-- reintent de la mateixa petició (mateix identificador)
select tests.reg(1, 'pq@example.test', '644000001', 180, '1', 'aaaaaaaa-0000-0000-0000-000000000001') as r1b \gset
-- una altra descàrrega, un altre dia (clau i identificador nous)
select tests.reg(2, 'pq@example.test', '644000001', 180, '1', 'aaaaaaaa-0000-0000-0000-000000000002') as r1c \gset
reset role;
select tests.expect('reintent: mateixa referència, no creat', (select count(*) where :'r1b'::jsonb @> '{"created": false, "reference": "W261127-Q001", "version": 1}'), 1);
select tests.expect('nova descàrrega: referència original', (select count(*) where :'r1c'::jsonb @> '{"created": false, "reference": "W261127-Q001"}'), 1);
select tests.expect('2 descàrregues (el reintent no compta)', (select downloads from public.web_quotes where id = :'q1'), 2);
select tests.expect('un sol pressupost', (select count(*) from public.web_quotes where client_id = :'c1'), 1);
select tests.expect('un sol client', (select count(*) from public.clients), :clients0 + 1);
select tests.expect('una sola tasca', (select count(*) from public.tasks where project_id = :'p1' and title like 'Seguiment pressupost web%'), 1);
select tests.expect('activitat de la nova descàrrega', (select count(*) from public.activities where project_id = :'p1' and summary like 'Ha tornat a descarregar%'), 1);

\warn '--- 4. Configuració diferent o tarifa diferent: versió nova; les anteriors no canvien'
select tests.login_service();
select tests.reg(3, 'PQ@example.test', '+34 644 000 001', 220, '1', 'aaaaaaaa-0000-0000-0000-000000000003') as r2 \gset
select tests.reg(4, 'pq@example.test', '644000001', 220, '2', 'aaaaaaaa-0000-0000-0000-000000000004') as r3 \gset
reset role;
select tests.expect('altra configuració: versió 2, mateix client i oportunitat', (select count(*) where :'r2'::jsonb @> jsonb_build_object('created', true, 'version', 2, 'client_id', :'c1', 'project_id', :'p1')), 1);
select tests.expect('altra tarifa: versió 3', (select count(*) where :'r3'::jsonb @> '{"created": true, "version": 3}'), 1);
select tests.expect('la versió 1 conserva tarifa i import', (select count(*) from public.web_quotes where id = :'q1' and tariff_number = '1' and total_cents = 25000000 and version = 1), 1);
select tests.expect('3 versions al mateix client', (select count(*) from public.web_quotes where client_id = :'c1'), 3);
select tests.expect('encara un sol client i una sola tasca oberta', (select count(*) from public.clients) - :clients0 + (select count(*) from public.tasks where project_id = :'p1' and title like 'Seguiment pressupost web%'), 2);

\warn '--- 5. Recuperació amb l''enllaç: sense dades personals, caducitat i revocació'
select tests.login_service();
select public.web_recover_quote(:'t1') as rec \gset
reset role;
select tests.expect('retorna la configuració i els imports originals', (select count(*) where :'rec'::jsonb @> '{"reference": "W261127-Q001", "tariff": "1", "totalCents": 25000000}' and :'rec'::jsonb -> 'input' ->> 'metres' = '180'), 1);
select tests.expect('cap dada personal a la resposta', (select count(*) where :'rec' ~* '(example\.test|644000001|Pressupost Prova)'), 0);
select tests.login_service();
select tests.expect('un enllaç inventat no retorna res', (select count(*) where public.web_recover_quote(repeat('b', 64)) is null), 1);
reset role;
update public.web_quote_tokens set expires_at = now() - interval '1 minute' where token_hash = tests.h(:'t1');
select tests.login_service();
select tests.expect('enllaç caducat: res', (select count(*) where public.web_recover_quote(:'t1') is null), 1);
reset role;
select tests.login(:'u_dir');
select public.revoke_web_quote_links((:'r2'::jsonb ->> 'id')::uuid);
reset role;
select tests.login_service();
select tests.expect('enllaç revocat per direcció: res', (select count(*) where public.web_recover_quote(:'r2'::jsonb ->> 'token') is null), 1);

\warn '--- 6. Visita des del pressupost: mateix client, pendent de confirmació, sense duplicar'
select public.web_quote_request_visit(tests.h('qv-1'), tests.h('qvs-1'), :'r3'::jsonb ->> 'token', 'W261127-V001') as v1 \gset
select public.web_quote_request_visit(tests.h('qv-1'), tests.h('qvs-1b'), :'r3'::jsonb ->> 'token', 'W261127-V002') as v1b \gset
reset role;
select tests.expect('visita creada i repetició reconeguda', (select count(*) where :'v1'::jsonb @> '{"duplicate": false}' and :'v1b'::jsonb @> '{"duplicate": true}'), 1);
select tests.expect('lligada al client i a l''oportunitat, pendent de confirmació', (select count(*) from public.web_lead_intake where kind = 'visit' and client_id = :'c1' and project_id = :'p1' and visit_status = 'pendent_confirmacio' and payload ->> 'quoteReference' = 'W261127-Q004'), 1);
select tests.expect('el pressupost indica que ha demanat visita', (select count(*) from public.web_quotes where client_id = :'c1' and visit_requested_at is not null), 1);
select tests.expect('cap cita automàtica', (select count(*) from public.calendar_events where project_id = :'p1'), 0);

\warn '--- 7. Gestió comercial i visibilitat'
select tests.login(:'u_dir');
select tests.expect('direcció veu l''historial', (select count(*) from public.web_quotes where client_id = :'c1'), 3);
select public.set_web_quote_status(:'q1', 'contactat');
select tests.expect('estat comercial actualitzat', (select count(*) from public.web_quotes where id = :'q1' and status = 'contactat'), 1);
select tests.expect_error('estat inventat', format($$select public.set_web_quote_status(%L, 'venut')$$, :'q1'));
select tests.expect_error('no es modifica l''historial directament', format($$update public.web_quotes set total_cents = 1 where id = %L$$, :'q1'));
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte no veu imports de pressupostos web', (select count(*) from public.web_quotes), 0);
select tests.expect_error('ni en canvia l''estat', format($$select public.set_web_quote_status(%L, 'acceptat')$$, :'q1'));
reset role;
select tests.login(:'u_cliC');
select tests.expect('un client no veu l''historial', (select count(*) from public.web_quotes), 0);
reset role;
select tests.login_service();
select tests.expect('el PDF es desa una sola vegada', (select count(*) where public.web_quote_set_pdf(:'q1', 'a/b.pdf')) + (select count(*) where public.web_quote_set_pdf(:'q1', 'c/d.pdf')), 1);
reset role;
select tests.expect('bucket privat', (select count(*) from storage.buckets where id = 'pressupostos-web' and public = false), 1);
