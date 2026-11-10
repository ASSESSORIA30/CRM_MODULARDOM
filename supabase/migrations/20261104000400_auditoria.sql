-- =====================================================================
-- 0400 · Registre d'auditoria (append-only)
-- =====================================================================

create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_role  text,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb
);
create index audit_log_table_record_idx on public.audit_log (table_name, record_id);
create index audit_log_at_idx on public.audit_log (at desc);

create or replace function app.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_id  text  := coalesce(v_new ->> 'id', v_old ->> 'id',
                          v_new ->> 'project_id', v_old ->> 'project_id');
begin
  insert into public.audit_log (actor_id, actor_role, table_name, record_id, action, old_data, new_data)
  values (auth.uid(), coalesce(auth.role(), 'sistema'), tg_table_name, v_id, tg_op, v_old, v_new);
  return coalesce(new, old);
end $$;
revoke all on function app.audit_row() from public;

do $$
declare t text;
begin
  foreach t in array array['companies','profiles','clients','client_users','projects',
                           'project_holders','project_members','project_financials','documents']
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function app.audit_row()', t || '_audit', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;
-- Ni tan sols el servidor pot reescriure l'historial
revoke update, delete, truncate on public.audit_log from service_role;

create policy audit_log_direccio_select on public.audit_log
  for select to authenticated using (app.is_direccio());
