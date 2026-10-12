"""Reversible edits of Claude Code's settings.json, the managed CLAUDE.md block and git config.

Every edit returns a *record* of exactly what was added. Uninstall removes only that, so anything the user already
had (or added later) is never touched. All functions are pure or take explicit paths so they can be tested in a temp dir.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

from .errors import InstallError

_MISSING = {"__missing__": True}


# ---------------------------------------------------------------- JSON file i/o
def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return {}
    try:
        data = json.loads(text)
    except ValueError as e:
        raise InstallError(f"{path} is not valid JSON ({e}). Fix or move it; nothing was changed.") from e
    if not isinstance(data, dict):
        raise InstallError(f"{path} does not hold a JSON object. Nothing was changed.")
    return data


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def write_json(path: Path, data: dict) -> None:
    write_atomic(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def backup_once(path: Path, tag: str) -> Path | None:
    """Keep the user's original next to it the first time we change it: <file>.pre-<tag>."""
    if path.exists():
        b = path.with_name(f"{path.name}.pre-{tag}")
        if not b.exists():
            shutil.copy2(path, b)
            return b
    return None


# ---------------------------------------------------------------- dotted-path helpers
def _get(d: dict, dotted: str) -> Any:
    cur: Any = d
    for k in dotted.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return _MISSING
        cur = cur[k]
    return cur


def _set(d: dict, dotted: str, value: Any) -> None:
    *parents, last = dotted.split(".")
    cur = d
    for k in parents:
        nxt = cur.get(k)
        if not isinstance(nxt, dict):
            nxt = cur[k] = {}
        cur = nxt
    cur[last] = value


def _prune(d: dict, dotted: str) -> None:
    """Delete the key and any parent object that became empty."""
    keys = dotted.split(".")
    chain = [d]
    for k in keys[:-1]:
        nxt = chain[-1].get(k)
        if not isinstance(nxt, dict):
            return
        chain.append(nxt)
    chain[-1].pop(keys[-1], None)
    for i in range(len(keys) - 1, 0, -1):
        if not chain[i]:
            chain[i - 1].pop(keys[i - 1], None)


# ---------------------------------------------------------------- settings plan: apply / revert
def apply_plan(settings: dict, plan: dict) -> tuple[dict, list[str]]:
    """Merge plan into settings (in place). plan = {"lists": {path: [items]}, "keys": {path: {k: v}}, "scalars": {path: v}}.

    Returns (record, notes). Lists get missing items appended. Keys are added only when absent (an existing value,
    even a different one, is the user's and is left alone). Scalars are set, remembering the previous value.
    """
    rec: dict = {"lists": {}, "keys": {}, "scalars": {}}
    notes: list[str] = []
    for path, items in plan.get("lists", {}).items():
        cur = _get(settings, path)
        if cur is _MISSING:
            cur = []
            _set(settings, path, cur)
        if not isinstance(cur, list):
            raise InstallError(f"settings: '{path}' is not a list; nothing was changed.")
        added = [i for i in items if i not in cur]
        cur.extend(added)
        if added:
            rec["lists"][path] = added
    for path, kv in plan.get("keys", {}).items():
        cur = _get(settings, path)
        if cur is _MISSING:
            cur = {}
            _set(settings, path, cur)
        if not isinstance(cur, dict):
            raise InstallError(f"settings: '{path}' is not an object; nothing was changed.")
        for k, v in kv.items():
            if k not in cur:
                cur[k] = v
                rec["keys"].setdefault(path, {})[k] = v
            elif cur[k] != v:
                notes.append(f"kept your existing {path}.{k} = {json.dumps(cur[k])}")
    for path, v in plan.get("scalars", {}).items():
        cur = _get(settings, path)
        if cur == v:
            continue
        rec["scalars"][path] = {"set": v, "prev": _MISSING if cur is _MISSING else cur}
        _set(settings, path, v)
    return rec, notes


def revert_plan(settings: dict, rec: dict) -> None:
    for path, items in rec.get("lists", {}).items():
        cur = _get(settings, path)
        if isinstance(cur, list):
            cur[:] = [i for i in cur if i not in items]
            if not cur:
                _prune(settings, path)
    for path, kv in rec.get("keys", {}).items():
        cur = _get(settings, path)
        if isinstance(cur, dict):
            for k, v in kv.items():
                if cur.get(k) == v:
                    del cur[k]
            if not cur:
                _prune(settings, path)
    for path, change in rec.get("scalars", {}).items():
        if _get(settings, path) == change["set"]:
            if change["prev"] == _MISSING:
                _prune(settings, path)
            else:
                _set(settings, path, change["prev"])


def record_is_empty(rec: dict) -> bool:
    return not any(rec.get(k) for k in ("lists", "keys", "scalars"))


# ---------------------------------------------------------------- managed block in a markdown file
def _block_re(begin: str, end: str) -> "re.Pattern[str]":
    return re.compile(re.escape(begin) + r".*?" + re.escape(end) + r"\n?", re.S)


def upsert_block(text: str, body: str, begin: str, end: str) -> str:
    block = f"{begin}\n{body.rstrip()}\n{end}\n"
    if begin in text:
        return _block_re(begin, end).sub(lambda m: block, text)
    return (text.rstrip() + "\n\n" if text.strip() else "") + block


def remove_block(text: str, begin: str, end: str) -> str:
    new = _block_re(begin, end).sub("", text)
    return new.rstrip() + "\n" if new.strip() else ""


# ---------------------------------------------------------------- plain lines (e.g. .git/info/exclude)
def add_lines(path: Path, lines: list[str]) -> list[str]:
    cur = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    new = [ln for ln in lines if ln not in cur]
    if new:
        write_atomic(path, "\n".join(cur + new) + "\n")
    return new


def remove_lines(path: Path, lines: list[str]) -> None:
    if path.exists() and lines:
        cur = path.read_text(encoding="utf-8").splitlines()
        write_atomic(path, "\n".join(ln for ln in cur if ln not in lines) + "\n")
