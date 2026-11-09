-- 033 · REVERSIÓ: treu el registre d'autofactures i el sistema de facturació de comissions.
-- ATENCIÓ: s'eliminen les autofactures registrades i els seus vincles. ELS COBRAMENTS ES CONSERVEN
-- (fin_provider_receipts i fin_ledger no es toquen; només es treuen les dues columnes noves dels cobraments).
-- Els PDF del bucket fin-self-invoices no s'esborren (cal fer-ho a mà si es vol).
drop trigger if exists bill_statement_self_billing_guard on public.bill_invoice_statements;
drop function if exists public.bill_statement_self_billing_guard();
alter table public.fin_provider_receipts drop constraint if exists fin_receipts_doc_type_chk;
drop index if exists public.fin_receipts_self_inv_idx;
alter table public.fin_provider_receipts drop column if exists self_invoice_id;
alter table public.fin_provider_receipts drop column if exists doc_type;
drop table if exists public.fin_self_invoice_statements;
drop function if exists public.fin_self_invoice_link_guard();
drop table if exists public.fin_self_invoices;
drop function if exists public.fin_self_invoices_guard();
drop function if exists public.fin_statement_billing_mode(uuid);
alter table public.fin_provider_statements drop constraint if exists fin_statements_billing_mode_chk;
alter table public.fin_provider_statements drop column if exists billing_mode;
drop trigger if exists retailers_billing_guard on public.retailers;
drop function if exists public.retailers_billing_guard();
alter table public.retailers drop constraint if exists retailers_commission_billing_chk;
alter table public.retailers drop column if exists commission_billing;
