#!/usr/bin/env bash
# ---------------------------------------------------------------------
# Restaura una còpia de backup.sh sobre un projecte modulardom-crm BUIT
# (normalment un projecte nou creat per a la restauració).
# Abans: aplica les migracions al projecte de destinació (supabase db push).
#
# Ús: scripts/restore.sh backups/<data>
# ---------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib-guard.sh
load_env

SRC="${1:?Indica la carpeta de la còpia, p. ex. backups/20261104T180000Z}"
[ -f "$SRC/data.sql" ] && [ -f "$SRC/auth.sql" ] || { echo "✖ Còpia incompleta a $SRC" >&2; exit 1; }
( cd "$SRC" && sha256sum -c --quiet SHA256SUMS ) || { echo "✖ Suma de verificació incorrecta" >&2; exit 1; }

require_modulardom_target

ROWS=$(psql "$SUPABASE_DB_URL" -tAc "select (select count(*) from public.projects) + (select count(*) from public.clients) + (select count(*) from auth.users)")
if [ "$ROWS" != "0" ]; then
  echo "✖ La destinació ja conté dades ($ROWS files). Aquest script només restaura sobre un projecte buit." >&2
  echo "  No s'esborra res automàticament." >&2
  exit 1
fi

echo "Destinació: projecte $SUPABASE_PROJECT_REF"
read -r -p "Escriu la ref del projecte per confirmar la restauració: " CONFIRM
[ "$CONFIRM" = "$SUPABASE_PROJECT_REF" ] || { echo "Cancel·lat."; exit 1; }

# session_replication_role = replica desactiva triggers i FK durant la càrrega
# (evita duplicar perfils i entrades d'auditoria).
{
  echo "set session_replication_role = replica;"
  # Taules que les migracions ja omplen (configuració i el seu registre d'auditoria): se substitueixen per les de la còpia
  echo "truncate public.pipeline_stage_requirements, public.upload_rules, public.audit_log, app.project_code_counters;"
  cat "$SRC/auth.sql"
  cat "$SRC/data.sql"
} | psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -q

echo "▶ Verificació"
psql "$SUPABASE_DB_URL" -c "select 'profiles' t, count(*) from public.profiles
  union all select 'clients', count(*) from public.clients
  union all select 'projects', count(*) from public.projects
  union all select 'documents', count(*) from public.documents"
echo "✔ Base de dades restaurada. Ara restaura els fitxers: node scripts/restore-storage.mjs $SRC/storage"
