# Moddeck

**Safety and productivity mods for Claude Code, built for scientists.**
Twenty-one small add-ons (mods), five skills and a set of git guards that protect your work, keep your token bill visible, and stay quiet until
they have something useful to say. Install everywhere or in a single project, tick only what you want, and undo it exactly.

> Status: first release, not yet used by anyone but its author. Written and tested without a live Claude Code session; see
> [what is verified](docs/SAFETY.md#6-what-has-not-been-verified).

## Start here: the tools most people will want

These are the author's picks, chosen for how often the problem they solve comes up. They are editorial, not usage data.

| Tool | The problem | What you see |
|---|---|---|
| **blast-radius** | An `rm -rf` or `git reset --hard` is one keystroke from losing a week of work | Before a risky command: exactly what would be lost (uncommitted changes, untracked and ignored files, unpushed commits), a **Folder risk** report (what the folder is, how big, how recent, what git could restore, recoverable yes / partly / no), a risk level, and **Cancel** as the first answer |
| **cache-tax** | After a pause, Claude's prompt cache goes cold and the next message silently costs much more | One stop before such a message with the estimated price; `/keepwarm` (costs tokens, so it is explicit) keeps the cache warm |
| **suggest-model** | A typo fix does not need your strongest model; a proof or a hard bug does | Every prompt is checked. On a clear mismatch the prompt is held and a dialog opens: "Don't use Sonnet for this task" or "Opus is overkill", with a fit-and-cost table and the model it recommends (switch, run as a subagent, or keep going). A status line shows the verdict each time |
| **branch-janitor** | Dozens of finished branches pile up, and deleting the wrong one hurts | It watches by itself, even for merges done in another terminal: "this branch looks finished, nothing would be lost, delete it?" with the command to restore it. The remote copy is a separate question |
| **review-cost** (Codex users) | An automatic second-model review before a push is great until you see the bill | A green / amber / red estimate of the review's tokens and a Review / Skip button |
| **secret-guard** | An API key or token in a file Claude reads, or in a prompt you paste, goes to the model | Secret-looking text is replaced by a placeholder before Claude sees it; a typed prompt with a secret asks first |
| **budget-guard** | A long session quietly runs up a bill, or the context fills | A quiet usage line that appears only when cost, context or your plan window matters; an optional spending limit that asks |
| **data-guard** | In a scratch repo `echo "email,age" > people.csv && git add people.csv`, then ask Claude to `git commit -m test` | A dialog naming the data file and the personal-looking column `email` (names only, never values) with **Hold it / Commit anyway / Fix it** |
| **big-file-guard** | Put a csv over 256 KB in the folder and ask Claude to read it. Then `/big-file-guard` | Claude gets the first 200 lines plus a note; the word shows tokens saved |
| **repro-log** | Ask Claude to run a Python script, then type `/repro` | A file in `.moddeck/repro/` with the commands, versions and seeds |
| **auto-test** | `/auto-test on`, ask Claude to edit a file in a project with tests | "auto-test · passed" or "FAILED" with the last lines of the output |
| **prompt-library** | Type `/prompts add eda | Profile this dataset`, then click it in the side bar | The text appears in the prompt box, not sent |
| **checkpoint** | Edit a file, type `/checkpoint`, edit it again, then `/checkpoint restore <name>` | A dialog listing the files that would change, with **Snapshot first, then restore** first |
| **long-run-ping** | `/long-run-ping test` | A toast, a sound and a notification |
| **Git guards** | A `.env` or a private key committed, a force-push to main | Refused at commit or push, in every repository (or just one) |
| **Hardened settings** | A cloned repo or a prompt-injected page tries to read your SSH keys | Claude's file tools cannot read SSH, cloud, GPG, registry or `.env` files (shell commands need the sandbox option) |

Everything else (`reflect`, `savvy-progress`, `filetree`, `replay-theater`, `tool-skins`, `diagram`) is in [docs/TOOLS.md](docs/TOOLS.md), one page on every tool.

## Install

Look first, then decide. Nothing changes until you confirm.

```bash
pipx install git+https://github.com/samuelbfernandes/moddeck@v0.4.1
moddeck install --plan     # prints every change it would make, then stops
moddeck install --standard # one line, no questions: the recommended set (or --all: every mod, rule and guard)
moddeck                    # asks a few questions, shows the plan, applies it
```

Or from a clone: `git clone https://github.com/samuelbfernandes/moddeck && cd Moddeck && sh install.sh` (Windows: `install.cmd`).
Only the mods, inside Claude Code: `/plugin marketplace add samuelbfernandes/moddeck`, then `/plugin install <mod>@moddeck`.
Other routes (uv, pip, conda, a plain download, or only the mods through Claude Code's own `/plugin` command) are in
[docs/INSTALL.md](docs/INSTALL.md). You need Claude Code 2.1.287 or newer, `git`, and Python 3.9+ (not for the plugin-only route).

**You choose where:** *everywhere* (every Claude Code session on your computer) or *one project* (only that folder, only on your
computer, nothing added to its git history).

**You choose what:** three checklists, each item with its token cost. Items that need something you do not have start unticked: no
Codex means no `review-cost` and no second-model review; no `rust-analyzer` means no Rust diagnostics.

**It turns on Claude Code's own features for you:** You Should Know tips, hardened settings, the sandbox, telemetry off, and
Anthropic's official plugins (Rust and Python diagnostics, security review, CLAUDE.md upkeep, code simplifier, PubMed, bioRxiv).
On by default: You Should Know and hardened settings (plus the Rust and Python diagnostics when those tools are found). Everything else is off until you tick it, and only Anthropic's own things are ever installed.

## Why you can trust the installer

- It shows the full plan first (`--plan`) and asks before applying.
- No network, no `sudo`, no shell strings, no third-party code: standard-library Python, about 1,300 lines, checked by CI.
- `uninstall` removes exactly what it recorded and leaves your own settings and text alone (tested byte for byte).
- `docs/AUDIT.md` lists, for every mod, the programs it starts, whether it writes files or spends tokens: network use is none.
- Releases come with checksums, and `moddeck verify` compares your install to the package.

Read [docs/SAFETY.md](docs/SAFETY.md): what it touches, what it never does, and the real caveats (global git hooks run on every
commit; Codex sends code to OpenAI when you enable it).

## The twenty-one mods

| Mod | One line |
|---|---|
| `moddeck` | A side bar with a live Session box (model, context, plan usage, cost, cache, git, backup, tokens, activity, environment), a **Side Question** panel (`/btw`) right under it, every mod in grouped cards (a switch is the mod's name, green on and red off: click it), the skills and saved prompts with a scroll bar, and an update check |
| `blast-radius` | Asks before risky commands and shows what you would lose |
| `cache-tax` | Warns once before a message that would re-pay for a cold prompt cache |
| `suggest-model` | Suggests a cheaper or stronger model when your prompt clearly calls for it |
| `branch-janitor` | Notices a finished branch, verifies it is safe to delete, offers to delete it |
| `review-cost` | Shows the token cost of a Codex review before a push |
| `reflect` | Offers to save a rule when you correct Claude |
| `savvy-progress` | Plan progress bar, and what helper agents are doing (as a tree) with estimated cost |
| `filetree` | A live folder tree beside the chat |
| `replay-theater` | Replays Claude's edits one diff at a time |
| `tool-skins` | Colour themes for tool calls |
| `secret-guard` | Hides keys, tokens and passwords from what Claude reads |
| `budget-guard` | A quiet usage line and an optional spending limit |
| `diagram` | Draws Claude's mermaid diagrams as box art, offline |
| `data-guard` | Asks before a commit holds large files, data files (csv, parquet, rds…), personal-looking column names, or notebooks with outputs (it can strip them) |
| `big-file-guard` | Reads only the first lines of a big csv, json or log, so it costs fewer tokens |
| `repro-log` | `/repro` writes a re-runnable recipe of what the session ran (commands, versions, seeds, files) |
| `auto-test` | Runs your tests after a turn that changed code and shows pass or fail (off until you switch it on) |
| `prompt-library` | `/prompts`: saved prompts per project, one click in the side bar |
| `checkpoint` | `/checkpoint`: safety snapshots of your working tree; restoring shows what you would lose first |
| `long-run-ping` | A toast, sound and notification when a long turn or command finishes |

**Commands always start with `/`.** Everything that costs no credit runs by itself, and the rest is a `/command` (`/branch-janitor`, `/suggest-model`, `/cache-tax`, `/agents-info`, `/replay`, `/filetree`, `/budget-guard`, `/secret-guard`, `/diagram`, `/moddeck`, `/data-guard`, `/big-file-guard`, `/repro`, `/auto-test`, `/prompts`, `/checkpoint`, `/long-run-ping`), also one click away in the moddeck side bar. A bare word without the slash is an ordinary prompt. See [docs/TOOLS.md](docs/TOOLS.md).

Skills: `dual-model-review` (a second model tries to prove a change wrong), `agents-md-scaffold` (sets up `AGENTS.md`, a decisions log, a review rubric), `align` (interviews you before a big build, then writes a spec), `burst` (three independent versions of a text or idea, graded) and `assess-plugin` (what a plugin installs, costs and risks, before you install it).
Turn any mod off with `/plugin disable <name>`.

## Try each item (about a minute each)

Open Claude Code in a **scratch git repository** (`mkdir demo && cd demo && git init`) so nothing real is at risk. `/commands` are answered on your computer and never sent to Claude, so they cost nothing (except `/btw` and `/keepwarm`).

### Mods

| Item | Try this | You should see |
|---|---|---|
| **moddeck** | Type `/moddeck` (wide window or desktop app), click the green `suggest` name, then click `[clean]` on the `branch-janitor` line. Drag the pane narrower | A side bar: Session, then Side Question, then the mod cards. `suggest` turns red (off) at once; `/branch-janitor clean` appears in the prompt box, not sent. One card under the other; narrow, descriptions end in "…" |
| **blast-radius** | Ask Claude: `create a folder build with a file a.txt, then delete the build folder` | Before `rm -rf build`: a box with the risk level, what is in the folder, what git could restore, "Recoverable: yes / partly / no", and **Cancel** as the first answer |
| **cache-tax** | In `/config` set `cacheTtlMinutes` to 1, chat a little, wait two minutes, send anything. Then type `/cache-tax` | A small dialog "Cache went cold · this message ~$X (warm: ~$Y)" with **Send anyway / Hold it**; the word shows hit ratio, last turn and cold-write spend |
| **suggest-model** | On Sonnet type: `derive the BLUP variance of the genomic breeding value under REML`. On Opus type: `fix the typo in the README title` | A dialog "Don't use Sonnet for this task" or "Opus is overkill for this" with a fit-and-cost table. Also: a green **suggest-model on** chip above the prompt; `suggest-model off` / `suggest-model on` / `suggest-model explain <text>` |
| **branch-janitor** | `git checkout -b demo`, commit a file, then in another terminal `git checkout main && git merge demo`. Send any prompt in Claude Code | "Delete 1 finished branch?" with the command to restore it. Type `/branch-janitor` for the list (with `gh`: open pull requests and their checks) |
| **review-cost** | Needs Codex. In a repo with a `docs/THEORY_REVIEW.md` file, change a method file and ask Claude to `git push` | A green / amber / red estimate of the review's tokens with **Review / Skip** |
| $ **reflect** | Tell Claude: `no, in this repo we always use tabs, never spaces` | A small band "Reflect" with the rule and **Save / Global / Edit / Skip** (saves to `CLAUDE.md`) |
| **savvy-progress** | Ask: `use two subagents to list the files in src/ and in tests/ in parallel`. Then type `/agents-info` and `/agents-info tree` | A band with a task bar `▰▰▱ 2/3 tasks` and the running helpers with a **Stop** button; the words print a report and the nested helper tree |
| **filetree** | Type `/filetree` (wide window), then ask Claude to edit a file | A folder tree beside the chat, the touched file highlighted. `/filetree` again closes it |
| **replay-theater** | Ask Claude to change three files in one turn, then type `/replay` | A one-line hint after the turn; the word opens a pane that steps through each edit as a diff |
| **tool-skins** | Type `/skin`, then `/skin dracula` | The theme list, then tool calls drawn in the Dracula colours (`/skin noir` is the default look; `/plugin disable tool-skins` removes the restyling) |
| **secret-guard** | Type: `my token is ghp_0123456789abcdefghijklmnopqrstuvwxyz, remember it` (a made-up token). Then type `/secret-guard` | A dialog "Send redacted / Send as typed / Hold it". The word shows how many secrets were hidden, by kind, never the secrets |
| **budget-guard** | Type `/budget-guard 80` (ask once any plan window reaches 80/100 used; `/budget-guard $10` for a dollar limit with an API key), chat, then type `/budget-guard` for the report | A usage line appears above the prompt only when cost, context or your plan window gets high; at the limit one dialog asks **Continue (+50%) / Continue without limit / Hold it**. The word prints cost, tokens, cache hits and turn times |
| **diagram** | Ask: `explain the steps of a GBLUP analysis as a mermaid flowchart`, then type `/diagram` | A toast "/diagram to see it"; the command opens a pane with the flowchart drawn as boxes and arrows. `/diagram close` closes it |

### Skills (Claude loads them by itself)

| Item | Try this | You should see |
|---|---|---|
| **dual-model-review** | Ask: `I changed the variance component equation in R/vc.R, review the change with a second model` | A read-only review by a different model with a verdict: PASS, FAIL or UNVERIFIABLE |
| **agents-md-scaffold** | Ask: `set up AGENTS.md for this project` | `AGENTS.md`, a decisions log and a review rubric are created |
| **align** | Ask: `align with me before we build a data portal` | A few numbered questions at a time, a five-line plan to confirm, then `SPEC.md` and a paste-ready line for a fresh session |
| **burst** | Ask: `burst three titles for my paper on genomic prediction` | Three independent versions, each graded against the goal, and one recommended |
| **assess-plugin** | Ask: `assess the plugin obra/superpowers before I install it` | What it installs, what it costs each turn, whether it is safe and whether you need it; nothing is installed |

### Rules, git guards and settings

| Item | Try this | You should see |
|---|---|---|
| **Global rules** | Open `~/.claude/CLAUDE.md` | A block between `BEGIN moddeck` and `END moddeck` markers; your own text above and below is untouched |
| **Git guards** | `echo KEY=1 > .env && git add .env && git commit -m test`, then `git push --force` | The commit is refused (secret file staged) and the force-push is refused |
| **Claude asks before git push** | Ask Claude to push, or to commit with `--no-verify` | Every `git push` asks for your OK; `--no-verify` is denied |
| **Run tests before push** | In an R package or a Cargo project, `git push` | `devtools::test()` or `cargo test` runs first; a failure stops the push |
| **Second-model review at push** | Needs Codex and a `docs/THEORY_REVIEW.md` file in the repo; `git push` after changing method code | Codex reviews the diff read-only before the push (the review-cost box shows the price first) |
| **Hardened settings** | Ask Claude: `read ~/.ssh/id_rsa` | The read is denied; `.env`, cloud and GPG files are denied too |
| **Sandbox** (off by default) | Ask Claude to write a file outside the project folder | Blocked by Claude Code's own sandbox |
| **Telemetry off** (off by default) | Open `~/.claude/settings.json` | `DISABLE_TELEMETRY` and `DISABLE_ERROR_REPORTING` are set |
| **You Should Know** (Anthropic, built in) | Run a long task | A short "Heads up" appears when something you may have missed turns up |

### Official plugins (installed only if you tick them)

| Item | Try this | You should see |
|---|---|---|
| **Rust diagnostics** | Introduce a borrow error in a `.rs` file and let Claude edit it | The compiler error reaches Claude right after the edit |
| **Python type checking** | Introduce a type error in a `.py` file | Pyright diagnostics reach Claude after the edit |
| **Security review** | Ask Claude to write `eval(input())` into a file | A warning about the risky pattern |
| **CLAUDE.md upkeep** | Ask: `audit my CLAUDE.md` | A review with suggested improvements |
| **Code simplifier** | Ask: `simplify src/helpers.R without changing behaviour` | A tidier version of the file |
| **PubMed / bioRxiv / bio-research** | Ask: `search PubMed for genomic prediction in wheat` (or `recent bioRxiv preprints on GBLUP`) | Papers with titles and links |
| **Context7** | Ask: `use context7 to check the current arguments of data.table::fread` | The current documentation, fetched live |

Each mod's own README (`mods/<name>/README.md`) has its settings and limits. Everything above was written and tested without a live
Claude Code session; if something does not look like this, please open an issue.

## Popular, but think twice

The installer never installs these. They are popular, and each has a cost or catch worth reading before you decide
(fuller table with sources and dates: [docs/SUGGESTIONS.md](docs/SUGGESTIONS.md)).

| Project | Why it tempts | Why to think twice |
|---|---|---|
| obra/superpowers | Skills that trigger on their own: test-driven development, debugging, verification | A bootstrap at every session start with no published token figure, and a workflow that can compete with your project's own rules. Try it on one project first |
| thedotmack/claude-mem | Automatic memory across sessions | Runs model summaries of your tool use (tokens) and stores them; think hard before it records unpublished data |
| github/spec-kit, Fission-AI/OpenSpec | Spec-driven workflows | Many manual steps and prompts; OpenSpec has telemetry on by default |
| ruvnet/ruflo, SuperClaude Framework | Agent swarms, many commands and modes | Large always-present instructions, no measured token cost, background workers |
| musistudio/claude-code-router | Route requests across providers | Built for API keys across providers; `suggest-model` does the cheap version |
| openai/codex-plugin-cc | Codex commands in Claude Code | Its review gate reviews every reply and warns it can drain usage limits |
| wshobson/agents, davila7/claude-code-templates | Catalogs of 100+ agents and skills | Browse, do not bulk-install: each piece costs context |

Worth a look, installed by you if you want them: trailofbits/claude-code-config (a reviewed settings file), kenryu42/cc-safety-net
(hard blocks on destructive commands), K-Dense-AI/claude-scientific-skills (science skills; install a subset),
posit-dev/skills (R packages), ccusage and claude-hud / ccstatusline (usage and status line).

## Make it yours

Add a mod: [docs/ADDING-A-MOD.md](docs/ADDING-A-MOD.md). The installer, the marketplace list, the audit and CI pick it up from the folder.
Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md). Licence: MIT.
