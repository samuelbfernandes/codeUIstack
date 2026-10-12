# Shared by the toolkit's global git hooks. POSIX sh, runs on macOS bash 3.2 / dash.
# Chain to the repo's own .git/hooks/<name> (a global core.hooksPath would otherwise silence it).
chain_repo_hook() {
  name="$1"; shift
  gitdir=$(git rev-parse --git-dir 2>/dev/null) || return 0
  repo_hook="$gitdir/hooks/$name"
  if [ -x "$repo_hook" ]; then "$repo_hook" "$@" || exit $?; fi
}
fail() { printf '\n[toolkit] %s\n' "$*" >&2; }
# Profile (git config toolkit.profile; a repo-local value wins over the global one): "lab" = the full rule set (no AI attribution, never commit agent files, theory review);
# "neutral" = generic safe defaults for students. Unset behaves as neutral.
toolkit_profile() { p=$(git config --get toolkit.profile 2>/dev/null); [ -z "$p" ] && p=neutral; echo "$p"; }
is_lab() { [ "$(toolkit_profile)" = lab ]; }
