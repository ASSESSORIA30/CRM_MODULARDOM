-- Pressupostos v2: tarifes, partides opcionals, preus manuals, importacions, publicació, extres i permisos.
-- Dades fictícies.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_arq   '00000000-0000-0000-0000-000000000002'
\set u_cons  '00000000-0000-0000-0000-000000000003'
\set u_cliB  '00000000-0000-0000-0000-000000000006'
\set u_arq2  '00000000-0000-0000-0000-000000000012'
\set u_cliC  '00000000-0000-0000-0000-000000000021'
select id as pav from public.projects where title like 'Client Avantprojecte%' \gset
-- (el constructor de prova es desactiva a la prova 01; aquí es reactiva i s'assigna al projecte)
update public.profiles set is_active = true where id = :'u_cons';
insert into public.project_members (project_id, profile_id, member_role) values (:'pav', :'u_cons', 'constructor') on conflict do nothing;

\warn '--- Tarifes'
select tests.expect('tarifa inicial aprovada i en vigor', (select count(*) from public.tariff_versions where id = public.tariff_in_force() and number = 1), 1);
select tests.expect('arquitecte: 130 €/m² + 1.800 €', (select (params->>'arquitecte_m2')::int * 1000 + (params->>'arquitecte_fix')::int from public.tariff_versions where number = 1), 131800);
select tests.expect('encara no publicada a la web', (select count(*) from public.web_published_tariff()), 0);
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte llegeix la tarifa', (select count(*) from public.tariff_versions), 1);
select tests.expect_error('però no la pot canviar', $$select public.new_tariff_draft()$$);
reset role;
select tests.login(:'u_cliC');
select tests.expect('el client no veu la tarifa interna', (select count(*) from public.tariff_versions), 0);
reset role;
select tests.login(:'u_dir');
select tests.expect_error('una tarifa aprovada no es modifica', $$update public.tariff_versions set params = '{}' where number = 1$$);
select tests.expect_error('ni s''elimina', $$delete from public.tariff_versions where number = 1$$);
select public.new_tariff_draft() as t2 \gset
select tests.expect_error('només un esborrany de tarifa', $$select public.new_tariff_draft()$$);
update public.tariff_versions set params = jsonb_set(params, '{construccio_m2}', '1010') where id = :'t2';
select public.approve_tariff(:'t2', (current_date + 30), 'Preu nou');
select tests.expect('la tarifa nova no s''aplica abans de la data', (select number from public.tariff_versions where id = public.tariff_in_force()), 1);
select tests.expect('sí a partir de la data', (select number from public.tariff_versions where id = public.tariff_in_force(current_date + 30)), 2);
select tests.expect_error('no es pot publicar a la web abans d''entrar en vigor', format($$select public.publish_tariff_to_web(%L)$$, :'t2'));
select public.publish_tariff_to_web((select id from public.tariff_versions where number = 1));
reset role;
select tests.expect('la web llegeix la tarifa publicada (anònim)', (select count(*) from public.web_published_tariff() where number = 1), 1);
select tests.expect('historial de canvis de tarifa a l''auditoria', (select (count(*) > 0)::int from public.audit_log where table_name = 'tariff_versions'), 1);

\warn '--- Configurador, partides opcionals i preus manuals'
select tests.login(:'u_arq2');
select public.create_quote(:'pav', 'Pressupost configurador') as v1 \gset
select quote_id as q1 from public.quote_versions where id = :'v1' \gset
select public.set_configurator_snapshot(:'v1', public.tariff_in_force(), '{"metres":150}', '{"totalCents":1}');
select tests.expect_error('l''arquitecte no pot canviar un preu de catàleg', format($$select public.save_quote_draft(%L, 'es', null, null, null, null,
  '[{"kind":"base","description":"Construcción","quantity":"150","unit":"m²","unit_price_cents":90000,"vat_rate_bp":1000,"catalog_key":"construccio","catalog_unit_price_cents":99300}]')$$, :'v1'));
select public.save_quote_draft(:'v1', 'es', null, null, 'Licencias y tasas municipales', 'Según contrato',
  '[{"kind":"base","description":"Construcción","quantity":"150","unit":"m²","unit_price_cents":99300,"vat_rate_bp":1000,"catalog_key":"construccio","catalog_unit_price_cents":99300,"constructor_visible":true},
    {"kind":"base","description":"Honorarios de arquitecto","quantity":"1","unit_price_cents":2130000,"vat_rate_bp":2100,"catalog_key":"arquitecte","catalog_unit_price_cents":2130000},
    {"kind":"extra_inicial","description":"Piscina","quantity":"1","unit_price_cents":2200000,"vat_rate_bp":1000,"status":"opcional"},
    {"kind":"extra_inicial","description":"Muro de contención","quantity":"1","unit_price_cents":0,"vat_rate_bp":1000,"status":"pendent_valoracio"},
    {"kind":"base","description":"Urbanización exterior","quantity":"1","unit_price_cents":500000,"vat_rate_bp":1000,"status":"exclosa"}]');
select tests.expect('l''opcional, el pendent i l''exclòs no sumen al total', (select taxable_cents from public.quote_version_totals where version_id = :'v1'), 14895000 + 2130000);
select tests.expect('opcionals a part', (select optional_cents from public.quote_version_totals where version_id = :'v1'), 2200000);
select tests.expect('partides pendents de valoració', (select pending_valuation from public.quote_version_totals where version_id = :'v1'), 1);
select tests.expect('origen configurador', (select count(*) from public.quote_versions where id = :'v1' and source = 'configurador' and tariff_version_id is not null), 1);
reset role;
select tests.login(:'u_dir');
select public.save_quote_draft(:'v1', 'es', null, null, 'Licencias y tasas municipales', 'Según contrato',
  '[{"kind":"base","description":"Construcción","quantity":"150","unit":"m²","unit_price_cents":95000,"vat_rate_bp":1000,"catalog_key":"construccio","catalog_unit_price_cents":99300,"constructor_visible":true},
    {"kind":"extra_inicial","description":"Piscina","quantity":"1","unit_price_cents":2200000,"vat_rate_bp":1000,"status":"opcional"}]');
select tests.expect('direcció pot fixar un preu manual i queda marcat', (select count(*) from public.quote_lines where version_id = :'v1' and price_overridden), 1);
select tests.expect('el catàleg no canvia', (select (params->>'construccio_m2')::int from public.tariff_versions where number = 1), 993);
select tests.expect_error('un esborrany no es publica al client', format($$select public.publish_quote_version(%L, true)$$, :'v1'));
select public.send_quote_version(:'v1', current_date, current_date + 30);
reset role;
select tests.login(:'u_cliC');
select tests.expect('enviat però no publicat: el client no el veu', (select count(*) from public.quote_versions where id = :'v1'), 0);
reset role;
select tests.login(:'u_dir');
select public.publish_quote_version(:'v1', true);
select public.set_current_quote(:'v1');
select tests.expect('versió vigent', (select count(*) from public.quote_versions where project_id = :'pav' and is_current), 1);
reset role;
select tests.login(:'u_cliC');
select tests.expect('publicat: el client el veu', (select count(*) from public.quote_versions where id = :'v1'), 1);
select tests.expect('amb les partides no excloses', (select count(*) from public.quote_lines where version_id = :'v1'), 2);
select tests.expect_error('decisions del client desactivades per defecte', format($$select public.client_decide_quote(%L, 'acceptat')$$, :'v1'));
reset role;
select tests.login(:'u_cliB');
select tests.expect('un altre client no el veu', (select count(*) from public.quote_versions where id = :'v1'), 0);
select tests.expect_error('ni el pot acceptar', format($$select public.client_decide_quote(%L, 'acceptat')$$, :'v1'));
reset role;
select tests.login(:'u_arq');
select tests.expect('un arquitecte d''un altre projecte no hi veu res', (select count(*) from public.quote_versions where project_id = :'pav'), 0);
select tests.expect_error('ni pot crear-hi pressupostos', format($$select public.create_quote(%L, 'X')$$, :'pav'));
reset role;
select tests.login(:'u_cons');
select tests.expect('constructor: només la partida autoritzada', (select count(*) from public.constructor_quote_scope(:'pav')), 1);
select tests.expect('constructor: sense accés als imports', (select count(*) from public.quote_lines), 0);
reset role;

update public.company_settings set client_quote_decisions = true;
select tests.login(:'u_cliC');
select public.client_decide_quote(:'v1', 'acceptat');
select tests.expect('acceptació del client registrada amb usuari, data i versió', (select count(*) from public.quote_versions
  where id = :'v1' and status = 'acceptat' and client_decided_by = :'u_cliC' and accepted_on is not null), 1);
select tests.expect_error('no es pot respondre dues vegades', format($$select public.client_decide_quote(%L, 'rebutjat')$$, :'v1'));
reset role;
select tests.expect('el pressupost queda acceptat', (select count(*) from public.quotes where id = :'q1' and accepted_version_id = :'v1'), 1);
select tests.expect('la direcció en rep l''avís', (select (count(*) > 0)::int from public.notifications where user_id = :'u_dir' and kind = 'pressupost_resposta'), 1);
select tests.login(:'u_dir');
select tests.expect_error('una versió aprovada no es pot sobreescriure', format($$select public.save_quote_draft(%L, 'es', null, null, null, null, '[]')$$, :'v1'));
reset role;

\warn '--- Importació'
select tests.login(:'u_dir');
insert into storage.objects (bucket_id, name) values ('pressupostos', 'p/' || :'pav' || '/pressupost-extern.pdf');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, status, sha256)
values ('e3000000-0000-0000-0000-000000000001', :'pav', 'pressupostos', 'p/' || :'pav' || '/pressupost-extern.pdf', 'pressupost', 'Pressupost extern', :'u_dir', 'vigent', repeat('a', 64));
select public.register_quote_import(:'pav', 'e3000000-0000-0000-0000-000000000001', 'Pressupost extern', 'enviat') as imp \gset
select public.record_quote_import_analysis(:'imp', 'prova', 'model', '{"lines":[]}');
select tests.expect_error('no es converteix amb partides per revisar', format($$select public.convert_quote_import(%L, 'Importat', 'es', null, null, null, null,
  '[{"kind":"base","description":"Partida","quantity":"1","unit_price_cents":100,"vat_rate_bp":1000,"needs_review":true}]')$$, :'imp'));
select public.convert_quote_import(:'imp', 'Importat', 'es', null, null, 'Exclusions', null,
  '[{"kind":"base","description":"Partida","quantity":"2","unit_price_cents":100,"vat_rate_bp":1000,"source_ref":"pàg. 1"}]') as vimp \gset
select tests.expect('convertit en esborrany editable vinculat a l''original', (select count(*) from public.quote_versions
  where id = :'vimp' and status = 'esborrany' and source = 'importat' and origin_import_id = :'imp'), 1);
select tests.expect('l''original es conserva intacte', (select count(*) from public.documents where id = 'e3000000-0000-0000-0000-000000000001' and sha256 = repeat('a', 64)), 1);
select tests.expect_error('una importació es converteix una sola vegada', format($$select public.convert_quote_import(%L, 'x', 'es', null, null, null, null, '[{"kind":"base","description":"x","quantity":"1","unit_price_cents":1,"vat_rate_bp":1000}]')$$, :'imp'));
reset role;

\warn '--- Extres'
select tests.login(:'u_dir');
select public.create_project_extra(:'pav', 'Piscina', 'Piscina 7x3', 2200000, 1000, 'extra_constructiu',
  (select id from public.quote_lines where version_id = :'v1' and status = 'opcional')) as ex1 \gset
select tests.expect_error('una partida inclosa no es converteix en extra', format($$select public.create_project_extra(%L, 'X', null, 1, 1000, null, (select id from public.quote_lines where version_id = %L and status = 'inclosa'))$$, :'pav', :'v1'));
select tests.expect_error('la mateixa partida opcional no genera dos extres', format($$select public.create_project_extra(%L, 'X', null, 1, 1000, null, (select id from public.quote_lines where version_id = %L and status = 'opcional'))$$, :'pav', :'v1'));
select public.create_project_extra(:'pav', 'Pèrgola', null, 500000, 1000, 'extra_constructiu') as ex2 \gset
select tests.expect('codis correlatius', (select count(*) from public.project_extras where project_id = :'pav' and code in ('EX-01', 'EX-02')), 2);
select tests.expect_error('aprovar requereix la data', format($$select public.set_extra_status(%L, 'aprovat', null, null)$$, :'ex1'));
select tests.expect_error('no es pot saltar a facturat', format($$select public.set_extra_status(%L, 'facturat', current_date, null)$$, :'ex1'));
select public.set_extra_status(:'ex1', 'pendent_aprovacio', null, 'Enviat al client');
reset role;
select tests.login(:'u_cliC');
select tests.expect('el client veu l''extra pendent', (select count(*) from public.project_extras where id = :'ex1'), 1);
select tests.expect('però no la proposta interna', (select count(*) from public.project_extras where id = :'ex2'), 0);
select tests.expect('ni els costos', (select count(*) from public.project_extra_costs), 0);
select public.client_decide_extra(:'ex1', 'aprovat');
reset role;
select tests.expect('acceptat pel client: data, usuari i via', (select count(*) from public.project_extras where id = :'ex1'
  and status = 'aprovat' and accepted_by = :'u_cliC' and accepted_via = 'portal' and accepted_on is not null), 1);
select tests.login(:'u_dir');
select tests.expect_error('un extra aprovat no canvia d''import', format($$update public.project_extras set amount_cents = 1 where id = %L$$, :'ex1'));
update public.project_extras set estimated_cost_cents = 1500000 where id = :'ex1';
select tests.expect('aprovat no vol dir facturat ni cobrat', (select invoiced_cents + collected_cents from public.project_extras_economics where project_id = :'pav'), 0);
select tests.expect('import aprovat al control econòmic', (select approved_cents from public.project_extras_economics where project_id = :'pav'), 2200000);
select tests.expect_error('incorporar requereix l''annex', format($$select public.set_extra_status(%L, 'incorporat', current_date, null)$$, :'ex1'));
insert into public.project_extra_milestones (extra_id, position, concept, amount_cents) values (:'ex1', 1, 'Inici', 1100000);
select tests.expect_error('les fites han de sumar l''import', format($$select public.set_extra_status(%L, 'incorporat', current_date, null, 'e3000000-0000-0000-0000-000000000001')$$, :'ex1'));
insert into public.project_extra_milestones (extra_id, position, concept, amount_cents) values (:'ex1', 2, 'Final', 1100000);
select public.set_extra_status(:'ex1', 'incorporat', current_date, 'Annex 1', 'e3000000-0000-0000-0000-000000000001');
select tests.expect_error('fites bloquejades un cop incorporat', format($$update public.project_extra_milestones set amount_cents = 1 where extra_id = %L$$, :'ex1'));
insert into public.project_extra_costs (extra_id, supplier, description, amount_cents, cost_date) values (:'ex1', 'Proveïdor de prova', 'Vas', 1600000, current_date);
select tests.expect('cost real i marge', (select approved_cents - actual_cost_cents from public.project_extras_economics where project_id = :'pav'), 600000);
select public.set_extra_status(:'ex1', 'executat', current_date, null);
select public.set_extra_status(:'ex1', 'facturat', current_date, null);
select tests.expect('facturat però encara no cobrat', (select invoiced_cents * 10 + collected_cents from public.project_extras_economics where project_id = :'pav'), 22000000);
select public.set_extra_status(:'ex1', 'cobrat', current_date, null);
select tests.expect('cobrat', (select collected_cents from public.project_extras_economics where project_id = :'pav'), 2200000);
select tests.expect('historial complet d''estats', (select count(*) from public.project_extra_events where extra_id = :'ex1'), 7);
select tests.expect_error('rebutjar requereix motiu', format($$select public.set_extra_status(%L, 'rebutjat', null, null)$$, :'ex2'));
select public.set_extra_status(:'ex2', 'rebutjat', null, 'No interessa');
select tests.expect('un extra rebutjat no suma', (select approved_cents from public.project_extras_economics where project_id = :'pav'), 2200000);
select public.mark_extra_included(:'ex1', :'v1');
select tests.expect('inclòs en una versió posterior: no es duplica', (select approved_cents from public.project_extras_economics where project_id = :'pav'), 0);
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte veu els extres del projecte', (select count(*) from public.project_extras where project_id = :'pav'), 2);
select tests.expect('però no els costos', (select count(*) from public.project_extra_costs), 0);
select tests.expect_error('ni canvia l''estat', format($$select public.set_extra_status(%L, 'proposat', null, null)$$, :'ex2'));
reset role;
update public.company_settings set client_quote_decisions = false;
select tests.login(:'u_dir');
update public.profiles set is_active = false where id = :'u_cons';
reset role;
\warn '=== PROVES PRESSUPOSTOS V2 SUPERADES ==='
