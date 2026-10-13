"""Thin wrapper over `claude plugin ...` (Claude Code's own plugin manager does the actual installing)."""
from __future__ import annotations

import json
import re
import shutil

from . import proc

OFFICIAL_MARKETPLACE = "anthropic-plugin-directory"
MIN_VERSION = (2, 1, 287)  # the mod (function-hook) API


class ClaudeCLI:
    def __init__(self, exe: str | None = None):
        self.exe = exe or shutil.which("claude")

    @property
    def available(self) -> bool:
        return bool(self.exe)

    def run(self, args: list[str], cwd: str | None = None, timeout: int = 180) -> tuple[int, str]:
        if not self.exe:
            return 127, "claude: not found"
        return proc.run([self.exe, *args], cwd=cwd, timeout=timeout)

    def version(self) -> tuple[int, ...] | None:
        rc, out = self.run(["--version"], timeout=30)
        m = re.search(r"(\d+)\.(\d+)\.(\d+)", out) if rc == 0 else None
        return tuple(int(x) for x in m.groups()) if m else None

    def marketplace_names(self) -> set[str]:
        rc, out = self.run(["plugin", "marketplace", "list", "--json"], timeout=60)
        try:
            return {x["name"] for x in json.loads(out)} if rc == 0 else set()
        except (ValueError, KeyError, TypeError):
            return set()

    def marketplace_add(self, source: str, scope: str, cwd: str | None) -> tuple[int, str]:
        return self.run(["plugin", "marketplace", "add", source, "--scope", scope], cwd=cwd)

    def marketplace_remove(self, name: str, scope: str, cwd: str | None) -> tuple[int, str]:
        return self.run(["plugin", "marketplace", "remove", name, "--scope", scope], cwd=cwd, timeout=60)

    def installed(self, cwd: str | None) -> list[dict]:
        rc, out = self.run(["plugin", "list", "--json"], cwd=cwd, timeout=60)
        try:
            data = json.loads(out) if rc == 0 else []
            return data if isinstance(data, list) else []
        except ValueError:
            return []

    def available_ids(self) -> set[str]:
        """Plugin ids offered by the marketplaces Claude Code already knows (includes the official directory)."""
        rc, out = self.run(["plugin", "list", "--available", "--json"], timeout=120)
        try:
            data = json.loads(out) if rc == 0 else {}
            items = data.get("available", []) if isinstance(data, dict) else data
            return {p["pluginId"] for p in items if "pluginId" in p}
        except (ValueError, TypeError, KeyError):
            return set()

    def install(self, plugin_id: str, scope: str, cwd: str | None) -> tuple[int, str]:
        return self.run(["plugin", "install", plugin_id, "-s", scope], cwd=cwd)

    def uninstall(self, plugin_id: str, scope: str, cwd: str | None) -> tuple[int, str]:
        return self.run(["plugin", "uninstall", plugin_id, "-s", scope], cwd=cwd)

    def update(self, plugin_id: str, scope: str, cwd: str | None) -> tuple[int, str]:
        return self.run(["plugin", "update", plugin_id, "--scope", scope], cwd=cwd)

    def mcp_add(self, spec: list[str], scope: str, cwd: str | None) -> tuple[int, str]:
        """spec = the server's name, then its options and command (catalog.Item.mcp)."""
        return self.run(["mcp", "add", "-s", scope, *spec], cwd=cwd, timeout=60)

    def mcp_remove(self, name: str, scope: str, cwd: str | None) -> tuple[int, str]:
        return self.run(["mcp", "remove", name, "-s", scope], cwd=cwd, timeout=60)
