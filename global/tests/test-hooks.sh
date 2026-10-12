#!/bin/sh
# Runs the global git hooks against real throwaway repositories, with fake `codex`/`claude` on PATH.
# Usage: sh test-hooks.sh        (prints PASS/FAIL per case, exit 1 if any failed)
set -u
HOOKS="$(cd "$(dirname "$0")/../githooks" && pwd)"
W=$(mktemp -d); export HOME="$W/home"; mkdir -p "$HOME" "$W/bin"
export GIT_CONFIG_GLOBAL="$HOME/.gitconfig"; export PATH="$W/bin:$PATH"
git config --global user.name t; git config --global user.email t@t.t
git config --global core.hooksPath "$HOOKS"; git config --global core.excludesFile "$HOOKS/ignore"; git config --global toolkit.profile lab
fails=0
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fails=$((fails+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected $2, got $3)"; fi; }

# fake codex: records calls, emits the verdict in $FAKE_VERDICT (pass|fail|unverifiable) to the -o file
cat > "$W/bin/codex" <<'SH'
#!/bin/sh
echo "$*" >> "$FAKE_LOG"; cat > "$FAKE_LOG.stdin"
while [ $# -gt 0 ]; do [ "$1" = "-o" ] && out="$2"; shift; done
[ -n "${FAKE_SLEEP:-}" ] && sleep "$FAKE_SLEEP"
[ -n "${FAKE_TOKENS:-}" ] && printf 'tokens used\n%s\n' "$FAKE_TOKENS"
case "${FAKE_VERDICT:-pass}" in
 pass) printf '{"verdict":"pass","summary":"ok","findings":[{"item":"eq 3","status":"PASS","evidence":"R/a.R:3","source":"x"}]}' > "$out";;
 fail) printf '{"verdict":"fail","summary":"identity breaks at p=0","findings":[{"item":"Eq. 3 at p=0","status":"FAIL","evidence":"R/a.R:3","source":"Lynch & Walsh p.TODO"}]}' > "$out";;
 unverifiable) printf '{"verdict":"unverifiable","summary":"cannot check","findings":[{"item":"cite","status":"UNVERIFIABLE","evidence":"R/a.R:9","source":"?"}]}' > "$out";;
 garbage) printf 'not json' > "$out";;
esac
SH
chmod +x "$W/bin/codex"; export FAKE_LOG="$W/codex.log"
calls() { [ -f "$FAKE_LOG" ] && wc -l < "$FAKE_LOG" | tr -d ' ' || echo 0; }

newrepo() { # $1 name
  rm -rf "$W/$1" "$W/$1.git"; git init -q --bare "$W/$1.git"; git init -q -b main "$W/$1"; cd "$W/$1" || exit 1
  git remote add origin "$W/$1.git"; mkdir -p R docs; echo "x <- 1" > R/a.R; echo "readme" > README.md
}

# --- 1. repo without a theory marker: no review, no codex call
newrepo plain; git add -A; git commit -qm "feat: init"; : > "$FAKE_LOG"
git push -q origin main 2>/dev/null; check "plain repo pushes with no review" 0 "$(calls)"

# --- 2. theory repo: first push reviewed once (pass); README-only push not reviewed
newrepo th; echo "# rubric" > docs/THEORY_REVIEW.md; git add -A; git commit -qm "feat: init"; : > "$FAKE_LOG"
FAKE_VERDICT=pass git push -q origin main 2>"$W/err"; check "theory repo first push ok" 0 $?
check "reviewed once, read-only, schema, stdin diff" 1 "$(calls)"
grep -q -- "-s read-only" "$FAKE_LOG" && ok "sandbox is read-only" || bad "sandbox flag missing: $(cat "$FAKE_LOG")"
grep -q -- "--output-schema" "$FAKE_LOG" && ok "uses --output-schema" || bad "no schema flag"
grep -q "x <- 1" "$FAKE_LOG.stdin" && ok "diff reached the reviewer on stdin" || bad "diff not on stdin"
echo "more" >> README.md; git commit -qam "docs: readme"; git push -q origin main 2>/dev/null
check "README-only push is not reviewed" 1 "$(calls)"

# --- 3. FAIL blocks; cached verdict reused; override works
echo "y <- 2" >> R/a.R; git commit -qam "feat: y"
FAKE_VERDICT=fail git push -q origin main 2>"$W/err"; check "FAIL verdict blocks the push" 1 $?
grep -q "Eq. 3 at p=0" "$W/err" && ok "finding shown" || bad "finding not shown"
n=$(calls); FAKE_VERDICT=pass git push -q origin main 2>/dev/null; check "same diff: cached FAIL still blocks, no new call" "1:$n" "$?:$(calls)"
ALLOW_FAILED_REVIEW=1 git push -q origin main 2>/dev/null; check "ALLOW_FAILED_REVIEW=1 lets it through" 0 $?

# --- 4. unverifiable allowed; garbage = UNREVIEWED but allowed (fail-open); codex missing allowed
echo "z <- 3" >> R/a.R; git commit -qam "feat: z"; FAKE_VERDICT=unverifiable git push -q origin main 2>"$W/err"; check "UNVERIFIABLE is allowed" 0 $?
grep -q UNVERIFIABLE "$W/err" && ok "UNVERIFIABLE reported" || bad "UNVERIFIABLE not reported"
echo "w <- 4" >> R/a.R; git commit -qam "feat: w"; FAKE_VERDICT=garbage git push -q origin main 2>"$W/err"; check "garbage output: fail-open" 0 $?
grep -q UNREVIEWED "$W/err" && ok "says UNREVIEWED" || bad "silent failure"
echo "v <- 5" >> R/a.R; git commit -qam "feat: v"; PATH="/usr/bin:/bin" git push -q origin main 2>"$W/err"; check "no codex installed: allowed with warning" 0 $?
grep -q "codex CLI not found" "$W/err" && ok "warns codex missing" || bad "no warning"

# --- 5. timeout is fail-open and kills the reviewer
echo "u <- 6" >> R/a.R; git commit -qam "feat: u"; git config --local toolkit.theoryTimeoutSec 1
s=$(date +%s); FAKE_SLEEP=20 FAKE_VERDICT=pass git push -q origin main 2>"$W/err"; e=$(date +%s)
check "timeout: push allowed" 0 $?; [ $((e-s)) -lt 12 ] && ok "watchdog fired in ~1s" || bad "watchdog too slow: $((e-s))s"
git config --local --unset toolkit.theoryTimeoutSec

# --- 6. switches
echo "t <- 7" >> R/a.R; git commit -qam "feat: t"; : > "$FAKE_LOG"
SKIP_THEORY_REVIEW=1 FAKE_VERDICT=fail git push -q origin main 2>/dev/null; check "SKIP_THEORY_REVIEW=1" "0:0" "$?:$(calls)"
echo "s <- 8" >> R/a.R; git commit -qam "feat: s"; git config --local toolkit.theoryReview false
FAKE_VERDICT=fail git push -q origin main 2>/dev/null; check "toolkit.theoryReview=false" "0:0" "$?:$(calls)"; git config --local --unset toolkit.theoryReview

# --- 7. custom paths via config (marker file not needed), glob + new branch
newrepo cfg; git add -A; git commit -qm "feat: init"; git config --local toolkit.theoryPaths "R/*.R"; git push -q origin main 2>/dev/null
: > "$FAKE_LOG"; git checkout -q -b feat/x; echo "q <- 1" >> R/a.R; git commit -qam "feat: q"; FAKE_VERDICT=pass git push -q origin feat/x 2>/dev/null
check "new branch: reviewed once over its own commits" "0:1" "$?:$(calls)"

# --- 8. claude reviewer path with a fake claude
cat > "$W/bin/claude" <<'SH'
#!/bin/sh
echo "$*" >> "$FAKE_LOG.claude"; cat > /dev/null
printf '{"type":"result","structured_output":{"verdict":"fail","summary":"s","findings":[{"item":"claude finds","status":"FAIL","evidence":"e","source":"s"}]}}'
SH
chmod +x "$W/bin/claude"; git config --local toolkit.theoryReviewer claude; echo "r <- 1" >> R/a.R; git commit -qam "feat: r"
git push -q origin feat/x 2>"$W/err"; check "claude reviewer FAIL blocks" 1 $?
grep -q "claude finds" "$W/err" && ok "claude finding parsed" || bad "claude finding missing"
grep -q -- "--permission-mode plan" "$FAKE_LOG.claude" && ok "claude runs in plan mode, no edit tools" || bad "claude flags"

# --- 9. force push / delete still blocked; AI trailer still blocked in same environment
git config --local toolkit.theoryReview false; git reset -q --hard HEAD~2; git commit -q --allow-empty -m "feat: diverge"
git push -q -f origin feat/x 2>/dev/null; check "force push still blocked" 1 $?
git commit -q --allow-empty -m "x

Co-Authored-By: Claude <noreply@anthropic.com>" 2>/dev/null; check "AI trailer still blocked" 1 $?

# --- 10. cost estimate, the review-cost decision channel, usage calibration
. "$HOOKS/_estimate.sh"
newrepo cost; echo "# rubric" > docs/THEORY_REVIEW.md; git add -A; git commit -qm "feat: init"; git push -q origin main 2>/dev/null
check "estimate for an empty diff matches the mod's formula" "9300 15850 22400 1.00 0" "$(estimate_review 0)"
check "green at the default thresholds" green "$(est_level 15850)"
git config --local toolkit.theoryGreenMax 100; git config --local toolkit.theoryRedMin 200; check "red when the thresholds are low" red "$(est_level 15850)"
git config --local toolkit.theoryRedMin 100000; check "amber between the thresholds" amber "$(est_level 15850)"
git config --local --unset toolkit.theoryGreenMax; git config --local --unset toolkit.theoryRedMin
: > "$FAKE_LOG"; echo "a <- 1" >> R/a.R; git commit -qam "feat: a"; FAKE_VERDICT=pass git push -q origin main 2>"$W/err"
grep -q "Codex review cost: GREEN" "$W/err" && ok "cost line shown before the review runs" || bad "no cost line: $(cat "$W/err")"
echo "b <- 1" >> R/a.R; git commit -qam "feat: b"; git config --local toolkit.theoryDecision "skip:$(date +%s)"; n=$(calls)
FAKE_VERDICT=fail git push -q origin main 2>"$W/err"; check "decision=skip: pushed, reviewer not called" "0:$n" "$?:$(calls)"
grep -q "SKIPPED" "$W/err" && ok "skip says UNREVIEWED" || bad "skip not announced"
[ -z "$(git config --local --get toolkit.theoryDecision)" ] && ok "decision cleared after use" || bad "decision left behind"
echo "c <- 1" >> R/a.R; git commit -qam "feat: c"; git config --local toolkit.theoryDecision "review:$(date +%s)"; n=$(calls)
FAKE_VERDICT=pass git push -q origin main 2>/dev/null; check "decision=review: reviewer called once" "$((n+1))" "$(calls)"
echo "d <- 1" >> R/a.R; git commit -qam "feat: d"; git config --local toolkit.theoryDecision "skip:$(( $(date +%s) - 5000 ))"; n=$(calls)
FAKE_VERDICT=pass git push -q origin main 2>/dev/null; check "stale decision (older than 10 min) is ignored" "$((n+1))" "$(calls)"
echo "e <- 1" >> R/a.R; git commit -qam "feat: e"; FAKE_TOKENS=24,500 FAKE_VERDICT=pass git push -q origin main 2>/dev/null
git config --local --get-all toolkit.theoryUsage | grep -Eq '^[0-9]+:24500$' && ok "actual tokens recorded for calibration" || bad "usage not recorded: $(git config --local --get-all toolkit.theoryUsage)"
git config --local --unset-all toolkit.theoryUsage; for i in 1 2 3; do git config --local --add toolkit.theoryUsage "1000:300000"; done
set -- $(estimate_review 1000); [ "$4" != "1.00" ] && [ "$5" = 3 ] && ok "estimate calibrates after 3 reviews (factor $4)" || bad "no calibration: $*"
git config --local --unset-all toolkit.theoryUsage

# --- 11. profiles: neutral = no AI-attribution rule, secrets still guarded; lab = full rules
newrepo prof; git add -A; git commit -qm "feat: init"
git config --global toolkit.profile neutral
git commit -q --allow-empty -m "x

Co-Authored-By: Someone <a@b.c>
Generated with a robot" 2>/dev/null; check "neutral profile: attribution text is not policed" 0 $?
echo "KEY=1" > .env; git add -f .env; git commit -qm "chore: env" 2>/dev/null; check "neutral profile: staged .env is refused" 1 $?
git restore --staged .env; rm -f .env
echo "claude" > CLAUDE.md; git add -f CLAUDE.md; git commit -qm "docs: c" 2>/dev/null; check "neutral profile: CLAUDE.md allowed" 0 $?
git config --global toolkit.profile lab; git reset -q --hard HEAD~1
echo "claude" > CLAUDE.md; git add -f CLAUDE.md; git commit -qm "docs: c" 2>/dev/null; check "lab profile: CLAUDE.md refused" 1 $?
git config --global --unset toolkit.profile; git config --local --unset toolkit.profile 2>/dev/null; git commit -q --allow-empty -m "y

Co-Authored-By: Claude <noreply@anthropic.com>" 2>/dev/null; check "no profile set behaves as neutral" 0 $?
git config --global toolkit.profile neutral; git config --local toolkit.profile lab
git commit -q --allow-empty -m "z

Co-Authored-By: Claude <noreply@anthropic.com>" 2>/dev/null; check "repo-local profile (lab) wins over global (neutral)" 1 $?
git config --local --unset toolkit.profile

rm -rf "$W"; [ "$fails" = 0 ] && { echo "ALL PASSED"; exit 0; } || { echo "$fails FAILED"; exit 1; }
