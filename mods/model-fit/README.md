# model-fit

Install (Claude Code 2.1.287 or later): `/plugin install model-fit --marketplace samuelbfernandes/codeUIstack`

Checks every prompt you type and tells you when your current model looks wrong for it, and which model to use instead. Nothing changes unless you pick it.

## What it does
- Every prompt is checked locally with keyword and size rules: no model call, zero tokens, instant. Slash commands, bare "yes/ok", and pasted tool output are skipped. A prompt the rules cannot place stays silent.
- Two risks, named plainly. UNDER-POWERED: "Don't use Sonnet for this task" (proofs, derivations, design, hard debugging, big refactors, statistical-method changes, review of method code, REML/GWAS/kinship/simulation, Rust unsafe/lifetimes). OVER-POWERED: "Opus is overkill for this" (typos, renames, formatting, simple lookups). The cues that matched are shown as the reason.
- Recommends the cheapest model predicted to be good enough, with a small table, for example `Haiku: weak, 1x; Sonnet: ok, 3x; Opus: best, 5x`. If you are on Fable, a cheaper model can be recommended for light or standard work; Fable is never a target.
- Review work (review, verify, falsify, audit a method change) is a third case even when your model is strong: the model that wrote the code should not approve it. If `codex --version` works, the dialog says "A different model (Codex) catches more than Opus reviewing its own work" and offers Keep or Ask Codex; the status line says `model-fit: review, Codex available`. Without Codex it only says your model fits.
- Always-on status line after every checked prompt: `model-fit: Opus fits`, `model-fit: overkill, Haiku would do (~5x cheaper)`, `model-fit: weak for this, use Opus`.
- **A mismatch at or above the confidence bar blocks the prompt and opens a dialog, every time.** No cooldown, no "already asked about this" memory, and dismissing dialogs never raises the bar. The dialog offers Keep (the default, so Enter changes nothing), Switch session, Run this task as a subagent (hidden if your prompt leans on the chat), and for review work Ask Codex for a read-only review (it spends Codex usage). Switching re-reads your conversation uncached; the dialog warns when it is over 20k tokens.
- **Esc does not send the prompt.** It is held, and your text is shown in the transcript so you can copy and resend it (set `onDismiss` to `send` if you prefer the old behaviour). The only ways the dialog stops asking are your own choices: "don't suggest again this session", `model-fit off`, or `enabled` = false.
- Ordinary (standard-tier) tasks are usually fine on Sonnet, so by default they only get a status-line hint. Set `askOnStandard` to true and they block too (a borderline or roomier-than-needed model).

## What the dialog looks like
```
Don't use Sonnet for this task
Deep task · proof or derivation, REML
Haiku 1x weak · Sonnet 3x weak · Opus 5x best
Opus is the cheapest model that should handle it. Costlier and slower.
```
Options: Keep Sonnet · Switch session to Opus · Run this task as a subagent on Opus · Keep and don't suggest again.

## Use
A small coloured pill (green `model-fit on`, red `model-fit off`) sits just above the prompt box (terminal and desktop; hide it with the `showButton` setting). Click it to switch checking on or off; it is the same switch as the words below and is remembered across sessions.

Type `model-fit` (status and last 5 checks), `model-fit off`, `model-fit on`. Only that exact text is handled; a prompt that merely mentions it goes to the model. `/model-fit [status|on|off|explain <text>]` also works; `explain` is a free dry run that prints the cues, the per-model ratings, costs and what it would do.

## No button?
The green (on) or red (off) label and its Turn off button are drawn by Claude Code in the band just above the prompt, on the terminal and in the desktop app (not VS Code or mobile). If it is missing: (1) run `sh install.sh status` and check model-fit is 0.3.1 or later, then `sh install.sh update`; (2) restart Claude Code or run `/reload-plugins`; (3) check `showButton` and `enabled` in `/config`; (4) the row hides while a dialog or survey is up and while another plugin's row is drawn there first; (5) run `claude --debug` and search the log for `ui.render (AbovePrompt)`, which names any refusal. The typed words `model-fit on` and `model-fit off` and the `model-fit: off` status line work without the band.

## Turn off
`model-fit off`, `enabled` = false in `/config`, or `/plugin disable model-fit`.

## Settings
`minConfidence` (0.6; a mismatch needs at least this much confidence to block), `askOnStandard` (false), `showButton` (true), `onDismiss` (`hold` or `send`), `minWords` (3; shorter prompts are ignored unless a strong rule matches), `statusLine` (true), `enabled`, `useClassifier` (false; when on, an unplaced prompt is sent once to haiku, which costs a small call). `costRatios` (`haiku=1,sonnet=3,opus=5`, `fable=` optional) is a rough ratio of list prices; it goes stale, so edit it. Bad pieces are ignored.

## Limits
- Ratings and verdicts are predictions from hand-written rules, not measured accuracy. Costs are rough ratios you maintain, not real prices. It is wrong sometimes; the tests only guard against regressions.
- Review work on a model that already fits (Opus) no longer opens a Codex dialog, since that is not a mismatch.
- Prompts are never saved; the last 5 checks keep a 50-character snippet in memory for the session. Only prompts you type are checked, not plugin or scheduled prompts. An error in the checker sends your prompt unchanged; only an answered or dismissed dialog holds it.
- Not verified live: the status line and dialog in a real session, the model switch, and anything on Windows (Codex there may need `codex.cmd` on PATH).
