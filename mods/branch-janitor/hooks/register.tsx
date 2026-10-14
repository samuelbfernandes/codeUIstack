// branch-janitor: notices when the work a git branch was made for is done, verifies the branch can go
// without losing anything, and OFFERS to delete it. Nothing is deleted without a confirmation click; the
// remote copy is a second, separate question.
//
// WHEN IT LOOKS, in order of how much it costs:
// 1. Every prompt the person sends (`prompt.submit`). The hook itself does nothing but start a timer; the timer
//    runs ONE bounded `git for-each-ref` probe and compares its fingerprint with the last one looked at in this
//    session. Unchanged: that is all. Changed, or the session's first prompt: the full look below. So a merge done
//    in a plain terminal outside Claude Code is noticed on the next prompt, and nothing else costs anything.
// 2. After Claude's own git commands and a moment after session start (below).
// The Bash path: the types have no "after a tool ran" event, so the Bash hook below is a `tool.call` hook
// that calls `next(e)` first (the command runs and its result comes back) and only then looks. It returns the
// result object it got, untouched: it never alters, delays-on-purpose or denies the user's command.
// A finished `git merge`, `git pull`, `git checkout|switch <branch>`, `gh pr merge`, `git push`,
// `git fetch --prune` and `git remote prune` qualify (a failed command, `isError`, does not).
// At session start the `session.start` event schedules one look a moment later, once the screen is up.
//
// HOW THE QUESTION IS HELD OPEN: `$.ui.ask` is a `$` call, and a hook's 10 s budget does not run while a `$`
// call is in flight (HookBudget in the API types), so the dialog can wait as long as the person likes.
//
// FAIL-OPEN. Every failure here (a git probe, the dialog, a thrown error, the budget) ends in "pass the
// Bash result / the prompt through unchanged": the `.catch` replays `next(e)`. This mod is a convenience, never
// a gate.
import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { readSettings } from './config'
import { lookAndOffer, noteGhUse, runCommand, watchPrompt } from './janitor'
import type { Deps, Look } from './janitor'
import { triggerOf, usesGh } from './trigger'

const askingSince = { plugin: 'branch-janitor', key: 'askingSince' } as const
const hasGhRef = { plugin: 'branch-janitor', key: 'hasGh' } as const
const memoryRef = { plugin: 'branch-janitor', key: 'memory' } as const
const watchingRef = { plugin: 'branch-janitor', key: 'watching' } as const

const START_DELAY_MS = 3_000
const PROMPT_DELAY_MS = 300 // the prompt is in and its turn started before the probe runs
const STALE_LOCK_MS = 30 * 60_000 // a lock older than this is a dialog that died with a reload
const WATCHING_NOTICE = 'Watching branches · /branch-janitor to list them'
const FAILED = 'Branches · something went wrong. Nothing was changed.'

export const register: Register = (on, options) => {
  const settings = readSettings(options)

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // Remember that gh is used here (one cheap git call, only for a gh command): it unlocks the pull-request lines.
    if (usesGh(e.command)) await quietly(async () => noteGhUse(depsOf($, settings), await $.session.cwd()))
    const look = triggerOf(e.command)
    if (look === undefined) return next(e)
    const ran = await next(e)
    const result = ran.result as { interrupted?: boolean } | undefined
    const succeeded = ran.deny === undefined && ran.isError !== true && result?.interrupted !== true
    if (succeeded) await lookIfPossible($, settings, look)
    return ran
  }).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await quietly(() => registerCommand($))
    if (e.isInteractive) await quietly(() => syncOff($)) // only a session with a screen shows the switch
    if (e.isInteractive) $.clock.after(START_DELAY_MS, () => void lookIfPossible($, settings, 'start'))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    // Only the person's own words: not a notification, a schedule, another plugin or a peer session.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)
    // Nothing is awaited here: the probe (and any look) runs from a timer after the prompt has gone in.
    $.clock.after(PROMPT_DELAY_MS, () => void watchIfPossible($, settings))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'branch-janitor' }, async ($, e) => {
    const text = await runCommand(depsOf($, settings), await $.session.cwd(), e.args.trim().toLowerCase())
    await quietly(() => syncOff($)) // on, off, or the dialog's "never" may have changed it
    return { text }
  }).catch(() => ({ text: FAILED }))
}

/** Off for this repository (`git config toolkit.branchJanitor false`): the moddeck switch reads it; null outside a repository. */
const isOff = atom({ plugin: 'branch-janitor', key: 'isOff' } as const, null as boolean | null)

async function syncOff($: EngineInterface): Promise<void> {
  const cwd = await $.session.cwd()
  const inRepo = await $.process.run(['git', '-C', cwd, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 5_000 })
  if (inRepo.exitCode !== 0) return void (await update($, isOff, () => null))
  const r = await $.process.run(['git', '-C', cwd, 'config', '--get', 'toolkit.branchJanitor'], { timeoutMs: 5_000 })
  await update($, isOff, () => r.stdout.trim() === 'false')
}

const hasSurface = async ($: EngineInterface) => (await $.session.surfaces()).length > 0

/** The per-prompt watch: only where a person can be asked, and any error is swallowed. */
async function watchIfPossible($: EngineInterface, settings: Deps['settings']): Promise<void> {
  await quietly(async () => {
    if (!(await hasSurface($))) return // headless: nobody to ask, so not even the probe
    const deps = depsOf($, settings)
    await watchPrompt(deps, await $.session.cwd())
  })
}

function registerCommand($: EngineInterface) {
  return $.command.register({
    name: 'branch-janitor',
    description: 'Tidies finished git branches. Runs by itself, or run /branch-janitor. You run this, not Claude.',
    argumentHint: '[clean|on|off]',
  })
}

/** The automatic look: only where a person can be asked, and any error is swallowed. */
async function lookIfPossible($: EngineInterface, settings: Deps['settings'], look: Look): Promise<void> {
  await quietly(async () => {
    const surfaces = await $.session.surfaces()
    if (surfaces.length === 0) return // headless: nobody to ask
    await lookAndOffer(depsOf($, settings), await $.session.cwd(), look)
  })
}

function depsOf($: EngineInterface, settings: Deps['settings']): Deps {
  return {
    settings,
    run: (argv, o) => $.process.run(argv, { cwd: o?.cwd, timeoutMs: o?.timeoutMs, stdin: o?.stdin }),
    ask: (question, o) => $.ui.ask(question, { options: o.options, header: o.header }),
    toast: text => {
      $.ui.toast(text, { timeoutMs: 20_000 })
      // The toast fades; the restore commands stay in the transcript, one `$.ui.log` call per line so each can be
      // copied (a newline inside one call draws as a stray glyph).
      for (const line of text.split('\n')) if (line.trim() !== '') $.ui.log(line)
    },
    now: () => $.clock.now(),
    store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    hasGh: () => probeGh($),
    session: { get: async key => (await $.state.get(memoryRef)).value?.[key], set: (key, value) => remember($, key, value) },
    announce: () => announceOnce($),
    tryLock: async () => {
      const now = await $.clock.now()
      const held = await $.state.get(askingSince)
      if (held.value !== undefined && held.value > 0 && now - held.value < STALE_LOCK_MS) return undefined
      const taken = await $.state.set(askingSince, now, { ifVersion: held.version })
      if (!taken.isSet) return undefined
      return async () => void (await $.state.set(askingSince, 0))
    },
  }
}

/** One value of the session's memory; a lost race is retried, three losses give up (memory only saves work). */
async function remember($: EngineInterface, key: string, value: unknown): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await $.state.get(memoryRef)
    const taken = await $.state.set(memoryRef, { ...current.value, [key]: value }, { ifVersion: current.version })
    if (taken.isSet) return
  }
}

/** The "watching" line, once per session; the caller has already checked that a person can see it. */
async function announceOnce($: EngineInterface): Promise<void> {
  if ((await $.state.get(watchingRef)).value === true) return
  await $.state.set(watchingRef, true)
  $.ui.toast(WATCHING_NOTICE, { timeoutMs: 6_000 }) // a toast only: no box left in the transcript
}

/** Is `gh` installed? Asked once per session, remembered in state. */
async function probeGh($: EngineInterface): Promise<boolean> {
  const known = await $.state.get(hasGhRef)
  if (typeof known.value === 'boolean') return known.value
  let isThere = false
  try {
    isThere = (await $.process.run(['gh', '--version'], { timeoutMs: 5_000 })).exitCode === 0
  } catch {
    isThere = false
  }
  await $.state.set(hasGhRef, isThere)
  return isThere
}

async function quietly(f: () => unknown): Promise<void> {
  try {
    await f()
  } catch {
    // fail-open: see the header comment
  }
}
