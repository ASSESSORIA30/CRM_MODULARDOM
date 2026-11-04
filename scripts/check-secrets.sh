#!/usr/bin/env bash
# Comprova que no hi ha secrets al repositori ni claus privades exposades al navegador.
# Ús: scripts/check-secrets.sh   (també s'executarà a CI i abans de cada fase)
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
files=$(git ls-files --cached --others --exclude-standard | grep -v -E '^(scripts/check-secrets\.sh)$')

check() { # $1 descripció, $2 regex
  local hits
  hits=$(echo "$files" | xargs -r grep -n -I -E "$2" 2>/dev/null || true)
  if [ -n "$hits" ]; then echo "✖ $1"; echo "$hits" | sed 's/^/    /'; fail=1; fi
}

check "Clau secreta de Supabase (sb_secret_)" 'sb_secret_[A-Za-z0-9_-]{10,}'
check "JWT service_role antic" 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl'
check "Variable secreta exposada al navegador (NEXT_PUBLIC_*SECRET/SERVICE)" 'NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE_ROLE|DB_URL|PASSWORD)'
check "Cadena de connexió amb contrasenya" 'postgres(ql)?://[^:@/ ]+:[^@<> ]{6,}@'

# Fitxers client que referencien la clau secreta o el client admin
for f in $(echo "$files" | grep -E '\.(ts|tsx)$'); do
  if head -3 "$f" | grep -q "use client" && grep -q -E 'SUPABASE_SECRET_KEY|supabase/admin' "$f"; then
    echo "✖ $f és un component client i referencia la clau secreta o el client admin"; fail=1
  fi
done

if echo "$files" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$'; then
  echo "✖ Hi ha fitxers .env dins del repositori"; fail=1
fi

[ $fail = 0 ] && echo "✔ Cap secret exposat"
exit $fail
