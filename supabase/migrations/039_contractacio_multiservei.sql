-- =====================================================================================================
-- 039 · CONTRACTACIÓ MULTISERVEI
-- Fibra, mòbil, fibra + mòbil, assegurances, alarmes, plaques solars i altres serveis dins del MATEIX
-- sistema de contractes (crm_contracts). No es crea cap sistema paral·lel.
--   · crm_contracts: servei, dades pròpies del servei (details), permanència, quota, referència, col·laborador
--   · crm_contract_lines: línies de mòbil (cada una amb tarifa, preu i estat propis)
--   · crm_contract_events: historial d'estats (no s'esborra mai)
--   · crm_contract_finance: estat de la comissió, col·laborador i liquidació (mai «cobrada» sense data)
--   · fin_service_rules: regles de comissió per proveïdor i producte (només Direcció les aprova)
--   · s'amplien les llistes de serveis, estats i categories de document (sense treure'n cap)
-- Idempotent: es pot tornar a executar. No elimina cap taula ni relació. Reversió: 039_..._down.sql
-- =====================================================================================================

-- ------------------------------------------------------------------ 1. crm_contracts: columnes noves
alter table public.crm_contracts add column if not exists service text;
alter table public.crm_contracts add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.crm_contracts add column if not exists permanence_end date;
alter table public.crm_contracts add column if not exists monthly_eur numeric(12, 2);
alter table public.crm_contracts add column if not exists provider_ref text;
alter table public.crm_contracts add column if not exists collaborator_id uuid references auth.users (id) on delete set null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_contracts_service_chk') then
    alter table public.crm_contracts add constraint crm_contracts_service_chk check (service is null or service in
      ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes', 'fibra', 'mobil', 'fibra_mobil', 'plaques_solars', 'altres'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_contracts_details_obj_chk') then
    alter table public.crm_contracts add constraint crm_contracts_details_obj_chk check (jsonb_typeof(details) = 'object');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_contracts_monthly_chk') then
    alter table public.crm_contracts add constraint crm_contracts_monthly_chk check (monthly_eur is null or monthly_eur >= 0);
  end if;
  -- estats: s'hi afegeixen els dels serveis nous (cap estat existent desapareix)
  alter table public.crm_contracts drop constraint if exists crm_contracts_status_check;
  if not exists (select 1 from pg_constraint where conname = 'crm_contracts_status_v2') then
    alter table public.crm_contracts add constraint crm_contracts_status_v2 check (status in
      ('esborrany', 'pendent_documentacio', 'pendent_signatura', 'enviat_comercialitzadora', 'en_tramitacio', 'actiu', 'renovacio_pendent', 'finalitzat', 'anullat', 'incidencia',
       'pendent_installacio', 'pendent_portabilitat', 'en_execucio', 'pendent_legalitzacio', 'baixa'));
  end if;
end $$;

-- servei dels contractes existents (només on és buit: no es toca res ja informat).
-- Ordre: servei de l'expedient d'origen (si és compatible), tipus d'energia del subministrament i tipus de client.
update public.crm_contracts k set service = coalesce(
    (select e.service from public.crm_expedients e where e.contract_id = k.id and (k.supply_id is null or e.service in ('llum_residencial', 'llum_empresa', 'gas')) order by e.created_at desc limit 1),
    (select case when s.energy_type = 'gas' then 'gas' end from public.crm_supplies s where s.id = k.supply_id),
    (select case when c.kind = 'particular' then 'llum_residencial' else 'llum_empresa' end from public.crm_clients c where c.id = k.client_id))
  where k.service is null;

-- els contractes creats per altres camins (importació, expedients) reben el servei automàticament
create or replace function public.crm_contract_default_service() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.service is null then
    select case when s.energy_type = 'gas' then 'gas' end into new.service from crm_supplies s where s.id = new.supply_id;
    if new.service is null then
      select case when c.kind = 'particular' then 'llum_residencial' else 'llum_empresa' end into new.service from crm_clients c where c.id = new.client_id;
    end if;
  end if;
  -- un servei que no és d'energia no s'enllaça mai a un CUPS (els contractes antics es respecten tal com són)
  if (tg_op = 'INSERT' or old.service is not null) and new.service not in ('llum_residencial', 'llum_empresa', 'gas') and new.supply_id is not null then
    raise exception 'Un contracte de % no es pot enllaçar a un subministrament d''energia (CUPS)', new.service using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists crm_contracts_default_service on public.crm_contracts;
create trigger crm_contracts_default_service before insert or update of service, supply_id on public.crm_contracts for each row execute function public.crm_contract_default_service();

create index if not exists crm_contracts_service_idx on public.crm_contracts (service, status);
create index if not exists crm_contracts_permanence_idx on public.crm_contracts (permanence_end) where permanence_end is not null;

-- ------------------------------------------------------------------ 2. línies de mòbil
create table if not exists public.crm_contract_lines (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.crm_contracts (id) on delete cascade,
  position integer not null default 1 check (position between 1 and 50),
  phone_number text check (phone_number is null or phone_number ~ '^(\+34)?[6789][0-9]{8}$'),
  line_type text not null default 'nova' check (line_type in ('nova', 'portabilitat')),
  donor_operator text,
  holder_name text,
  tariff text,
  data_gb numeric(10, 2) check (data_gb is null or data_gb >= 0),
  price_monthly_eur numeric(10, 2) check (price_monthly_eur is null or price_monthly_eur >= 0),
  included_in_package boolean not null default false,
  status text not null default 'pendent' check (status in ('pendent', 'portabilitat_en_curs', 'activa', 'incidencia', 'baixa')),
  activated_at date,
  removed_at timestamptz,                                  -- una línia treta es dona de baixa, no s'esborra
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (line_type <> 'portabilitat' or phone_number is not null)
);
create index if not exists crm_contract_lines_contract_idx on public.crm_contract_lines (contract_id, position);
-- un mateix número no pot estar viu dues vegades al mateix contracte
create unique index if not exists crm_contract_lines_phone_uq on public.crm_contract_lines (contract_id, phone_number) where phone_number is not null and status <> 'baixa';

drop trigger if exists crm_contract_lines_touch on public.crm_contract_lines;
create trigger crm_contract_lines_touch before update on public.crm_contract_lines for each row execute function public.crm_touch();

-- les línies no s'esborren des del navegador: es donen de baixa (historial)
alter table public.crm_contract_lines enable row level security;
drop policy if exists p_crm_lines_select on public.crm_contract_lines;
create policy p_crm_lines_select on public.crm_contract_lines for select to authenticated
  using (exists (select 1 from public.crm_contracts k where k.id = contract_id and public.crm_can_see_client(k.client_id)));
drop policy if exists p_crm_lines_insert on public.crm_contract_lines;
create policy p_crm_lines_insert on public.crm_contract_lines for insert to authenticated
  with check (exists (select 1 from public.crm_contracts k where k.id = contract_id and public.crm_can_edit_client(k.client_id)));
drop policy if exists p_crm_lines_update on public.crm_contract_lines;
create policy p_crm_lines_update on public.crm_contract_lines for update to authenticated
  using (exists (select 1 from public.crm_contracts k where k.id = contract_id and public.crm_can_edit_client(k.client_id)))
  with check (exists (select 1 from public.crm_contracts k where k.id = contract_id and public.crm_can_edit_client(k.client_id)));

-- ------------------------------------------------------------------ 3. historial d'estats (no s'esborra mai)
create table if not exists public.crm_contract_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.crm_contracts (id) on delete cascade,
  kind text not null default 'estat' check (kind in ('creacio', 'estat', 'linia')),
  from_status text,
  to_status text,
  note text,
  by_user uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists crm_contract_events_contract_idx on public.crm_contract_events (contract_id, at desc);

create or replace function public.crm_contract_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'crm_contracts' then
    if tg_op = 'INSERT' then
      insert into crm_contract_events (contract_id, kind, to_status) values (new.id, 'creacio', new.status);
    elsif new.status is distinct from old.status then
      insert into crm_contract_events (contract_id, kind, from_status, to_status) values (new.id, 'estat', old.status, new.status);
    end if;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into crm_contract_events (contract_id, kind, from_status, to_status, note) values (new.contract_id, 'linia', old.status, new.status, coalesce(new.phone_number, 'línia ' || new.position));
  end if;
  return new;
end $$;
drop trigger if exists crm_contracts_log on public.crm_contracts;
create trigger crm_contracts_log after insert or update of status on public.crm_contracts for each row execute function public.crm_contract_log();
drop trigger if exists crm_contract_lines_log on public.crm_contract_lines;
create trigger crm_contract_lines_log after update of status on public.crm_contract_lines for each row execute function public.crm_contract_log();

alter table public.crm_contract_events enable row level security;
drop policy if exists p_crm_kevents_select on public.crm_contract_events;
create policy p_crm_kevents_select on public.crm_contract_events for select to authenticated
  using (exists (select 1 from public.crm_contracts k where k.id = contract_id and public.crm_can_see_client(k.client_id)));
-- sense polítiques d'insert/update/delete: només els triggers hi escriuen

-- ------------------------------------------------------------------ 4. comissió del contracte
alter table public.crm_contract_finance add column if not exists commission_model text;
alter table public.crm_contract_finance add column if not exists commission_expected_eur numeric(12, 2);
alter table public.crm_contract_finance add column if not exists commission_status text not null default 'prevista';
alter table public.crm_contract_finance add column if not exists collaborator_pct numeric(5, 2);
alter table public.crm_contract_finance add column if not exists collaborator_eur numeric(12, 2);
alter table public.crm_contract_finance add column if not exists settlement_ref text;
alter table public.crm_contract_finance add column if not exists clawback_until date;
alter table public.crm_contract_finance add column if not exists rule_ids uuid[] not null default '{}';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_finance_commission_status_chk') then
    alter table public.crm_contract_finance add constraint crm_finance_commission_status_chk check (commission_status in
      ('sense_regla', 'pendent_activacio', 'prevista', 'meritada', 'liquidada', 'cobrada', 'retrocedida', 'no_aplica'));
  end if;
  -- mai «cobrada» sense data de cobrament ni «liquidada» sense referència de liquidació
  if not exists (select 1 from pg_constraint where conname = 'crm_finance_cobrada_chk') then
    alter table public.crm_contract_finance add constraint crm_finance_cobrada_chk check (commission_status <> 'cobrada' or commission_paid_at is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_finance_liquidada_chk') then
    alter table public.crm_contract_finance add constraint crm_finance_liquidada_chk check (commission_status <> 'liquidada' or settlement_ref is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_finance_amounts_chk') then
    alter table public.crm_contract_finance add constraint crm_finance_amounts_chk check ((commission_expected_eur is null or commission_expected_eur >= 0) and (collaborator_eur is null or collaborator_eur >= 0) and (collaborator_pct is null or collaborator_pct between 0 and 100));
  end if;
end $$;

-- ------------------------------------------------------------------ 5. regles de comissió dels serveis
create table if not exists public.fin_service_rules (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (length(trim(provider)) between 1 and 120),
  service text not null check (service in ('fibra_telefonia', 'assegurances', 'alarmes', 'fibra', 'mobil', 'fibra_mobil', 'plaques_solars', 'altres')),
  product text,
  modality text not null check (modality in ('fix_alta', 'pct_quota', 'recurrent', 'per_linia', 'per_paquet', 'per_installacio', 'per_kwp')),
  amount_eur numeric(12, 2) check (amount_eur is null or amount_eur >= 0),
  pct numeric(6, 3) check (pct is null or pct between 0 and 100),
  months integer check (months is null or months between 1 and 120),
  requires_activation boolean not null default true,
  clawback_months integer check (clawback_months is null or clawback_months between 0 and 60),
  clawback_pct numeric(6, 3) check (clawback_pct is null or clawback_pct between 0 and 100),
  collaborator_pct numeric(6, 3) check (collaborator_pct is null or collaborator_pct between 0 and 100),
  valid_from date,
  valid_to date,
  status text not null default 'esborrany' check (status in ('esborrany', 'aprovada', 'arxivada')),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (modality <> 'pct_quota' or pct is not null),
  check (modality = 'pct_quota' or amount_eur is not null),
  check (status <> 'aprovada' or approved_by is not null)
);
create index if not exists fin_service_rules_lookup_idx on public.fin_service_rules (lower(provider), service, status);
drop trigger if exists fin_service_rules_touch on public.fin_service_rules;
create trigger fin_service_rules_touch before update on public.fin_service_rules for each row execute function public.crm_touch();

-- les veuen Direcció i Administració; només Direcció les crea, aprova o arxiva (mai comercials ni col·laboradors)
alter table public.fin_service_rules enable row level security;
drop policy if exists p_fin_service_rules_select on public.fin_service_rules;
create policy p_fin_service_rules_select on public.fin_service_rules for select to authenticated using (public.is_staff());
drop policy if exists p_fin_service_rules_write on public.fin_service_rules;
create policy p_fin_service_rules_write on public.fin_service_rules for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------------ 6. llistes de serveis i categories ampliades
do $$ begin
  alter table public.crm_expedients drop constraint if exists crm_expedients_service_check;
  if not exists (select 1 from pg_constraint where conname = 'crm_expedients_service_v2') then
    alter table public.crm_expedients add constraint crm_expedients_service_v2 check (service in
      ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes', 'fibra', 'mobil', 'fibra_mobil', 'plaques_solars', 'altres'));
  end if;
  alter table public.fin_rules drop constraint if exists fin_rules_service_check;
  if not exists (select 1 from pg_constraint where conname = 'fin_rules_service_v2') then
    alter table public.fin_rules add constraint fin_rules_service_v2 check (service is null or service in
      ('llum_residencial', 'llum_empresa', 'gas', 'fibra_telefonia', 'assegurances', 'alarmes', 'fibra', 'mobil', 'fibra_mobil', 'plaques_solars', 'altres'));
  end if;
  alter table public.crm_documents drop constraint if exists crm_documents_category_chk;
  if not exists (select 1 from pg_constraint where conname = 'crm_documents_category_v2') then
    alter table public.crm_documents add constraint crm_documents_category_v2 check (category in
      ('dni_nie', 'fiscal', 'factura_llum', 'factura_gas', 'contracte', 'contracte_signat', 'mandat', 'proposta', 'bancaria', 'altres', 'proteccio_dades',
       'polissa', 'pressupost', 'certificat', 'garantia', 'portabilitat', 'factura_servei', 'projecte_tecnic'));
  end if;
  alter table public.crm_doc_requirements drop constraint if exists crm_doc_requirements_doc_category_check;
  if not exists (select 1 from pg_constraint where conname = 'crm_doc_requirements_doc_category_v2') then
    alter table public.crm_doc_requirements add constraint crm_doc_requirements_doc_category_v2 check (doc_category is null or doc_category in
      ('dni_nie', 'fiscal', 'factura_llum', 'factura_gas', 'contracte', 'contracte_signat', 'mandat', 'proposta', 'bancaria', 'altres', 'proteccio_dades',
       'polissa', 'pressupost', 'certificat', 'garantia', 'portabilitat', 'factura_servei', 'projecte_tecnic'));
  end if;
end $$;

-- documents obligatoris d'exemple per als serveis nous (només si no hi són; Direcció els pot adaptar)
insert into public.crm_doc_requirements (name, description, kind, doc_category, services, mandatory, sort, is_example)
select v.name, v.descr, 'document', v.cat, v.services, true, v.ord, true
from (values
  ('Pòlissa signada', 'Còpia de la pòlissa signada per l''assegurat.', 'polissa', array['assegurances']::text[], 210),
  ('Pressupost acceptat de la instal·lació', 'Pressupost de les plaques signat pel client.', 'pressupost', array['plaques_solars']::text[], 220),
  ('Sol·licitud de portabilitat signada', 'Una per a cada línia que es porta d''un altre operador.', 'portabilitat', array['mobil', 'fibra_mobil']::text[], 230),
  ('Contracte del servei signat', 'Contracte de l''operador o proveïdor signat.', 'contracte_signat', array['fibra', 'mobil', 'fibra_mobil', 'alarmes', 'altres']::text[], 240)
) as v(name, descr, cat, services, ord)
where not exists (select 1 from public.crm_doc_requirements r where r.name = v.name);

-- ------------------------------------------------------------------ comprovació
-- select service, count(*) from public.crm_contracts group by 1 order by 1;
-- select count(*) as linies from public.crm_contract_lines;
-- select conname from pg_constraint where conname in ('crm_contracts_service_chk', 'crm_contracts_status_v2', 'crm_documents_category_v2', 'crm_expedients_service_v2', 'fin_rules_service_v2') order by 1;
