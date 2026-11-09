-- =====================================================================================================================
-- 033 · Autofactures de comissions i cobraments
--   1. Sistema de facturació de comissions per comercialitzadora (factura pròpia / autofactura / mixt). Només Direcció.
--   2. Mode de facturació de cada liquidació (per al sistema mixt) i funció que el resol.
--   3. Autofactures rebudes (document fiscal de la comercialitzadora): número, data, base, IVA, total i PDF original.
--      No es modifiquen ni s'esborren: s'anul·len amb motiu. Cap autofactura duplicada (número o mateix fitxer).
--   4. Vincle autofactura ↔ liquidacions (una autofactura pot cobrir diverses liquidacions).
--   5. Cobraments: tipus de document i autofactura relacionada. Registrar una autofactura NO marca res com a cobrat.
--   6. Una liquidació amb autofactura no es pot facturar amb una factura pròpia (i a l'inrevés).
-- Idempotent: es pot tornar a executar. No elimina cap taula ni dada existent.
-- =====================================================================================================================

-- ------------------------------------------------------------ 1. comercialitzadores
alter table public.retailers add column if not exists commission_billing text not null default 'factura_propia';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'retailers_commission_billing_chk') then
    alter table public.retailers add constraint retailers_commission_billing_chk check (commission_billing in ('factura_propia', 'autofactura', 'mixt'));
  end if;
end $$;
comment on column public.retailers.commission_billing is 'Sistema de facturació de comissions: factura_propia (emesa per Assessoria 3.0), autofactura (emesa per la comercialitzadora) o mixt (depèn de la liquidació).';

-- només Direcció canvia el sistema de facturació
create or replace function public.retailers_billing_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.commission_billing <> 'factura_propia' and not coalesce(public.is_admin(), false) and auth.uid() is not null then
      raise exception 'Només Direcció pot definir el sistema de facturació de comissions' using errcode = '42501';
    end if;
  elsif new.commission_billing is distinct from old.commission_billing and not coalesce(public.is_admin(), false) and auth.uid() is not null then
    raise exception 'Només Direcció pot canviar el sistema de facturació de comissions' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists retailers_billing_guard on public.retailers;
create trigger retailers_billing_guard before insert or update of commission_billing on public.retailers for each row execute function public.retailers_billing_guard();

-- ------------------------------------------------------------ 2. mode de cada liquidació
alter table public.fin_provider_statements add column if not exists billing_mode text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fin_statements_billing_mode_chk') then
    alter table public.fin_provider_statements add constraint fin_statements_billing_mode_chk check (billing_mode is null or billing_mode in ('factura_propia', 'autofactura'));
  end if;
end $$;

-- Mode efectiu: el de la liquidació; si no en té, el de la comercialitzadora (per nom o àlies). «mixt» = cal decidir-ho.
-- Sense fitxa de comercialitzadora: factura pròpia (comportament anterior).
create or replace function public.fin_statement_billing_mode(p_statement uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    s.billing_mode,
    (select r.commission_billing from retailers r
      where lower(trim(r.trade_name)) = lower(trim(s.retailer))
         or lower(trim(s.retailer)) like lower(trim(r.trade_name)) || ' %'
         or exists (select 1 from unnest(r.aliases) a where lower(trim(a)) = lower(trim(s.retailer)))
      order by (lower(trim(r.trade_name)) = lower(trim(s.retailer))) desc
      limit 1),
    'factura_propia')
  from fin_provider_statements s where s.id = p_statement;
$$;
revoke all on function public.fin_statement_billing_mode(uuid) from public;
grant execute on function public.fin_statement_billing_mode(uuid) to authenticated;

-- ------------------------------------------------------------ 3. autofactures rebudes
create table if not exists public.fin_self_invoices (
  id uuid primary key default gen_random_uuid(),
  retailer text not null check (length(trim(retailer)) between 1 and 120),
  doc_type text not null default 'autofactura' check (doc_type in ('autofactura', 'rectificativa')),
  number text not null check (length(trim(number)) between 1 and 60),
  issue_date date not null,
  base numeric(14, 2) not null,
  vat_rate numeric(5, 2),
  vat numeric(14, 2) not null default 0,
  withholding numeric(14, 2) not null default 0,     -- retenció (IRPF) si la comercialitzadora l'aplica
  total numeric(14, 2) not null,
  period_from date,
  period_to date,
  file_name text,
  storage_path text,                                  -- PDF original al bucket privat fin-self-invoices
  file_sha256 text,
  source text not null default 'manual' check (source in ('manual', 'lector')),
  read_summary jsonb,                                 -- què va llegir el lector i amb quina evidència (traçabilitat)
  status text not null default 'registrada' check (status in ('registrada', 'anullada')),
  annulled_reason text,
  annulled_at timestamptz,
  notes text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (abs(total - (base + vat - withholding)) <= 0.02),
  check (status <> 'anullada' or length(trim(coalesce(annulled_reason, ''))) >= 3)
);
create unique index if not exists fin_self_invoices_number_uq on public.fin_self_invoices (lower(trim(retailer)), lower(trim(number))) where status <> 'anullada';
create unique index if not exists fin_self_invoices_file_uq on public.fin_self_invoices (file_sha256) where file_sha256 is not null and status <> 'anullada';
create index if not exists fin_self_invoices_date_idx on public.fin_self_invoices (issue_date);

-- document fiscal: no es modifica ni s'esborra; només s'anul·la (amb motiu) o s'hi afegeixen observacions
create or replace function public.fin_self_invoices_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una autofactura registrada no s''esborra: anul·la-la indicant el motiu' using errcode = '42501';
  end if;
  if (new.retailer, new.doc_type, new.number, new.issue_date, new.base, new.vat_rate, new.vat, new.withholding, new.total, new.file_name, new.storage_path, new.file_sha256, new.source, new.created_by, new.created_at)
     is distinct from (old.retailer, old.doc_type, old.number, old.issue_date, old.base, old.vat_rate, old.vat, old.withholding, old.total, old.file_name, old.storage_path, old.file_sha256, old.source, old.created_by, old.created_at) then
    raise exception 'Les dades fiscals d''una autofactura no es modifiquen: anul·la-la i registra-la de nou' using errcode = '42501';
  end if;
  if old.status = 'anullada' and new.status <> 'anullada' then
    raise exception 'Una autofactura anul·lada no es pot reactivar' using errcode = '42501';
  end if;
  if new.status = 'anullada' and old.status <> 'anullada' then new.annulled_at := now(); end if;
  return new;
end $$;
drop trigger if exists fin_self_invoices_guard on public.fin_self_invoices;
create trigger fin_self_invoices_guard before update or delete on public.fin_self_invoices for each row execute function public.fin_self_invoices_guard();

-- ------------------------------------------------------------ 4. autofactura ↔ liquidacions
create table if not exists public.fin_self_invoice_statements (
  self_invoice_id uuid not null references public.fin_self_invoices (id) on delete restrict,
  statement_id uuid not null references public.fin_provider_statements (id) on delete restrict,
  amount numeric(14, 2) not null,                     -- base de l'autofactura que correspon a aquesta liquidació
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (self_invoice_id, statement_id)
);
create index if not exists fin_self_inv_stm_idx on public.fin_self_invoice_statements (statement_id);

-- una liquidació facturada per Assessoria 3.0 no rep autofactura, i una amb autofactura no es factura
create or replace function public.fin_self_invoice_link_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from bill_invoice_statements s join bill_invoices i on i.id = s.invoice_id where s.statement_id = new.statement_id and i.kind = 'ordinaria' and i.status in ('emesa', 'parcialment_cobrada', 'cobrada')) then
    raise exception 'Aquesta liquidació ja té una factura emesa per Assessoria 3.0: no s''hi pot vincular una autofactura' using errcode = '23514';
  end if;
  if (select status from fin_self_invoices where id = new.self_invoice_id) = 'anullada' then
    raise exception 'L''autofactura està anul·lada' using errcode = '23514';
  end if;
  update fin_provider_statements set billing_mode = 'autofactura' where id = new.statement_id and billing_mode is distinct from 'autofactura';
  return new;
end $$;
drop trigger if exists fin_self_invoice_link_guard on public.fin_self_invoice_statements;
create trigger fin_self_invoice_link_guard before insert on public.fin_self_invoice_statements for each row execute function public.fin_self_invoice_link_guard();

create or replace function public.bill_statement_self_billing_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.fin_statement_billing_mode(new.statement_id) = 'autofactura' then
    raise exception 'Aquesta liquidació es cobra amb autofactura de la comercialitzadora: no s''emet factura pròpia' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists bill_statement_self_billing_guard on public.bill_invoice_statements;
create trigger bill_statement_self_billing_guard before insert on public.bill_invoice_statements for each row execute function public.bill_statement_self_billing_guard();

-- ------------------------------------------------------------ 5. cobraments: document que els justifica
alter table public.fin_provider_receipts add column if not exists doc_type text not null default 'transferencia';
alter table public.fin_provider_receipts add column if not exists self_invoice_id uuid references public.fin_self_invoices (id) on delete restrict;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fin_receipts_doc_type_chk') then
    alter table public.fin_provider_receipts add constraint fin_receipts_doc_type_chk check (doc_type in ('transferencia', 'autofactura', 'compensacio', 'altres'));
  end if;
end $$;
create index if not exists fin_receipts_self_inv_idx on public.fin_provider_receipts (self_invoice_id);

-- ------------------------------------------------------------ 6. RLS (mateix criteri que la conciliació: Administració i Direcció)
alter table public.fin_self_invoices enable row level security;
alter table public.fin_self_invoice_statements enable row level security;
drop policy if exists p_fin_self_invoices_select on public.fin_self_invoices;
create policy p_fin_self_invoices_select on public.fin_self_invoices for select to authenticated using (public.fin_staff('read'));
drop policy if exists p_fin_self_invoices_insert on public.fin_self_invoices;
create policy p_fin_self_invoices_insert on public.fin_self_invoices for insert to authenticated with check (public.fin_staff('edit'));
drop policy if exists p_fin_self_invoices_update on public.fin_self_invoices;
create policy p_fin_self_invoices_update on public.fin_self_invoices for update to authenticated using (public.fin_staff('edit')) with check (public.fin_staff('edit'));
drop policy if exists p_fin_self_inv_stm_select on public.fin_self_invoice_statements;
create policy p_fin_self_inv_stm_select on public.fin_self_invoice_statements for select to authenticated using (public.fin_staff('read'));
drop policy if exists p_fin_self_inv_stm_insert on public.fin_self_invoice_statements;
create policy p_fin_self_inv_stm_insert on public.fin_self_invoice_statements for insert to authenticated with check (public.fin_staff('edit'));
-- (sense DELETE: res d'això s'esborra)

-- ------------------------------------------------------------ 7. bucket privat dels PDF originals
insert into storage.buckets (id, name, public, file_size_limit)
values ('fin-self-invoices', 'fin-self-invoices', false, 10485760)
on conflict (id) do nothing;
-- Sense polítiques per a `authenticated`: només el servidor hi llegeix i hi escriu, després de comprovar fin_staff.
