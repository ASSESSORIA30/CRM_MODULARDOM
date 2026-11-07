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

FASE 1 · pas 2 — aplicació Next.js 16:
- Login amb Supabase Auth, sessió per cookies, proxy de protecció de rutes
- Comptes inactius → pantalla "pendent d'activació"; invitacions i canvi de contrasenya
- Pàgina "Configuració pendent" i `/api/health` si falten variables d'entorn
- Capçaleres de seguretat; tipus de lletra Montserrat autoallotjada

FASE 1 · pas 3 — mòduls del CRM: panell, clients i leads, fitxa 360º, fitxa de projecte amb els
11 passos, Kanban amb validacions al servidor, calendari, tasques, notificacions i administració d'usuaris.
Detall: [docs/05-FASE1-CRM.md](docs/05-FASE1-CRM.md).

## Documentació
- [Configuració Supabase, GitHub i Vercel](docs/01-CONFIGURACIO-SUPABASE-GITHUB-VERCEL.md)
- [Còpies de seguretat i restauració](docs/02-COPIES-I-RESTAURACIO.md)
- [Model de permisos](docs/03-PERMISOS.md)
- [Anàlisi dels documents de referència](docs/04-ANALISI-DOCUMENTS-REFERENCIA.md)

## Ordres
```bash
npm install && npm run dev   # http://localhost:3000 (requereix .env.local)
npm run check && npm run build   # typecheck + lint + proves unitàries + secrets
scripts/test-db-local.sh   # migracions + proves RLS + backup/restore (Postgres local, sense credencials)
scripts/check-secrets.sh   # cap secret al repositori
scripts/backup.sh          # còpia de la BD (requereix .env.local)
```
