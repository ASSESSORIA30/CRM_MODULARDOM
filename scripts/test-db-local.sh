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

echo "▶ Prova de concurrència: dos enviaments simultanis de la mateixa ronda"
CLI='00000000-0000-0000-0000-000000000021'
PAV=$("${PSQL[@]}" -d modulardom_test -tAc "select id from public.projects where title like 'Client Avantprojecte%'")
DRAFT=$("${PSQL[@]}" -d modulardom_test -tAc "
  insert into public.revision_round_grants (project_id, reason) values ('$PAV', 'prova concurrència');
  insert into public.revision_drafts (project_id, created_by) values ('$PAV', '$CLI') returning id;" | head -1)
"${PSQL[@]}" -d modulardom_test -c "insert into public.revision_items (draft_id, project_id, title) values ('$DRAFT', '$PAV', 'Concurrència')" >/dev/null
BEFORE=$("${PSQL[@]}" -d modulardom_test -tAc "select count(*) from public.revision_rounds where project_id = '$PAV'")
submit() {
  "${PSQL[@]}" -d modulardom_test -tA -c "begin;
    select set_config('request.jwt.claims', '{\"sub\":\"$CLI\",\"role\":\"authenticated\"}', true);
    set local role authenticated;
    select public.submit_revision_round('$DRAFT', '$1');
    select pg_sleep(1.5);
    commit;" >"$TMP/sub-$1.log" 2>&1; echo $? >"$TMP/sub-$1.rc"
}
submit c0ffee00-0000-0000-0000-000000000001 &
sleep 0.3
submit c0ffee00-0000-0000-0000-000000000002 &
wait
AFTER=$("${PSQL[@]}" -d modulardom_test -tAc "select count(*) from public.revision_rounds where project_id = '$PAV'")
OKS=$(cat "$TMP"/sub-*.rc | grep -c '^0$')
if [ "$((AFTER - BEFORE))" != "1" ] || [ "$OKS" != "1" ]; then
  echo "   FALLADA: s'han creat $((AFTER - BEFORE)) rondes ($OKS enviaments acceptats)"; cat "$TMP"/sub-*.log; exit 1
fi
echo "   OK  només una ronda creada; el segon enviament simultani s'ha rebutjat: $(grep -ho 'ja s.ha enviat' "$TMP"/sub-*.log | head -1)"

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
    echo "truncate public.pipeline_stage_requirements, public.upload_rules, app.project_code_counters;"
    cat "$DUMPA" "$DUMPD"; } \
      | "${PSQL[@]}" -d modulardom_restore --single-transaction >/dev/null
  for t in profiles clients client_users project_holders project_financials project_steps project_stage_history tasks calendar_events notifications pipeline_stage_requirements revision_rounds revision_items plan_annotations comments document_links revision_confirmations upload_rules projects project_members documents audit_log; do
    a=$("${PSQL[@]}" -d modulardom_test    -tAc "select count(*) from public.$t")
    b=$("${PSQL[@]}" -d modulardom_restore -tAc "select count(*) from public.$t")
    if [ "$a" != "$b" ]; then echo "   FALLADA restauració $t: $a ≠ $b"; exit 1; fi
    echo "   OK  $t: $a files restaurades"
  done
fi
echo "✔ Tot correcte"
