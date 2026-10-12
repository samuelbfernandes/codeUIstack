import json
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (adds src/ to sys.path)
from cctk import settingsfile as sf
from cctk.errors import InstallError

PLAN = {
    "lists": {"permissions.ask": ["Bash(git push:*)"], "permissions.deny": ["Read(~/.ssh/**)"]},
    "keys": {"enabledPlugins": {"a@b": True}, "env": {"DISABLE_TELEMETRY": "1"}},
    "scalars": {"enableAllProjectMcpServers": False, "sandbox.enabled": True},
}


class Settings(unittest.TestCase):
    def test_roundtrip_restores_users_file_exactly(self):
        user = {"model": "opus", "permissions": {"allow": ["Bash(ls:*)"], "deny": ["Read(secret)"]}, "enableAllProjectMcpServers": True}
        original = json.loads(json.dumps(user))
        rec, _ = sf.apply_plan(user, PLAN)
        self.assertIn("Read(~/.ssh/**)", user["permissions"]["deny"])
        self.assertEqual(user["enableAllProjectMcpServers"], False)
        sf.revert_plan(user, rec)
        self.assertEqual(user, original)

    def test_second_apply_records_nothing(self):
        s = {}
        sf.apply_plan(s, PLAN)
        rec, _ = sf.apply_plan(s, PLAN)
        self.assertTrue(sf.record_is_empty(rec))

    def test_existing_key_value_is_kept_with_a_note(self):
        s = {"env": {"DISABLE_TELEMETRY": "0"}, "enabledPlugins": {"a@b": False}}
        rec, notes = sf.apply_plan(s, PLAN)
        self.assertEqual(s["env"]["DISABLE_TELEMETRY"], "0")
        self.assertEqual(s["enabledPlugins"]["a@b"], False)
        self.assertEqual(len(notes), 2)

    def test_revert_leaves_values_the_user_changed_since(self):
        s = {}
        rec, _ = sf.apply_plan(s, PLAN)
        s["sandbox"]["enabled"] = False          # user flipped it later
        s["permissions"]["ask"].append("Bash(rm:*)")
        sf.revert_plan(s, rec)
        self.assertEqual(s["sandbox"]["enabled"], False)
        self.assertEqual(s["permissions"]["ask"], ["Bash(rm:*)"])

    def test_empty_containers_are_pruned(self):
        s = {}
        rec, _ = sf.apply_plan(s, PLAN)
        sf.revert_plan(s, rec)
        self.assertEqual(s, {})

    def test_invalid_json_is_refused_and_untouched(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "settings.json"
            p.write_text("{ not json")
            with self.assertRaises(InstallError):
                sf.read_json(p)
            self.assertEqual(p.read_text(), "{ not json")

    def test_wrong_type_is_refused(self):
        with self.assertRaises(InstallError):
            sf.apply_plan({"permissions": {"ask": "x"}}, PLAN)


class Blocks(unittest.TestCase):
    B, E = "<!-- BEGIN x -->", "<!-- END x -->"

    def test_upsert_keeps_user_text_and_replaces_block(self):
        t = sf.upsert_block("# mine\nhello\n", "rules v1", self.B, self.E)
        t = sf.upsert_block(t, "rules v2", self.B, self.E)
        self.assertIn("# mine\nhello", t)
        self.assertIn("rules v2", t)
        self.assertNotIn("rules v1", t)
        self.assertEqual(t.count(self.B), 1)

    def test_remove_restores_original(self):
        t = sf.upsert_block("# mine\nhello\n", "r", self.B, self.E)
        self.assertEqual(sf.remove_block(t, self.B, self.E), "# mine\nhello\n")

    def test_remove_from_only_block_gives_empty(self):
        self.assertEqual(sf.remove_block(sf.upsert_block("", "r", self.B, self.E), self.B, self.E), "")


class Lines(unittest.TestCase):
    def test_add_and_remove_only_ours(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "exclude"
            p.write_text("mine\n")
            added = sf.add_lines(p, ["mine", "ours"])
            self.assertEqual(added, ["ours"])
            sf.remove_lines(p, added)
            self.assertEqual(p.read_text(), "mine\n")


if __name__ == "__main__":
    unittest.main()
