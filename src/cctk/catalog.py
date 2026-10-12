"""Everything the user can switch on or off, with plain-language descriptions and token cost.

A new mod dropped into mods/ appears here automatically (name and description come from its plugin.json); add a row to
MOD_META only to give it a cost note or a Codex requirement.
"""
from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass, field

from . import payload

GROUP_MOD, GROUP_RULE, GROUP_ADDON = "mod", "layer", "addon"
GROUP_TITLES = {
    GROUP_MOD: "Mods (screens and behaviour added to Claude Code)",
    GROUP_RULE: "Rules, skills and git guards",
    GROUP_ADDON: "Built-in Claude Code features and official plugins (turned on for you, nothing third-party)",
}
OFFICIAL = "anthropic-plugin-directory"


@dataclass(frozen=True)
class Item:
    id: str
    group: str
    title: str
    desc: str
    tokens: str = "none"
    default: bool = True
    star: bool = False            # editorial "start here" pick
    needs: str = ""               # a program that must be on PATH for the item to be useful
    platforms: tuple[str, ...] = ("darwin", "linux", "windows")
    plugin: str = ""              # for official plugins: plugin@marketplace


@dataclass
class Detected:
    platform: str = field(default_factory=lambda: {"win32": "windows", "darwin": "darwin"}.get(sys.platform, "linux"))
    tools: dict[str, bool] = field(default_factory=dict)

    @classmethod
    def probe(cls) -> "Detected":
        d = cls()
        for t in ("claude", "git", "codex", "rust-analyzer", "pyright-langserver", "cargo", "Rscript"):
            d.tools[t] = shutil.which(t) is not None
        return d

    def has(self, tool: str) -> bool:
        return bool(self.tools.get(tool))


# name -> (token note, needs, start-here)
MOD_META: dict[str, tuple[str, str, bool]] = {
    "blast-radius": ("none", "", True),
    "suggest-model": ("none (local rules)", "", True),
    "branch-janitor": ("none", "", True),
    "cache-tax": ("none (keep-warm pings are optional)", "", True),
    "review-cost": ("none (only estimates)", "codex", True),
    "reflect": ("small: a corrected prompt goes once to a small model", "", False),
    "savvy-progress": ("none", "", False),
    "filetree": ("none", "", False),
    "replay-theater": ("none", "", False),
    "tool-skins": ("none", "", False),
    "secret-guard": ("none", "", True),
    "budget-guard": ("none", "", True),
    "diagram": ("none", "", False),
    "aside": ("a little: only when you run /aside", "", False),
    "moddeck": ("none", "", True),
    "data-guard": ("none", "", True),
    "big-file-guard": ("none (it saves tokens)", "", True),
    "repro-log": ("none", "", False),
    "auto-test": ("none (off until you switch it on; it runs your tests)", "", False),
    "prompt-library": ("none", "", False),
    "checkpoint": ("none", "", True),
    "long-run-ping": ("none", "", False),
}
# Mods that spend model credit when used: listed, but not switched on until the person chooses them.
OFF_BY_DEFAULT = {"aside"}
OPTIONAL_NEEDS = {"codex": "Codex CLI not found: the item is unchecked (install Codex, then re-run to add it)"}


def items(det: Detected, root=None) -> list[Item]:
    out: list[Item] = []
    for m in payload.mods(root):
        tokens, needs, star = MOD_META.get(m["name"], ("see its README", "", False))
        out.append(Item(m["name"], GROUP_MOD, m["name"], m["description"], tokens, default=((not needs or det.has(needs)) and m["name"] not in OFF_BY_DEFAULT), star=star, needs=needs))
    out += [
        Item("rules", GROUP_RULE, "Global rules for Claude", "A short CLAUDE.md block (tests before claims, small changes, ask before destructive steps). Your own text in that file is never touched.", "small: about 25 lines read each session"),
        Item("skills", GROUP_RULE, "Two skills", "dual-model-review (a second model tries to prove a change wrong) and agents-md-scaffold (sets up AGENTS.md and a decisions log).", "one description line each until used"),
        Item("git-guards", GROUP_RULE, "Git guards", "On commit: refuses staged secret files (.env, private keys). On push: refuses force-pushes and remote branch deletion.", star=True),
        Item("guard-rules", GROUP_RULE, "Claude asks before git push", "Permission rules: every git push needs your OK, and commit/push --no-verify is denied so the guards cannot be skipped.", star=True),
        Item("prepush-tests", GROUP_RULE, "Run tests before push", "R (devtools::test()) or Rust (cargo test) projects are tested before a push goes out. Other projects are skipped."),
        Item("theory-review", GROUP_RULE, "Second-model review at push", "In repos that opt in (a docs/THEORY_REVIEW.md file), Codex reviews the changed method code read-only before the push. The review-cost mod shows the price first.", "Codex tokens, only when it runs", default=det.has("codex"), needs="codex"),
        Item("you-should-know", GROUP_ADDON, "You Should Know (built in)", "Anthropic's own tips during long jobs. Turned on by one line in settings.", plugin="cc-plugin-you-should-know@builtin"),
        Item("hardened-settings", GROUP_ADDON, "Hardened settings", "Claude's file tools may not read SSH, cloud, GPG, registry and .env files; a cloned repo cannot start MCP servers by itself. Does not stop shell commands (see sandbox).", star=True),
        Item("sandbox", GROUP_ADDON, "Sandbox (built in)", "Runs commands in Claude Code's own sandbox so they cannot write outside the project. Can break tools that need the network or other folders, including Codex.", "none", default=False, platforms=("darwin", "linux")),
        Item("telemetry-off", GROUP_ADDON, "Turn off telemetry and error reports", "Sets DISABLE_TELEMETRY and DISABLE_ERROR_REPORTING for Claude Code. A privacy choice; nothing else changes.", default=False),
        Item("plugin:rust-analyzer-lsp", GROUP_ADDON, "Rust diagnostics (official plugin)", "Rust compiler errors reach Claude right after an edit. Needs rust-analyzer on PATH.", "only when there are errors", default=det.has("rust-analyzer"), needs="rust-analyzer", plugin=f"rust-analyzer-lsp@{OFFICIAL}"),
        Item("plugin:pyright-lsp", GROUP_ADDON, "Python type checking (official plugin)", "Pyright diagnostics reach Claude right after an edit. Needs pyright-langserver on PATH.", "only when there are errors", default=det.has("pyright-langserver"), needs="pyright-langserver", plugin=f"pyright-lsp@{OFFICIAL}"),
        Item("plugin:security-guidance", GROUP_ADDON, "Security review (official plugin)", "Warns about risky patterns on edits, and reviews diffs with a model when a turn ends.", "yes: a model reviews diffs at the end of turns", default=False, plugin=f"security-guidance@{OFFICIAL}"),
        Item("plugin:claude-md-management", GROUP_ADDON, "CLAUDE.md upkeep (official plugin)", "Audits and improves your CLAUDE.md files; you call it.", "a few skill descriptions", default=False, plugin=f"claude-md-management@{OFFICIAL}"),
        Item("plugin:code-simplifier", GROUP_ADDON, "Code simplifier (official plugin)", "An agent that tidies code without changing behaviour; you call it.", "one agent description", default=False, plugin=f"code-simplifier@{OFFICIAL}"),
        Item("plugin:context7", GROUP_ADDON, "Live package docs (official plugin)", "Looks up current, version-specific documentation for R, Python and Rust packages instead of guessing from memory.", "yes: tool definitions in every session; fetches docs over the network", default=False, plugin=f"context7@{OFFICIAL}"),
        Item("plugin:pubmed", GROUP_ADDON, "PubMed search (official plugin)", "Literature search in Claude through a PubMed connector.", "yes: tool definitions in every session", default=False, plugin=f"pubmed@{OFFICIAL}"),
        Item("plugin:biorxiv", GROUP_ADDON, "bioRxiv / medRxiv (official plugin)", "Preprint search through a bioRxiv connector.", "yes: tool definitions in every session", default=False, plugin=f"biorxiv@{OFFICIAL}"),
        Item("plugin:bio-research", GROUP_ADDON, "Life-science research bundle (official plugin)", "Anthropic's bundle of literature, genomics and target-prioritisation connectors. Large.", "yes: many tool definitions in every session", default=False, plugin=f"bio-research@{OFFICIAL}"),
    ]
    return out


def available(det: Detected, root=None) -> list[Item]:
    return [i for i in items(det, root) if det.platform in i.platforms]


def defaults(det: Detected, root=None) -> set[str]:
    return {i.id for i in available(det, root) if i.default}


# ---------------------------------------------------------------- what each switch means in settings.json
DENY_READ = [
    "Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.gnupg/**)", "Read(~/.kube/**)", "Read(~/.config/gh/**)",
    "Read(~/.netrc)", "Read(~/.npmrc)", "Read(~/.pypirc)", "Read(~/.docker/config.json)",
    "Read(**/.env)", "Read(**/.env.local)",
]


def settings_plan(selected: set[str], profile: str, catalog: list[Item]) -> dict:
    plan: dict = {"lists": {}, "keys": {}, "scalars": {}}
    if "guard-rules" in selected:
        plan["lists"]["permissions.ask"] = ["Bash(git push:*)", "Bash(git push)"]
        plan["lists"]["permissions.deny"] = ["Bash(git commit --no-verify:*)", "Bash(git commit -n:*)", "Bash(git push --no-verify:*)"]
    if "hardened-settings" in selected:
        plan["lists"].setdefault("permissions.deny", []).extend(DENY_READ)
        plan["scalars"]["enableAllProjectMcpServers"] = False
    if "sandbox" in selected:
        plan["scalars"]["sandbox.enabled"] = True
    if "telemetry-off" in selected:
        plan["keys"]["env"] = {"DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1"}
    if "you-should-know" in selected:
        plan["keys"]["enabledPlugins"] = {"cc-plugin-you-should-know@builtin": True}
    if profile == "lab":
        plan["scalars"]["attribution.commit"] = ""
        plan["scalars"]["attribution.pr"] = ""
        plan["scalars"]["includeCoAuthoredBy"] = False
    return plan
