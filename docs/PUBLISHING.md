# Publishing checklist (for the maintainer)

1. **Pick the name**, then run once: `python scripts/rename.py --name NAME --github OWNER/REPO`. It changes the project name, command,
   marketplace, URLs and every mention. The name must not contain "claude" or "anthropic".
2. `bash scripts/check-all.sh` (needs the `claude` CLI for the plugin checks) and `bash scripts/test-wheel.sh`.
3. Create the empty GitHub repository, then `git init`, review `git status` (no `node_modules`, no `claude-code.d.ts`), commit and push.
4. On GitHub: enable **private vulnerability reporting** (Settings > Code security), protect `main`, add topics such as `claude-code`,
   `claude-code-plugins`, `research`, `git-hooks`, `productivity`.
5. Wait for CI to go green. The `mods` job is marked `continue-on-error` until it has been seen passing on a hosted runner: fix, then remove that line.
6. Release: bump the version in `pyproject.toml` and `src/cctk/__init__.py`, add a `## [x.y.z]` entry to `CHANGELOG.md`,
   run `bash scripts/release.sh`, tag (`git tag -s vX.Y.Z`), push the tag, attach `dist/*` including `SHA256SUMS` to a GitHub release.
7. Optional: publish to PyPI (`python -m twine upload dist/*`) so `pipx install NAME` works without a git URL.
8. Replace the "Status" note in the README once someone other than you has used it on a live session.

Before you announce it, install it on a clean computer (macOS and Windows) and use each start-here tool once in a real session: that
is the part nothing here could test.
