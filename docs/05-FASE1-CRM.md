# FASE 1 — CRM: lliurament

## Què s'ha implementat

| Mòdul | Ruta | Qui hi accedeix |
|---|---|---|
| Panell d'inici amb indicadors clicables i filtres (període, responsable) | `/inici` | Tots (contingut segons rol) |
| Clients i leads: llistat, cerca, filtres per etapa | `/clients` | Direcció |
| Alta de lead (client + projecte + estimació en una transacció) amb detecció de duplicats | `/clients/nou` | Direcció |
| Fitxa 360º del client: dades, projectes, activitats, tasques i cites | `/clients/[id]` | Direcció |
| Fitxa del projecte: 11 passos, canvi d'etapa, historial, equip, dades comercials | `/projectes/[id]` | Direcció; arquitecte assignat (lectura + passos tècnics) |
| Kanban de 6 etapes + Perdut / Finalitzada, arrossegable i amb selector alternatiu per a mòbil | `/kanban` | Direcció |
| Calendari intern: dia, setmana, mes i agenda; cites amb responsable, assistents i recordatori | `/calendari` | Tots (cadascú veu les seves; el client, només les cites confirmades i publicades) |
| Tasques: meves, totes, fetes; venciments | `/tasques` | Direcció, arquitecte, constructor |
| Notificacions amb campaneta, enllaç directe i marcatge de llegides | `/notificacions` | Tots |
| Administració d'usuaris: invitar, rol, activar/desactivar, empresa, fitxa de client; empreses constructores | `/administracio/usuaris` | Direcció |
| Selector d'idioma (català/castellà) desat al perfil | menú lateral | Tots |

## Regles de negoci a la base de dades
- **L'etapa només canvia amb `move_project_stage()`**: ni el Kanban ni una crida directa a l'API poden saltar-se
  els passos obligatoris. Els requisits per etapa són a `pipeline_stage_requirements` (configurables):

  | Etapa | Passos obligatoris |
  |---|---|
  | Pressupost i visites | 1 |
  | Avantprojecte | 1, 2, 4 |
  | Contractat | 1, 2, 4, 5, 6 |
  | Projecte i llicència | 1, 2, 4, 5, 6 |
  | En obra | 1, 2, 4, 5, 6, 7, 8, 9, 10 (el pas 11 es marca automàticament) |
  | Perdut | motiu obligatori |
  | Finalitzada | només des d'En obra |

  El pas 3 (visita a la casa pilot) és l'únic que es pot marcar com a "no aplica".
  No es pot desmarcar un pas que l'etapa actual exigeix.
- Historial complet a `project_stage_history` (qui, quan, d'on a on, motiu).
- Codi automàtic de projecte `MD-AAAA-NNNN`.
- Duplicats: per NIF, email, telèfon (normalitzat) i nom semblant (sense accents). Mai es fusiona automàticament.
- Notificacions sense duplicats (`dedupe_key`). Avisos: lead nou, tasca assignada, cita assignada, tasca vençuda,
  cita propera (segons el recordatori), lead sense contactar en 48 h, seguiment de pressupost vençut.
- Ha de quedar sempre almenys una persona de direcció activa.

## Migració nova
`supabase/migrations/20261107000500_crm_fase1.sql` — aplicar amb `supabase db push` o al SQL Editor
**després** de les quatre anteriors. Activa les extensions `pg_trgm` i `unaccent` (disponibles a Supabase).

## Configuració addicional
- Vercel: `NEXT_PUBLIC_SITE_URL=https://crmmodulardom.vercel.app` (enllaços d'invitació).
- Supabase → Authentication → Emails → *Invite user*: enllaç
  `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
- Supabase → Authentication → URL Configuration: *Site URL* = l'URL de Vercel.

## Proves executades
- 45 proves RLS (fase 0) + 31 proves de pipeline, passos, duplicats, tasques, calendari i notificacions
  (`scripts/test-db-local.sh`, PostgreSQL 16 local amb entorn Supabase simulat).
- Còpia i restauració de totes les taules (15 taules comparades).
- 27 proves unitàries d'imports en cèntims i dates en hora de Madrid (`npm test`).
- TypeScript, ESLint i build de producció.
- Totes les columnes i relacions que consulta l'aplicació existeixen a l'esquema (comprovació automàtica).
- Rutes protegides redirigeixen al login sense sessió.

## No verificat encara
- **Fluxos amb sessió real** (crear lead, arrossegar al Kanban, invitar usuaris…) contra un Supabase real.
  No s'han pogut executar en aquest entorn. Cal provar-los al projecte `modulardom-crm` després d'aplicar la migració.
- Proves Playwright de punta a punta: pendents de disposar d'un entorn amb Supabase.

## Pendent per a fases posteriors
- Fusió de contactes duplicats amb revisió (es detecten, però encara no hi ha pantalla de fusió).
- Sincronització amb calendaris externs (fora de l'abast inicial).
- Indicadors econòmics del panell (FASE 4).
