# Contributing

Ideas, bug reports and new mods are welcome. For anything non-trivial, open an issue first so we agree on the direction.

- Adding a mod: read `docs/ADDING-A-MOD.md`. The bar is: small, no network, honest about token cost, tested.
- Changing the installer: it must stay standard-library only, and every change it makes must be reversible and shown by `--plan`.
  Add a test in `tests/` (they run against a throwaway home folder with a fake `claude`; they never touch your real files).
- Before opening a pull request: `bash scripts/check-all.sh`.
- Suggestions for `docs/SUGGESTIONS.md`: include the repository, what it does, what it costs in tokens as far as you can tell, and what
  would make you hesitate. We list popular projects honestly rather than promoting them.

Be kind. Assume good faith. Disagree with the idea, not the person.
