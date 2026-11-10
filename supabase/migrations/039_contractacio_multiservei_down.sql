-- 039 · REVERSIÓ de la contractació multiservei.
-- Treu només el que afegeix la 039. ATENCIÓ: les línies de mòbil, l'historial d'estats dels contractes i les
-- regles de comissió dels serveis es perden. Els contractes NO s'esborren: es conserven amb les columnes d'abans.
-- Les restriccions originals es tornen a posar com a NOT VALID perquè els contractes de serveis nous que ja
-- existeixin no facin fallar la reversió (els nous registres sí que es tornen a validar).

drop trigger if exists crm_contracts_default_service on public.crm_contracts;
drop trigger if exists crm_contracts_log on public.crm_contracts;
drop function if exists public.crm_contract_default_service();

drop table if exists public.crm_contract_lines;
drop table if exists public.crm_contract_events;
drop function if exists public.crm_contract_log();
drop table if exists public.fin_service_rules;

delete from public.crm_doc_requirements where is_example and name in ('Pòlissa signada', 'Pressupost acceptat de la instal·lació', 'Sol·licitud de portabilitat signada', 'Contracte del servei signat');

alter table public.crm_contract_finance drop constraint if exists crm_finance_commission_status_chk;
alter table public.crm_contract_finance drop constraint if exists crm_finance_cobrada_chk;
alter table public.crm_contract_finance drop constraint if exists crm_finance_liquidada_chk;
alter table public.crm_contract_finance drop constraint if exists crm_finance_amounts_chk;
alter table public.crm_contract_finance drop column if exists commission_model;
alter table public.crm_contract_finance drop column if exists commission_expected_eur;
alter table public.crm_contract_finance drop column if exists commission_status;
alter table public.crm_contract_finance drop column if exists collaborator_pct;
alter table public.crm_contract_finance drop column if exists collaborator_eur;
alter table public.crm_contract_finance drop column if exists settlement_ref;
alter table public.crm_contract_finance drop column if exists clawback_until;
alter table public.crm_contract_finance drop column if exists rule_ids;

drop index if exists public.crm_contracts_service_idx;
drop index if exists public.crm_contracts_permanence_idx;
alter table public.crm_contracts drop constraint if exists crm_contracts_service_chk;
alter table public.crm_contracts drop constraint if exists crm_contracts_details_obj_chk;
alter table public.crm_contracts drop constraint if exists crm_contracts_monthly_chk;
alter table public.crm_contracts drop column if exists service;
alter table public.crm_contracts drop column if exists details;
alter table public.crm_contracts drop column if exists permanence_end;
alter table public.crm_contracts drop column if exists monthly_eur;
alter table public.crm_contracts drop column if exists provider_ref;
alter table public.crm_contracts drop column if exists collaborator_id;

do $$ begin
  alter table public.crm_contracts drop constraint if exists crm_contracts_status_v2;
  if not exists (select 1 from pg_constraint where conname = 'crm_contracts_status_check') then
    alter table public.crm_contracts add constraint crm_contracts_status_check check (status in ('esborrany', 'pendent_documentacio', 'pendent_signatura', 'enviat_comercialitzadora', 'en_tramitacio', 'actiu', 'renovacio_pendent', 'finalitzat', 'anullat', 'incidencia')) not valid;
  end if;
  alter table public.crm_expedients drop constraint if exists crm_expedients_service_v2;
  if not exists (select 1 from pg_constraint where conname = 'crm_expedients_service_check') then
    alter table public.crm_expedients add constraint crm_expedients_service_check check (service in ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes')) not valid;
  end if;
  alter table public.fin_rules drop constraint if exists fin_rules_service_v2;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_service_check') then
    alter table public.fin_rules add constraint fin_rules_service_check check (service is null or service in ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes')) not valid;
  end if;
  alter table public.crm_documents drop constraint if exists crm_documents_category_v2;
  if not exists (select 1 from pg_constraint where conname = 'crm_documents_category_chk') then
    alter table public.crm_documents add constraint crm_documents_category_chk check (category in ('dni_nie', 'fiscal', 'factura_llum', 'factura_gas', 'contracte', 'contracte_signat', 'mandat', 'proposta', 'bancaria', 'altres', 'proteccio_dades')) not valid;
  end if;
  alter table public.crm_doc_requirements drop constraint if exists crm_doc_requirements_doc_category_v2;
  if not exists (select 1 from pg_constraint where conname = 'crm_doc_requirements_doc_category_check') then
    alter table public.crm_doc_requirements add constraint crm_doc_requirements_doc_category_check check (doc_category is null or doc_category in ('dni_nie', 'fiscal', 'factura_llum', 'factura_gas', 'contracte', 'contracte_signat', 'mandat', 'proposta', 'bancaria', 'altres')) not valid;
  end if;
end $$;

-- comprovació: ha de tornar 0 files
-- select column_name from information_schema.columns where table_name = 'crm_contracts' and column_name in ('service', 'details', 'permanence_end');
