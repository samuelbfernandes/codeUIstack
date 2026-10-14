# suggest-model

Install (Claude Code 2.1.287 or later): `/plugin install suggest-model --marketplace samuelbfernandes/moddeck`

Checks every prompt you type and tells you when your current model looks wrong for it, and which model to use instead. Nothing changes unless you pick it.

## What it does
- Every prompt is checked locally with keyword and size rules: no model call, zero tokens, instant. Slash commands, bare "yes/ok", and pasted tool output are skipped. A prompt the rules cannot place stays silent.
- Two risks, named plainly. UNDER-POWERED: "Don't use Sonnet for this task" (proofs, derivations, design, hard debugging, big refactors, statistical-method changes, review of method code, REML/GWAS/kinship/simulation, Rust unsafe/lifetimes). OVER-POWERED: "Opus is overkill for this" (typos, renames, formatting, simple lookups). The cues that matched are shown as the reason.
- Recommends the cheapest model predicted to be good enough, with a small table, for example `Haiku: weak, 1x; Sonnet: ok, 20x; Opus: best, 40x`. If you are on Fable, a cheaper model can be recommended for light or standard work; Fable is never a target.
- Review work (review, verify, falsify, audit a method change) is a third case even when your model is strong: the model that wrote the code should not approve it. If `codex --version` works, the dialog says "A different model (Codex) catches more than Opus reviewing its own work" and offers Keep or Ask Codex; the status line says `suggest-model: review, Codex available`. Without Codex it only says your model fits.
- Effort-watch (setting `effortWatch`, on): the status line adds a note when the session's effort level does not fit the task, such as `effort max is more than this needs · /effort medium` for light or standard work, or `effort low may be too little for this · /effort high` for hard work. Advice only, never a dialog. The level is read from each model request; on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 changing effort keeps the prompt cache.
- Always-on status line after every checked prompt: `suggest-model: Opus fits`, `suggest-model: overkill, Haiku would do (~40x cheaper)`, `suggest-model: weak for this, use Opus`.
- **A mismatch at or above the confidence bar blocks the prompt and opens a dialog, every time.** No cooldown, no "already asked about this" memory, and dismissing dialogs never raises the bar. The dialog offers Keep (the default, so Enter changes nothing), Switch session, Run this task as a subagent (hidden if your prompt leans on the chat), and for review work Ask Codex for a read-only review (it spends Codex usage). Switching mid-session makes the new model re-cache the whole conversation (and again on the way back), which usually costs more than a cheaper model saves on a task or two. So when a task is merely overkill for your model and the context is over 20k tokens with a warm cache, Switch is not offered: the dialog offers a subagent (a fresh, small context) instead, or, when the prompt leans on the chat and no subagent fits, it does not ask at all and the prompt goes as typed. Switch comes back once the cache has gone cold, the context is small, or after `/clear`. A task too hard for your model still offers Switch, with the re-cache cost stated.
- **Esc does not send the prompt.** It is held, and your text is shown in the transcript so you can copy and resend it (set `onDismiss` to `send` if you prefer the old behaviour). The only ways the dialog stops asking are your own choices: "don't suggest again this session", `suggest-model off`, or `enabled` = false.
- Ordinary (standard-tier) tasks are usually fine on Sonnet, so by default they only get a status-line hint. Set `askOnStandard` to true and they block too (a borderline or roomier-than-needed model).

## What the dialog looks like
```
Don't use Sonnet for this task
Deep task · proof or derivation, REML
Haiku 1x weak · Sonnet 20x weak · Opus 40x best
Opus is the cheapest model that should handle it. Costlier and slower.
```
Options: Keep Sonnet · Switch session to Opus · Run this task as a subagent on Opus · Keep and don't suggest again.

## Use
The on/off switch is in the moddeck side bar (green `suggest on`, red `suggest off`; click it to flip). It is the same switch as `/suggest-model on|off` and is remembered across sessions.

`/suggest-model [status|on|off|explain <text>]`: status with the last 5 checks, the switch, and `explain` (a free dry run that prints the cues, the per-model ratings, costs and what it would do).

## Turn off
`/suggest-model off`, `enabled` = false in `/config`, or `/plugin disable suggest-model`.

## Settings
`minConfidence` (0.6; a mismatch needs at least this much confidence to block), `askOnStandard` (false), `onDismiss` (`hold` or `send`), `minWords` (3; shorter prompts are ignored unless a strong rule matches), `statusLine` (true), `enabled`, `useClassifier` (false; when on, an unplaced prompt is sent once to haiku, which costs a small call). `costRatios` (`haiku=1,sonnet=3,opus=5`, `fable=` optional) is a rough ratio of list prices; it goes stale, so edit it. Bad pieces are ignored.

## Limits
- Ratings and verdicts are predictions from hand-written rules, not measured accuracy. Costs are rough ratios you maintain, not real prices. It is wrong sometimes; the tests only guard against regressions.
- Review work on a model that already fits (Opus) no longer opens a Codex dialog, since that is not a mismatch.
- Prompts are never saved; the last 5 checks keep a 50-character snippet in memory for the session. Only prompts you type are checked, not plugin or scheduled prompts. An error in the checker sends your prompt unchanged; only an answered or dismissed dialog holds it.
- Not verified live: the status line and dialog in a real session, the model switch, and anything on Windows (Codex there may need `codex.cmd` on PATH).
