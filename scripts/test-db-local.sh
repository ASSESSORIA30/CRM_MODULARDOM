#!/usr/bin/env bash
# ---------------------------------------------------------------------
# Prova les migracions i les polítiques RLS en un PostgreSQL local temporal.
# No es connecta MAI a Supabase. No necessita credencials.
# Ús: scripts/test-db-local.sh
# ---------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PORT:-54329}"
TMP="$(mktemp -d)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$TMP"
  RUN_AS=(runuser -u postgres --)
fi
export PGHOST="$TMP" PGPORT="$PORT" PGUSER=postgres

cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

PSQL=("${RUN_AS[@]}" psql -X -q -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORT" -U postgres)
"${PSQL[@]}" -d postgres -c "create database modulardom_test" >/dev/null

echo "▶ Entorn Supabase simulat"
"${PSQL[@]}" -d modulardom_test -f "$ROOT/tests/local-stubs/supabase_stubs.sql" >/dev/null

echo "▶ Migracions"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  "${PSQL[@]}" -d modulardom_test -f "$f" >/dev/null
done

echo "▶ Proves de permisos i lògica de negoci"
for f in "$ROOT"/supabase/tests/*.sql; do
  echo "  · $(basename "$f")"
  "${PSQL[@]}" -d modulardom_test -f "$f" 2>&1 >/dev/null | sed -E 's/^psql:[^ ]* (NOTICE|WARNING):  /   /'
done

if [ "${TEST_BACKUP:-1}" = "1" ]; then
  echo "▶ Prova de còpia de seguretat i restauració"
  # Mateix mètode que scripts/backup.sh + scripts/restore.sh
  DUMPA="$TMP/auth.sql"; DUMPD="$TMP/data.sql"
  "${RUN_AS[@]}" pg_dump -h "$TMP" -p "$PORT" -U postgres -d modulardom_test \
      --data-only --no-owner --table=auth.users > "$DUMPA" 2>/dev/null
  "${RUN_AS[@]}" pg_dump -h "$TMP" -p "$PORT" -U postgres -d modulardom_test \
      --data-only --no-owner --schema=public --schema=app > "$DUMPD" 2>/dev/null
  "${PSQL[@]}" -d postgres -c "create database modulardom_restore" >/dev/null
  "${PSQL[@]}" -d modulardom_restore -f "$ROOT/tests/local-stubs/supabase_stubs.sql" >/dev/null
  for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d modulardom_restore -f "$f" >/dev/null; done
  { echo "set session_replication_role = replica;"
    echo "truncate public.pipeline_stage_requirements, app.project_code_counters;"
    cat "$DUMPA" "$DUMPD"; } \
      | "${PSQL[@]}" -d modulardom_restore --single-transaction >/dev/null
  for t in profiles clients client_users project_holders project_financials project_steps project_stage_history tasks calendar_events notifications pipeline_stage_requirements projects project_members documents audit_log; do
    a=$("${PSQL[@]}" -d modulardom_test    -tAc "select count(*) from public.$t")
    b=$("${PSQL[@]}" -d modulardom_restore -tAc "select count(*) from public.$t")
    if [ "$a" != "$b" ]; then echo "   FALLADA restauració $t: $a ≠ $b"; exit 1; fi
    echo "   OK  $t: $a files restaurades"
  done
fi
echo "✔ Tot correcte"
