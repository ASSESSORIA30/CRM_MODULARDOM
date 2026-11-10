-- FASE 2: pressupostos (versions immutables, totals, acceptació) i contractes (lectura, fites, validació)
-- Dades fictícies.
\set ON_ERROR_STOP on
\set QUIET on
reset role;
\set u_dir   '00000000-0000-0000-0000-000000000001'
\set u_cons  '00000000-0000-0000-0000-000000000003'
\set u_cliB  '00000000-0000-0000-0000-000000000006'
\set u_arq2  '00000000-0000-0000-0000-000000000012'
\set u_cliC  '00000000-0000-0000-0000-000000000021'
select id as pav from public.projects where title like 'Client Avantprojecte%' \gset

\warn '--- Configuració'
select tests.expect('IVA per defecte: projecte i direcció al 21 %', (select default_vat_bp from public.concept_types where code = 'projecte_direccio'), 2100);
select tests.expect('IVA per defecte: construcció al 10 %', (select default_vat_bp from public.concept_types where code = 'construccio'), 1000);
select tests.expect('darrera factura de la sèrie general: 13 (26-013)', (select last_number from public.invoice_series where code = 'general' and year = 2026), 13);

\warn '--- Pressupostos: permisos'
select tests.login(:'u_arq2');
select tests.expect_error('l''arquitecte no pot crear pressupostos', format($$select public.create_quote(%L, 'X')$$, :'pav'));
reset role;
select tests.login(:'u_cliC');
select tests.expect_error('el client no pot crear pressupostos', format($$select public.create_quote(%L, 'X')$$, :'pav'));
select tests.expect('el client no veu les sèries de factura', (select count(*) from public.invoice_series), 0);
reset role;

select tests.login(:'u_dir');
select public.create_quote(:'pav', 'Habitatge de prova') as v1 \gset
select tests.expect('codi de pressupost correlatiu', (select count(*) from public.quotes q join public.quote_versions v on v.quote_id = q.id
  where v.id = :'v1' and q.code ~ '^P[0-9]{2}-001$'), 1);
select quote_id as q1 from public.quote_versions where id = :'v1' \gset

-- 260 m² × 993 € = 258.180 €; cimentació 36.000; projecte 35.600 (21 %); extra 12.300; descompte −1.000
insert into public.quote_lines (version_id, position, chapter, kind, concept_type, description, quantity, unit, unit_price_cents, vat_rate_bp) values
  (:'v1', 1, 'Base', 'base', 'construccio', 'Construcció habitatge', 260, 'm²', 99300, 1000),
  (:'v1', 2, 'Base', 'base', 'cimentacio', 'Cimentació', 1, 'u', 3600000, 1000),
  (:'v1', 3, 'Base', 'base', 'projecte_direccio', 'Projecte, direcció i final d''obra', 1, 'u', 3560000, 2100),
  (:'v1', 4, 'Extres', 'extra_inicial', 'extra_constructiu', 'Cuina', 1, 'u', 1230000, 1000),
  (:'v1', 5, 'Descomptes', 'descompte', 'construccio', 'Descompte comercial', 1, 'u', -100000, 1000);
select tests.expect('base', (select base_cents from public.quote_version_totals where version_id = :'v1'), 32978000);
select tests.expect('extres inicials', (select extras_initial_cents from public.quote_version_totals where version_id = :'v1'), 1230000);
select tests.expect('descompte', (select discount_cents from public.quote_version_totals where version_id = :'v1'), -100000);
select tests.expect('base imposable', (select taxable_cents from public.quote_version_totals where version_id = :'v1'), 34108000);
-- 10 %: 30.548.000 → 3.054.800 · 21 %: 3.560.000 → 747.600
select tests.expect('IVA per tipus', (select vat_cents from public.quote_version_totals where version_id = :'v1'), 3802400);
select tests.expect('total amb IVA', (select total_cents from public.quote_version_totals where version_id = :'v1'), 37910400);
select tests.expect('dos tipus d''IVA al desglossament', (select jsonb_array_length(vat_breakdown) from public.quote_version_totals where version_id = :'v1'), 2);
select tests.expect_error('un descompte ha de ser negatiu', format($$insert into public.quote_lines (version_id, position, kind, description, unit_price_cents, vat_rate_bp) values (%L, 9, 'descompte', 'x', 500, 1000)$$, :'v1'));
select tests.expect_error('una partida no pot ser negativa', format($$insert into public.quote_lines (version_id, position, kind, description, unit_price_cents, vat_rate_bp) values (%L, 9, 'base', 'x', -500, 1000)$$, :'v1'));
-- Descompte per línia en percentatge: 10 % de 1.000,00 €
insert into public.quote_lines (version_id, position, kind, description, unit_price_cents, discount_bp, vat_rate_bp)
values (:'v1', 6, 'extra_inicial', 'Extra amb descompte', 100000, 1000, 1000);
select tests.expect('descompte en percentatge a la línia', (select amount_cents from public.quote_lines where version_id = :'v1' and position = 6), 90000);
delete from public.quote_lines where version_id = :'v1' and position = 6;

\warn '--- Enviar: versió immutable'
select tests.expect_error('cal una validesa posterior a l''emissió', format($$select public.send_quote_version(%L, '2026-11-10', '2026-11-01')$$, :'v1'));
select public.send_quote_version(:'v1', '2026-11-10', '2026-12-10');
select tests.expect_error('una versió enviada no es pot modificar', format($$update public.quote_lines set unit_price_cents = 1 where version_id = %L$$, :'v1'));
select tests.expect_error('ni afegir-hi partides', format($$insert into public.quote_lines (version_id, position, kind, description, unit_price_cents, vat_rate_bp) values (%L, 9, 'base', 'x', 1, 1000)$$, :'v1'));
select tests.expect_error('ni esborrar-ne', format($$delete from public.quote_lines where version_id = %L$$, :'v1'));
select tests.expect_error('ni canviar-ne les notes', format($$update public.quote_versions set notes = 'x' where id = %L$$, :'v1'));
select tests.expect_error('ni tornar-la a esborrany', format($$update public.quote_versions set status = 'esborrany' where id = %L$$, :'v1'));

select public.new_quote_version(:'q1') as v2 \gset
select tests.expect('la versió 2 copia les partides', (select count(*) from public.quote_lines where version_id = :'v2'), 5);
select tests.expect_error('només un esborrany alhora', format($$select public.new_quote_version(%L)$$, :'q1'));
update public.quote_lines set unit_price_cents = 3700000 where version_id = :'v2' and position = 2;
select tests.expect('la versió 1 no canvia', (select taxable_cents from public.quote_version_totals where version_id = :'v1'), 34108000);
select public.send_quote_version(:'v2', '2026-11-12', '2026-12-12');
select tests.expect('enviar la v2 substitueix la v1', (select count(*) from public.quote_versions where id = :'v1' and status = 'substituit'), 1);
select tests.expect_error('no es pot acceptar una versió substituïda', format($$select public.set_quote_outcome(%L, 'acceptat', '2026-11-15')$$, :'v1'));
reset role;

select tests.login(:'u_cliC');
select tests.expect('abans d''acceptar, el client no veu cap pressupost', (select count(*) from public.quote_versions), 0);
reset role;
select tests.login(:'u_dir');
select tests.expect_error('acceptar requereix la data', format($$select public.set_quote_outcome(%L, 'acceptat', null)$$, :'v2'));
select public.set_quote_outcome(:'v2', 'acceptat', '2026-11-15');
select tests.expect('pressupost acceptat', (select count(*) from public.quotes where id = :'q1' and accepted_version_id = :'v2'), 1);
select tests.expect_error('acceptat: els canvis van com a extres', format($$select public.new_quote_version(%L)$$, :'q1'));
reset role;

select tests.login(:'u_cliC');
select tests.expect('el client veu només la versió acceptada', (select count(*) from public.quote_versions where id = :'v2'), 1);
select tests.expect('i no la substituïda', (select count(*) from public.quote_versions where id = :'v1'), 0);
select tests.expect('i les seves partides', (select count(*) from public.quote_lines where version_id = :'v2'), 5);
select tests.expect('i els totals', (select count(*) from public.quote_version_totals where version_id = :'v2' and taxable_cents = 34208000), 1);
reset role;
select tests.login(:'u_cliB');
select tests.expect('un altre client no hi veu res', (select count(*) from public.quote_versions where project_id = :'pav'), 0);
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte no veu imports', (select count(*) from public.quote_lines), 0);
reset role;

select tests.login(:'u_dir');
select public.duplicate_quote(:'v2', :'pav', 'Còpia') as v3 \gset
select tests.expect('duplicar crea un esborrany amb les partides', (select count(*) from public.quote_lines l join public.quote_versions v on v.id = l.version_id
  where v.id = :'v3' and v.status = 'esborrany' and v.source = 'duplicat'), 5);
reset role;

\warn '--- Contractes'
select tests.login(:'u_dir');
insert into storage.objects (bucket_id, name) values ('contractes', 'p/' || :'pav' || '/contracte-prova.pdf');
insert into public.documents (id, project_id, bucket_id, storage_path, category, title, uploaded_by, status)
values ('e2000000-0000-0000-0000-000000000001', :'pav', 'contractes', 'p/' || :'pav' || '/contracte-prova.pdf', 'contracte', 'Contracte', :'u_dir', 'vigent');
select tests.expect_error('el contracte ha de ser un document del bucket de contractes',
  format($$select public.create_contract(%L, (select id from public.documents where bucket_id <> 'contractes' and project_id = %L limit 1), 'X')$$, :'pav', :'pav'));
select public.create_contract(:'pav', 'e2000000-0000-0000-0000-000000000001', 'Contracte d''obra', :'v2') as ctr \gset
select public.record_contract_extraction(:'ctr', 'prova', 'model-prova', 'v1', 3, '{"ok":true}', '[]',
  '{"total_cents": 34208000, "document_date": "2026-11-20"}',
  '[{"position":1,"code":"F1.01","phase":"Projecte","concept":"Signatura","amount_cents":"3560000","vat_rate_bp":2100,"source_page":2,"source_text":"35.600 €"},
    {"position":2,"code":"F2.01","phase":"Cimentació","concept":"Inici cimentació","amount_cents":"20000000","source_page":3},
    {"position":3,"code":"F2.02","phase":"Cimentació","concept":"Final cimentació","amount_cents":"9418000","source_page":3},
    {"position":4,"code":"F4.1","phase":"Extres","concept":"Cuina","amount_cents":"1230000","is_extra":true,"extra_label":"Cuina","source_page":4}]',
  '[{"kind":"pressupost_contracte","severity":"alta","message":"Diferència amb el pressupost","expected_cents":34208000,"found_cents":34208000}]') as ext1 \gset
select tests.expect('lectura 1 desada', (select count(*) from public.contract_extractions where contract_id = :'ctr' and version = 1), 1);
select tests.expect('fites proposades', (select count(*) from public.contract_milestones where contract_id = :'ctr' and not confirmed), 4);
select tests.expect('IVA no determinable queda buit', (select count(*) from public.contract_milestones where contract_id = :'ctr' and vat_rate_bp is null), 3);
select tests.expect('contracte en revisió amb el total llegit', (select count(*) from public.contracts where id = :'ctr' and status = 'en_revisio' and total_cents = 34208000), 1);
select tests.expect_error('no es pot validar amb fites sense confirmar', format($$select public.validate_contract(%L)$$, :'ctr'));

-- Correccions de direcció
update public.contract_milestones set vat_rate_bp = 1000, confirmed = true where contract_id = :'ctr' and vat_rate_bp is null;
update public.contract_milestones set confirmed = true where contract_id = :'ctr';
select tests.expect_error('discrepància oberta', format($$select public.validate_contract(%L)$$, :'ctr'));
select tests.expect_error('tancar una discrepància requereix una explicació',
  format($$update public.contract_discrepancies set status = 'ignorada' where contract_id = %L$$, :'ctr'));
update public.contract_discrepancies set status = 'ignorada', resolution = 'Error de càlcul confirmat per direcció',
  resolved_by = :'u_dir', resolved_at = now() where contract_id = :'ctr';

select public.split_contract_milestone((select id from public.contract_milestones where contract_id = :'ctr' and code = 'F2.01'), array[12000000, 8000000]::bigint[]);
select tests.expect('dividir: 5 fites', (select count(*) from public.contract_milestones where contract_id = :'ctr'), 5);
select tests.expect('dividir manté la suma', (select sum(amount_cents) from public.contract_milestones where contract_id = :'ctr')::bigint, 34208000);
select tests.expect_error('dividir amb imports que no sumen', format($$select public.split_contract_milestone((select id from public.contract_milestones where contract_id = %L and position = 1), array[1,2]::bigint[])$$, :'ctr'));
select tests.expect('ordre: les noves fites queden consecutives', (select count(*) from public.contract_milestones where contract_id = :'ctr' and code = 'F2.01' and position in (2,3)), 2);
select public.merge_contract_milestones(array(select id from public.contract_milestones where contract_id = :'ctr' and code = 'F2.01'));
select tests.expect('fusionar: 4 fites', (select count(*) from public.contract_milestones where contract_id = :'ctr'), 4);
select tests.expect_error('cal tornar a confirmar la fita fusionada', format($$select public.validate_contract(%L)$$, :'ctr'));
update public.contract_milestones set confirmed = true where contract_id = :'ctr';

update public.contracts set total_cents = 34208100 where id = :'ctr';
select tests.expect_error('la suma de les fites ha de coincidir amb el total', format($$select public.validate_contract(%L)$$, :'ctr'));
update public.contracts set total_cents = 34208000 where id = :'ctr';
reset role;
select tests.login(:'u_cliC');
select tests.expect('el client no veu contractes ni fites', (select count(*) from public.contracts) + (select count(*) from public.contract_milestones), 0);
select tests.expect_error('el client no pot validar el contracte', format($$select public.validate_contract(%L)$$, :'ctr'));
reset role;
select tests.login(:'u_cons');
select tests.expect('el constructor tampoc', (select count(*) from public.contract_milestones), 0);
reset role;

select tests.login(:'u_dir');
select public.validate_contract(:'ctr');
select tests.expect('contracte validat', (select count(*) from public.contracts where id = :'ctr' and status = 'validat' and validated_by = :'u_dir'), 1);
select tests.expect_error('un contracte validat no es pot modificar', format($$update public.contract_milestones set amount_cents = 1 where contract_id = %L$$, :'ctr'));
select tests.expect_error('ni afegir-hi fites', format($$insert into public.contract_milestones (contract_id, position, concept, amount_cents) values (%L, 9, 'x', 1)$$, :'ctr'));
select tests.expect_error('ni canviar-ne el total', format($$update public.contracts set total_cents = 1 where id = %L$$, :'ctr'));
select tests.expect_error('ni tornar-lo a llegir', format($$select public.record_contract_extraction(%L, 'p', 'm', 'v', 1, '{}', '[]', '{}', '[]', '[]')$$, :'ctr'));
select tests.expect_error('les lectures de la IA no es poden reescriure', format($$update public.contract_extractions set output = '{}' where id = %L$$, :'ext1'));
reset role;
select tests.expect('registre de correccions a l''auditoria', (select (count(*) > 0)::int from public.audit_log where table_name = 'contract_milestones' and action = 'UPDATE'), 1);
\warn '=== PROVES PRESSUPOSTOS I CONTRACTES SUPERADES ==='

\warn '--- Desar esborrany i dades de l''empresa'
select tests.login(:'u_dir');
select public.save_quote_draft(:'v3', 'ca', 'Introducció', null,
  '[{"chapter":"Base","kind":"base","concept_type":"construccio","description":"Construcció","quantity":"100.5","unit":"m²","unit_price_cents":100000,"vat_rate_bp":1000},
    {"chapter":"Base","kind":"base","concept_type":"projecte_direccio","description":"Projecte","quantity":"1","unit_price_cents":1000000,"vat_rate_bp":2100}]');
select tests.expect('l''esborrany es reescriu sencer', (select count(*) from public.quote_lines where version_id = :'v3'), 2);
select tests.expect('quantitats decimals', (select amount_cents from public.quote_lines where version_id = :'v3' and position = 1), 10050000);
select tests.expect_error('una línia invàlida desfà tot el desament', format($$select public.save_quote_draft(%L, 'ca', null, null,
  '[{"kind":"base","description":"ok","quantity":"1","unit_price_cents":1,"vat_rate_bp":1000},{"kind":"base","description":"","quantity":"1","unit_price_cents":1,"vat_rate_bp":1000}]')$$, :'v3'));
select tests.expect('i les partides anteriors es conserven', (select count(*) from public.quote_lines where version_id = :'v3'), 2);
select tests.expect_error('no es pot desar sobre una versió enviada', format($$select public.save_quote_draft(%L, 'ca', null, null, '[]')$$, :'v2'));
select tests.expect('dades de l''empresa: NIF pendent d''introduir', (select count(*) from public.company_settings where tax_id is null), 1);
reset role;
select tests.login(:'u_arq2');
select tests.expect('l''arquitecte no veu l''IBAN ni les dades de facturació', (select count(*) from public.company_settings), 0);
reset role;
\warn '=== PROVES DESAR ESBORRANY SUPERADES ==='

\warn '--- Reordenar fites'
select tests.login(:'u_dir');
select public.create_contract(:'pav', 'e2000000-0000-0000-0000-000000000001', 'Contracte 2') as ctr2 \gset
select public.record_contract_extraction(:'ctr2', 'manual', '-', 'manual', null, '{}', '[]', '{}',
  '[{"position":1,"concept":"A","amount_cents":1},{"position":2,"concept":"B","amount_cents":2},{"position":3,"concept":"C","amount_cents":3}]', '[]');
select public.move_contract_milestone((select id from public.contract_milestones where contract_id = :'ctr2' and concept = 'C'), -1);
select tests.expect('C puja una posició', (select position from public.contract_milestones where contract_id = :'ctr2' and concept = 'C'), 2);
select tests.expect('B baixa una posició', (select position from public.contract_milestones where contract_id = :'ctr2' and concept = 'B'), 3);
select public.move_contract_milestone((select id from public.contract_milestones where contract_id = :'ctr2' and concept = 'A'), -1);
select tests.expect('la primera no es mou', (select position from public.contract_milestones where contract_id = :'ctr2' and concept = 'A'), 1);
select tests.expect('lectura manual: contracte en revisió', (select count(*) from public.contracts where id = :'ctr2' and status = 'en_revisio'), 1);
reset role;
\warn '=== PROVES REORDENAR SUPERADES ==='
