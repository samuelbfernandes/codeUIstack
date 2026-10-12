# What is in the toolkit (one page)

Everything installs once (everywhere, or in one project) and then works in every Claude Code session there. Most tools do nothing until
they have something useful to say. "Tokens" means what the tool costs you in model usage; "none" means it runs on your
computer only.

## The fourteen mods

A mod is a small add-on that changes Claude Code's own screen or behaviour. Turn any of them off with
`/plugin disable <name>` and back on with `/plugin enable <name>`.

| Mod | What it does for you | You will notice | Tokens | Type this (no "/" needed) |
|---|---|---|---|---|
| **blast-radius** | Before a risky shell command (delete, `git reset --hard`, `git clean`, force-push, `branch -D`, stash drop) it shows exactly what would be affected and **what you would lose**. For every folder it adds a **Folder risk** report: what the folder is (a repository, a build cache, your data, your home), size, how recently it changed, what git could restore, and a "Recoverable: yes / partly / no" line. | A question with a RISK level (HIGH / MEDIUM / LOW / UNKNOWN). The first answer is "cancel". | none | Nothing to type: it appears by itself. |
| **review-cost** | Before a `git push` triggers the automatic second-model review (see "Git guards"), shows what that review will cost in tokens: GREEN (small), AMBER (medium), RED (many). You choose **Review** or **Skip**. | Only when a review would run. GREEN shows one line and goes ahead. | none (it only estimates) | Nothing to type. Thresholds in `/config`. |
| **model-fit** | Checks **every prompt** against the model you are using. Says "Don't use Sonnet for this task" when the task looks too hard for it, or "Opus is overkill for this" when it is trivial, and recommends the model with the best predicted fit for the cost (a small table: fit and relative cost per model). For review requests it offers Codex, a different model than the one that wrote the code. | A status line after each prompt. On a clear mismatch the prompt is blocked until you answer the dialog (every time; Enter keeps your model, Esc holds the prompt). | none (local rules; optional small-model check is off) | An ON/OFF button above the prompt box, or `model-fit` (status), `model-fit off`, `model-fit on`. `/model-fit explain <text>` tests any text. |
| **branch-janitor** | Watches your branches by itself: after every prompt it takes one quick look at the repository, and when something changed (including a merge you did in a separate terminal) it checks whether a branch's work is finished (merged, squash-merged, merged pull request), that deleting it loses nothing, and **offers** to delete it. The remote copy is a separate second question. | A question after a merge, pull or push. It always prints how to restore the branch. | none | `branch-janitor` (list every branch and why), `branch-janitor clean`, `branch-janitor off`. |
| **cache-tax** | Claude's prompt cache goes cold after a pause, and the next message then re-writes the whole conversation at a higher price. It asks you **once** (Send anyway / Hold it) before such a message and shows the estimated price, only when the extra cost is at least 25 cents. | A small question after a long pause in a big conversation. | none (`/keepwarm` sends tiny pings: it costs tokens, so it is slash-only) | `cache-tax` (status). `/keepwarm 90m` keeps the cache warm. |
| **reflect** | Notices when you correct Claude ("no, in this repo we use ...", "from now on ...") and offers to save the rule to a `CLAUDE.md`. | A small band with Save / Global / Edit / Skip after a correction. | small (a corrected prompt goes once to a small model to extract the rule) | `reflect status`, `reflect off`, `reflect on`. |
| **savvy-progress** | Shows your plan's progress (a task bar) and what Claude's helper agents (subagents) are doing, nested as a tree, with estimated tokens and cost (always labelled "est."), and a **Stop** button on each running helper. | A band above the prompt once there is a task list or a helper has run. | none | `agents-info`, `agents tree` |
| **filetree** | A live folder tree beside the chat, with the files Claude is touching highlighted. Opens by itself at session start where the window has room (setting `autoOpen`). | A side panel. | none | `filetree` (toggle). Needs a wide window. |
| **replay-theater** | Replays what Claude changed in a session, edit by edit. After a turn that changed 3 or more files it shows a one-line hint (setting `turnHint`). | A short hint, at most once per 10 minutes. | none | `replay`. Records Claude's own edit tools, not edits made by shell commands. |
| **tool-skins** | Colour themes for how tool calls look. | Nothing until you pick one. | none | `skins` (list), `skin dracula` (seven themes). |
| **secret-guard** | Hides API keys, tokens, passwords and private keys from what Claude reads (file contents, command output), and asks before a prompt you type that contains one is sent. Emails stay visible unless you ask (`redactEmails`). | Nothing, it only removes text. A one-line note the first time it hides something. | none | `secret-guard` (counts, never the secrets), `secret-guard on|off`. |
| **budget-guard** | Keeps an eye on session cost, context fill and your plan window. Shows a quiet line only when one of them matters, and (if you set `limitUsd`) asks before the next prompt once the limit is reached. Never refuses a tool mid-turn. | A line above the prompt only when something is high; a dialog at the limit. | none | `usage` (report: cost, cache hits, context, turn times), `budget 10` (limit for this session). |
| **diagram** | Claude's ` ```mermaid ` answers show as raw text. This draws flowcharts, sequence diagrams and pie charts as box art in a pane. Offline. | A small "type diagram" hint after an answer with a diagram. | none | `diagram`, `diagram close`. |
| **aside** | A quick side question over your current context, shown in a pane and never added to the conversation. | A pane with the answer. | a little: one model call per question | `/aside <question>` (the plain word `aside` only explains). Off until you choose it in the installer. |

Typing one of these words alone as your whole prompt runs it on your computer without sending anything to Claude, so it costs
no credit. A prompt that merely contains the word is sent to Claude as usual. The `/name` forms still work.

There is also Anthropic's built-in **You Should Know** mod (enabled by the installer): short tips during long jobs.

## Skills (Claude loads them by itself when relevant)

| Skill | What it does |
|---|---|
| **dual-model-review** | When you change a model, equation or analysis, it makes a different model review the change read-only, trying to prove it wrong. Verdicts are PASS, FAIL or UNVERIFIABLE; the model that wrote the code never approves itself. |
| **agents-md-scaffold** | Sets up a new project with an `AGENTS.md` (the rules Claude reads first), a decisions log and a review rubric. |

A skill costs only its one-line description in each session until it is used.

## Git guards (global, run on every commit and push)

| When | What happens |
|---|---|
| `git commit` | Commits that include secret files (`.env`, private keys, `credentials.json`) are refused. |
| `git push` | Force-pushes and remote-branch deletions are refused. The project's tests run first (R: `devtools::test()`, Rust: `cargo test`). Pushing always needs your OK in Claude Code. |
| `git push` in a repo with `docs/THEORY_REVIEW.md` | A second model (Codex, if you have it) reviews the changed method code read-only. You see the estimated cost first (review-cost mod, or a Y/n question in a plain terminal). A FAIL blocks the push; UNVERIFIABLE is reported but allowed. |

Opt out for one repo: `git config --local toolkit.prepushTests false`, `git config --local toolkit.theoryReview false`.

## Profiles

- **neutral** (default): the generic safe rules above.
- **lab**: the author's lab set, for people who want it. Adds: no AI names or "Generated with" lines in commit messages,
  `CLAUDE.md` and `.claude/` are never committed, and the automatic theory review is on in repos that opt in.
  Pick it in the installer, or later with `codeuistack install --profile lab`.

## Built-in features and official plugins the installer can turn on

All optional, all shown in the installer's checklist with their token cost. Only Anthropic's own features and its official
plugin directory are ever installed: You Should Know tips, hardened settings (credential files unreadable by Claude's file
tools), the sandbox, telemetry off, rust-analyzer and Pyright diagnostics, security review, CLAUDE.md upkeep, code simplifier,
and the PubMed / bioRxiv / life-science connectors. Popular third-party projects are only ever *suggested*: see `SUGGESTIONS.md`.
