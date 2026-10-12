"""The only place the installer starts other programs: always an argv list (never a shell string), always with a timeout."""
from __future__ import annotations

import subprocess

# Tests replace this to record or fake calls.
def run(argv: list[str], cwd: str | None = None, timeout: int = 180) -> tuple[int, str]:
    try:
        p = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        return 127, f"{argv[0]}: not found"
    except subprocess.TimeoutExpired:
        return 124, f"{' '.join(argv[:3])}: timed out after {timeout}s"
    return p.returncode, (p.stdout or "") + (p.stderr or "")
