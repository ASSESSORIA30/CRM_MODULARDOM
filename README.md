# ModularDom CRM

Plataforma CRM i de gestió d'obra de MODULARDOM OBRAS Y REFORMAS, S.L.
Infraestructura **totalment independent**: projecte Supabase `modulardom-crm`,
repositori privat `modulardom-crm` i projecte Vercel propi. No comparteix cap taula,
usuari, document ni dada amb Assessoria 3.0.

## Estat
FASE 1 · pas 1 — fonaments de Supabase (aquest commit):
- Migracions versionades a `supabase/migrations/`
- Rols: `direccio`, `arquitecte`, `constructor`, `client`; RLS a totes les taules
- Storage privat: `contractes`, `pressupostos`, `factures`, `planols`, `fotografies`, `documents`
- Auditoria append-only
- Còpies de seguretat i restauració (`scripts/`)

## Documentació
- [Configuració Supabase, GitHub i Vercel](docs/01-CONFIGURACIO-SUPABASE-GITHUB-VERCEL.md)
- [Còpies de seguretat i restauració](docs/02-COPIES-I-RESTAURACIO.md)
- [Model de permisos](docs/03-PERMISOS.md)
- [Anàlisi dels documents de referència](docs/04-ANALISI-DOCUMENTS-REFERENCIA.md)

## Ordres
```bash
scripts/test-db-local.sh   # migracions + proves RLS + backup/restore (Postgres local, sense credencials)
scripts/check-secrets.sh   # cap secret al repositori
scripts/backup.sh          # còpia de la BD (requereix .env.local)
```
