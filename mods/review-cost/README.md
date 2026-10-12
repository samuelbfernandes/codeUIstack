# review-cost

Install (Claude Code 2.1.287 or later): `/plugin install review-cost --marketplace samuelbfernandes/moddeck`

The toolkit's git pre-push hook runs an automatic second-model review (Codex by default) of your pushed
diff. This mod shows the **estimated token cost first** and lets you choose **Review** or **Skip**. The level
is always a word: Green (small), Amber (medium), Red (many).

## Use
Nothing to type. When Claude runs `git push` where the review would run (`docs/THEORY_REVIEW.md` or
`git config toolkit.theoryPaths`), you see:
```
Codex review · about 36k tokens
● Amber  ▰▰▰▰▰▰▱▱▱▱  19k to 52k

1 file · 580 changed lines · about 34 KB
Largest: R/model.R +580 -0
Estimate, not a measurement.
Skip still pushes, marked UNREVIEWED.
Review with Codex before pushing?
```
Green only shows a one-line toast (`Codex review · about 4.1k tokens · Green`) and goes ahead.
Review is first for Green/Amber; Skip is first for Red, so Enter does not spend many tokens. Esc cancels the
push ("Push cancelled."). The choice reaches the hook via `git config --local toolkit.theoryDecision
<review|skip>:<seconds>` (valid 10 minutes). No files are written.

Switch it on or off while you work: `/review-cost on`, `/review-cost off`; `/review-cost` alone says which. Off means a push
is let through at once and nothing is estimated. The switch is remembered between sessions and mirrored in the shared state
value `review-cost.isOff` (boolean, default false), which the moddeck side bar reads with
`$.state.get({ plugin: 'review-cost', key: 'isOff' })`. An unknown word changes nothing.

Turn off completely: `/plugin disable review-cost`. Skip one review without this mod: `SKIP_THEORY_REVIEW=1 git push`.

## Settings
`greenMaxTokens` (25000), `redMinTokens` (60000), `askWhen` (`amber-red` or `always`), `inputUsdPerMTok` / `outputUsdPerMTok` (0 = no dollars; set both to add "About $0.10 at API prices"; nothing
is ever guessed), `coloredBanner` (on). Diff cap: `git config toolkit.theoryMaxBytes` (default 120000).

## Limits
- **The token numbers are a rule of thumb**, never measured against a live Codex run: prompt 1800 + diff/3.5
  tokens, a wide range. After 3 past reviews (`toolkit.theoryUsage`) the estimate is scaled by your history.
- Defaults: under ~16 KB Green, up to ~77 KB Amber, more Red; the 120000-byte cap tops out near 84k tokens.
- The question is plain text; a colored copy of the level line is drawn above it where the surface allows
  (`coloredBanner` off if it ever looks wrong).
- Detects `git push` (also `git -C dir push`, `cd x && git push`); not `bash -c "git push"`, aliases or
  scripts. `--dry-run`, branch deletions, `cd ~/x` and `$VAR` paths are left alone.
- Fails open: any error lets the push through unasked; a headless run is not asked.
- Not verified live: no session, no real Codex, nothing run on Windows (paths are handled as text, only
  `git` is spawned); how the dialog looks was only tested with a mocked engine.
