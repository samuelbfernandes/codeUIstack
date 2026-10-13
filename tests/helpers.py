"""A throwaway home folder, a fake `claude` on PATH and a private git config, so tests never touch the real machine."""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import stat
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from cctk import payload as _payload  # noqa: E402

NAME = _payload.identity()["name"]
MP = _payload.identity()["marketplace"]

FAKE_CLAUDE = r'''#!/usr/bin/env python3
# Minimal stand-in for the `claude plugin` commands the installer uses. State lives in $HOME/.fake-claude.json.
import json, os, sys
db_path = os.path.join(os.environ["HOME"], ".fake-claude.json")
db = json.load(open(db_path)) if os.path.exists(db_path) else {"markets": {}, "plugins": [], "log": []}
a = sys.argv[1:]
db["log"].append(a)
def save(): json.dump(db, open(db_path, "w"))
def opt(flag, default=None):
    for f in flag:
        if f in a: return a[a.index(f) + 1]
    return default
out, rc = "", 0
if a[:1] == ["--version"]:
    out = os.environ.get("FAKE_CLAUDE_VERSION", "2.1.296") + " (Claude Code)"
elif a[:3] == ["plugin", "marketplace", "list"]:
    out = json.dumps([{"name": k, "source": "directory", "path": v} for k, v in db["markets"].items()])
elif a[:3] == ["plugin", "marketplace", "add"]:
    if os.path.isdir(a[3]):
        name = json.load(open(os.path.join(a[3], ".claude-plugin", "marketplace.json")))["name"]
    else:
        name = a[3].replace("/", "-")      # owner/repo: the fake names it like posit-dev/skills -> posit-dev-skills
    db["markets"][name] = a[3]; out = "added"
elif a[:2] == ["mcp", "add"]:
    scope, rest = opt(["-s", "--scope"], "local"), [x for i, x in enumerate(a[2:]) if x not in ("-s", "--scope") and (i == 0 or a[2:][i - 1] not in ("-s", "--scope"))]
    mcp = db.setdefault("mcp", {})
    if rest[0] in mcp: out, rc = f"MCP server {rest[0]} already exists in {scope} config", 1
    else:
        mcp[rest[0]] = {"scope": scope, "args": rest[1:]}; out = "added"
elif a[:2] == ["mcp", "remove"]:
    db.setdefault("mcp", {}).pop(a[2], None); out = "removed"
elif a[:3] == ["plugin", "marketplace", "remove"]:
    db["markets"].pop(a[3], None); out = "removed"
elif a[:3] == ["plugin", "list", "--available"] or (a[:2] == ["plugin", "list"] and "--available" in a):
    out = json.dumps({"available": [{"pluginId": i} for i in os.environ.get("FAKE_OFFERED", "").split(",") if i]})
elif a[:2] == ["plugin", "list"]:
    out = json.dumps(db["plugins"])
elif a[:2] == ["plugin", "install"]:
    pid, scope = a[2], opt(["-s", "--scope"], "user")
    if os.environ.get("FAKE_FAIL") == pid: out, rc = "boom", 1
    else:
        db["plugins"].append({"id": pid, "scope": scope}); out = "installed"
elif a[:2] == ["plugin", "uninstall"]:
    pid, scope = a[2], opt(["-s", "--scope"], "user")
    db["plugins"] = [p for p in db["plugins"] if not (p["id"] == pid and p["scope"] == scope)]; out = "removed"
elif a[:2] == ["plugin", "update"]:
    out = "updated"
save(); print(out); sys.exit(rc)
'''


class Sandbox:
    def __init__(self, with_codex: bool = False, claude: bool = True):
        self.root = Path(tempfile.mkdtemp(prefix="cctk-test-"))
        self.home, self.bin, self.proj = self.root / "home", self.root / "bin", self.root / "proj"
        for d in (self.home, self.bin, self.proj):
            d.mkdir()
        git = shutil.which("git")
        os.symlink(git, self.bin / "git")
        if claude:
            f = self.bin / "claude"
            f.write_text(FAKE_CLAUDE.replace("#!/usr/bin/env python3", "#!" + sys.executable, 1))
            f.chmod(f.stat().st_mode | stat.S_IXUSR)
        if with_codex:
            c = self.bin / "codex"
            c.write_text("#!/bin/sh\necho codex 0\n")
            c.chmod(c.stat().st_mode | stat.S_IXUSR)
        self._saved = dict(os.environ)
        os.environ.update(HOME=str(self.home), USERPROFILE=str(self.home), PATH=str(self.bin),
                          GIT_CONFIG_GLOBAL=str(self.home / ".gitconfig"), GIT_CONFIG_SYSTEM=os.devnull)
        os.environ.pop("FAKE_OFFERED", None)
        os.environ.pop("FAKE_FAIL", None)
        self.git("init", "-q", str(self.proj))

    def git(self, *args: str, cwd: Path | None = None) -> str:
        import subprocess
        return subprocess.run(["git", *args], cwd=cwd or self.root, capture_output=True, text=True).stdout.strip()

    def cleanup(self) -> None:
        os.environ.clear()
        os.environ.update(self._saved)
        shutil.rmtree(self.root, ignore_errors=True)

    def fake_db(self) -> dict:
        p = self.home / ".fake-claude.json"
        return json.loads(p.read_text()) if p.exists() else {"markets": {}, "plugins": [], "log": []}

    def tree(self) -> dict[str, str]:
        out = {}
        for p in sorted(self.root.rglob("*")):
            if p.is_file() and ".git/" not in p.as_posix() and p.name != ".fake-claude.json":
                out[p.relative_to(self.root).as_posix()] = p.read_text(errors="replace")
        return out


def run_cli(argv: list[str]) -> tuple[int, str, str]:
    from cctk import cli
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = cli.main(argv)
    return rc, out.getvalue(), err.getvalue()
