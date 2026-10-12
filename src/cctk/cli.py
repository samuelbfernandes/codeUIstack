"""Command line: install (default), plan, update, uninstall, status, verify, list, doctor."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, catalog, installer, payload, ui
from .claudecli import ClaudeCLI, MIN_VERSION
from .errors import InstallError


def _split(values: list[str] | None) -> list[str]:
    return [x for v in values or [] for x in v.replace(",", " ").split() if x]


def parser(cli_name: str) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=cli_name, description="Install the toolkit's Claude Code mods, rules, skills and git guards. Nothing changes until you confirm; --plan shows everything first.")
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="cmd")

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--scope", choices=["user", "project"], help="user = every Claude Code session on this computer; project = one project only (kept out of git)")
        sp.add_argument("--project", metavar="DIR", help="the project folder for --scope project (default: the current folder)")

    ins = sub.add_parser("install", help="install or re-configure (the default command)")
    common(ins)
    ins.add_argument("--profile", choices=["neutral", "lab"], help="neutral = generic safe rules (default); lab = FernandesLab's strict set")
    ins.add_argument("--with", dest="with_", action="append", metavar="ID", help="switch an item on (repeatable; see `list`)")
    ins.add_argument("--without", action="append", metavar="ID", help="switch an item off (repeatable)")
    ins.add_argument("--mods", metavar="LIST", help="install exactly these mods (comma separated), or 'all' / 'none'")
    preset = ins.add_mutually_exclusive_group()
    preset.add_argument("--standard", action="store_true", help="one line, no questions: the recommended set (same as -y with the defaults)")
    preset.add_argument("--all", action="store_true", help="one line, no questions: every mod, rule, skill and git guard (built-in features and third-party plugins stay at their defaults)")
    ins.add_argument("-y", "--yes", action="store_true", help="no questions: use the defaults (plus --with/--without)")
    ins.add_argument("--plan", action="store_true", help="print exactly what would change and stop; changes nothing")
    ins.add_argument("--force-hooks", action="store_true", help="replace an existing git core.hooksPath (default: keep it)")

    up = sub.add_parser("update", help="re-apply with the choices recorded at install time (run after upgrading the package)")
    common(up)
    up.add_argument("-y", "--yes", action="store_true")

    un = sub.add_parser("uninstall", help="remove what was installed in a scope (only what was recorded)")
    common(un)
    un.add_argument("-y", "--yes", action="store_true")

    for name, h in (("status", "show what is installed"), ("verify", "check the installed files against this package"), ("list", "list every switch with its default"), ("doctor", "check the tools the installer looks for")):
        sp = sub.add_parser(name, help=h)
        common(sp)
    return p


def _layout_for(args, ident: dict, home: Path, selected=None, profile="neutral") -> installer.Layout:
    scope = args.scope or "user"
    project = Path(args.project or ".").resolve() if scope == "project" else None
    return installer.Layout(ident, installer.Options(scope, project, profile, selected or set()), home)


def _print_plan(steps: list[installer.Step], lay: installer.Layout, opts: installer.Options) -> None:
    where = "every Claude Code session on this computer" if lay.user else f"the project {lay.project} only"
    print(f"\nPLAN  scope: {opts.scope} ({where})   profile: {opts.profile}")
    n = 0
    for s in steps:
        if s.title == "Note":
            print(f"  note: {s.lines[0]}")
            continue
        n += 1
        print(f"  {n}. {s.title}")
        for ln in s.lines:
            print(f"     - {ln}")
    print("  Network: none from this installer. (Official plugins, if you picked any, are downloaded by Claude Code itself.)")
    print("  Undo: `uninstall` removes exactly what is listed; your own settings and text are never edited beyond the lines above.")


def _selection(args, det, root, saved: set[str] | None) -> set[str]:
    items = catalog.available(det, root)
    ids = {i.id for i in items}
    sel = set(saved) if saved is not None else catalog.defaults(det, root)
    if getattr(args, "all", False):
        sel |= {i.id for i in items if i.group in (catalog.GROUP_MOD, catalog.GROUP_RULE) and det.platform in i.platforms and (i.group == catalog.GROUP_MOD or not i.needs or det.has(i.needs))}
    if getattr(args, "mods", None):
        mod_ids = {i.id for i in items if i.group == catalog.GROUP_MOD}
        want = mod_ids if args.mods == "all" else set() if args.mods == "none" else set(_split([args.mods]))
        unknown = want - mod_ids
        if unknown:
            raise InstallError(f"unknown mod(s): {', '.join(sorted(unknown))}. Known: {', '.join(sorted(mod_ids))}")
        sel = (sel - mod_ids) | want
    for x in _split(getattr(args, "with_", None)):
        if x not in ids:
            raise InstallError(f"unknown item '{x}'. Run `list` to see the valid ids.")
        sel.add(x)
    for x in _split(getattr(args, "without", None)):
        if x not in ids:
            raise InstallError(f"unknown item '{x}'. Run `list` to see the valid ids.")
        sel.discard(x)
    return sel


def cmd_install(args, update: bool = False) -> int:
    if getattr(args, "standard", False) or getattr(args, "all", False):
        args.yes = True   # a preset is the one-line install: it asks nothing (add --plan to only look)
    det, root = catalog.Detected.probe(), payload.data_root()
    ident, home, cli = payload.identity(root), Path.home(), ClaudeCLI()
    talk = ui.interactive() and not args.yes and not getattr(args, "plan", False)
    if not talk and not (args.yes or getattr(args, "plan", False)):
        raise InstallError("this needs a terminal to ask you questions. Run it in a terminal, or add --yes (use the defaults) or --plan (just show the plan).")
    print(f"{ident['title']} installer {__version__}")
    if talk:
        print("It asks a few questions, shows exactly what it will change, and changes nothing until you say yes.\n(Run with --plan any time to only look.)")
    scope = args.scope
    if not scope:
        scope = "user" if not talk else ui.choice("Where should it be installed?", [
            ("user", "Everywhere (global)", "Every Claude Code session on this computer, in every project."),
            ("project", "One project only", "Only when Claude Code runs in that project's folder, on this computer. Nothing is added to the project's git history.")], "user")
        args.scope = scope
    if scope == "project" and not args.project:
        here = str(Path.cwd())
        args.project = here if not talk else (ui.ask(f"Project folder [{here}]: ").strip() or here)
    lay0 = _layout_for(args, ident, home)
    old = installer.load_state(lay0)
    earlier = installer.legacy_installs(ident, lay0.opts, home)   # an install made under an earlier name of this project
    from_earlier = bool(not old and earlier)
    if from_earlier:
        old = installer.load_state(earlier[0])
        print(f"Found an install made under the earlier name '{earlier[0].name}': it will be replaced" + (", keeping your choices." if update else "."))
    saved = set(old.get("selected", [])) if (old and update) else None
    if saved is not None and (from_earlier or "known" in old):
        saved |= catalog.defaults(det, root) - set(old.get("known", []))   # items added since that install start on at their default
    profile = getattr(args, "profile", None) or (old.get("profile") if old else None)
    if not profile:
        profile = "neutral" if not talk else ui.choice("Which rule set?", [
            ("neutral", "Neutral (recommended)", "Generic safe habits: secrets are never committed, force-pushes are refused, tests before claims."),
            ("lab", "Lab (strict)", "Also: no AI names in commit messages, CLAUDE.md and .claude/ never committed, automatic second-model review in repos that opt in.")], "neutral")
    sel = _selection(args, det, root, saved)
    if talk:
        print("\nEach list shows what is switched on by default. Items that need a program you do not have (for example Codex) start switched off.")
        items = catalog.available(det, root)
        for g in (catalog.GROUP_MOD, catalog.GROUP_RULE, catalog.GROUP_ADDON):
            grp = [i for i in items if i.group == g]
            keep = ui.checklist(catalog.GROUP_TITLES[g], grp, sel)
            sel = (sel - {i.id for i in grp}) | keep
    opts = installer.Options(scope, lay0.project, profile, sel, getattr(args, "force_hooks", False))
    lay, steps, _ = installer.build_steps(opts, cli, det, root, home)
    _print_plan(steps, lay, opts)
    if getattr(args, "plan", False):
        print("\n(plan only: nothing was changed)")
        return 0
    if talk and not ui.confirm("\nApply this plan?", True):
        print("Nothing was changed.")
        return 1
    ctx = installer.Ctx(lay, cli, root)
    print()
    installer.apply(steps, ctx)
    _done(lay, ctx, ident)
    return 0 if not ctx.warnings else 0


def _done(lay: installer.Layout, ctx: installer.Ctx, ident: dict) -> None:
    print("\nDone." + (f" {len(ctx.warnings)} warning(s) above." if ctx.warnings else ""))
    print("Start a NEW Claude Code session (or run /reload-plugins in an open one). Most tools now run by themselves; open the side bar with /moddeck, or run one:  /branch-janitor   /suggest-model   /cache-tax")
    print(f"What each tool does: {lay.stage / 'docs' / 'TOOLS.md'}" if (lay.stage / "TOOLS.md").exists() else "What each tool does: see docs/TOOLS.md in the repository.")
    cli = ident["cli"]
    where = "" if lay.user else f" --scope project --project {lay.project}"
    print(f"Change choices: `{cli} install{where}`.  Remove everything: `{cli} uninstall{where}`.")


def cmd_uninstall(args) -> int:
    root = payload.data_root()
    ident, home = payload.identity(root), Path.home()
    lay = _layout_for(args, ident, home)
    found = ([lay] if installer.load_state(lay) else []) + installer.legacy_installs(ident, lay.opts, home)
    if not found:
        print("Nothing recorded for this scope: nothing to remove.")
        return 0
    if not args.yes:
        if not ui.interactive():
            raise InstallError("add --yes to uninstall without a terminal.")
        names = ", ".join(f"'{l.name}'" for l in found)
        if not ui.confirm(f"Remove the toolkit ({names}) from scope '{lay.opts.scope}' (only what the installer recorded)?", True):
            print("Nothing was changed.")
            return 1
    cli = ClaudeCLI()
    for l in found:
        installer.uninstall(l, cli)
    print("Removed. Your own settings and text were left alone.")
    return 0


def cmd_status(args) -> int:
    root = payload.data_root()
    ident, home = payload.identity(root), Path.home()
    from .settingsfile import read_json
    names = [ident["name"], *[n for n in ident.get("legacy", []) if n and n != ident["name"]]]
    found = [(n, f) for n in names for f in installer.all_states(home / ".claude" / n)]
    cli = ClaudeCLI()
    shown = {n for n, _ in found}
    try:
        stray = [n for n in names[1:] if n not in shown and cli.available and n in cli.marketplace_names()]
    except Exception:  # a status report never fails because Claude Code could not be asked
        stray = []
    if not found:
        print("Not installed (no records found).")
        for n in stray:
            print(f"Claude Code still lists a marketplace named '{n}' from an earlier install. Remove it with:  claude plugin marketplace remove {n}")
        return 0
    old = False
    for n, f in found:
        st = read_json(f)
        tag = "" if n == ident["name"] else f"  [installed under the earlier name '{n}']"
        old = old or bool(tag)
        print(f"- scope {st.get('scope')}" + (f" ({st.get('project')})" if st.get("project") else "") + f", profile {st.get('profile')}, version {st.get('version')}{tag}")
        print(f"    items: {', '.join(st.get('selected', []))}")
    if old:
        where = "" if all(read_json(f).get("scope") == "user" for _, f in found) else "  (add --scope project --project DIR for a project install)"
        print(f"An install from the earlier name is still there. Run `{ident['cli']} update`: it removes it and installs the current version with the same choices.{where}")
    return 0


def cmd_verify(args) -> int:
    root = payload.data_root()
    ident, home = payload.identity(root), Path.home()
    stage = home / ".claude" / ident["name"]
    if not stage.is_dir():
        older = [n for n in ident.get("legacy", []) if (home / ".claude" / n).is_dir()]
        print("Not installed." + (f" Found an install under the earlier name '{older[0]}': run `{ident['cli']} update` to replace it." if older else ""))
        return 1
    d = payload.diff(payload.fingerprint(root), payload.fingerprint(stage))
    if not any(d.values()):
        print(f"OK: the installed files match this package ({len(payload.fingerprint(stage))} files).")
        return 0
    for k, v in d.items():
        for x in v:
            print(f"{k}: {x}")
    print("The installed copy differs from this package. Run `install` to refresh it.")
    return 1


def cmd_list(args) -> int:
    det = catalog.Detected.probe()
    for g in (catalog.GROUP_MOD, catalog.GROUP_RULE, catalog.GROUP_ADDON):
        print(f"\n{catalog.GROUP_TITLES[g]}")
        for i in catalog.items(det):
            if i.group != g:
                continue
            avail = det.platform in i.platforms
            print(f"  {i.id:<30} {'on ' if i.default and avail else 'off'}  {i.title}{'  (start here)' if i.star else ''}{'' if avail else '  [not on ' + det.platform + ']'}")
    return 0


def cmd_doctor(args) -> int:
    det, cli = catalog.Detected.probe(), ClaudeCLI()
    ver = cli.version() if cli.available else None
    print(f"platform: {det.platform}")
    for t, ok in det.tools.items():
        print(f"  {t:<20} {'found' if ok else 'not found'}")
    if ver:
        print(f"Claude Code {'.'.join(map(str, ver))} (mods need {'.'.join(map(str, MIN_VERSION))} or later): {'ok' if ver >= MIN_VERSION else 'TOO OLD, run `claude update`'}")
    else:
        print("Claude Code: not found on PATH. Install it first: https://docs.claude.com/en/docs/claude-code")
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    try:
        ident = payload.identity()
    except InstallError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    if not argv or argv[0].startswith("-") and argv[0] not in ("-h", "--help", "--version"):
        argv.insert(0, "install")
    args = parser(ident["cli"]).parse_args(argv)
    try:
        if args.cmd in (None, "install"):
            return cmd_install(args)
        return {"update": lambda a: cmd_install(a, update=True), "uninstall": cmd_uninstall, "status": cmd_status,
                "verify": cmd_verify, "list": cmd_list, "doctor": cmd_doctor}[args.cmd](args)
    except InstallError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nCancelled. Anything already applied can be removed with `uninstall`.", file=sys.stderr)
        return 130
