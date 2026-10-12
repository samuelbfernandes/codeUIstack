#!/usr/bin/env bash
# Builds the release files and their checksums. It does not commit, tag or upload anything.
#   bash scripts/release.sh            -> dist/<name>-<version>.whl, .tar.gz, SHA256SUMS
# Then, yourself:  git tag -s vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z   (and attach dist/* to the GitHub release)
set -eu
cd "$(dirname "$0")/.."
PY=${PYTHON:-python3}
v_py=$(grep -m1 '^version' pyproject.toml | sed 's/.*"\(.*\)".*/\1/')
v_pkg=$(grep -m1 '__version__' src/cctk/__init__.py | sed 's/.*"\(.*\)".*/\1/')
[ "$v_py" = "$v_pkg" ] || { echo "version mismatch: pyproject $v_py vs src/cctk/__init__.py $v_pkg"; exit 1; }
grep -q "## \[$v_py\]" CHANGELOG.md || { echo "CHANGELOG.md has no '## [$v_py]' entry"; exit 1; }
[ -z "$(git status --porcelain 2>/dev/null)" ] || echo "warning: working tree has uncommitted changes (a release should come from a clean tag)"
bash scripts/check-all.sh
rm -rf dist; "$PY" -m pip install -q build; "$PY" -m build --outdir dist .
( cd dist && { command -v sha256sum >/dev/null && sha256sum * || shasum -a 256 *; } > SHA256SUMS && cat SHA256SUMS )
echo; echo "Built version $v_py. Checksums are in dist/SHA256SUMS: publish them with the release so anyone can compare."
