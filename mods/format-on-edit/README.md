# format-on-edit

Install: `/plugin install format-on-edit --marketplace samuelbfernandes/moddeck`

After Claude edits a file, formats just that file with the formatter your project already uses. Then Claude is told to
read the file again, so its next Edit is not made against text that has changed. It is **off until you turn it on**.

## What it does
After an Edit, Write or MultiEdit succeeds, and only when the switch is on:
- `.R` / `.r`: `air format <file>`
- `.py` / `.pyi`: `ruff format <file>`
- `.js .mjs .cjs .jsx .ts .tsx .css .scss .html .vue .json`: only when the project already uses a formatter.
  With a Prettier config (a `"prettier"` key in `package.json`, a `.prettierrc*` file or a `prettier.config.*` file)
  it runs `node_modules/.bin/prettier --write <file>`, or `prettier` from PATH if the project has no local copy.
  Otherwise, with `biome.json` or `biome.jsonc`, it runs `biome format --write <file>` (again, the local copy first).
  With neither, JS files are left alone.

It never changes the tool call itself. It runs after the edit and only adds a note to the result. If the file's
text changed, the note says `format-on-edit: <tool> reformatted <file>. Read it again before editing it.`. If the
formatter changed nothing, there is no note. Each formatter is checked once per session (`<tool> --version`). A
formatter that is not installed is skipped without a message. Each run may take up to 20 s.

It never touches files outside the session's folder (it resolves links first), or files under `node_modules`,
`.git`, `renv`, `.venv`, `dist` or `build`.

## Use
    /format-on-edit on       turn it on (remembered across sessions)
    /format-on-edit off      turn it off
    /format-on-edit status   on or off, files reformatted this session, which formatters were found

For a missing formatter, `status` says where to get it: Air at https://posit-dev.github.io/air/, Ruff at
https://docs.astral.sh/ruff/, jarl at https://github.com/etiennebacher/jarl. Prettier and Biome come from the
project's own devDependencies.

## Settings
`lint` (default off): also apply lint fixes before formatting, with `ruff check --fix <file>` for Python and
`jarl check <file> --fix` for R.

## Cost
No model calls. The note is one short line of context, added only when a file really changed.

## Turn off
`/format-on-edit off`, or `/plugin disable format-on-edit`.

## State for the moddeck side bar
`{ plugin: 'format-on-edit', key: 'isOff' }` (boolean, true while off, which is the default) and
`{ plugin: 'format-on-edit', key: 'formatted' }` (number of files reformatted this session).

## Programs it may start
`air`, `ruff`, `jarl`, `prettier`, `biome`, or the project's `node_modules/.bin/prettier` / `biome` (`.cmd` on Windows).
They are always started as argument lists, never through a shell. It uses no network.

## Limits and what was checked
- Tested with the plugin test kit and a mocked engine (`claude plugin test`): the switch, each language, the Prettier
  and Biome rules, the folder rules, the note, and failures leaving the result alone. It was **not** run against
  real Air, Ruff, jarl, Prettier or Biome, because none is installed on the machine where it was written.
- jarl's `check <file> --fix` form comes from jarl's README. Its `--version` flag is UNVERIFIED: any start that does
  not fail counts as found.
- Windows: the `.cmd` shims in `node_modules/.bin` are tried first, but this is UNVERIFIED. Whether the engine can
  start a `.cmd` file without a shell is untested.
- It formats the whole file, not only the lines Claude changed. If your project has not been formatted before, the
  first edit to a file can produce a large diff.
- The JS rules look only at the session's root folder (`package.json`, config files). A front end kept in a subfolder
  with its own Prettier config is not picked up.
