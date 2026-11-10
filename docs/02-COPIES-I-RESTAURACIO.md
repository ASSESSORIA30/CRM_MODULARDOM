# Còpies de seguretat i restauració — ModularDom CRM

Hi ha tres capes de protecció:

1. **Còpies automàtiques de Supabase** (segons el pla; opcionalment PITR). Panell → *Database → Backups*.
2. **Còpia lògica pròpia** de la base de dades: `scripts/backup.sh`.
3. **Còpia dels fitxers de Storage**: `scripts/backup-storage.mjs` (les còpies de Supabase
   no inclouen els fitxers dels buckets).

L'esquema de la base de dades viu versionat a `supabase/migrations/`; és la font de veritat.

## Fer una còpia
Requisits: `.env.local` amb `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`,
`NEXT_PUBLIC_SUPABASE_URL` i `SUPABASE_SECRET_KEY`; `pg_dump` de versió igual o superior
a la del servidor (o feu servir `supabase db dump`).

```bash
scripts/backup.sh                                  # → backups/<data>/
node scripts/backup-storage.mjs backups/<data>/storage
tar czf - backups/<data> | gpg -c > modulardom-<data>.tgz.gpg   # xifrar
```
Guardeu el fitxer xifrat fora del repositori (la carpeta `backups/` és a `.gitignore`).
Freqüència recomanada: setmanal + abans de cada desplegament amb migracions.

Tots els scripts **es neguen a executar-se** si l'URL no correspon a `SUPABASE_PROJECT_REF`
o si la base de dades no té l'esquema de ModularDom: no es poden apuntar per error a Assessoria 3.0.

## Restaurar
La restauració es fa sobre un projecte **buit** (mai sobreescriu dades existents):

1. Creeu un projecte nou dins l'organització ModularDom (guia 01, passos A2–A4).
2. Apliqueu les migracions: `supabase link --project-ref <nou-ref> && supabase db push`.
3. Actualitzeu `.env.local` amb les credencials del projecte de destinació.
4. Base de dades: `scripts/restore.sh backups/<data>` (demana escriure la ref per confirmar;
   verifica les sumes SHA-256; desactiva triggers durant la càrrega per no duplicar perfils
   ni auditoria).
5. Fitxers: `node scripts/restore-storage.mjs backups/<data>/storage` (no sobreescriu).
6. Comproveu l'accés amb un usuari de cada rol i actualitzeu les variables de Vercel si
   el projecte de destinació passa a ser el de producció.

## Prova periòdica
`scripts/test-db-local.sh` executa automàticament un cicle complet còpia → restauració
en un PostgreSQL local i compara el nombre de files de cada taula. Recomanat: fer també
un simulacre real de restauració sobre un projecte temporal un cop per trimestre.
