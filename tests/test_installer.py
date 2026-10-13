import json
import os
import stat
import sys
import unittest
from pathlib import Path

import helpers
from helpers import MP, NAME, Sandbox, run_cli
from cctk import catalog, installer, payload, ui

POSIX = sys.platform != "win32"
SKIP_PLUGINS = ["--without", "plugin:rust-analyzer-lsp,plugin:pyright-lsp"]


class Base(unittest.TestCase):
    codex = False

    def setUp(self):
        self.sb = Sandbox(with_codex=self.codex)
        self.addCleanup(self.sb.cleanup)
        self.home, self.proj = self.sb.home, self.sb.proj

    def install(self, *args):
        rc, out, err = run_cli(["install", "--yes", *SKIP_PLUGINS, *args])
        self.assertEqual(rc, 0, out + err)
        return out

    def plugins(self):
        return {p["id"] for p in self.sb.fake_db()["plugins"]}


@unittest.skipUnless(POSIX, "uses a fake claude script")
class UserScope(Base):
    def test_default_install_touches_what_the_plan_said(self):
        self.install("--scope", "user")
        self.assertTrue((self.home / ".claude" / "CLAUDE.md").exists())
        s = json.loads((self.home / ".claude" / "settings.json").read_text())
        self.assertIn("Bash(git push:*)", s["permissions"]["ask"])
        self.assertIs(s["enableAllProjectMcpServers"], False)
        self.assertNotIn("attribution", s)            # neutral profile
        self.assertTrue((self.home / ".claude" / "skills" / "dual-model-review" / "SKILL.md").exists())
        self.assertEqual(self.sb.git("config", "--global", "toolkit.profile"), "neutral")
        hp = self.sb.git("config", "--global", "core.hooksPath")
        self.assertTrue(hp.endswith("global/githooks"))
        self.assertTrue(os.access(Path(hp) / "pre-push", os.X_OK))
        self.assertIn(f"blast-radius@{MP}", self.plugins())

    def test_no_codex_means_review_cost_and_theory_review_start_off(self):
        self.install("--scope", "user")
        self.assertNotIn(f"review-cost@{MP}", self.plugins())
        self.assertEqual(self.sb.git("config", "--global", "toolkit.theoryReview"), "false")

    def test_standard_is_one_line_and_asks_nothing(self):
        rc, out, err = run_cli(["install", "--standard", "--scope", "user", *SKIP_PLUGINS])
        self.assertEqual(rc, 0, out + err)
        self.assertIn(f"blast-radius@{MP}", self.plugins())

    def test_all_installs_every_mod_including_the_ones_that_start_off(self):
        rc, out, err = run_cli(["install", "--all", "--scope", "user", *SKIP_PLUGINS])
        self.assertEqual(rc, 0, out + err)
        every = {m["name"] for m in payload.mods()}
        self.assertEqual({p.split("@")[0] for p in self.plugins()}, every)

    def test_standard_and_all_cannot_be_combined(self):
        with self.assertRaises(SystemExit):
            run_cli(["install", "--standard", "--all"])

    def test_plan_changes_nothing(self):
        before = self.sb.tree()
        rc, out, _ = run_cli(["install", "--plan", "--scope", "user"])
        self.assertEqual(rc, 0)
        self.assertIn("PLAN", out)
        self.assertEqual(self.sb.tree(), before)
        self.assertEqual(self.sb.fake_db()["plugins"], [])
        self.assertEqual(self.sb.git("config", "--global", "--list"), "")

    def test_uninstall_restores_users_files_byte_for_byte(self):
        claude = self.home / ".claude"
        claude.mkdir()
        (claude / "CLAUDE.md").write_text("# my own rules\nbe kind\n")
        (claude / "settings.json").write_text(json.dumps({"model": "opus", "permissions": {"allow": ["Bash(ls:*)"]}}, indent=2) + "\n")
        self.sb.git("config", "--global", "user.name", "T")
        before = {k: (claude / k).read_text() for k in ("CLAUDE.md", "settings.json")}
        gitcfg = self.sb.git("config", "--global", "--list")
        self.install("--scope", "user", "--with", "telemetry-off,sandbox")
        rc, _, err = run_cli(["uninstall", "--yes"])
        self.assertEqual(rc, 0, err)
        self.assertEqual(json.loads((claude / "settings.json").read_text()), json.loads(before["settings.json"]))
        self.assertEqual((claude / "CLAUDE.md").read_text(), before["CLAUDE.md"])
        self.assertEqual(self.sb.git("config", "--global", "--list"), gitcfg)
        self.assertFalse((claude / "skills" / "dual-model-review").exists())
        self.assertEqual(self.plugins(), set())
        self.assertEqual(self.sb.fake_db()["markets"], {})
        self.assertFalse((claude / NAME).exists())

    def test_existing_hooks_path_is_kept(self):
        self.sb.git("config", "--global", "core.hooksPath", "/somewhere/else")
        out = self.install("--scope", "user")
        self.assertEqual(self.sb.git("config", "--global", "core.hooksPath"), "/somewhere/else")
        self.assertIn("kept", out)
        run_cli(["uninstall", "--yes"])
        self.assertEqual(self.sb.git("config", "--global", "core.hooksPath"), "/somewhere/else")

    def test_force_hooks_replaces_and_uninstall_puts_back(self):
        self.sb.git("config", "--global", "core.hooksPath", "/somewhere/else")
        self.install("--scope", "user", "--force-hooks")
        self.assertNotEqual(self.sb.git("config", "--global", "core.hooksPath"), "/somewhere/else")
        run_cli(["uninstall", "--yes"])
        self.assertEqual(self.sb.git("config", "--global", "core.hooksPath"), "/somewhere/else")

    def test_rerun_with_fewer_choices_removes_the_rest(self):
        self.install("--scope", "user")
        self.assertIn(f"filetree@{MP}", self.plugins())
        self.install("--scope", "user", "--without", "filetree,hardened-settings")
        self.assertNotIn(f"filetree@{MP}", self.plugins())
        s = json.loads((self.home / ".claude" / "settings.json").read_text())
        self.assertNotIn("enableAllProjectMcpServers", s)
        self.assertIn("Bash(git push:*)", s["permissions"]["ask"])

    def test_rerun_is_idempotent(self):
        self.install("--scope", "user")
        snap = {k: v for k, v in self.sb.tree().items() if "state/" not in k}
        self.install("--scope", "user")
        self.assertEqual({k: v for k, v in self.sb.tree().items() if "state/" not in k}, snap)
        self.assertEqual(len([p for p in self.sb.fake_db()["plugins"] if p["id"].startswith("blast-radius")]), 1)

    def test_lab_profile_turns_attribution_off_and_uninstall_removes_it(self):
        self.install("--scope", "user", "--profile", "lab")
        s = json.loads((self.home / ".claude" / "settings.json").read_text())
        self.assertEqual(s["attribution"], {"commit": "", "pr": ""})
        self.assertEqual(self.sb.git("config", "--global", "toolkit.profile"), "lab")
        run_cli(["uninstall", "--yes"])
        self.assertFalse((self.home / ".claude" / "settings.json").exists() and "attribution" in (self.home / ".claude" / "settings.json").read_text())

    def test_mods_flag_selects_exactly_those(self):
        self.install("--scope", "user", "--mods", "blast-radius,suggest-model")
        self.assertEqual({p for p in self.plugins()}, {f"blast-radius@{MP}", f"suggest-model@{MP}"})

    def test_unknown_ids_are_refused_before_anything_changes(self):
        before = self.sb.tree()
        rc, _, err = run_cli(["install", "--yes", "--with", "nonsense"])
        self.assertEqual(rc, 2)
        self.assertIn("nonsense", err)
        rc, _, err = run_cli(["install", "--yes", "--mods", "nope"])
        self.assertEqual(rc, 2)
        self.assertEqual(self.sb.tree(), before)

    def test_corrupt_settings_aborts_without_touching_it(self):
        (self.home / ".claude").mkdir()
        (self.home / ".claude" / "settings.json").write_text("{ broken")
        rc, _, err = run_cli(["install", "--yes", "--scope", "user", *SKIP_PLUGINS])
        self.assertEqual(rc, 2)
        self.assertEqual((self.home / ".claude" / "settings.json").read_text(), "{ broken")

    def test_failed_plugin_is_reported_and_others_continue(self):
        os.environ["FAKE_FAIL"] = f"suggest-model@{MP}"
        out = self.install("--scope", "user")
        self.assertIn("could not install suggest-model", out)
        self.assertIn(f"blast-radius@{MP}", self.plugins())
        self.assertNotIn(f"suggest-model@{MP}", self.plugins())

    def test_old_claude_code_skips_mods_with_a_clear_message(self):
        os.environ["FAKE_CLAUDE_VERSION"] = "2.0.1"
        out = self.install("--scope", "user")
        self.assertIn("older than", out)
        self.assertEqual(self.plugins(), set())
        self.assertTrue((self.home / ".claude" / "CLAUDE.md").exists())     # the rest still installed

    def test_official_plugin_missing_from_the_offered_list_is_still_tried(self):
        os.environ["FAKE_OFFERED"] = "other@anthropic-plugin-directory"
        run_cli(["install", "--yes", "--scope", "user", "--with", "plugin:code-simplifier", *SKIP_PLUGINS])
        self.assertIn("code-simplifier@anthropic-plugin-directory", self.plugins())  # the list can be incomplete

    def test_official_plugin_that_cannot_be_installed_is_skipped_with_the_reason(self):
        os.environ["FAKE_OFFERED"] = "other@anthropic-plugin-directory"
        os.environ["FAKE_FAIL"] = "code-simplifier@anthropic-plugin-directory"
        rc, out, _ = run_cli(["install", "--yes", "--scope", "user", "--with", "plugin:code-simplifier", *SKIP_PLUGINS])
        self.assertIn("could not install code-simplifier@anthropic-plugin-directory: boom", out)
        self.assertIn("did not list it as offered", out)
        self.assertNotIn("code-simplifier@anthropic-plugin-directory", self.plugins())

    def test_official_plugin_offered_is_installed_and_removed(self):
        os.environ["FAKE_OFFERED"] = "code-simplifier@anthropic-plugin-directory"
        self.install("--scope", "user", "--with", "plugin:code-simplifier")
        self.assertIn("code-simplifier@anthropic-plugin-directory", self.plugins())
        run_cli(["uninstall", "--yes"])
        self.assertEqual(self.plugins(), set())

    def test_verify_detects_a_modified_hook(self):
        self.install("--scope", "user")
        self.assertEqual(run_cli(["verify"])[0], 0)
        (self.home / ".claude" / NAME / "global" / "githooks" / "pre-push").write_text("#!/bin/sh\nexit 0\n")
        rc, out, _ = run_cli(["verify"])
        self.assertEqual(rc, 1)
        self.assertIn("changed: global/githooks/pre-push", out)


@unittest.skipUnless(POSIX, "uses a fake claude script")
class ProjectScope(Base):
    def test_project_install_stays_local_and_out_of_git(self):
        self.install("--scope", "project", "--project", str(self.proj), "--profile", "lab")
        self.assertTrue((self.proj / "CLAUDE.local.md").exists())
        self.assertFalse((self.proj / "CLAUDE.md").exists())
        self.assertTrue((self.proj / ".claude" / "settings.local.json").exists())
        self.assertFalse((self.proj / ".claude" / "settings.json").exists())
        self.assertFalse((self.home / ".claude" / "CLAUDE.md").exists())       # nothing global
        self.assertEqual(self.sb.git("config", "--global", "--list"), "")
        self.assertEqual(self.sb.git("config", "--local", "toolkit.profile", cwd=self.proj), "lab")
        status = self.sb.git("status", "--porcelain", "-uall", cwd=self.proj)
        self.assertEqual(status, "", f"project would show untracked files: {status}")
        self.assertTrue(all(p["scope"] == "local" for p in self.sb.fake_db()["plugins"]))

    def test_project_uninstall_leaves_the_project_as_found(self):
        before = self.sb.tree()
        excl = (self.proj / ".git" / "info" / "exclude").read_text()
        self.install("--scope", "project", "--project", str(self.proj))
        rc, _, err = run_cli(["uninstall", "--yes", "--scope", "project", "--project", str(self.proj)])
        self.assertEqual(rc, 0, err)
        self.assertEqual(self.sb.tree(), before)
        self.assertEqual((self.proj / ".git" / "info" / "exclude").read_text(), excl)
        self.assertEqual(self.sb.git("config", "--local", "--list", cwd=self.proj).count("toolkit"), 0)

    def test_user_and_project_installs_are_independent(self):
        self.install("--scope", "user")
        self.install("--scope", "project", "--project", str(self.proj))
        run_cli(["uninstall", "--yes", "--scope", "project", "--project", str(self.proj)])
        self.assertTrue((self.home / ".claude" / "CLAUDE.md").exists())
        self.assertIn(f"blast-radius@{MP}", self.plugins())
        self.assertTrue((self.home / ".claude" / NAME / "global").exists())

    def test_non_git_folder_skips_git_parts_with_a_note(self):
        plain = self.sb.root / "plain"
        plain.mkdir()
        out = self.install("--scope", "project", "--project", str(plain))
        self.assertTrue((plain / "CLAUDE.local.md").exists())
        self.assertFalse((plain / ".git").exists())

    def test_missing_project_folder_is_an_error(self):
        rc, _, err = run_cli(["install", "--yes", "--scope", "project", "--project", str(self.sb.root / "nope")])
        self.assertEqual(rc, 2)


@unittest.skipUnless(POSIX, "uses a fake claude script")
class WithCodex(Base):
    codex = True

    def test_codex_present_turns_review_features_on(self):
        self.install("--scope", "user")
        self.assertIn(f"review-cost@{MP}", self.plugins())
        self.assertEqual(self.sb.git("config", "--global", "toolkit.theoryReview"), "")


@unittest.skipUnless(POSIX, "uses a fake claude script")
class Interactive(Base):
    def run_with(self, answers):
        q = list(answers)
        old_ask, old_int = ui.ask, ui.interactive
        ui.ask, ui.interactive = (lambda prompt: q.pop(0)), (lambda: True)
        try:
            return run_cli(["install", *SKIP_PLUGINS])
        finally:
            ui.ask, ui.interactive = old_ask, old_int
            self.assertEqual(q, [], "unused answers")

    def test_questions_toggle_and_confirm(self):
        # scope=1 (user), rules=Enter (neutral), mods: toggle blast-radius then Enter, rules: Enter, add-ons: Enter, confirm y
        names = [m["name"] for m in payload.mods()]
        number = str(names.index("blast-radius") + 1)  # the list follows marketplace.json, so look the number up
        rc, out, err = self.run_with(["1", "", number, "", "", "", "y"])
        self.assertEqual(rc, 0, out + err)
        self.assertNotIn(f"blast-radius@{MP}", self.plugins())
        self.assertIn(f"suggest-model@{MP}", self.plugins())

    def test_saying_no_changes_nothing(self):
        before = self.sb.tree()
        rc, out, _ = self.run_with(["1", "", "", "", "", "n"])
        self.assertEqual(rc, 1)
        self.assertEqual(self.sb.tree(), before)

    def test_needs_terminal_or_yes(self):
        rc, _, err = run_cli(["install"])
        self.assertEqual(rc, 2)
        self.assertIn("--yes", err)


class CatalogRules(unittest.TestCase):
    def test_ids_unique_and_every_mod_listed(self):
        det = catalog.Detected(platform="linux", tools={})
        ids = [i.id for i in catalog.items(det)]
        self.assertEqual(len(ids), len(set(ids)))
        for m in payload.mods():
            self.assertIn(m["name"], ids)

    def test_codex_items_default_off_without_codex(self):
        off = catalog.defaults(catalog.Detected(platform="linux", tools={"codex": False}))
        on = catalog.defaults(catalog.Detected(platform="linux", tools={"codex": True}))
        self.assertNotIn("review-cost", off)
        self.assertNotIn("theory-review", off)
        self.assertIn("review-cost", on)
        self.assertIn("theory-review", on)

    def test_sandbox_is_never_on_by_default_and_hidden_on_windows(self):
        self.assertNotIn("sandbox", catalog.defaults(catalog.Detected(platform="linux", tools={})))
        ids = {i.id for i in catalog.available(catalog.Detected(platform="windows", tools={}))}
        self.assertNotIn("sandbox", ids)

    def test_no_third_party_install_anywhere(self):
        for i in catalog.items(catalog.Detected(platform="linux", tools={})):
            if i.plugin:
                self.assertTrue(i.plugin.endswith(("@anthropic-plugin-directory", "@builtin")), i.id)

    def test_normalize_drops_dependents_of_missing_git_guards(self):
        det = catalog.Detected(platform="linux", tools={"codex": True})
        sel, notes = installer.normalize({"prepush-tests", "theory-review", "rules"}, det)
        self.assertEqual(sel, {"rules"})
        self.assertEqual(len(notes), 2)

    def test_dangerous_defaults_absent(self):
        d = catalog.defaults(catalog.Detected(platform="linux", tools={}))
        for risky in ("sandbox", "telemetry-off", "plugin:security-guidance", "plugin:bio-research", "plugin:pubmed", "plugin:biorxiv"):
            self.assertNotIn(risky, d)


class Payload(unittest.TestCase):
    def test_stage_keeps_state_dir_and_sets_exec_bits(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            dest = Path(d) / "x"
            payload.stage(payload.data_root(), dest)
            (dest / "state").mkdir()
            (dest / "state" / "user.json").write_text("{}")
            fp = payload.stage(payload.data_root(), dest)
            self.assertTrue((dest / "state" / "user.json").exists())
            self.assertIn("global/githooks/pre-push", fp)
            if POSIX:
                self.assertTrue(os.stat(dest / "global" / "githooks" / "pre-push").st_mode & stat.S_IXUSR)
                self.assertFalse(os.stat(dest / "global" / "githooks" / "ignore").st_mode & stat.S_IXUSR)

    def test_no_tests_or_dev_files_needed_by_installer(self):
        fp = payload.fingerprint(payload.data_root())
        self.assertFalse([k for k in fp if "node_modules" in k or k.endswith(".d.ts") and "claude-code.d.ts" in k])


if __name__ == "__main__":
    unittest.main()


class NewModDefaults(unittest.TestCase):
    def test_safety_mods_start_on(self):
        by_name = {i.id: i for i in catalog.items(catalog.Detected())}
        self.assertTrue(by_name["secret-guard"].default)
        self.assertTrue(by_name["budget-guard"].default)


class ReleaseConstant(unittest.TestCase):
    def test_moddeck_update_check_knows_this_release(self):
        import re
        root = __import__("pathlib").Path(__file__).resolve().parent.parent
        py = re.search(r'^version = "([^"]+)"', (root / "pyproject.toml").read_text(), re.M).group(1)
        ts = re.search(r"RELEASE = '([^']+)'", (root / "mods/moddeck/hooks/update.ts").read_text()).group(1)
        self.assertEqual(ts, py, "mods/moddeck/hooks/update.ts RELEASE must equal the pyproject version (bump both at release)")
