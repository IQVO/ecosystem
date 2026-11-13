#!/usr/bin/env bash
# The sanctioned refresh of specs/ and the generated catalog, as ONE command (the procedure in
# .claude/rules/specs-and-generation.md): sync -> orphan sensor -> generate -> lint -> build -> re-sync, and the
# re-sync must find the same bytes generate used (otherwise a producer merged mid-run and the pages lag the specs).
# The specs-refresh workflow runs it a few times a day and turns the result into the bot PR `chore/specs-refresh`;
# a human runs the same thing locally instead of chaining the steps by hand.
#
# Usage: WAREHOUSE_ROOT=<dir holding the producer clones> scripts/specs-refresh.sh
#        SPECS_REFRESH_LOG=<dir> keeps the step logs there (default: $TMPDIR/specs-refresh).
# Exit:  0 refreshed, or nothing to refresh (specs/ already equals every producer's develop; prints NO-DRIFT)
#        1 a step failed (sensor, generate parse error, half-written tree, lint, build): the tree is NOT committable
#        3 a producer moved while generate ran: run again
set -euo pipefail
cd "$(dirname "$0")/.."
LOG="${SPECS_REFRESH_LOG:-${TMPDIR:-/tmp}/specs-refresh}"
mkdir -p "$LOG"

step() { # step <name> <cmd...>: run a step into its own log; on failure show the tail and stop
  local name=$1; shift
  echo "specs-refresh: $name"
  if ! "$@" >"$LOG/$name.log" 2>&1; then
    tail -n 60 "$LOG/$name.log"
    echo "specs-refresh: FAILED at $name (log: $LOG/$name.log)"
    exit 1
  fi
}

step sync npm run sync
if git diff --quiet -- specs && [ -z "$(git ls-files --others --exclude-standard -- specs)" ]; then
  echo "specs-refresh: NO-DRIFT, every spec copy equals its producer's develop"
  exit 0
fi
git status --short -- specs

snap="$(mktemp -d)"
cp -R specs "$snap/specs"

# A new upstream contract can bring an event type nobody consumes: the orphan sensor must stay green.
step orphan-events npm run check:events
step generate npm run generate
# generator-openapi SKIPS an invalid spec silently (exit 0, no page): this line is the only trace.
if grep -n 'Failed to parse' "$LOG/generate.log"; then
  echo "specs-refresh: FAILED, a producer spec does not parse (fix it in the producer repo, never in specs/)"
  exit 1
fi
empty="$(find domains channels -type d -empty)"
if [ -n "$empty" ]; then
  echo "$empty"
  echo "specs-refresh: FAILED, generate left empty directories (a half-written tree breaks the build)"
  exit 1
fi
rm -rf .astro || rm -rf .astro
step lint npm run lint
step build npm run build
step resync npm run sync
if ! diff -rq "$snap/specs" specs; then
  echo "specs-refresh: MOVED, a producer merged while generate ran; run again"
  exit 3
fi
echo "specs-refresh: refreshed"
git status --short -- specs domains channels | sed -n '1,40p'
