#!/usr/bin/env bash
# Everything CI runs, runnable locally:  bash scripts/check-all.sh
# Steps that need the `claude` CLI are skipped (with a message) when it is not installed.
set -u
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
fails=0
step() { printf '\n== %s\n' "$1"; shift; if "$@"; then echo "   ok"; else echo "   FAILED"; fails=$((fails+1)); fi; }

step "marketplace.json is up to date"  "$PY" scripts/build_marketplace.py --check
step "capability audit"                "$PY" scripts/audit.py --check
step "installer tests"                 "$PY" -m unittest discover -s tests
step "git guard tests"                 bash global/tests/test-hooks.sh
if command -v claude >/dev/null 2>&1; then
  step "claude plugin validate (marketplace + every mod)" bash -c 'claude plugin validate . && for m in mods/*/; do claude plugin validate "$m" || exit 1; done'
  step "mod unit tests (claude plugin test)" bash -c 'for m in mods/*/; do echo "-- $m"; claude plugin test "$m" || exit 1; done'
else
  echo; echo "== claude CLI not found: skipping plugin validate and mod tests"
fi
echo; [ "$fails" = 0 ] && { echo "ALL CHECKS PASSED"; exit 0; } || { echo "$fails CHECK(S) FAILED"; exit 1; }
