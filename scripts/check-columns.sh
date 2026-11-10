#!/usr/bin/env bash
# Comprova que totes les columnes, relacions i funcions RPC que fa servir el codi existeixen
# a l'esquema que creen les migracions (PostgreSQL local temporal, sense Supabase).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PORT:-54330}"
TMP="$(mktemp -d)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then chown postgres "$TMP"; RUN_AS=(runuser -u postgres --); fi
cleanup() { "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT
"${RUN_AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null
PSQL=("${RUN_AS[@]}" psql -X -q -At -v ON_ERROR_STOP=1 -h "$TMP" -p "$PORT" -U postgres)
"${PSQL[@]}" -d postgres -c "create database cols" >/dev/null
"${PSQL[@]}" -d cols -f "$ROOT/tests/local-stubs/supabase_stubs.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -d cols -f "$f" >/dev/null; done
cd "$ROOT"
fail=0; n=0
while read -r kind a b; do
  n=$((n+1))
  case "$kind" in
    C) q="select 1 from information_schema.columns where table_schema='public' and table_name='$a' and column_name='$b'";;
    E) q="select 1 from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_class r on r.oid=c.confrelid
          where c.contype='f' and ((t.relname='$a' and r.relname='$b') or (t.relname='$b' and r.relname='$a')) limit 1";;
    R) q="select 1 from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='$a' limit 1";;
  esac
  if [ -z "$("${PSQL[@]}" -d cols -c "$q")" ]; then echo "✗ $kind $a $b"; fail=1; fi
done < <(python3 scripts/check-columns.py)
if [ $fail = 0 ]; then echo "✔ $n columnes, relacions i funcions comprovades"; else exit 1; fi
