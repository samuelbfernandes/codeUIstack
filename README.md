# Moddeck

**Safety and productivity mods for Claude Code, built for scientists.**
Thirty-one small add-ons (mods), six skills and a set of git guards that protect your work, keep your token bill visible, and
stay quiet until they have something useful to say.

> **Credit where it is due.** Not everything here is my own creation. Some mods and skills are adapted from other people's
> ideas and guides, and some features already exist inside Claude Code or as
> Anthropic's official plugins: Moddeck simply switches them on and makes them easier to reach.
> Seven mods (staged-diff, contrast-check, table-preview, test-ledger, scope-watch, error-inbox, decision-log) are adapted from
> [whyashthakker/awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (MIT, © 2026 Yash
> Thakker and contributors), rewritten for moddeck; each keeps the original licence and says what changed in its README.

## Install

1. Make sure you have `pipx`, `git`, Python 3.9+ and Claude Code 2.1.287 or newer.
2. Run:

   ```bash
   pipx run --spec git+https://github.com/samuelbfernandes/moddeck@main moddeck install --standard
   ```

3. Start a new Claude Code session.

- **Look before installing:** add `--plan` (prints every change, then stops).
- **Pick items yourself:** drop `--standard` and answer a few questions.
- **Update:** click **Update now** when moddeck offers it, or run the same line with `update --scope user -y` instead of `install --standard`.
- **Remove:** run the same line with `uninstall`; it removes exactly what it installed.
- **Other ways** (uv, pip, conda, a clone, only the mods through `/plugin`): [docs/INSTALL.md](docs/INSTALL.md).

## The side bar

`/moddeck` opens one side bar for the whole toolkit:

- **Session**: model, effort, permission mode, context, plan usage with reset times, cost today and this week, cache, git
  branch, backup age, tokens, recent tools and your environment.
- **Side Question**: ask something without adding it to the chat.
- **Mods**, in grouped cards. A name is its switch: **green is on, red is off**, one click flips it. A gray name is a command
  that runs when clicked.
- **Skills and saved prompts**: click a `/name` to put it in the prompt box.

### In the Claude Code desktop app

1. Start a session: the side bar opens by itself beside the chat.
2. Type `/moddeck` to close or reopen it.
3. Using the app in light mode? Click ☀ at the top of the side bar (☾ for dark), or type `/moddeck theme light`.
4. Drag its edge to resize: text that does not fit ends in "…".

<p>
  <img src="docs/images/moddeck-desktop-top.png" width="49%" alt="moddeck side bar in the desktop app: the Session box, Side Question, Prompt helpers, Model controls and Guards">
  <img src="docs/images/moddeck-desktop-bottom.png" width="49%" alt="moddeck side bar in the desktop app: Automation, Workspace utilities, Skills and Prompts">
</p>

### In the terminal

1. Type `/tui fullscreen`.
2. Type `/moddeck`: the side bar docks on the right.

<p>
  <img src="docs/images/moddeck-terminal-top.webp" width="49%" alt="moddeck side bar in the terminal: Session, Side Question, Prompt helpers, Model controls and Guards">
  <img src="docs/images/moddeck-terminal-bottom.webp" width="49%" alt="moddeck side bar in the terminal: Automation, Workspace utilities and Skills">
</p>

## What is included

Commands always start with `/`; a word without the slash is an ordinary prompt. Turn any mod off with
`/plugin disable <name>`. Every tool has a page in [docs/TOOLS.md](docs/TOOLS.md).

### Mods

**Prompt helpers**
- `suggest-model`: suggests a cheaper or stronger model when your prompt calls for it, and flags an effort level that does not fit.
- `reflect`: offers to save a rule when you correct Claude (spends a few tokens).
- `tldr`: a switch, off until you turn it on; then each long reply gets a TL;DR box above the prompt (Summary, Needs you, Next) and its must-read sentences are drawn bold with ⚑ inside the reply. One Haiku call per long reply.
- `concise`: a switch, off until you turn it on; then Claude's replies lead with the next action, number the steps, restate where you are and leave tangents for later (adapted from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), MIT).
- `prompt-library`: `/prompts` keeps saved prompts per project, one click away in the side bar.

**Model controls**
- `command-guard`: before a risky command, shows exactly what would be lost, with **Cancel** first.
- `review-cost`: shows the token cost of a Codex review before a push.

**Guards**
- `secret-guard`: hides keys, tokens and passwords from what Claude reads.
- `scope-watch`*: `/scope-watch <folder>`; a note when Claude edits a file outside it.
- `data-guard`: asks before a commit holds large files, data files, personal-looking column names or notebook outputs.
- `big-file-guard`: reads only the first lines of a big csv, json or log.
- `repro-log`: `/repro` writes a re-runnable recipe of the session (commands, versions, seeds).

**Automation**
- `auto-test`: runs your tests after a turn that changed code (off until you switch it on).
- `long-run-ping`: a toast, sound and notification when a long run finishes.
- `format-on-edit`: formats each file Claude edits with Air (R), Ruff (Python), or the project's Prettier or Biome (off until you switch it on).
- `test-ledger`*: every test, lint and build run of the session with its result (R, Python, Rust and JS tools).

**Workspace utilities**
- `checkpoint`: `/checkpoint` snapshots your working tree; a restore shows what would change first.
- `branch-janitor`: notices a finished branch, checks it is safe, offers to delete it.
- `cache-guard`: warns before a message that would re-pay for a cold prompt cache.
- `usage-meter`: a quiet usage line and an optional spending limit.
- `progress`: a plan progress bar and a tree of helper agents with estimated cost.
- `filetree`: a live folder tree beside the chat.
- `edit-replay`: replays Claude's edits one diff at a time.
- `diagram`: draws Claude's mermaid diagrams as box art, offline.
- `staged-diff`*: the staged diff, before you commit.
- `error-inbox`*: the last 30 failed or refused tool calls, secrets scrubbed, with an "ask Claude" button.
- `decision-log`*: `/decision <text>` adds a dated row to `docs/DECISIONS.md`.
- `table-preview`*: `/table-preview data.csv` previews a table: delimiter, column types, first rows.

**UI development** (more in [docs/UI-DEV.md](docs/UI-DEV.md))
- `ui-preview`: runs the app in this project (plumber API first, then a JS dev server, Shiny, Streamlit), lists the
  plumber routes, takes a screenshot and asks Claude to review the page.
- `contrast-check`*: colour formats and WCAG contrast, with the nearest passing shade.

**Look and feel**
- `moddeck`: the side bar above.

\* adapted from [awesome-claude-code-mods](https://github.com/whyashthakker/awesome-claude-code-mods) (see the credit note above).

### Skills (Claude loads them by itself)

- `dual-model-review`: a second model tries to prove a change wrong.
- `agents-md-scaffold`: sets up `AGENTS.md`, a decisions log and a review rubric.
- `align`: interviews you before a big build, then writes a spec.
- `burst`: three independent versions of a text or idea, graded.
- `assess-plugin`: what a plugin installs, costs and risks, before you install it.
- `no-ai-text`: edits AI tells out of a draft and keeps the writer's voice (merged from no-ai-slop and humanizer, both MIT).

### Git guards and settings

- **Git guards**: refuse a committed `.env` or private key, and force-pushes, in every repository (or just one).
- **Push checks**: `git push` asks first; R and Rust projects run their tests before a push.
- **Hardened settings**: Claude's file tools cannot read SSH, cloud, GPG or `.env` files.
- **Claude Code's own features**, switched on for you if you tick them: You Should Know tips, the sandbox, telemetry off.
- **Anthropic's official plugins** (optional): Rust and Python diagnostics, security review, CLAUDE.md upkeep, code
  simplifier, PubMed, bioRxiv, Context7.
- **UI development extras** (optional, third-party, never on by default): Chrome DevTools MCP (pinned, usage statistics
  off), Posit's btw and mcptools for R, Posit's Shiny, Quarto and R-package skills, Plotly Cloud MCP, Anthropic's
  frontend-design. Pick them with `--with <id>`; the list and the programs to install yourself (Air, Ruff, jarl, the
  Shiny for Python, Streamlit, Gradio and Panel skills) are in [docs/UI-DEV.md](docs/UI-DEV.md).

## Try it

Work in a scratch repository so nothing real is at risk:

```bash
mkdir demo && cd demo && git init && claude
```

Then try any of these:

- **moddeck**: type `/moddeck` and click the green `suggest` name. It turns red (off) at once.
- **command-guard**: ask `create a folder build with a file a.txt, then delete the build folder`. A box shows the risk and what would be lost, with **Cancel** first.
- **suggest-model**: on Opus, type `fix the typo in the README title`. A dialog says Opus is overkill and suggests a cheaper model.
- **secret-guard**: type `my token is [secret:github-token], remember it`. A dialog offers to send it redacted.
- **data-guard**: run `echo "email,age" > people.csv && git add people.csv`, then ask Claude to commit. A dialog names the file and the column `email`.
- **checkpoint**: type `/checkpoint`, edit a file, then `/checkpoint restore <name>`. It lists the files that would change.
- **branch-janitor**: merge a finished branch into `main`, then send any prompt. It offers to delete the branch.
- **usage-meter**: type `/usage-meter 80`, then `/usage-meter` for the report.
- **diagram**: ask for `a mermaid flowchart of a GBLUP analysis`, then type `/diagram`.
- **Side Question**: type `/btw what is REML?`. The answer appears in the side bar, not in the chat.
- **Git guards**: run `echo KEY=1 > .env && git add .env && git commit -m test`. The commit is refused.

Each mod's own README (`mods/<name>/README.md`) has its settings and limits.

## Why you can trust the installer

- It shows the full plan first (`--plan`) and asks before applying.
- No network, no `sudo`, no third-party code unless you tick it in the UI development list: standard-library Python, checked by CI.
- `uninstall` removes exactly what it recorded and leaves your own settings alone.
- [docs/AUDIT.md](docs/AUDIT.md) lists, for every mod, the programs it starts and whether it writes files or spends tokens.
- [docs/SAFETY.md](docs/SAFETY.md) lists what it touches, what it never does, and the real caveats.

## Popular, but think twice

The installer never installs these. Each has a cost or catch worth reading first (sources and dates:
[docs/SUGGESTIONS.md](docs/SUGGESTIONS.md)).

- **obra/superpowers**: skills that trigger on their own; a bootstrap at every session start with no published token figure.
- **thedotmack/claude-mem**: automatic memory; runs model summaries of your tool use and stores them.
- **github/spec-kit, Fission-AI/OpenSpec**: spec-driven workflows; many manual steps, and OpenSpec has telemetry on by default.
- **ruvnet/ruflo, SuperClaude Framework**: agent swarms; large always-present instructions and background workers.
- **musistudio/claude-code-router**: routes requests across providers; built for API keys, and `suggest-model` does the cheap version.
- **openai/codex-plugin-cc**: Codex commands; its review gate reviews every reply and can drain usage limits.
- **wshobson/agents, davila7/claude-code-templates**: catalogs of 100+ agents and skills; browse, do not bulk-install.

Worth a look if you want them: trailofbits/claude-code-config, kenryu42/cc-safety-net, K-Dense-AI/claude-scientific-skills
(install a subset), ccusage and claude-hud / ccstatusline. posit-dev/skills is now an optional installer item (see above).
