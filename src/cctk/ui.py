"""Plain-text prompts (no dependencies). `ask` is replaced in tests."""
from __future__ import annotations

import sys
from typing import Callable

from .catalog import Item

ask: Callable[[str], str] = input


def interactive() -> bool:
    return sys.stdin.isatty() and sys.stdout.isatty()


def choice(title: str, options: list[tuple[str, str, str]], default: str) -> str:
    """options = [(key, label, explanation)]. Enter takes the default."""
    print(f"\n{title}")
    for n, (key, label, expl) in enumerate(options, 1):
        print(f"  {n}) {label}{'  (default)' if key == default else ''}\n       {expl}")
    while True:
        raw = ask("Choose a number, or press Enter for the default: ").strip()
        if not raw:
            return default
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1][0]
        print("  Please type one of the numbers shown.")


def confirm(question: str, default: bool = True) -> bool:
    raw = ask(f"{question} [{'Y/n' if default else 'y/N'}] ").strip().lower()
    return default if not raw else raw.startswith("y")


def checklist(title: str, items: list[Item], selected: set[str]) -> set[str]:
    """Show items with [x]/[ ]; the user toggles by number. Returns the new selection restricted to these items."""
    ids = [i.id for i in items]
    sel = {i for i in selected if i in ids}
    while True:
        print(f"\n{title}")
        for n, it in enumerate(items, 1):
            mark = "x" if it.id in sel else " "
            star = "  <- start here" if it.star else ""
            note = f"  [needs {it.needs}]" if it.needs else ""
            print(f" {n:>2}. [{mark}] {it.title}{star}{note}\n        {it.desc}\n        Tokens: {it.tokens}")
        raw = ask("Type numbers to switch on/off (e.g. 2 5), a = all, n = none, Enter = keep as shown: ").strip().lower()
        if not raw:
            return sel
        if raw == "a":
            sel = set(ids)
        elif raw == "n":
            sel = set()
        else:
            try:
                for tok in raw.replace(",", " ").split():
                    it = items[int(tok) - 1]
                    sel.symmetric_difference_update({it.id})
            except (ValueError, IndexError):
                print("  Please type numbers from the list.")
