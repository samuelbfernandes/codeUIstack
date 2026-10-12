---
name: dual-model-review
description: Independent, read-only, falsification-minded review of a change by the OTHER model (Codex or a fresh Claude), mandatory for genetics, statistics or method changes. Use after implementing, before commit, or when asked for a second opinion or theory review.
---

# Dual-model review

Two independent models exist so a second set of eyes catches implementation bugs and, above all, errors in the
genetic/statistical theory before they land. **The implementer is never its own reviewer.**

## When this applies
- Any change touching genetics or quantitative genetics (effects, architectures, selection, meiosis, variance
  partitioning, heritability, BLUP/GBLUP, any cited equation), a method, DAG semantics, or code generation.
- Whenever the user asks for a review, a second opinion, a theory review, or "check this".
- Not needed for pure docs/formatting changes. If unsure whether a change is "theory", treat it as theory.

## Protocol
1. **Freeze the change.** Identify the exact diff: `git diff --staged` or `git diff <base>...HEAD`. Note the files and the
   claim being made ("this implements equation X from <source>").
2. **Pick the reviewer, never yourself.**
   - **A push already triggers this automatically** for repos with `docs/THEORY_REVIEW.md` (or `git config toolkit.theoryPaths`):
     the global pre-push hook has Codex review the pushed diff read-only and blocks on FAIL. Use this skill for an
     earlier or deeper review, or where that hook is not active.
   - If the repo has `dev/dual.sh`, use it: `dev/dual.sh review --staged` (or `<paths>`). Read `dev/README.md` first.
   - Codex CLI (installed; flags checked against 0.162.0): read-only structured review of a diff:
     `git diff --staged | codex exec -s read-only --ephemeral -C <repo> --output-schema ~/.claude/codeuistack/global/theory-review.schema.json -o /tmp/review.json "<reviewer prompt>"`.
     Quick unstructured pass: `codex review --uncommitted` (or `--base <branch>`, `--commit <sha>`). `-s workspace-write` only in a
     throwaway worktree (`git worktree add ../_review <rev>`, `TMPDIR` inside it) when the reviewer must run R to get executed evidence.
   - If the Codex plugin is installed, `/codex:adversarial-review` with focus text also works. Never `/codex:rescue` (it edits files).
   - Else spawn a fresh read-only Claude subagent (no edit tools) with the prompt below.
   - If none of these is possible, **stop and say the change is UNREVIEWED**. Do not self-approve.
3. **Reviewer prompt** (adapt the bracketed parts; keep the adversarial framing):
   > You are an independent reviewer. You are READ-ONLY: do not edit, create or delete anything. Your job is to
   > FALSIFY, not to agree. For [the change], find the input that breaks the equation, the allele frequency / sample
   > size / edge case where the identity fails, the citation whose page or equation number is wrong, the place where
   > the code diverges from [spec/docs/THEORY_REVIEW.md]. Run code to get executed evidence where you can. Report
   > per rubric item: PASS / FAIL / UNVERIFIABLE, with `file:line` evidence and the primary source (title, year, verified
   > page/equation). Never invent a citation, page, or equation: if you cannot verify it, say UNVERIFIABLE. A review
   > that only confirms is a failed review.
4. **Rubric.** If `docs/THEORY_REVIEW.md` exists, the reviewer uses it item by item. Otherwise include at least:
   units and scaling; boundary frequencies (0, 0.5, 1); sample-size/degenerate cases; sign conventions; random-number
   handling and reproducibility (seeds drawn where?); whether stated assumptions (HWE, LE, additivity, infinitesimal)
   match what the code does; every cited equation traced to a verified primary source and page.
5. **Confirm the reviewer changed nothing:** `git status` and `git diff` after the review; remove the throwaway worktree.
6. **Objective gate regardless of opinions:** run the project's tests (`devtools::test()`, `R CMD check` for releases,
   `cargo test`/clippy). Green tests do not replace the review, and a green review does not replace tests.
7. **Resolve.** For each FAIL, fix (by the implementer, not the reviewer), then re-review the fix with the same reviewer
   until no FAIL remains. Record UNVERIFIABLE items in the PR text or `docs/DECISIONS.md` rather than hiding them.
8. **Report to the user:** reviewer used, items PASS/FAIL/UNVERIFIABLE, what changed as a result, tests result. Never
   mention the reviewer or yourself in commit messages (no AI attribution anywhere).

## Roles alternate
If Claude implemented, Codex (or a fresh subagent) reviews; if Codex implemented, Claude reviews. Per task, not per project.
