#!/usr/bin/env bash
# Sync API contracts (AsyncAPI + OpenAPI) from each bounded-context repo's
# origin/develop into ./specs/<context>/. The catalog is generated from these
# committed copies so builds are hermetic and never depend on a stale worktree.
#
# Usage: scripts/sync-specs.sh            # WAREHOUSE_ROOT defaults to ..
#        WAREHOUSE_ROOT=~/warehouse-systems scripts/sync-specs.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="${WAREHOUSE_ROOT:-..}"

CONTEXTS=()
while IFS= read -r c; do CONTEXTS+=("$c"); done < <(
  node --input-type=module -e "import('./catalog.contexts.mjs').then(m => console.log(Object.keys(m.CONTEXTS).join('\n')))"
)
FILES=(asyncapi.yaml openapi.yaml openapi-reports.yaml)

for ctx in "${CONTEXTS[@]}"; do
  repo="$ROOT/$ctx"
  [ -d "$repo/.git" ] || { echo "skip $ctx (no clone at $repo)"; continue; }
  git -C "$repo" fetch --quiet origin develop
  rm -rf "specs/$ctx"; mkdir -p "specs/$ctx"
  for f in "${FILES[@]}"; do
    if git -C "$repo" cat-file -e "origin/develop:apis/$f" 2>/dev/null; then
      git -C "$repo" show "origin/develop:apis/$f" > "specs/$ctx/$f"
    fi
  done
  echo "synced $ctx@$(git -C "$repo" rev-parse --short origin/develop): $(ls specs/$ctx | tr '\n' ' ')"
done
