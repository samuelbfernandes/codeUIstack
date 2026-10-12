#!/bin/sh
# Automatic second-model theory review (rule #6), run from pre-push. Zero tokens from the model that wrote the code:
# the OTHER model (Codex by default) reads the pushed diff of the "theory paths", read-only, and returns a structured verdict.
#
#   usage: theory-review.sh <base-sha|"">  <head-sha>        exit 0 = ok/skipped, 1 = reviewer says FAIL
#
# Active only where it makes sense: a repo with docs/THEORY_REVIEW.md, or with `git config toolkit.theoryPaths "R src ..."`.
# Cost control: one review per push (aggregated diff), cached by diff hash, diff capped, reviewer sandboxed read-only.
# Knobs (git config, --local or --global):
#   toolkit.theoryReview     false          switch off
#   toolkit.theoryPaths      "R src"        pathspecs (space-separated; globs allowed) that count as theory/method code
#   toolkit.theoryReviewer   codex|claude   who reviews (default codex; use claude if CODEX wrote the change)
#   toolkit.theoryMaxBytes   120000         diff cap sent to the reviewer
#   toolkit.theoryTimeoutSec 900            give up after this long: the push is allowed but loudly marked UNREVIEWED
#   toolkit.codexArgs        "-m ... -c model_reasoning_effort=\"medium\""   extra codex flags (tune cost here)
#   toolkit.theoryAsk        amber-red|always|never   when to show the cost and ask (default amber-red; asks only on a terminal)
#   toolkit.theoryGreenMax / toolkit.theoryRedMin     token thresholds for the green / red colour (25000 / 60000)
# The review-cost mod answers the same question inside Claude Code and leaves its choice in toolkit.theoryDecision
# ("review:<epoch>" or "skip:<epoch>", honoured for 10 minutes, then cleared). After each real review the tokens used are
# recorded (toolkit.theoryUsage, last 10) so the estimate calibrates itself.
# Env: SKIP_THEORY_REVIEW=1 skips once; ALLOW_FAILED_REVIEW=1 lets a FAIL verdict through once.
. "$(dirname "$0")/_lib.sh"
. "$(dirname "$0")/_estimate.sh"
here="$(cd "$(dirname "$0")" && pwd)"
base="$1"; head="$2"
# A choice made in the review-cost dialog travels in git config. Read it and clear it at once, so it only ever applies to this push.
decision=''
d=$(git config --local --get toolkit.theoryDecision 2>/dev/null)
if [ -n "$d" ]; then
  git config --local --unset toolkit.theoryDecision 2>/dev/null
  dword=${d%%:*}; dtime=${d##*:}
  case "$dtime" in ''|*[!0-9]*) ;; *) [ $(( $(date +%s) - dtime )) -ge 0 ] && [ $(( $(date +%s) - dtime )) -le 600 ] && decision=$dword;; esac
fi
[ "${SKIP_THEORY_REVIEW:-}" = "1" ] && exit 0
[ "$(git config --get toolkit.theoryReview 2>/dev/null)" = "false" ] && exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
paths=$(git config --get toolkit.theoryPaths 2>/dev/null)
if [ -z "$paths" ]; then
  if [ -f "$root/docs/THEORY_REVIEW.md" ]; then paths="R src"; else exit 0; fi
fi
# Windows students often have no python3 (or only the Microsoft Store stub): find a working one, else say so BEFORE spending tokens.
PY=""; for c in python3 python; do if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import json' >/dev/null 2>&1; then PY=$c; break; fi; done
if [ -z "$PY" ]; then fail "theory review needs python (python3 or python): this push is UNREVIEWED. Install Python, or git config toolkit.theoryReview false"; exit 0; fi
reviewer=$(git config --get toolkit.theoryReviewer 2>/dev/null); [ -z "$reviewer" ] && reviewer=codex
maxbytes=$(git config --get toolkit.theoryMaxBytes 2>/dev/null); [ -z "$maxbytes" ] && maxbytes=120000
tmo=$(git config --get toolkit.theoryTimeoutSec 2>/dev/null); [ -z "$tmo" ] && tmo=900
extra=$(git config --get toolkit.codexArgs 2>/dev/null)
# Empty base = a branch with no pushed history: diff against git's empty tree (written once so git can name it).
[ -z "$base" ] && base=$(git hash-object -t tree -w /dev/null 2>/dev/null)

tmp=$(mktemp -d "${TMPDIR:-/tmp}/theory.XXXXXX") || exit 0
trap 'rm -rf "$tmp"' EXIT INT TERM
set -f; set -- $paths; set +f
git diff --no-color --no-ext-diff "$base" "$head" -- "$@" > "$tmp/diff.patch" 2>/dev/null || exit 0
[ -s "$tmp/diff.patch" ] || exit 0                     # nothing in the theory paths changed: no review, no cost
bytes=$(wc -c < "$tmp/diff.patch" | tr -d ' ')
if [ "$bytes" -gt "$maxbytes" ]; then
  head -c "$maxbytes" "$tmp/diff.patch" > "$tmp/cut" && mv "$tmp/cut" "$tmp/diff.patch"
  printf '\n[diff truncated at %s bytes of %s: review what is shown and say UNVERIFIABLE for the rest]\n' "$maxbytes" "$bytes" >> "$tmp/diff.patch"
fi

gitdir=$(git rev-parse --absolute-git-dir); cache="$gitdir/toolkit-reviews"; mkdir -p "$cache"
key=$( { cat "$tmp/diff.patch"; printf 'reviewer=%s' "$reviewer"; } | git hash-object --stdin )
result="$cache/$key.json"

summarize() {  # prints the non-PASS findings; exit status 1 when the verdict is FAIL
  "$PY" - "$1" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
rows=d.get("findings",[])
bad=[r for r in rows if r.get("status")!="PASS"]
verdict="fail" if any(r.get("status")=="FAIL" for r in rows) else d.get("verdict","unverifiable")
print("[toolkit] theory review: %s  (%d findings, %d not PASS)" % (verdict.upper(), len(rows), len(bad)))
if d.get("summary"): print("    " + d["summary"][:400])
for r in bad[:10]:
    print("    %-12s %s\n        evidence: %s\n        source:   %s" % (r.get("status"), r.get("item","")[:160], r.get("evidence","")[:200], r.get("source","")[:200]))
sys.exit(1 if verdict=="fail" else 0)
PY
}

REVIEWER_LABEL=Codex; [ "$reviewer" = claude ] && REVIEWER_LABEL=Claude
if [ ! -s "$result" ]; then
  # Show what this will cost BEFORE spending it, and let the person say no.
  sent=$bytes; [ "$sent" -gt "$maxbytes" ] && sent=$maxbytes
  set -- $(estimate_review "$sent"); e_low=$1; e_exp=$2; e_high=$3; e_n=$5
  level=$(est_level "$e_exp")
  askmode=$(git config --get toolkit.theoryAsk 2>/dev/null); [ -z "$askmode" ] && askmode=amber-red
  if [ "$decision" = skip ]; then
    fail "theory review SKIPPED at your request (cost): this push is UNREVIEWED"; exit 0
  elif [ "$decision" = review ]; then
    : # already chosen in the Claude Code dialog
  else
    printf '[toolkit] %s\n' "$(est_line "$level" "$e_low" "$e_exp" "$e_high" "$e_n")" >&2
    if [ "$askmode" = always ] || { [ "$askmode" = amber-red ] && [ "$level" != green ]; }; then
      if ! ask_review "$level"; then fail "theory review SKIPPED at your request (cost): this push is UNREVIEWED"; exit 0; fi
    fi
  fi
  printf '[toolkit] theory review by %s of %s bytes in [%s] (read-only; cached by diff; SKIP_THEORY_REVIEW=1 to skip)\n' "$reviewer" "$bytes" "$paths" >&2
  prompt='You are an independent reviewer of a pull of changes in a scientific software project. You are READ-ONLY: never edit, create or delete anything. Your job is to FALSIFY, not to agree: find the input, frequency, sample size or edge case that breaks the equation or identity, the assumption the code violates, the place where behaviour diverges from the stated spec, and any cited equation, page or source that cannot be verified. If docs/THEORY_REVIEW.md exists in the repository, use it as the rubric, item by item. The diff to review is on stdin. Prefer reading the code to running it; run only quick, targeted checks. Never invent a citation, page number or equation: anything you cannot verify is UNVERIFIABLE. Report at most 10 findings, only those that are FAIL or UNVERIFIABLE plus at most 3 important PASS items, each with file:line evidence and the primary source. verdict is fail if any finding is FAIL, else unverifiable if any is UNVERIFIABLE, else pass. A review that only confirms is a failed review.'
  rc=1
  case "$reviewer" in
    codex)
      if ! command -v codex >/dev/null 2>&1; then fail "codex CLI not found: this push is UNREVIEWED (install it, or git config toolkit.theoryReview false)"; exit 0; fi
      # shellcheck disable=SC2086
      codex exec $extra -s read-only --ephemeral -C "$root" --output-schema "$here/../theory-review.schema.json" -o "$tmp/out.json" "$prompt" \
        < "$tmp/diff.patch" > "$tmp/run.log" 2>&1 &
      ;;
    claude)
      if ! command -v claude >/dev/null 2>&1; then fail "claude CLI not found: this push is UNREVIEWED"; exit 0; fi
      ( claude -p --no-session-persistence --permission-mode plan --disallowedTools "Edit Write NotebookEdit Bash" \
          --output-format json --json-schema "$(cat "$here/../theory-review.schema.json")" "$prompt" \
          < "$tmp/diff.patch" > "$tmp/raw.json" 2> "$tmp/run.log"; ) &
      ;;
    *) fail "unknown toolkit.theoryReviewer '$reviewer' (codex|claude): this push is UNREVIEWED"; exit 0;;
  esac
  pid=$!
  ( sleep "$tmo"; kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null ) >/dev/null 2>&1 &
  dog=$!
  wait "$pid"; rc=$?
  kill "$dog" 2>/dev/null; pkill -P "$dog" 2>/dev/null; wait "$dog" 2>/dev/null
  if [ "$reviewer" = claude ] && [ -s "$tmp/raw.json" ]; then
    "$PY" - "$tmp/raw.json" "$tmp/out.json" <<'PY' 2>/dev/null
import json,sys
raw=json.load(open(sys.argv[1])); cand=raw.get("structured_output")
if cand is None and isinstance(raw.get("result"),str):
    try: cand=json.loads(raw["result"])
    except Exception: cand=None
if isinstance(cand,dict) and "verdict" in cand: json.dump(cand,open(sys.argv[2],"w"))
PY
  fi
  if [ ! -s "$tmp/out.json" ] || ! "$PY" -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["verdict"] in ("pass","fail","unverifiable")' "$tmp/out.json" 2>/dev/null; then
    fail "theory review did not complete (exit $rc, timeout ${tmo}s?): this push is UNREVIEWED. Log tail:"
    tail -n 5 "$tmp/run.log" 2>/dev/null | sed 's/^/    /' >&2
    exit 0       # fail-open: infrastructure trouble must not wedge your work, but it is never silent
  fi
  cp "$tmp/out.json" "$result"
  # Best-effort: remember the tokens this review really used (codex prints a "tokens used" line) to calibrate the next estimate.
  used=$(grep -i -A1 'tokens used' "$tmp/run.log" 2>/dev/null | tr -d ',' | grep -Eo '[0-9]{3,}' | tail -n 1)
  if [ -n "$used" ]; then
    { git config --local --get-all toolkit.theoryUsage 2>/dev/null | tail -n 9; echo "$sent:$used"; } > "$tmp/usage"
    git config --local --unset-all toolkit.theoryUsage 2>/dev/null
    while read -r line; do git config --local --add toolkit.theoryUsage "$line"; done < "$tmp/usage"
  fi
else
  printf '[toolkit] theory review: cached verdict for this exact diff\n' >&2
fi

summarize "$result" >&2; verdict_rc=$?
if [ "$verdict_rc" -ne 0 ]; then
  if [ "${ALLOW_FAILED_REVIEW:-}" = "1" ]; then fail "reviewer said FAIL; ALLOW_FAILED_REVIEW=1: pushing anyway. Record this in your decisions log."; exit 0; fi
  fail "push rejected: the reviewer found a FAIL. Fix and commit (a new diff is re-reviewed), or ALLOW_FAILED_REVIEW=1 for one push."
  exit 1
fi
exit 0
