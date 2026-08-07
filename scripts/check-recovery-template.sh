#!/usr/bin/env bash
#
# Controle de derive du modele d'e-mail "Reset password" (lot INFRA.2).
#
# Verifie que la configuration d'authentification du projet de PRODUCTION
# correspond a la copie de reference versionnee dans ce depot. Perdre l'un des
# trois elements compares casse la reinitialisation de mot de passe en silence.
#
# EXECUTION MANUELLE UNIQUEMENT — aucun secret n'est stocke dans ce depot,
# aucune execution automatique n'est branchee. A lancer avant une mise en
# production, ou en cas de doute :
#
#   SUPABASE_ACCESS_TOKEN="<jeton temporaire>" bash scripts/check-recovery-template.sh
#
# Le jeton se cree sur https://supabase.com/dashboard/account/tokens avec la
# duree la plus courte proposee, et SE SUPPRIME immediatement apres usage :
# il porte tous les droits du compte. Supabase ne permet pas, sur le plan
# actuel, de creer un jeton en lecture seule.
#
# LECTURE SEULE : ce script n'emet qu'un GET. Il n'ecrit rien sur Supabase.
# Sortie 0 = conforme. Sortie 1 = derive detectee.
#
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-grrzisdrhstuzrohlgla}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TPL="$ROOT/supabase/templates/recovery.html"
EXPECTED_SUBJECT="Reset your password"
EXPECTED_SITE_URL="https://www.mirvo.ai"

command -v jq >/dev/null || { echo "jq est requis (brew install jq)"; exit 2; }
[ -f "$TPL" ] || { echo "Copie de reference introuvable : $TPL"; exit 2; }

if [ -n "${AUTH_CONFIG_FILE:-}" ]; then
  CFG="$(cat "$AUTH_CONFIG_FILE")"
else
  : "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN manquant}"
  CFG="$(curl -sSf -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
        "https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth")"
fi

remote_content="$(printf '%s' "$CFG" | jq -r '.mailer_templates_recovery_content')"
remote_subject="$(printf '%s' "$CFG" | jq -r '.mailer_subjects_recovery')"
remote_site_url="$(printf '%s' "$CFG" | jq -r '.site_url')"
expected_content="$(cat "$TPL")"

fail=0
if [ "$remote_content" != "$expected_content" ]; then
  echo "DERIVE : le contenu du modele Recovery differe de la copie versionnee"
  diff -u "$TPL" <(printf '%s\n' "$remote_content") || true
  fail=1
fi
[ "$remote_subject"  = "$EXPECTED_SUBJECT"  ] || { echo "DERIVE : sujet distant = '$remote_subject'"; fail=1; }
[ "$remote_site_url" = "$EXPECTED_SITE_URL" ] || { echo "DERIVE : site_url distant = '$remote_site_url'"; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo "ECHEC : la reinitialisation de mot de passe peut etre cassee."
  exit 1
fi
echo "OK : contenu, sujet et site_url conformes a la reference du depot."
