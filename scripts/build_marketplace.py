#!/usr/bin/env python3
"""Regenerate .claude-plugin/marketplace.json from identity.json and mods/*/.claude-plugin/plugin.json.

The generated file is committed; CI runs this with --check and fails if it is out of date.
Adding a mod = adding a folder under mods/ and running this script.
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def build() -> dict:
    ident = json.loads((ROOT / "identity.json").read_text(encoding="utf-8"))
    plugins = []
    for mod in sorted((ROOT / "mods").iterdir()):
        manifest = mod / ".claude-plugin" / "plugin.json"
        if not manifest.is_file():
            continue
        d = json.loads(manifest.read_text(encoding="utf-8"))
        if d["name"] != mod.name:
            sys.exit(f"mods/{mod.name}: plugin.json name is {d['name']!r}; folder and name must match")
        plugins.append({"name": d["name"], "source": f"./mods/{mod.name}", "description": d["description"]})
    return {
        "name": ident["marketplace"],
        "owner": {"name": ident["author"]},
        "metadata": {"description": ident["tagline"]},
        "plugins": plugins,
    }


def main() -> int:
    text = json.dumps(build(), indent=2, ensure_ascii=False) + "\n"
    target = ROOT / ".claude-plugin" / "marketplace.json"
    if "--check" in sys.argv:
        if not target.is_file() or target.read_text(encoding="utf-8") != text:
            print("marketplace.json is out of date: run python scripts/build_marketplace.py", file=sys.stderr)
            return 1
        print("marketplace.json is up to date")
        return 0
    target.write_text(text, encoding="utf-8")
    print(f"wrote {target.relative_to(ROOT)} ({len(json.loads(text)['plugins'])} mods)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
