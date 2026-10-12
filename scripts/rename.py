#!/usr/bin/env python3
"""Rename the project everywhere (name, GitHub slug, command, marketplace) from identity.json's current values.

  python scripts/rename.py --name labcoat --github samuelfernandes/labcoat [--title Labcoat] [--dry-run]

Changes: identity.json, pyproject.toml (name, command, URLs), every text file that mentions the old name or slug,
and regenerates .claude-plugin/marketplace.json. The marketplace name must not contain "claude" or "anthropic"
(Claude Code reserves such names). Run the tests afterwards: python -m unittest discover -s tests
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEXT_SUFFIXES = {".md", ".json", ".toml", ".yml", ".yaml", ".py", ".sh", ".cmd", ".ps1", ".txt", ".ts", ".tsx", ".cfg"}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "__pycache__", ".venv", "venv"}
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,38}[a-z0-9]$")


def text_files():
    for p in sorted(ROOT.rglob("*")):
        if p.is_file() and not (set(p.relative_to(ROOT).parts) & SKIP_DIRS) and (p.suffix in TEXT_SUFFIXES or p.name in {"LICENSE", ".gitignore"}):
            if p.relative_to(ROOT).as_posix() != "scripts/rename.py":
                yield p


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True, help="new project name: lowercase letters, digits, hyphens")
    ap.add_argument("--github", required=True, help="OWNER/REPO on GitHub")
    ap.add_argument("--title", help="display name (default: the name in Title Case)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    if not NAME_RE.match(a.name) or "claude" in a.name or "anthropic" in a.name:
        sys.exit("--name must be lowercase letters, digits and hyphens (3-40 chars) and must not contain 'claude' or 'anthropic'")
    if not re.match(r"^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$", a.github):
        sys.exit("--github must look like OWNER/REPO")
    ident_path = ROOT / "identity.json"
    old = json.loads(ident_path.read_text(encoding="utf-8"))
    title = a.title or " ".join(w.capitalize() for w in a.name.split("-"))
    pairs = [(old["github"], a.github), (old["title"], title), (old["name"], a.name)]
    token = lambda s: re.compile(r"(?<![A-Za-z0-9_])" + re.escape(s) + r"(?![A-Za-z0-9_])")  # noqa: E731
    changed = []
    for f in text_files():
        s = f.read_text(encoding="utf-8")
        new = s
        for o, n in pairs:
            if o != n:
                new = token(o).sub(lambda m, n=n: n, new)
        if new != s:
            changed.append(f.relative_to(ROOT).as_posix())
            if not a.dry_run:
                f.write_text(new, encoding="utf-8")
    print(f"{'would change' if a.dry_run else 'changed'} {len(changed)} file(s):", *changed, sep="\n  ")
    if a.dry_run:
        return 0
    ident = json.loads(ident_path.read_text(encoding="utf-8"))
    legacy = [x for x in [*ident.get("legacy", []), old["name"]] if x != a.name]
    ident.update(name=a.name, title=title, github=a.github, marketplace=a.name, cli=a.name, legacy=sorted(set(legacy)))
    ident_path.write_text(json.dumps(ident, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_marketplace.py")], check=True)
    print("Next: python -m unittest discover -s tests   and   claude plugin validate .")
    return 0


if __name__ == "__main__":
    sys.exit(main())
