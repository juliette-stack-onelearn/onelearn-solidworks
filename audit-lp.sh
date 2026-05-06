#!/usr/bin/env bash
# audit-lp.sh — Audit qualité d'une landing page One Learn (HTML statique + assets)
# Usage : ./audit-lp.sh [page-folder]
#   ex: ./audit-lp.sh communication-design
# Si aucun argument : audite tous les dossiers contenant un index.html à la racine

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'
YEL='\033[0;33m'
GRN='\033[0;32m'
BLU='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

GLOBAL_FAILS=0
GLOBAL_WARNS=0

audit_one() {
  local folder="$1"
  local html="$folder/index.html"

  if [[ ! -f "$html" ]]; then
    echo -e "${RED}❌ $folder : pas d'index.html, skip${NC}"
    return 1
  fi

  local fails=0
  local warns=0
  echo
  echo -e "${BLU}━━━ Audit : $folder ━━━${NC}"

  # --- 1. Taille du HTML ---
  local size_kb=$(( $(wc -c < "$html") / 1024 ))
  if (( size_kb > 300 )); then
    echo -e "  ${RED}❌ HTML > 300 KB ($size_kb KB) — bloat probable${NC}"
    ((fails++))
  elif (( size_kb > 250 )); then
    echo -e "  ${YEL}⚠  HTML un peu lourd ($size_kb KB)${NC}"
    ((warns++))
  else
    echo -e "  ${GRN}✓${NC} ${DIM}Taille HTML : $size_kb KB${NC}"
  fi

  # --- 2. Doublons de scripts critiques (signature unique par script, pas substring) ---
  # On compte les occurrences de patterns d'init UNIQUE qui n'apparaissent que dans le script lui-même
  local pixel_count=$(grep -cF 'fbq("init"' "$html" | tr -d ' ')
  if (( pixel_count > 1 )); then
    echo -e "  ${RED}❌ Facebook Pixel chargé $pixel_count fois (doublon)${NC}"
    ((fails++))
  fi

  local tt_count=$(grep -cF 'TiktokAnalyticsObject' "$html" | tr -d ' ')
  if (( tt_count > 1 )); then
    echo -e "  ${RED}❌ TikTok Pixel chargé $tt_count fois (doublon)${NC}"
    ((fails++))
  fi

  local clarity_count=$(grep -cF 'clarity.ms/tag/' "$html" | tr -d ' ')
  if (( clarity_count > 1 )); then
    echo -e "  ${RED}❌ Clarity chargé $clarity_count fois (doublon)${NC}"
    ((fails++))
  fi

  local axeptio_count=$(grep -cF 'static.axept.io/sdk' "$html" | tr -d ' ')
  if (( axeptio_count > 1 )); then
    echo -e "  ${RED}❌ Axeptio chargé $axeptio_count fois (doublon)${NC}"
    ((fails++))
  fi

  # GTM : on cherche la signature de bootstrap ('gtm.start' literal) plutôt que l'URL
  local gtm_count=$(grep -cF "'gtm.start'" "$html" | tr -d ' ')
  if (( gtm_count > 1 )); then
    echo -e "  ${RED}❌ GTM chargé $gtm_count fois (doublon)${NC}"
    ((fails++))
  fi

  if (( pixel_count <= 1 && tt_count <= 1 && clarity_count <= 1 && axeptio_count <= 1 && gtm_count <= 1 )); then
    echo -e "  ${GRN}✓${NC} ${DIM}Pas de scripts en doublon${NC}"
  fi

  # --- 3. Images référencées qui n'existent pas ---
  local missing=0
  while IFS= read -r ref; do
    [[ -z "$ref" ]] && continue
    [[ "$ref" =~ ^https?:// ]] && continue
    [[ "$ref" =~ ^data: ]] && continue
    [[ -f "$folder/$ref" ]] || { echo -e "  ${RED}❌ Image manquante : $ref${NC}"; ((missing++)); }
  done < <(grep -oE 'src="(assets/[^"]+\.(png|jpe?g|svg|webp|gif))"' "$html" | sed -E 's/^src="([^"]+)"$/\1/' | sort -u)

  if (( missing == 0 )); then
    echo -e "  ${GRN}✓${NC} ${DIM}Toutes les images référencées existent${NC}"
  else
    ((fails+=missing))
  fi

  # --- 4. Assets orphelins (présents mais non référencés) ---
  local orphans=0
  if [[ -d "$folder/assets" ]]; then
    while IFS= read -r file; do
      local rel="${file#$folder/}"
      grep -qF "\"$rel\"" "$html" || grep -qF "'$rel'" "$html" || { echo -e "  ${YEL}⚠  Asset orphelin : $rel${NC}"; ((orphans++)); }
    done < <(find "$folder/assets" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.svg' -o -name '*.webp' -o -name '*.gif' \))
  fi
  if (( orphans == 0 )); then
    echo -e "  ${GRN}✓${NC} ${DIM}Pas d'assets orphelins${NC}"
  else
    ((warns+=orphans))
    echo -e "  ${DIM}    → utiliser ./audit-lp.sh --clean $folder pour les supprimer${NC}"
  fi

  # --- 5. style="" vides ---
  local empty_style=$(grep -oE 'style=""' "$html" | wc -l | tr -d ' ')
  if (( empty_style > 0 )); then
    echo -e "  ${YEL}⚠  $empty_style attribut(s) style=\"\" vide(s)${NC}"
    ((warns++))
  fi

  # --- 6. TODO / FIXME / XXX dans le HTML ---
  local todos=$(grep -cE '<!--\s*(TODO|FIXME|XXX)' "$html" 2>/dev/null | tr -d ' ')
  if (( todos > 0 )); then
    echo -e "  ${YEL}⚠  $todos commentaire(s) TODO/FIXME oublié(s)${NC}"
    ((warns++))
  fi

  # --- 7. Ancres href="#xxx" sans cible correspondante ---
  local broken_anchors=0
  while IFS= read -r anchor; do
    [[ "$anchor" == "#" ]] && continue
    local id="${anchor#\#}"
    grep -qE "id=\"$id\"" "$html" || { echo -e "  ${YEL}⚠  Ancre cassée : href=\"$anchor\" sans cible${NC}"; ((broken_anchors++)); }
  done < <(grep -oE 'href="#[a-zA-Z][a-zA-Z0-9_-]*"' "$html" | sed -E 's/^href="([^"]+)"$/\1/' | sort -u)
  ((warns+=broken_anchors))

  # --- 8. Vérif simple "is it the right page" (titre + h1) ---
  if [[ "$folder" == *"architecture"* ]]; then
    if grep -qE '<title>[^<]*[Cc]ommunication' "$html" || grep -qE '<title>[^<]*[Dd]esign' "$html"; then
      echo -e "  ${RED}❌ Title parle de Communication/Design dans le dossier $folder${NC}"
      ((fails++))
    fi
  elif [[ "$folder" == *"communication-design"* ]]; then
    if grep -qE '<title>[^<]*[Aa]rchitecture' "$html"; then
      echo -e "  ${RED}❌ Title parle d'Architecture dans le dossier $folder${NC}"
      ((fails++))
    fi
  fi

  # --- 9. Editor/PAT en dur (sécurité) ---
  if grep -qE '(ghp_|github_pat_)[A-Za-z0-9_]{20,}' "$html"; then
    echo -e "  ${RED}❌ Token GitHub en dur dans le HTML — DANGER SÉCURITÉ${NC}"
    ((fails++))
  fi

  # --- Récap dossier ---
  if (( fails == 0 && warns == 0 )); then
    echo -e "  ${GRN}✅ Audit clean${NC}"
  elif (( fails == 0 )); then
    echo -e "  ${YEL}⚠  $warns warning(s)${NC}"
  else
    echo -e "  ${RED}❌ $fails erreur(s) bloquante(s), $warns warning(s)${NC}"
  fi

  GLOBAL_FAILS=$((GLOBAL_FAILS + fails))
  GLOBAL_WARNS=$((GLOBAL_WARNS + warns))
}

# --- Mode --fix : autofix doublons GTM/Axeptio/trackers via normalize-page.js ---
if [[ "${1:-}" == "--fix" ]]; then
  shift
  if [[ ! -f "$ROOT/scripts/normalize-page.js" ]]; then
    echo -e "${RED}scripts/normalize-page.js introuvable${NC}"; exit 1
  fi
  if [[ $# -eq 0 ]]; then
    node "$ROOT/scripts/normalize-page.js" --all
  else
    for folder in "$@"; do node "$ROOT/scripts/normalize-page.js" "${folder%/}/index.html"; done
  fi
  exit $?
fi

# --- Mode --clean : supprime les assets orphelins du dossier passé ---
if [[ "${1:-}" == "--clean" ]]; then
  shift
  folder="${1:-}"
  [[ -z "$folder" ]] && { echo "Usage : ./audit-lp.sh --clean <dossier>"; exit 1; }
  html="$folder/index.html"
  [[ ! -f "$html" ]] && { echo "Pas d'index.html dans $folder"; exit 1; }
  removed=0
  while IFS= read -r file; do
    rel="${file#$folder/}"
    if ! grep -qF "\"$rel\"" "$html" && ! grep -qF "'$rel'" "$html"; then
      echo -e "${RED}🗑  rm $rel${NC}"
      rm "$file"
      ((removed++))
    fi
  done < <(find "$folder/assets" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.svg' -o -name '*.webp' -o -name '*.gif' \))
  echo -e "${GRN}$removed fichier(s) orphelin(s) supprimé(s)${NC}"
  exit 0
fi

# --- Audit principal ---
cd "$ROOT"
echo -e "${BLU}╭──────────────────────────────────────────╮${NC}"
echo -e "${BLU}│  AUDIT LANDING PAGES — One Learn         │${NC}"
echo -e "${BLU}╰──────────────────────────────────────────╯${NC}"

if [[ $# -gt 0 ]]; then
  for folder in "$@"; do
    audit_one "${folder%/}"
  done
else
  for folder in */; do
    [[ -f "$folder/index.html" ]] && audit_one "${folder%/}"
  done
fi

echo
echo -e "${BLU}━━━ Récap global ━━━${NC}"
if (( GLOBAL_FAILS == 0 )); then
  echo -e "${GRN}✅ 0 erreur bloquante${NC}, ${YEL}$GLOBAL_WARNS warning(s)${NC}"
  exit 0
else
  echo -e "${RED}❌ $GLOBAL_FAILS erreur(s) bloquante(s)${NC}, ${YEL}$GLOBAL_WARNS warning(s)${NC}"
  echo -e "${DIM}    → ./audit-lp.sh --fix              # corrige tous les doublons GTM/Axeptio/trackers${NC}"
  echo -e "${DIM}    → ./audit-lp.sh --fix <dossier>    # idem sur un dossier précis${NC}"
  exit 1
fi
