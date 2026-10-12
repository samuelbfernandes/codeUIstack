---
name: agents-md-scaffold
description: Bootstrap or audit a project's canonical AGENTS.md, gitignored CLAUDE.md pointer, commit-msg guard, decisions log and theory-review rubric, in the FernandesLab style. Use when starting a repo, or when a repo lacks AGENTS.md or its critical rules.
---

# AGENTS.md scaffold

The templates follow FernandesLab's strict rules (including "no AI attribution" and "never commit CLAUDE.md"). If the project's
owner wants different rules, adapt the matching lines instead of copying them blindly.

Goal: every project has ONE committed, canonical `AGENTS.md` (read by Claude Code, Codex and any agent) and a gitignored
`CLAUDE.md` that only points to it. Global rules live in `~/.claude/CLAUDE.md`; AGENTS.md restates the project-specific ones.

## Procedure
1. **Inspect, do not assume.** Detect: R package (`DESCRIPTION`), Rust (`Cargo.toml`, `src/rust`), webR/plumber app
   (`inst/app`), spec folders (`specs/`, `docs/adr/`), existing `AGENTS.md`/`CLAUDE.md`/`.githooks/`/`dev/`. If AGENTS.md
   exists, AUDIT it against the checklist below and propose edits; never overwrite it.
2. **Ask once** (single question, only what you cannot detect): project name, one-paragraph purpose, test gate command,
   and whether specs/ADRs are used.
3. **Write** (new files only, never clobber):
   - `AGENTS.md` from the template below, filled with detected facts. Keep it under ~220 lines.
   - `CLAUDE.md` (pointer) and make sure it is git-ignored.
   - `.gitignore` additions (append missing lines only).
   - `.githooks/commit-msg` from the global hook: copy `~/.claude/codeuistack/global/githooks/commit-msg` and `_lib.sh`
     if that path exists, then (with the user's OK) `git config core.hooksPath .githooks`.
   - `docs/DECISIONS.md` and `docs/THEORY_REVIEW.md` stubs when the project is scientific/method code.
4. **Never** commit anything yourself, never add AI attribution to any file, never invent decision IDs, citations or
   capabilities: placeholders say `TODO(maintainer)`.
5. Report what was created, what was skipped because it existed, and what still needs the maintainer.

## Audit checklist for an existing AGENTS.md
Critical rules present? (no AI attribution + hook; never commit CLAUDE.md/.claude; push only with OK, no force-push;
never push failing tests; no invented citations; backward-compat contract if any; spec-before-code if used.) Dual-model
section? Build & Test commands that actually run? Conventions? "Avoid" list? Locked-decisions table mirrored in
docs/DECISIONS.md? Length under limit?

## Template: AGENTS.md
```markdown
# AGENTS.md — <project>

> **Canonical, cross-tool project instructions.** Read at the start of every session (Claude Code, Codex, any agent).
> This file is **committed**. `CLAUDE.md` (gitignored) only points here. Keep under ~220 lines.

## Critical Rules (read first, every session)
1. **NEVER add `Co-Authored-By`, "Generated with ...", robot emoji or any AI/assistant attribution** to commits, PRs or
   files. Enforced by `.githooks/commit-msg`; do not bypass it.
2. **NEVER commit `CLAUDE.md`, `.claude/`, or anything in `.gitignore`.**
3. **Push to a remote ONLY with the maintainer's explicit OK**; never force-push without explicit authorization.
4. **NEVER push code that fails `<test gate>`.**
5. **Do not invent citations, page numbers, equations or capabilities.** Verify or mark UNVERIFIABLE.
6. TODO(maintainer): project-specific contractual rules (API compatibility, language boundaries, spec-first).

## Dual-model development
The implementer never reviews its own change; the other model reviews independently and read-only, trying to FALSIFY.
Every change touching methods/genetics/statistics gets a theory review against `docs/THEORY_REVIEW.md` before commit.
Objective gate: `<test gate>` green regardless of any reviewer.

## Project Overview
<purpose, where things live>

## Build & Test
<commands that actually run>

## Conventions
<git, language style, testing>

## Avoid
- Don't add AI attribution; don't commit CLAUDE.md / .claude/.
- Don't push without explicit OK; don't push a red gate.
- Don't invent citations/pages/equations; don't overclaim.
```

## Template: CLAUDE.md pointer (gitignored)
```markdown
Read ./AGENTS.md first: it is the canonical, committed instruction file for this project and wins over anything here.
```

## .gitignore additions
```
CLAUDE.md
CLAUDE.local.md
.claude/
```

## Template: docs/THEORY_REVIEW.md
```markdown
# Theory review rubric
Each item: PASS / FAIL / UNVERIFIABLE with file:line evidence and the primary source (title, year, verified page).
1. Equation <id>: matches source <TODO(maintainer)> p.<verified page>; units/scaling; sign convention.
2. Boundary cases: frequency 0, 0.5, 1; n = 1; zero variance; singular matrices.
3. Assumptions stated vs implemented (HWE, LE, additivity, infinitesimal, ...).
4. Reproducibility: where each random draw happens; seed handling; identical output for identical seed.
5. Citations: every cited equation/page verified, none invented.
```

## Template: docs/DECISIONS.md
```markdown
# Decisions log
| ID | Date | Decision | Rationale | Status |
|----|------|----------|-----------|--------|
| 001 | TODO | TODO(maintainer) | | proposed |
```
