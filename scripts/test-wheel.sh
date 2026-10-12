#!/usr/bin/env bash
# Builds the wheel, installs it in a fresh virtual environment and runs the installer against a throwaway HOME:
# plan, project-scope install, verify, uninstall, and checks the project folder is back exactly as it was.
# Uses the real `claude` CLI when present (no network needed: everything installed is a local folder); otherwise stops after the plan.
set -eu
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
"$PY" -m venv "$T/venv"; "$T/venv/bin/pip" install -q build
"$T/venv/bin/python" -m build --outdir "$T/dist" . >/dev/null
"$T/venv/bin/pip" install -q "$T"/dist/*.whl
CLI=$("$T/venv/bin/python" -c "import json,pathlib,cctk;print(json.loads((pathlib.Path(cctk.__file__).parent/'data'/'identity.json').read_text())['cli'])")
export HOME="$T/home" GIT_CONFIG_GLOBAL="$T/home/.gitconfig"; mkdir -p "$HOME/proj"; git init -q "$HOME/proj"
before=$(cd "$HOME/proj" && find . -path ./.git -prune -o -type f -print | sort | xargs -r shasum 2>/dev/null; cat .git/info/exclude)
"$T/venv/bin/$CLI" install --plan --scope project --project "$HOME/proj" | tail -4
if ! command -v claude >/dev/null 2>&1; then echo "claude not installed: stopping after the plan"; exit 0; fi
"$T/venv/bin/$CLI" install --yes --scope project --project "$HOME/proj" --without plugin:rust-analyzer-lsp,plugin:pyright-lsp | tail -6
"$T/venv/bin/$CLI" verify
"$T/venv/bin/$CLI" uninstall --yes --scope project --project "$HOME/proj" | tail -2
after=$(cd "$HOME/proj" && find . -path ./.git -prune -o -type f -print | sort | xargs -r shasum 2>/dev/null; cat .git/info/exclude)
[ "$before" = "$after" ] && echo "WHEEL TEST OK: project folder identical after uninstall" || { echo "WHEEL TEST FAILED: project changed"; exit 1; }
