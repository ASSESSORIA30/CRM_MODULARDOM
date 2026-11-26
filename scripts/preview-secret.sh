#!/usr/bin/env bash
# Genera el secret compartit web ↔ CRM i el desa als dos projectes de Vercel (entorn Preview)
# sense mostrar-lo ni escriure'l enlloc. Necessita la CLI de Vercel amb sessió iniciada.
# Ús: scripts/preview-secret.sh <carpeta del CRM> <carpeta de la web>
#     (cada carpeta ha d'estar enllaçada al seu projecte amb `vercel link`)
set -euo pipefail
CRM="${1:?carpeta del repositori del CRM}"; WEB="${2:?carpeta del repositori de la web}"
SECRET="$(openssl rand -hex 32)"
printf '%s' "$SECRET" | (cd "$CRM" && vercel env add WEB_LEADS_SECRET preview --sensitive --force >/dev/null)
printf '%s' "$SECRET" | (cd "$WEB" && vercel env add CRM_LEAD_SECRET preview --sensitive --force >/dev/null)
unset SECRET
echo "Secret desat a WEB_LEADS_SECRET (CRM) i CRM_LEAD_SECRET (web), entorn Preview."
echo "Falten, a mà o amb 'vercel env add': WEB_LEADS_ENABLED, CRM_LEAD_URL, CRM_LEADS_ENABLED. Després, Redeploy."
