# Cost estimate for one automatic review. POSIX sh + awk only (no python), so it runs in Git Bash on Windows too.
# MUST stay in step with mods/review-cost/hooks/estimate.ts (same constants, same formula). All numbers are HEURISTICS,
# not measured against a live reviewer; after 3+ real reviews they are calibrated from your own past runs.
#
#   estimate_review <diffBytes>   prints:  low expected high factor n      (tokens; factor 1 and n 0 = uncalibrated)
estimate_review() {
  git config --get-all toolkit.theoryUsage 2>/dev/null | tail -n 10 | awk -v b="$1" '
    function ceil(v) { return (v == int(v)) ? v : int(v) + 1 }
    function expect(x,   i, lo, hi) { i = 1800 + ceil(x / 3.5); lo = i + 6000 + 1500; hi = 3 * i + 12000 + 5000; return (lo + hi) / 2 }
    BEGIN { n = 0 }
    /^[0-9]+:[0-9]+$/ { split($0, p, ":"); if (p[2] > 0) { r[++n] = p[2] / expect(p[1]) } }
    END {
      f = 1; used = 0
      if (n >= 3) {
        for (i = 2; i <= n; i++) { v = r[i]; j = i - 1; while (j >= 1 && r[j] > v) { r[j + 1] = r[j]; j-- } r[j + 1] = v }
        f = (n % 2) ? r[(n + 1) / 2] : (r[n / 2] + r[n / 2 + 1]) / 2
        if (f < 0.3) f = 0.3; if (f > 4) f = 4; used = n
      }
      i = 1800 + ceil(b / 3.5)
      lo = i + 6000 + 1500; hi = 3 * i + 12000 + 5000
      printf "%d %d %d %.2f %d\n", lo * f + 0.5, (lo + hi) / 2 * f + 0.5, hi * f + 0.5, f, used
    }'
}

# est_level <expected> -> green|amber|red   (toolkit.theoryGreenMax default 25000, toolkit.theoryRedMin default 60000)
est_level() {
  g=$(git config --get toolkit.theoryGreenMax 2>/dev/null); [ -z "$g" ] && g=25000
  r=$(git config --get toolkit.theoryRedMin 2>/dev/null); [ -z "$r" ] && r=60000
  if [ "$1" -le "$g" ]; then echo green; elif [ "$1" -ge "$r" ]; then echo red; else echo amber; fi
}

# est_k <tokens> -> "42k" / "950"
est_k() { awk -v t="$1" 'BEGIN { if (t >= 1000) printf "%dk", t / 1000 + 0.5; else printf "%d", t }'; }

# est_line <level> <low> <expected> <high> <n> -> one coloured line (the level word is always printed, colour is a bonus)
est_line() {
  case "$1" in green) c='\033[32m';; amber) c='\033[33m';; *) c='\033[31m';; esac
  case "$1" in green) bar='[###-------]';; amber) bar='[#####-----]';; *) bar='[##########]';; esac
  if [ -t 2 ] || { [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; }; then col="$c"; off='\033[0m'; else col=''; off=''; fi
  cal=''; [ "${5:-0}" -gt 0 ] && cal=" calibrated from $5 past reviews"
  printf "${col}%s review cost: %s  ~%s tokens (range %s-%s) %s${off}%s" "$REVIEWER_LABEL" "$(echo "$1" | tr 'a-z' 'A-Z')" \
    "$(est_k "$3")" "$(est_k "$2")" "$(est_k "$4")" "$bar" "$cal"
}

# ask_review <level> -> 0 = review, 1 = skip. Only asks on a real terminal; anything else means "review".
ask_review() {
  ( : < /dev/tty ) 2>/dev/null || return 0
  case "$1" in red) def=n; hint='[y/N]';; *) def=y; hint='[Y/n]';; esac
  printf '\n%s Review this push? %s ' "" "$hint" > /dev/tty
  read -r ans < /dev/tty || ans=''
  [ -z "$ans" ] && ans=$def
  case "$ans" in [Yy]*) return 0;; *) return 1;; esac
}
