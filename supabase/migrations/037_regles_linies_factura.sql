-- =====================================================================================================================
-- 037 · Regles apreses del lector de factures (Comparatives IA)
--   invoice_line_rules  una denominació de línia d'una factura («Energia comercialitzadora», «Peatges i càrrecs
--                       d'energia»…) correspon a un concepte econòmic (energia lliure, ATR, ajust, descompte, ja inclòs…).
--                       Abast: una comercialitzadora o totes (retailer = null).
--   Una correcció puntual NO es converteix en regla sola: l'usuari ha de prémer «Ensenyar aquesta correcció a la IA».
--   Si la proposa un comercial queda «proposada»; només Direcció o la cap d'administració l'aproven. Només les regles
--   aprovades s'apliquen a les factures que es llegeixen després.
-- RLS activada i sense polítiques: hi accedeix només el servidor després de comprovar el rol. Idempotent.
-- =====================================================================================================================

create table if not exists public.invoice_line_rules (
  id uuid primary key default gen_random_uuid(),
  retailer text check (retailer is null or length(trim(retailer)) between 1 and 80),
  pattern text not null check (length(trim(pattern)) between 2 and 120),
  concept text not null check (concept in ('lliure', 'atr', 'peatges', 'carrecs', 'ajust', 'descompte', 'altres', 'energia', 'inclos')),
  status text not null default 'proposada' check (status in ('proposada', 'aprovada', 'revocada')),
  example_label text check (example_label is null or length(example_label) <= 200),
  previous_concept text check (previous_concept is null or length(previous_concept) <= 20),
  note text check (note is null or length(note) <= 500),
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_by_name text,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- una sola regla vigent per comercialitzadora i denominació
create unique index if not exists invoice_line_rules_scope_uq on public.invoice_line_rules (coalesce(lower(trim(retailer)), ''), lower(trim(pattern)))
  where status <> 'revocada';
create index if not exists invoice_line_rules_status_idx on public.invoice_line_rules (status);

alter table public.invoice_line_rules enable row level security;
