# Suggestions: popular add-ons that fit this toolkit

Nothing on this page is installed by the toolkit's installer. Each item is something you decide on. (The installer itself only ever turns on Anthropic's own built-in features and official plugins; see the README.)

**How it was checked (2026-10-09).** Star counts and descriptions come from each GitHub page as it loaded that day; versions
for `cc-safety-net`, `ccusage`, Codex and Claude Code come from npm. The interface-mod list below was cross-checked on 2026-10-12 against
three catalogue pages and two articles. Most pages do not state their token cost, so "cost" below is
reasoned from how the thing works, not measured. Release dates were mostly not shown on the pages.

**Filter used.** Repositories with thousands of stars; works on its own (hooks, settings, skills Claude loads when
relevant) rather than needing you to call it; few or no tokens; fits R/Rust and statistics work, a second model checking
method changes, and students sharing one setup. A skill costs its one-line description in every session; an MCP server
costs all its tool definitions in every session; a hook that runs local code costs nothing.

## Worth adding

| Repo (stars) | What it gives you | Why it fits | Cost / catch |
|---|---|---|---|
| **trailofbits/claude-code-config** (2.1k) | A reviewed `settings.json`: deny rules for credentials (SSH/GPG keys, cloud, registry tokens), `enableAllProjectMcpServers: false` (a cloned repo's `.mcp.json` cannot start servers on its own), telemetry off, hook examples blocking `rm -rf` and direct pushes to main. Its own advice: hooks are guardrails, not a security boundary; use `/sandbox` for real enforcement. | Students clone unfamiliar repos. A few lines of settings protect them with no runtime cost. Copy the lines you want; do not install it wholesale. | Nothing at runtime. Review each line before you merge it into `~/.claude/settings.json`. Without `/sandbox`, the deny rules only cover Claude's own file tools. |
| **kenryu42/cc-safety-net** (1.6k; npm 2.6.6) | A hook that parses what a command would do and blocks `git reset --hard`, `git push --force`, `rm -rf` on dangerous targets (even inside `bash -c`), and reads of SSH keys, `.env`, `~/.aws`. Presets Standard / Strict / Paranoid. | A hard stop, where `blast-radius` asks. Its secret-file protection is something the toolkit does not do. | No model tokens. Overlaps `blast-radius` on delete/reset: you get its block first. Third-party code runs on every command, so read it and pin a version. Install: `npx -y cc-safety-net@latest install`, then `doctor`. |
| **trailofbits/skills** (6.9k) | Security-minded skills Claude loads when relevant. Useful ones here: `differential-review` (review of a change using git history), `property-based-testing` (proptest, Hypothesis), `rust-review`, `mutation-testing`, `second-opinion` (reviews with Codex), `supply-chain-risk-auditor`. | They back the "a second reviewer tries to falsify" habit, and the Rust and testing ones match R/Rust work. | One description line per installed skill. Install only the plugins you want (`/plugin marketplace add trailofbits/skills`), not all ~40. `second-opinion` and `git-cleanup` overlap the toolkit's own `dual-model-review` skill and `branch-janitor` mod. |
| **K-Dense-AI/claude-scientific-skills** (48.2k) | 177 science skills, 32 in bioinformatics and genomics (BioPython, pysam, Scanpy, RNA-seq...), plus statistics, power and experimental design. | The closest thing to genetics-specific coverage that has the stars. | Its own README says to install a topical subset, because the catalog itself costs context. Pick 5-10 skills for your project. It does not install their Python dependencies. Verify any numbers a skill produces. |
| **jarrodwatts/claude-hud** (28.2k) *or* **sirmalloc/ccstatusline** (12.4k) | A status line with model, git branch, context usage, rate limits (claude-hud also shows running agents and todos). | Makes context and usage visible all the time, which is the cheapest way to stay in budget. Pick one. | claude-hud says it is local-only (no network). ccstatusline's usage widgets call Anthropic's API directly. Overlaps `savvy-progress` a little. Needs Node 18+. |
| **ryoppippi/ccusage** (18.9k; npm 20.0.26) | Reports of token use and cost from your local logs: daily, weekly, monthly, per session. A beta status line exists (`bunx ccusage statusline`). | Shows where your usage went. | Local only. You run it; it is not automatic apart from the beta status line. |
| **posit-dev/skills** (519; under the 1k-star filter, kept because it is the R specialist) | R package skills: `testing-r-packages`, `cran-extrachecks`, `r-package-development`, `lifecycle`, `cli`, plus review skills. | Matches testthat, roxygen2 and CRAN workflow. | One description line each. Install only the R ones. Read them for any instruction to commit or push, which the lab profile forbids. |
| **rust-analyzer-lsp** from Anthropic's official plugin list (37.6k repo) | Rust compiler diagnostics reach Claude right after an edit. | Fewer wasted retries on borrow and type errors. *From earlier research, not re-checked.* | Needs `rust-analyzer` on PATH. Diagnostic text enters context only when there are errors. |

## Popular, but think twice

| Repo (stars) | Why it is tempting | Why I would not add it by default |
|---|---|---|
| **obra/superpowers** (293k) | 15 skills that trigger on their own: test-driven development, systematic debugging, verification before completion, git worktrees, finishing a branch. Works with Codex. | It injects a bootstrap at every session start, and its page gives no token figure. It pushes a brainstorm-plan-execute workflow that competes with a project's own `AGENTS.md` rules. Try it on one project and watch `/context` before adopting. |
| **thedotmack/claude-mem** (97.2k) | Automatic memory across sessions through five hooks. | It runs AI summaries of your tool use (tokens against your plan), stores them locally in SQLite plus a search index, and the install asks for an email sign-in (can be skipped). Think hard before it records unpublished data. |
| **github/spec-kit** (139k) and **Fission-AI/OpenSpec** (66.9k) | Spec-driven workflows. | You invoke every step by hand, they add many prompts, and OpenSpec has anonymous telemetry on by default (`OPENSPEC_TELEMETRY=0`). Only worth it for a project that wants that process. |
| **ruvnet/ruflo** (74.2k) and **SuperClaude-Org/SuperClaude_Framework** (23.9k) | Agent swarms, routing, many commands and modes. | Large always-present instruction surfaces with no measured token cost. Ruflo runs background workers. Both overlap `suggest-model` and `reflect`. |
| **musistudio/claude-code-router** (37.3k) | A local gateway that routes requests across providers, with fallbacks and cost estimates. | Meant for people with API keys across providers. `suggest-model` does the cheap version (a suggestion on your own plan). |
| **openai/codex-plugin-cc** (32.7k) | Official Codex commands inside Claude Code. | Its review gate is a Stop hook that reviews every reply; its README warns it "may drain usage limits quickly". The toolkit's push-time review is the cheap alternative. The manual `/codex:adversarial-review` command is fine if you want it. |
| **wshobson/agents** (40.3k), **davila7/claude-code-templates** (30.8k) | Catalogs of 100+ agents, skills and hooks. | Browse, do not bulk-install. Each installed piece costs context. |
| **BloopAI/vibe-kanban** (28.1k) | Kanban board that runs coding agents on branches. | Its own page says it is sunsetting. |

## Read, do not install

- **hesreallyhim/awesome-claude-code** (53.1k): a curated list of hooks, skills and plugins. A good place to browse.
- **anthropics/skills** (177.5k): Anthropic's skill examples (documents, design, MCP builder). Good reading before writing a skill.
- **Piebald-AI/claude-code-system-prompts** (12.4k): the system prompts Claude Code sends, tracked per version.
- **disler/claude-code-hooks-mastery** (3.9k): working examples of all the hook events.

## What the toolkit built instead

| Need | Built here | Existing alternative |
|---|---|---|
| Cost of a Codex review before it runs | `review-cost` (estimates, asks, learns from your past runs) | None found with these controls |
| A better-fitting model for this prompt | `suggest-model` (local rules; switch, subagent or keep) | claude-code-router and ruflo route requests automatically; they need extra setup and cost |
| Delete a finished branch safely | `branch-janitor` | trailofbits `git-cleanup` skill (you invoke it) and superpowers' `finishing-a-development-branch` (part of its workflow) |

## Interface mods checked on 2026-10-12 (all small and new; patterns to learn from, not defaults)

Star counts are from the catalogue pages; most of these have almost none. None was installed or read line by line.

| Mod | What it does | Status in this toolkit |
|---|---|---|
| **secret-redactor** (ray-amjad) | Replaces secrets with placeholders before the model reads them | Rebuilt as `secret-guard` |
| **budget-guard**, **token-ledger**, **context-lens**, **quota-meter** (Arunjay4213) | Spending limit; cost, cache hits, context fill and plan windows as pinned lines | Merged into `budget-guard` (quiet line, optional limit, `usage` report) and the `cache-tax` report |
| **plan-progress** (zycck, 13 stars), **agent-flow**, **cctop** | Progress bars, a tree of subagents, a dashboard | Merged into `savvy-progress` (task bar, nested tree, tool counts) |
| **cache-keepalive** | Pings the cache every 50 minutes | Already covered by `/keepwarm`, which asks and shows the cost; `cache-tax` now only mentions it |
| **cc-pr-tracker**, **gh-ci-status** | Pull requests and CI runs pinned above the prompt (network) | Folded into the `branch-janitor` report when `gh` is there; open-PR branches are never offered for deletion |
| **claude-mermaid** | Mermaid blocks as box art | Rebuilt as `diagram` |
| **aside** (JayDoubleu) | A read-only side chat pane | Rebuilt as `/btw` inside the moddeck side bar (explicit, uses a little credit) |
| **time** (diegorv) | Shows when each message was sent | Turn durations are in the `usage` report instead |
| **terminal-browser** (zenbu-labs, 3.6k stars) | A Chromium pane beside the chat | Not added: a full browser is a wide reach, and the Claude desktop app already has a built-in browser |
| **Context7** (official marketplace) | Live, version-specific package docs | Offered as an optional official plugin in the installer (adds tool definitions to every session) |
| **whyashthakker pane pack** (70 panes, 1 star) | CSV Table, Log Viewer, Scope Watch, Read-only Mode and more | Not added; worth reading for ideas |
| **Mindful-Claude**, **cc-arcade**, **cc-pokedex** | Breathing band, games | Not added (fun, not usability) |
