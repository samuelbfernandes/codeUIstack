#!/usr/bin/env python3
"""Capability audit: what can each part of this repository do, and did anything new appear?

  python scripts/audit.py            print the table and fail (exit 1) on a violation
  python scripts/audit.py --write    also (re)write docs/AUDIT.md
  python scripts/audit.py --check    fail on a violation or when docs/AUDIT.md is stale (CI)

It is a tripwire plus a readable summary, NOT a proof: it greps source text. Read the code too.
A mod that starts a new program, uses the network, or a script that fetches anything must be added to the allowlist below
in the same pull request, so a reviewer sees it.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Programs a mod may start (via $.process.run argv arrays). Anything else fails the audit.
ALLOW_PROGRAMS: dict[str, set[str]] = {
    "command-guard": {"git", "find", "du"},
    "branch-janitor": {"git", "gh"},       # gh = a read-only `gh pr list`, only if the user has gh
    "cache-guard": set(),
    "filetree": {"git"},
    "model-picker": {"codex"},                # offered as an option for review tasks, only if Codex is installed
    "reflect": set(),
    "edit-replay": set(),
    "review-cost": {"git"},
    "progress": set(),
    "secret-guard": set(),
    "usage-meter": set(),
    "diagram": set(),
    "moddeck": {"git", "pipx", "uvx"},         # git: read-only for the Session box, and `git ls-remote --tags` for the update check; pipx/uvx: the installer's own one-liner, only after you answer "Update now"
    "data-guard": {"git"},
    "big-file-guard": set(),
    "repro-log": {"git", "python3", "node", "R"},          # only `--version` probes, for runtimes that appeared in the session
    "auto-test": {"npm", "python3", "sh", "Rscript"},           # runs the project's own tests (pytest, npm test); `sh -c` only for a command the person set; off until switched on
    "prompt-library": set(),
    "checkpoint": {"git", "rm", "cmd"},          # rm / del only on a confirmed restore, only paths the dialog listed
    "long-run-ping": set(),
    # Adapted from whyashthakker/awesome-claude-code-mods (MIT): read-only git for staged-diff, nothing else.
    "staged-diff": {"git"},
    "contrast-check": set(),
    "table-preview": set(),
    "test-ledger": set(),
    "scope-watch": set(),
    "error-inbox": set(),
    "concise": set(),
    "tldr": set(),
    "decision-log": set(),
    "format-on-edit": {"air", "ruff", "jarl", "prettier", "biome"},   # only when switched on, on the one file Claude just edited, if the tool is installed
    "ui-preview": {"Rscript", "npm", "shiny", "streamlit", "google-chrome", "chromium", "chromium-browser"},   # your app's own server, and a headless browser for a screenshot; only on /ui-preview start|shot
}
ALLOW_NETWORK: set[str] = {"moddeck", "ui-preview"}      # moddeck names the GitHub repo for `git ls-remote --tags` (the update check), it never calls $.http; ui-preview fetches only http://127.0.0.1 / localhost (refused in code otherwise)
NEVER_PROGRAMS = {"curl", "wget", "ssh", "scp", "nc", "ncat", "telnet", "sudo", "powershell", "pwsh", "bash", "sh", "zsh", "cmd", "python", "python3", "node", "npm", "npx", "pip", "rm", "mv", "chmod"}
KNOWN_PROGRAMS = {"git", "gh", "codex", "claude", "du", "find", "pipx", "uvx", "air", "ruff", "jarl", "prettier", "biome", "Rscript", "R", "shiny", "streamlit", "google-chrome", "chromium", "chromium-browser"} | NEVER_PROGRAMS

NETWORK_RE = re.compile(r"\$\.http\b|\.http\.fetch|\bfetch\s*\(|XMLHttpRequest|WebSocket|https?://")
DYNAMIC_RE = re.compile(r"\beval\s*\(|new\s+Function\s*\(|\bimport\s*\(|\brequire\s*\(|child_process")
ARGV_HEAD_RE = re.compile(r"""\[\s*(['"])([\w.+-]+)\1\s*[,\]]""")
EVENT_RE = re.compile(r"""\bon\(\s*['"]([\w.:-]+)['"]""")

# Shell hooks and the installer
SHELL_FORBIDDEN = re.compile(r"\b(curl|wget|nc|ncat|ssh|scp|telnet)\b|\beval\b|base64\s+-d|\|\s*(sh|bash)\b|\bsudo\b")
PY_FORBIDDEN = re.compile(r"\b(urllib|http\.client|httplib|socket|requests|ftplib|smtplib|telnetlib|xmlrpc|ctypes)\b|shell\s*=\s*True|os\.system|os\.popen|\beval\s*\(|\bexec\s*\(|__import__|importlib")


def code_lines(path: Path, comment_prefixes: tuple[str, ...]):
    for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        s = line.strip()
        if s and not s.startswith(comment_prefixes):
            yield n, line


def mod_sources(mod: Path):
    for ext in ("*.ts", "*.tsx", "*.js", "*.mjs"):
        for f in sorted((mod / "hooks").rglob(ext)):
            yield f


def audit_mod(mod: Path) -> tuple[dict, list[str]]:
    name = mod.name
    info = {"events": set(), "programs": set(), "network": False, "writes": False, "model": False, "files": 0}
    problems: list[str] = []
    for f in mod_sources(mod):
        info["files"] += 1
        text = "\n".join(l for _, l in code_lines(f, ("//", "*", "/*")))
        info["events"] |= set(EVENT_RE.findall(text))
        info["writes"] |= "$.fs.write" in text
        info["model"] |= bool(re.search(r"\$\.(model|agent)\.(complete|classify|fork|spawn)", text))
        rel = f.relative_to(ROOT)
        for n, line in code_lines(f, ("//", "*", "/*")):
            if NETWORK_RE.search(line):
                info["network"] = True
                if name not in ALLOW_NETWORK:
                    problems.append(f"{rel}:{n}: network use is not allowed for {name}: {line.strip()[:100]}")
            if DYNAMIC_RE.search(line):
                problems.append(f"{rel}:{n}: dynamic code loading or child_process: {line.strip()[:100]}")
            if "new Set(" in line:
                continue  # word lists such as the wrappers `sudo`, `env` a classifier recognises, not programs it starts
            for _, prog in ARGV_HEAD_RE.findall(line):
                if prog in KNOWN_PROGRAMS:
                    info["programs"].add(prog)
    allowed = ALLOW_PROGRAMS.get(name)
    if allowed is None:
        problems.append(f"mods/{name}: not in ALLOW_PROGRAMS in scripts/audit.py (add it, even with an empty set)")
        allowed = set()
    for prog in sorted(info["programs"] - allowed):
        problems.append(f"mods/{name}: starts '{prog}', which is not in its allowlist")
    return info, problems


def audit_shell() -> tuple[list[str], list[str]]:
    seen, problems = [], []
    for f in sorted((ROOT / "global" / "githooks").glob("*")) + sorted((ROOT / "skills").rglob("*.sh")):
        if f.name.startswith("ignore") or not f.is_file():
            continue
        seen.append(f.relative_to(ROOT).as_posix())
        for n, line in code_lines(f, ("#",)):
            if SHELL_FORBIDDEN.search(line):
                problems.append(f"{f.relative_to(ROOT)}:{n}: {line.strip()[:100]}")
    return seen, problems


def audit_installer() -> tuple[list[str], list[str]]:
    seen, problems = [], []
    for f in sorted((ROOT / "src" / "cctk").glob("*.py")):
        seen.append(f.name)
        for n, line in code_lines(f, ("#",)):
            if f.name == "proc.py" and "subprocess" in line:
                continue  # the one place programs are started
            if PY_FORBIDDEN.search(line):
                problems.append(f"{f.relative_to(ROOT)}:{n}: {line.strip()[:100]}")
            if "subprocess" in line and f.name != "proc.py":
                problems.append(f"{f.relative_to(ROOT)}:{n}: subprocess is only allowed in proc.py")
    return seen, problems


def render(rows: list[tuple[str, dict]], shell_files: list[str], installer_files: list[str]) -> str:
    yn = lambda b: "yes" if b else "no"  # noqa: E731
    out = ["# What each part can do (generated)", "",
           "Produced by `python scripts/audit.py --write` and checked by CI. It greps source text for network use, programs started,",
           "file writes and model use. It is a tripwire and a summary, not a proof: read the code too.", "",
           "## Mods", "",
           "| Mod | Network | Starts these programs | Writes files | Spends model tokens | Hooks into |", "|---|---|---|---|---|---|"]
    for name, i in rows:
        progs = ", ".join(sorted(i["programs"])) or "none"
        out.append(f"| {name} | {yn(i['network'])} | {progs} | {yn(i['writes'])} | {yn(i['model'])} | {', '.join(sorted(i['events'])) or 'commands only'} |")
    out += ["", "\"Writes files\" means the mod can write through Claude Code's file API (reflect does, only when you press Save).",
            "\"Spends model tokens\" means the mod can ask a model something itself (reflect: a small model once per correction; cache-guard: optional keep-warm pings; model-picker: only if you pick the subagent option).",
            "", "## Shell scripts (git guards)", "", "Checked for: curl, wget, nc, ssh, scp, telnet, eval, base64 -d, piping into a shell, sudo. None present.", ""]
    out += [f"- `{f}`" for f in shell_files]
    out += ["", "## Installer (Python, standard library only)", "",
            "Checked for: network modules (urllib, http.client, socket, requests ...), shell=True, os.system, eval/exec, dynamic imports.",
            "Programs are started only in `src/cctk/proc.py`, always as an argument list and with a timeout.", ""]
    out += [f"- `src/cctk/{f}`" for f in installer_files]
    return "\n".join(out) + "\n"


def main() -> int:
    rows, problems = [], []
    for mod in sorted((ROOT / "mods").iterdir()):
        if (mod / ".claude-plugin" / "plugin.json").is_file():
            info, p = audit_mod(mod)
            rows.append((mod.name, info))
            problems += p
    shell_files, p = audit_shell()
    problems += p
    installer_files, p = audit_installer()
    problems += p
    text = render(rows, shell_files, installer_files)
    target = ROOT / "docs" / "AUDIT.md"
    if "--write" in sys.argv:
        target.write_text(text, encoding="utf-8")
        print(f"wrote {target.relative_to(ROOT)}")
    if "--check" in sys.argv and (not target.is_file() or target.read_text(encoding="utf-8") != text):
        problems.append("docs/AUDIT.md is stale: run python scripts/audit.py --write")
    if problems:
        print("AUDIT FAILED:", *problems, sep="\n  ", file=sys.stderr)
        return 1
    if "--write" not in sys.argv:
        print(text)
    print(f"audit ok: {len(rows)} mods, {len(shell_files)} shell scripts, {len(installer_files)} installer modules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
