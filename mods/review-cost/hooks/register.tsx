// review-cost: before `git push` triggers the automatic second-model review, show what it
// is expected to cost (green / amber / red) and let the person choose Review or Skip.
//
// WHAT IT TOUCHES: nothing but git config. The choice is handed to the shell pre-push hook as
// `git config --local toolkit.theoryDecision <review|skip>:<epochSeconds>`; the hook honours it
// for 10 minutes and clears it. No files, no network, only `git` is spawned.
//
// FAIL OPEN: this is a convenience, never a gate. If anything here throws (a git call, the
// estimate, the dialog code) the `.catch` lets the push through untouched: `next(e)` is called
// exactly once on every path (when `next` had already been called the same `next(e)` replays
// that result instead of running the push twice). The ONE deliberate refusal is the person
// cancelling the question (Esc, dismissed dialog, free text): the push is denied with
// CANCEL_TEXT and they run it again. A headless run (no surface to ask on) is not asked.
import type { EngineInterface, Register } from 'claude-code'

import { findPush, joinPath } from './command'
import { readConfig } from './config'
import { estimate } from './estimate'
import type { Level } from './estimate'
import { ASK_HEADER, CANCEL_TEXT, askOptions, question, toastText } from './format'
import { planReview, writeDecision } from './git'
import type { Run } from './git'

const GIT_TIMEOUT_MS = 20_000
const BANNER = /^\u25CF (Green|Amber|Red)\b/

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const push = findPush(e.command)
    if (push === undefined || push.skipEnv) return next(e)
    if ((await $.env.get('SKIP_THEORY_REVIEW')) === '1') return next(e)

    const session = await safe(() => $.session.cwd())
    const dir = session === undefined ? push.dir : push.dir === undefined ? session : joinPath(session, push.dir)
    const run: Run = (argv, cwd) => $.process.run(argv, { cwd, timeoutMs: GIT_TIMEOUT_MS })

    const planned = await planReview(run, dir)
    if (!('plan' in planned)) return next(e) // no review would run: stay out of the way
    const { plan } = planned
    const est = estimate({
      diffBytes: plan.diffBytes,
      files: plan.files.length,
      reviewer: plan.reviewer,
      history: plan.history,
      thresholds: cfg.thresholds,
    })

    let choice: 'review' | 'skip'
    if (est.level === 'green' && !cfg.askAlways) {
      $.ui.toast(toastText(plan.reviewer, est), { timeoutMs: 6000 }) // small: no interruption
      choice = 'review'
    } else {
      const surfaces = await safe(() => $.session.surfaces())
      if (surfaces !== undefined && surfaces.length === 0) return next(e) // headless: no one to ask
      const answer = await ask($, question(plan, est, cfg.thresholds.redMin, cfg.prices), est.level)
      if (answer === undefined) return { deny: CANCEL_TEXT }
      choice = answer
    }

    const now = await $.clock.now()
    const isWritten = await safe(() => writeDecision(run, plan.root, choice, Math.floor(now / 1000)))
    if (choice === 'skip' && !isWritten) $.ui.toast('Could not record Skip. The review will run.', { timeoutMs: 8000 })
    return next(e)
  }).catch(($, e, next) => next(e))

  // The level line again, colored, above our dialog. A tree the surface cannot draw falls back
  // to the engine's own dialog, which still carries the level word and the bar in its text.
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (!cfg.coloredBanner) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const first = (e.props.questions[0] ?? {}) as { question?: unknown; header?: unknown }
    const text = typeof first.question === 'string' ? (first.question.split('\n')[1] ?? '') : ''
    const level = BANNER.exec(text)?.[1]
    if (first.header !== ASK_HEADER || level === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const color = level === 'Green' ? 'success' : level === 'Amber' ? 'warning' : 'error'
    return (
      <Box flexDirection="column">
        <Text bold color={color}>
          {text}
        </Text>
        {await next(e)}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}

/** The person's choice, or undefined for cancel / dismissed / free text. */
async function ask($: EngineInterface, text: string, level: Level) {
  const o = askOptions(level)
  try {
    const answer = await $.ui.ask(text, { options: o.options, header: ASK_HEADER })
    if (answer === o.review) return 'review' as const
    if (answer === o.skip) return 'skip' as const
    return undefined
  } catch {
    return undefined
  }
}

async function safe<T>(f: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}
