#!/usr/bin/env bash
# ---------------------------------------------------------------------
# Còpia de seguretat lògica de la base de dades de ModularDom CRM.
# Genera a backups/<data>/ :
#   schema.sql  esquemes public i app (referència; l'origen és supabase/migrations)
#   auth.sql    usuaris d'Auth (auth.users, auth.identities)
#   data.sql    dades de l'esquema public
#   SHA256SUMS
# Els fitxers de Storage es copien amb scripts/backup-storage.mjs.
#
# Requisits: pg_dump amb versió >= a la del servidor Supabase.
# Ús: scripts/backup.sh       (llegeix .env.local)
# ---------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-guard.sh
load_env
require_modulardom_target

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="backups/$STAMP"
mkdir -p "$OUT"
chmod 700 backups "$OUT"

echo "▶ Esquema"
pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges \
  --schema=public --schema=app -f "$OUT/schema.sql"

echo "▶ Usuaris d'Auth"
pg_dump "$SUPABASE_DB_URL" --data-only --no-owner \
  --table=auth.users --table=auth.identities -f "$OUT/auth.sql"

echo "▶ Dades"
pg_dump "$SUPABASE_DB_URL" --data-only --no-owner --schema=public -f "$OUT/data.sql"

( cd "$OUT" && sha256sum ./*.sql > SHA256SUMS )
chmod 600 "$OUT"/*
echo "✔ Còpia a $OUT"
echo "  Conté dades personals: xifra-la i guarda-la fora del repositori (p. ex. 'gpg -c')."
