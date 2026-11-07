#!/usr/bin/env bash
# Comprovacions de seguretat compartides pels scripts de backup/restauració.
# Garanteixen que mai s'opera sobre un projecte que no sigui modulardom-crm.

load_env() {
  local f="${ENV_FILE:-.env.local}"
  if [ -f "$f" ]; then
    set -a; # shellcheck disable=SC1090
    . "$f"; set +a
  fi
}

require_modulardom_target() {
  : "${SUPABASE_PROJECT_REF:?Falta SUPABASE_PROJECT_REF (ref del projecte modulardom-crm)}"
  : "${SUPABASE_DB_URL:?Falta SUPABASE_DB_URL}"
  if [[ "$SUPABASE_DB_URL" != *"$SUPABASE_PROJECT_REF"* ]]; then
    echo "✖ SUPABASE_DB_URL no conté la ref $SUPABASE_PROJECT_REF. Operació cancel·lada." >&2
    exit 1
  fi
  # Verificació addicional: la base de dades ha de tenir l'esquema de ModularDom
  if ! psql "$SUPABASE_DB_URL" -tAc "select 1 from pg_tables where schemaname='public' and tablename='project_members'" | grep -q 1; then
    echo "✖ La base de dades de destinació no té l'esquema de ModularDom CRM." >&2
    echo "  Si és un projecte nou, aplica abans les migracions (supabase db push)." >&2
    exit 1
  fi
}
