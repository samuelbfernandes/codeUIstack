"""git config reads/writes with the previous value remembered, so uninstall can put things back."""
from __future__ import annotations

from . import proc


class GitConfig:
    def __init__(self, scope: str, cwd: str | None):
        assert scope in ("global", "local")
        self.scope, self.cwd = scope, cwd

    def _argv(self, *rest: str) -> list[str]:
        return ["git", "config", f"--{self.scope}", *rest]

    def get(self, key: str) -> str | None:
        rc, out = proc.run(self._argv("--get", key), cwd=self.cwd)
        return out.strip() if rc == 0 else None

    def set(self, key: str, value: str) -> None:
        rc, out = proc.run(self._argv(key, value), cwd=self.cwd)
        if rc != 0:
            raise RuntimeError(f"git config {key} failed: {out.strip()}")

    def unset(self, key: str) -> None:
        proc.run(self._argv("--unset", key), cwd=self.cwd)


def is_git_repo(path: str) -> bool:
    rc, _ = proc.run(["git", "rev-parse", "--git-dir"], cwd=path)
    return rc == 0


def git_dir(path: str) -> str | None:
    rc, out = proc.run(["git", "rev-parse", "--absolute-git-dir"], cwd=path)
    return out.strip() if rc == 0 else None
