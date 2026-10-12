"""Where the toolkit's files live (installed wheel or a git checkout) and how they are staged and fingerprinted."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path

from .errors import InstallError

# What gets copied into the stable home folder (~/.claude/<name>/). Nothing else is read from the package.
PAYLOAD = [".claude-plugin", "mods", "global", "skills", "docs", "identity.json", "LICENSE"]
IGNORED = {"__pycache__", ".DS_Store", "node_modules", ".git"}


def data_root() -> Path:
    """The folder holding mods/, global/, skills/ ... : bundled inside the wheel, else the repository root."""
    bundled = Path(__file__).resolve().parent / "data"
    if (bundled / "identity.json").is_file():
        return bundled
    repo = Path(__file__).resolve().parents[2]
    if (repo / "identity.json").is_file():
        return repo
    raise InstallError("toolkit files not found next to the installer (broken install?)")


def identity(root: Path | None = None) -> dict:
    return json.loads(((root or data_root()) / "identity.json").read_text(encoding="utf-8"))


def mods(root: Path | None = None) -> list[dict]:
    """[{name, description}] from the shipped marketplace.json (the single list of installable mods)."""
    p = (root or data_root()) / ".claude-plugin" / "marketplace.json"
    return [{"name": x["name"], "description": x.get("description", "")} for x in json.loads(p.read_text(encoding="utf-8"))["plugins"]]


def _walk(base: Path):
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in IGNORED)
        for f in sorted(filenames):
            if f not in IGNORED:
                yield Path(dirpath) / f


def fingerprint(base: Path, names: list[str] | None = None) -> dict[str, str]:
    """{posix relative path: sha256} of every payload file under base."""
    out: dict[str, str] = {}
    for name in names or PAYLOAD:
        p = base / name
        files = [p] if p.is_file() else list(_walk(p)) if p.is_dir() else []
        for f in files:
            out[f.relative_to(base).as_posix()] = hashlib.sha256(f.read_bytes()).hexdigest()
    return out


def stage(src_root: Path, dest: Path) -> dict[str, str]:
    """Copy the payload to dest (replacing an older copy) and return its fingerprint."""
    tmp = dest.with_name(dest.name + ".new")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    for name in PAYLOAD:
        s = src_root / name
        if s.is_file():
            shutil.copy2(s, tmp / name)
        elif s.is_dir():
            shutil.copytree(s, tmp / name, ignore=shutil.ignore_patterns(*IGNORED))
    for hook in (tmp / "global" / "githooks").glob("*"):
        if hook.is_file() and not hook.name.startswith("ignore"):
            hook.chmod(hook.stat().st_mode | 0o111)  # git ignores hooks without the executable bit (zip/pip can drop it)
    if dest.exists():
        if (dest / "state").is_dir():
            shutil.move(str(dest / "state"), str(tmp / "state"))  # install records live beside the files
        shutil.rmtree(dest)
    tmp.rename(dest)
    return fingerprint(dest)


def diff(expected: dict[str, str], actual: dict[str, str]) -> dict[str, list[str]]:
    return {
        "changed": sorted(k for k in expected if k in actual and expected[k] != actual[k]),
        "missing": sorted(k for k in expected if k not in actual),
        "extra": sorted(k for k in actual if k not in expected),
    }
