"""Plan, install and uninstall. Every change is a Step with a human-readable description (shown by --plan) and an
apply function; what was changed is written to a state file so `uninstall` and a re-run can put it back exactly."""
from __future__ import annotations

import hashlib
import json
import shutil
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from . import __version__, catalog, payload, settingsfile as sf
from .claudecli import ClaudeCLI, MIN_VERSION
from .errors import InstallError
from .gitcfg import GitConfig, git_dir, is_git_repo

MOD_SKILLS = ["dual-model-review", "agents-md-scaffold", "align", "burst", "assess-plugin", "no-ai-text"]


@dataclass
class Options:
    scope: str                    # "user" (everywhere) | "project" (this project only, this computer only)
    project: Path | None
    profile: str                  # neutral | lab
    selected: set[str]
    force_hooks: bool = False


class Layout:
    def __init__(self, ident: dict, opts: Options, home: Path):
        self.name, self.opts, self.home = ident["name"], opts, home
        self.user = opts.scope == "user"
        self.project = None if self.user else Path(opts.project or ".").resolve()
        self.claude_scope = "user" if self.user else "local"     # Claude Code's own scope name
        self.stage = home / ".claude" / self.name
        key = "user" if self.user else "project-" + hashlib.sha1(str(self.project).encode()).hexdigest()[:10]
        self.state_file = self.stage / "state" / f"{key}.json"
        base = home / ".claude" if self.user else self.project / ".claude"
        self.settings = base / ("settings.json" if self.user else "settings.local.json")
        self.claude_md = (home / ".claude" / "CLAUDE.md") if self.user else (self.project / "CLAUDE.local.md")
        self.skills_dir = base / "skills"
        self.git_scope = "global" if self.user else "local"
        self.cwd = str(self.project) if self.project else str(home)
        self.begin = f"<!-- BEGIN {self.name} (managed block: edits inside are overwritten on re-install; delete the block to remove) -->"
        self.end = f"<!-- END {self.name} -->"


def legacy_layouts(ident: dict, opts: Options, home: Path) -> list[Layout]:
    """Layouts of the same scope under the project's earlier names (identity.json "legacy"), for finding old installs."""
    return [Layout({**ident, "name": n, "marketplace": n, "cli": n}, opts, home) for n in ident.get("legacy", []) if n and n != ident["name"]]


def legacy_installs(ident: dict, opts: Options, home: Path) -> list[Layout]:
    """Only those earlier-name layouts that actually have an install recorded in this scope."""
    return [l for l in legacy_layouts(ident, opts, home) if l.state_file.exists()]


@dataclass
class Step:
    title: str
    lines: list[str]
    run: Callable[["Ctx"], None]


@dataclass
class Ctx:
    layout: Layout
    cli: ClaudeCLI
    root: Path
    say: Callable[[str], None] = print
    state: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)
        self.say(f"   ! {msg}")

    def save(self) -> None:
        sf.write_json(self.layout.state_file, self.state)


def load_state(layout: Layout) -> dict:
    return sf.read_json(layout.state_file)


def all_states(stage: Path) -> list[Path]:
    d = stage / "state"
    return sorted(d.glob("*.json")) if d.is_dir() else []


# ---------------------------------------------------------------- selection hygiene
def normalize(selected: set[str], det: catalog.Detected, root: Path | None = None) -> tuple[set[str], list[str]]:
    ok = {i.id for i in catalog.available(det, root)}
    sel = {s for s in selected if s in ok}
    notes = [f"'{s}' is not available on this computer and was dropped" for s in sorted(selected - ok)]
    if "git-guards" not in sel:
        for dep in ("prepush-tests", "theory-review"):
            if dep in sel:
                sel.discard(dep)
                notes.append(f"'{dep}' needs the git guards and was dropped")
    if "telemetry-off" in sel:
        notes.append("telemetry-off also keeps /advisor off. Picking the advisor in moddeck asks first, then turns telemetry back on for you")
    return sel, notes


def plugin_ids(selected: set[str], marketplace: str, catalog_items: list[catalog.Item]) -> list[str]:
    ids = [f"{i.id}@{marketplace}" for i in catalog_items if i.group == catalog.GROUP_MOD and i.id in selected]
    ids += [i.plugin for i in catalog_items if (i.plugin.endswith(catalog.OFFICIAL) or i.source) and i.id in selected]
    return ids


def market_sources(selected: set[str], catalog_items: list[catalog.Item]) -> dict[str, str]:
    """Third-party marketplaces the selected plugins come from: {marketplace name: owner/repo}."""
    return {i.plugin.split("@", 1)[1]: i.source for i in catalog_items if i.source and i.id in selected}


def mcp_specs(selected: set[str], catalog_items: list[catalog.Item]) -> list[list[str]]:
    return [list(i.mcp) for i in catalog_items if i.mcp and i.id in selected]


# ---------------------------------------------------------------- building the plan
def build_steps(opts: Options, cli: ClaudeCLI, det: catalog.Detected, root: Path, home: Path) -> tuple[Layout, list[Step], list[str]]:
    ident = payload.identity(root)
    lay = Layout(ident, opts, home)
    items = catalog.available(det, root)
    sel, notes = normalize(opts.selected, det, root)
    if not lay.user:
        if not lay.project.is_dir():
            raise InstallError(f"project folder not found: {lay.project}")
        if not is_git_repo(str(lay.project)):
            notes.append("this folder is not a git repository: the git guards and git ignores are skipped")
            sel -= {"git-guards", "prepush-tests", "theory-review"}
    steps: list[Step] = []
    for old in legacy_installs(ident, opts, home):
        steps.append(Step(f"Replace the earlier '{old.name}' install", [f"Remove what the '{old.name}' installer recorded in this scope (its files, settings lines, rules block, git settings, mods and marketplace '{old.name}'), then install under the name '{lay.name}' below. Your own text and settings are left alone."], lambda c, old=old: _retire_legacy(c, old)))
    where = "every Claude Code session on this computer" if lay.user else f"{lay.project} only (kept out of git, this computer only)"
    if lay.state_file.exists():
        steps.append(Step("Undo the earlier install in this scope", ["Put back exactly what the previous run recorded (only that), then apply the choices below."], lambda c: _revert_previous(c, sel)))
    steps.append(Step("Toolkit files", [f"Copy the toolkit files to {lay.stage} (the one place everything below points to; nothing else is copied)."], lambda c: _stage(c)))
    if "rules" in sel:
        steps.append(Step("Rules for Claude", [f"Add a managed block ({opts.profile} profile, global/CLAUDE.{opts.profile}.md) to {lay.claude_md}. Text outside the block is never edited; a .pre-{lay.name} backup is kept."], lambda c: _rules(c, opts.profile)))
    plan = catalog.settings_plan(sel, opts.profile, items)
    if not sf.record_is_empty({"lists": plan["lists"], "keys": plan["keys"], "scalars": plan["scalars"]}):
        steps.append(Step("Claude Code settings", _settings_lines(lay, plan), lambda c, p=plan: _settings(c, p)))
    if "skills" in sel:
        steps.append(Step("Skills", [f"Copy {', '.join(MOD_SKILLS)} to {lay.skills_dir}" + ("" if lay.user else " and list them in .git/info/exclude so they are never committed") + "."], lambda c: _skills(c)))
    if "git-guards" in sel:
        steps.append(Step("Git guards", _git_lines(lay, opts, sel), lambda c: _git(c, opts, sel)))
    pids = plugin_ids(sel, ident["marketplace"], items)
    srcs = market_sources(sel, items)
    if pids:
        steps.append(Step("Mods and plugins", _plugin_lines(lay, ident, pids, srcs), lambda c: _plugins(c, ident, pids, srcs)))
    specs = mcp_specs(sel, items)
    if specs or load_state(lay).get("mcp"):
        steps.append(Step("MCP servers", _mcp_lines(lay, specs), lambda c: _mcp(c, specs)))
    for line in notes:
        steps.append(Step("Note", [line], lambda c: None))
    return lay, steps, notes


def _settings_lines(lay: Layout, plan: dict) -> list[str]:
    out = [f"Edit {lay.settings} (additive; a .pre-{lay.name} backup is kept; only what is listed is added):"]
    for p, v in plan["lists"].items():
        out.append(f"{p} += {len(v)} rule(s): {', '.join(v[:3])}{' ...' if len(v) > 3 else ''}")
    for p, kv in plan["keys"].items():
        out.append(f"{p} += {', '.join(f'{k}={json.dumps(x)}' for k, x in kv.items())} (only if you have no value for it)")
    for p, v in plan["scalars"].items():
        out.append(f"{p} = {json.dumps(v)}")
    return out


def _git_lines(lay: Layout, opts: Options, sel: set[str]) -> list[str]:
    hp = (lay.stage / "global" / "githooks").as_posix()
    where = "--global" if lay.user else "--local in that repository"
    out = [f"git config {where}: core.hooksPath = {hp} (kept as is if you already have one" + ("; --force-hooks replaces it" if not opts.force_hooks else "; --force-hooks is on") + f"), toolkit.profile = {opts.profile}"]
    if "prepush-tests" not in sel:
        out.append("toolkit.prepushTests = false")
    if "theory-review" not in sel:
        out.append("toolkit.theoryReview = false")
    out.append("Ignore patterns: " + ("core.excludesFile (or lines appended to yours)" if lay.user else ".git/info/exclude") + f" ({'CLAUDE.md, .claude/' if opts.profile == 'lab' else '.env, *.pem'} ...).")
    return out


def _plugin_lines(lay: Layout, ident: dict, pids: list[str], srcs: dict[str, str] | None = None) -> list[str]:
    out = [f"Run: claude plugin marketplace add {lay.stage} --scope {lay.claude_scope}   (a local folder, no download)"]
    for name, src in (srcs or {}).items():
        out.append(f"Run: claude plugin marketplace add {src} --scope {lay.claude_scope}   (third-party marketplace '{name}': downloaded by Claude Code from github.com/{src}; skipped if you already have it)")
    for p in pids:
        official = p.endswith(catalog.OFFICIAL)
        third = p.split("@", 1)[1] in (srcs or {})
        out.append(f"Run: claude plugin install {p} -s {lay.claude_scope}" + ("   (official Anthropic plugin: downloaded by Claude Code from github.com/anthropics)" if official else "   (third-party plugin)" if third else ""))
    return out


def _mcp_lines(lay: Layout, specs: list[list[str]]) -> list[str]:
    out = [f"Run: claude mcp add -s {lay.claude_scope} {' '.join(_quote(x) for x in s)}" for s in specs]
    if not specs:
        out.append("Remove the MCP servers an earlier run added and that are no longer chosen.")
    out.append("A server that already exists under the same name is left as it is (yours wins) and is not recorded.")
    return out


def _quote(x: str) -> str:
    return f'"{x}"' if any(ch in x for ch in " '()") else x


# ---------------------------------------------------------------- steps: apply
def _stage(c: Ctx) -> None:
    c.say(f"   copying toolkit to {c.layout.stage}")
    c.state["payload"] = payload.stage(c.root, c.layout.stage)
    c.state["version"] = __version__
    (c.layout.stage / "state").mkdir(parents=True, exist_ok=True)


def _retire_legacy(c: Ctx, old: Layout) -> None:
    c.say(f"   an install made under the earlier name '{old.name}' is recorded here: removing it first")
    uninstall(old, c.cli, c.say)


def _revert_previous(c: Ctx, sel: set[str]) -> None:
    old = load_state(c.layout)
    if not old:
        return
    c.say("   an earlier install is recorded here: undoing it first")
    revert_files(c.layout, old, c.say)
    # plugins are diffed later (they are slow to reinstall); keep the record
    c.state["plugins"] = old.get("plugins", [])
    c.state["marketplace"] = old.get("marketplace", {})
    c.state["markets"] = old.get("markets", [])
    c.state["mcp"] = old.get("mcp", [])


def _rules(c: Ctx, profile: str) -> None:
    lay = c.layout
    body = (lay.stage / "global" / f"CLAUDE.{profile}.md").read_text(encoding="utf-8")
    existed = lay.claude_md.exists()
    cur = lay.claude_md.read_text(encoding="utf-8") if existed else ""
    new = sf.upsert_block(cur, body, lay.begin, lay.end)
    if existed:
        sf.backup_once(lay.claude_md, lay.name)
    sf.write_atomic(lay.claude_md, new)
    c.state["claude_md"] = {"path": str(lay.claude_md), "created": not existed}
    c.say(f"   {lay.claude_md}")
    if not lay.user:
        _exclude(c, ["CLAUDE.local.md"])


def _settings(c: Ctx, plan: dict) -> None:
    lay = c.layout
    cur = sf.read_json(lay.settings)
    rec, notes = sf.apply_plan(cur, plan)
    for n in notes:
        c.warn(n)
    if not sf.record_is_empty(rec):
        existed = lay.settings.exists()
        sf.backup_once(lay.settings, lay.name)
        sf.write_json(lay.settings, cur)
        c.state["settings"] = {"path": str(lay.settings), "record": rec, "created": not existed}
    c.say(f"   {lay.settings}")
    if not lay.user:
        _exclude(c, [".claude/settings.local.json"])


def _exclude(c: Ctx, lines: list[str]) -> None:
    gd = git_dir(str(c.layout.project))
    if not gd:
        return
    path = Path(gd) / "info" / "exclude"
    added = sf.add_lines(path, lines)
    if added:
        ex = c.state.setdefault("exclude", {"path": str(path), "lines": []})
        ex["lines"] += [x for x in added if x not in ex["lines"]]


def _skills(c: Ctx) -> None:
    lay = c.layout
    names = []
    for s in MOD_SKILLS:
        src, dst = lay.stage / "skills" / s, lay.skills_dir / s
        if dst.exists():
            if _same_tree(src, dst):
                names.append(s)
                continue
            dst.rename(dst.with_name(f"{s}.bak.{time.strftime('%Y%m%d%H%M%S')}"))
            c.say(f"   existing {s} moved aside (.bak)")
        shutil.copytree(src, dst)
        names.append(s)
        c.say(f"   {s}")
    c.state["skills"] = {"dir": str(lay.skills_dir), "names": names}
    if not lay.user:
        _exclude(c, [f".claude/skills/{n}/" for n in names])


def _same_tree(a: Path, b: Path) -> bool:
    fa = {k.split("/", 1)[1]: v for k, v in payload.fingerprint(a.parent, [a.name]).items()}
    fb = {k.split("/", 1)[1]: v for k, v in payload.fingerprint(b.parent, [b.name]).items()}
    return fa == fb


def _git(c: Ctx, opts: Options, sel: set[str]) -> None:
    lay = c.layout
    g = GitConfig(lay.git_scope, lay.cwd)
    hp = (lay.stage / "global" / "githooks").as_posix()
    done: dict[str, dict] = {}

    def setk(key: str, value: str) -> None:
        prev = g.get(key)
        if prev == value:
            return
        g.set(key, value)
        done[key] = {"set": value, "prev": prev}

    cur = g.get("core.hooksPath")
    if cur in (None, hp) or opts.force_hooks:
        setk("core.hooksPath", hp)
        c.say(f"   core.hooksPath = {hp}")
    else:
        c.warn(f"git already uses hooks from {cur}: kept. Re-run with --force-hooks to replace it (your repo hooks still run either way when chained).")
    setk("toolkit.profile", opts.profile)
    if "prepush-tests" not in sel:
        setk("toolkit.prepushTests", "false")
    if "theory-review" not in sel:
        setk("toolkit.theoryReview", "false")
    # ignore patterns, taken from the payload's own files so there is one source
    ign = lay.stage / "global" / "githooks" / ("ignore" if opts.profile == "lab" else "ignore.neutral")
    patterns = [ln for ln in ign.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.startswith("#")]
    c.state["git"] = {"scope": lay.git_scope, "set": done}   # `done` is filled in place by setk()
    if lay.user:
        ex = g.get("core.excludesFile")
        if ex in (None, ign.as_posix()):
            setk("core.excludesFile", ign.as_posix())
        else:
            exp = Path(ex.replace("~", str(lay.home), 1) if ex.startswith("~") else ex)
            added = sf.add_lines(exp, patterns)
            if added:
                c.state["exclude"] = {"path": str(exp), "lines": added}
                c.say(f"   appended {len(added)} ignore line(s) to your existing {exp}")
    else:
        _exclude(c, patterns)


def _plugins(c: Ctx, ident: dict, pids: list[str], srcs: dict[str, str] | None = None) -> None:
    lay, cli = c.layout, c.cli
    if not cli.available:
        c.warn("'claude' was not found on PATH: the mods and plugins were skipped. Install Claude Code, then run this installer again.")
        return
    ver = cli.version()
    if ver and ver < MIN_VERSION:
        c.warn(f"Claude Code {'.'.join(map(str, ver))} is older than {'.'.join(map(str, MIN_VERSION))}, which mods need: run `claude update`, then run this installer again.")
        return
    name = ident["marketplace"]
    mp = c.state.setdefault("marketplace", {})
    if name not in cli.marketplace_names() or mp.get("scope") != lay.claude_scope:
        rc, out = cli.marketplace_add(str(lay.stage), lay.claude_scope, lay.cwd)
        if rc != 0 and "already" not in out.lower():
            c.warn(f"marketplace add failed: {out.strip().splitlines()[-1] if out.strip() else rc}")
            return
        mp.update({"name": name, "scope": lay.claude_scope, "added": True})
    known = cli.marketplace_names()
    ours = c.state.setdefault("markets", [])
    skip: set[str] = set()
    for mname, src in (srcs or {}).items():
        if mname in known:
            continue
        rc, out = cli.marketplace_add(src, lay.claude_scope, lay.cwd)
        if rc != 0 and "already" not in out.lower():
            c.warn(f"could not add the marketplace {src}: {out.strip().splitlines()[-1] if out.strip() else rc}. Its plugins are skipped.")
            skip.add(mname)
            continue
        if mname not in {m["name"] for m in ours}:
            ours.append({"name": mname, "source": src, "scope": lay.claude_scope})
        c.say(f"   ok   marketplace {src}")
    pids = [p for p in pids if p.split("@", 1)[1] not in skip]
    have = {p["id"] for p in cli.installed(lay.cwd) if p.get("scope") == lay.claude_scope}
    offered = cli.available_ids()
    prev = c.state.setdefault("plugins", [])
    prev_ids = {p["id"] for p in prev}
    for gone in sorted(prev_ids - set(pids)):
        rc, _ = cli.uninstall(gone, lay.claude_scope, lay.cwd)
        c.say(f"   removed {gone}" if rc == 0 else f"   could not remove {gone}")
        prev[:] = [p for p in prev if p["id"] != gone]
    for pid in pids:
        official = pid.endswith(catalog.OFFICIAL)
        # The "offered" list can be incomplete (older builds, a catalog not loaded yet), so a plugin missing from
        # it is still tried: the install itself gives the real answer, and a failure only skips that one plugin.
        if pid in have:
            rc, out = cli.update(pid, lay.claude_scope, lay.cwd)
            c.say(f"   ok   {pid} (already installed)")
        else:
            rc, out = cli.install(pid, lay.claude_scope, lay.cwd)
            if rc != 0:
                why = out.strip().splitlines()[-1] if out.strip() else f"exit {rc}"
                hint = " (this Claude Code did not list it as offered)" if official and offered and pid not in offered else ""
                c.warn(f"could not install {pid}: {why}{hint}. Skipped; install it later with /plugin if you want it.")
                continue
            c.say(f"   ok   {pid}")
        if pid not in {p["id"] for p in prev}:
            prev.append({"id": pid, "scope": lay.claude_scope, "official": official})
    _drop_markets(c, {p.split("@", 1)[1] for p in pids})


def _drop_markets(c: Ctx, needed: set[str]) -> None:
    """Remove the third-party marketplaces an earlier run added that no chosen plugin needs any more."""
    ours = c.state.get("markets", [])
    for m in [m for m in ours if m["name"] not in needed]:
        rc, _ = c.cli.marketplace_remove(m["name"], m["scope"], c.layout.cwd)
        c.say(f"   removed marketplace {m['source']}" if rc == 0 else f"   could not remove marketplace {m['source']}")
        ours.remove(m)


def _mcp(c: Ctx, specs: list[list[str]]) -> None:
    lay, cli = c.layout, c.cli
    if not cli.available:
        c.warn("'claude' was not found on PATH: the MCP servers were skipped.")
        return
    prev = c.state.setdefault("mcp", [])
    want = {s[0] for s in specs}
    for gone in [m for m in prev if m["name"] not in want]:
        rc, _ = cli.mcp_remove(gone["name"], gone["scope"], lay.cwd)
        c.say(f"   removed MCP server {gone['name']}" if rc == 0 else f"   could not remove MCP server {gone['name']}")
        prev.remove(gone)
    for spec in specs:
        name = spec[0]
        if name in {m["name"] for m in prev}:
            c.say(f"   ok   {name} (already added)")
            continue
        rc, out = cli.mcp_add(spec, lay.claude_scope, lay.cwd)
        if rc != 0:
            why = out.strip().splitlines()[-1] if out.strip() else f"exit {rc}"
            c.warn(f"could not add the MCP server {name}: {why}. " + ("You already have one with that name: it was kept." if "already exists" in out.lower() else "Skipped."))
            continue
        prev.append({"name": name, "scope": lay.claude_scope})
        c.say(f"   ok   MCP server {name}")


# ---------------------------------------------------------------- apply / uninstall
def apply(steps: list[Step], ctx: Ctx) -> None:
    ctx.state.setdefault("scope", ctx.layout.opts.scope)
    ctx.state["project"] = str(ctx.layout.project) if ctx.layout.project else None
    ctx.state["profile"] = ctx.layout.opts.profile
    ctx.state["selected"] = sorted(ctx.layout.opts.selected)
    ctx.state["known"] = sorted(i.id for i in catalog.available(catalog.Detected.probe(), ctx.root))
    try:
        for s in steps:
            if s.title == "Note":
                continue
            ctx.say(f"== {s.title}")
            s.run(ctx)
            if (ctx.layout.stage / "state").is_dir():
                ctx.save()
    finally:
        if (ctx.layout.stage / "state").is_dir():
            ctx.save()


def revert_files(lay: Layout, st: dict, say: Callable[[str], None]) -> None:
    """Undo the file-level changes recorded in st (not plugins)."""
    cm = st.get("claude_md")
    if cm:
        p = Path(cm["path"])
        if p.exists():
            new = sf.remove_block(p.read_text(encoding="utf-8"), lay.begin, lay.end)
            if new.strip():
                sf.write_atomic(p, new)
            elif cm.get("created"):
                p.unlink()
            else:
                sf.write_atomic(p, new)
            say(f"   removed our block from {p}")
    se = st.get("settings")
    if se:
        p = Path(se["path"])
        if p.exists():
            cur = sf.read_json(p)
            sf.revert_plan(cur, se["record"])
            if not cur and se.get("created"):
                p.unlink()
            else:
                sf.write_json(p, cur)
            say(f"   removed our entries from {p}")
    sk = st.get("skills")
    if sk:
        for n in sk["names"]:
            d = Path(sk["dir"]) / n
            src = lay.stage / "skills" / n
            if d.is_dir():
                if src.is_dir() and _same_tree(src, d):
                    shutil.rmtree(d)
                    say(f"   removed skill {n}")
                else:
                    say(f"   skill {n} was edited: left in place")
    gi = st.get("git")
    if gi:
        g = GitConfig(gi["scope"], lay.cwd)
        for key, ch in gi.get("set", {}).items():
            if g.get(key) == ch["set"]:
                g.set(key, ch["prev"]) if ch["prev"] is not None else g.unset(key)
        say(f"   restored git config ({gi['scope']})")
    ex = st.get("exclude")
    if ex:
        sf.remove_lines(Path(ex["path"]), ex["lines"])


def _clean_declarations(lay: Layout, st: dict) -> None:
    """Claude Code writes the marketplace and plugin declarations into the settings file itself; make sure none of ours
    is left pointing at a folder that is about to disappear, and tidy empty containers we leave behind."""
    name = (st.get("marketplace") or {}).get("name") or lay.name
    p = lay.settings
    if p.exists():
        cur = sf.read_json(p)
        known = cur.get("extraKnownMarketplaces", {})
        if isinstance(known, dict) and str(((known.get(name) or {}).get("source") or {}).get("path")) == str(lay.stage):
            del known[name]
        ep = cur.get("enabledPlugins", {})
        if isinstance(ep, dict):
            for k in [k for k in ep if k.endswith("@" + name)]:
                del ep[k]
        for k in ("extraKnownMarketplaces", "enabledPlugins"):
            if k in cur and not cur[k]:
                del cur[k]
        if cur:
            sf.write_json(p, cur)
        elif not lay.user:
            p.unlink()
        else:
            sf.write_json(p, cur)
    if not lay.user:
        for d in (lay.skills_dir, lay.project / ".claude"):
            try:
                d.rmdir()  # only if empty
            except OSError:
                pass


def uninstall(lay: Layout, cli: ClaudeCLI, say: Callable[[str], None] = print) -> bool:
    st = load_state(lay)
    if not st:
        say("Nothing recorded for this scope: nothing to remove.")
        return False
    revert_files(lay, st, say)
    if cli.available:
        for p in st.get("plugins", []):
            rc, _ = cli.uninstall(p["id"], p["scope"], lay.cwd)
            say(f"   {'removed' if rc == 0 else 'could not remove'} {p['id']}")
        for m in st.get("mcp", []):
            rc, _ = cli.mcp_remove(m["name"], m["scope"], lay.cwd)
            say(f"   {'removed' if rc == 0 else 'could not remove'} MCP server {m['name']}")
        for m in st.get("markets", []):
            rc, _ = cli.marketplace_remove(m["name"], m["scope"], lay.cwd)
            say(f"   {'removed' if rc == 0 else 'could not remove'} marketplace {m['source']}")
        mp = st.get("marketplace", {})
        if mp.get("name"):
            cli.marketplace_remove(mp["name"], mp.get("scope", lay.claude_scope), lay.cwd)
            say(f"   removed marketplace {mp['name']} from scope {mp.get('scope', lay.claude_scope)}")
    _clean_declarations(lay, st)
    lay.state_file.unlink()
    if not all_states(lay.stage):
        shutil.rmtree(lay.stage, ignore_errors=True)
        say(f"   removed {lay.stage}")
    return True
