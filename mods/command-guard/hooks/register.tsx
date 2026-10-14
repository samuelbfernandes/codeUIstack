// command-guard: hold risky Bash commands, show what they would destroy, ask first.
//
// THIS IS A SAFETY NET, NOT A PERMISSION SYSTEM. It only ever adds a question; it never
// allows anything the normal permission prompt would not. Keep your permissions on.
//
// HOW THE CALL IS HELD OPEN (the one engine detail that matters here):
//   A hook has a 10 s budget of its OWN time, but the clock stops while a `next` call or
//   any `$` call is in flight (HookBudget in the API types). `$.ui.ask` is a `$` call
//   that waits for a person, so it can wait minutes at no cost. A pane with Proceed /
//   Cancel buttons would NOT work: its press arrives as a separate event, and a hook
//   waiting on a bare promise for that press burns its own budget and is timed out
//   after 10 s. So the question goes through the engine's own question dialog; the first
//   option is Cancel, which is the one the dialog highlights, so Enter means no.
//   There is no timeout of our own: the dialog stays until answered; an interrupt
//   (Esc, or the turn being stopped) rejects the ask and that is treated as Cancel.
import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { classify } from './classify'
import { LEVELS, LEVEL_MEANING, asLevel, failClosedReason, isBelowBar, readConfig } from './config'
import type { Level } from './config'
import { denyText, dialogText, toastText } from './format'
import { measureAll } from './measure'
import type { Run } from './measure'
import { looksWindows, unmeasured } from './windows'

const PROBE_TIMEOUT_MS = 20_000
const COMMAND = 'command-guard'

/** Mirror of the persisted runtime level (`$.store` 'level'), so other mods can read it with $.state.get. */
const levelAtom = atom({ plugin: 'command-guard', key: 'level' } as const, 'medium')

/** The level in force: the person's runtime choice if there is one, else the `askFrom` setting. */
async function levelNow($: EngineInterface, fallback: Level): Promise<Level> {
  return asLevel(await safe(() => $.store.get('level'))) ?? fallback
}

const describe = (l: Level): string => `${l} (${LEVEL_MEANING[l]})`

async function runCommand($: EngineInterface, args: string, fallback: Level): Promise<string> {
  const word = args.trim().toLowerCase()
  const current = await levelNow($, fallback)
  if (word === '') {
    return [
      `Blast radius · ${describe(current)}`,
      `Levels: ${LEVELS.map(l => `${l} = ${LEVEL_MEANING[l]}`).join(' · ')} · /command-guard <level> to change`,
    ].join('\n')
  }
  const next = asLevel(word)
  if (next === undefined) return `Blast radius · "${args.trim().slice(0, 30)}" is not a level, nothing changed · use off, low, medium or high (now ${current})`
  try {
    await $.store.set('level', next)
    await update($, levelAtom, () => next)
  } catch {
    return 'Blast radius · that did not work, nothing changed'
  }
  return `Blast radius · ${describe(next)}`
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    // The person's runtime level overrides the setting; off is fail-open, before anything is classified.
    const level = await levelNow($, cfg.askFrom)
    if (level === 'off') return next(e)
    const cwd = await safe(() => $.session.cwd())
    const home = await safe(() => $.env.get('HOME'))
    const found = classify(e.command, { cwd, home, extraPatterns: cfg.extraPatterns })
    if (found.length === 0) return next(e)

    const run: Run = (argv, dir, opts) => $.process.run(argv, { cwd: dir, timeoutMs: opts?.timeoutMs ?? PROBE_TIMEOUT_MS })
    // WINDOWS: the probes below are Unix `find` / `du`. On native Windows `find` is a different program (text search), so an
    // empty answer would look like "nothing there" and a destructive command would pass unasked. Never do that: hold
    // the command with an honest "cannot measure here" instead. (Conditional findings such as `> file` need a file check
    // we cannot make there, so they pass through rather than asking about every redirect.)
    const win = await isWindows($, cwd, home)
    const { reports, unlisted } = win ? unmeasured(found) : await measureAll(run, found, { maxListed: cfg.maxListed, home, cwd })
    if (reports.length === 0 && unlisted === 0) return next(e) // conditions not met, e.g. `> new-file`
    // Below the `askFrom` bar nothing is shown: a command whose every part is lower risk goes through. A part that
    // was not checked (unlisted) or whose level is unknown always asks.
    if (isBelowBar(reports.map(r => r.risk?.level ?? 'unknown'), unlisted, level)) return next(e)

    const verdict = await confirm($, dialogText(e.command, reports, unlisted, cwd, cfg.maxListed))
    if (verdict.isYes) {
      await safe(() => $.ui.status(undefined))
      return next(e)
    }
    const why = verdict.why

    const toast = toastText(reports)
    await safe(() => $.ui.toast(toast, { timeoutMs: 8000 }))
    await safe(() => $.ui.status(toast))
    await safe(() => $.clock.after(30_000, () => void safe(() => $.ui.status(undefined))))
    return { deny: denyText(why, e.command, reports) }
  }).catch(($, e, next) => {
    // FAIL CLOSED, but only where the text itself looks destructive. The classifier or the
    // measurer (or the dialog code) threw, or the hook outran its budget: if the command
    // matches the coarse FALLBACK_RISKY regex or one of the user's own patterns we refuse
    // rather than guess; anything else goes through, so a bug here cannot wedge ordinary
    // work. Where `next` was already called (the user pressed Proceed) we just replay it.
    if (next.called) return next(e)
    const deny = failClosedReason((e as { command?: unknown }).command, cfg)
    return deny === undefined ? next(e) : { deny }
  })

  on('session.start', async ($, e, next) => {
    const level = await levelNow($, cfg.askFrom)
    await safe(() => update($, levelAtom, () => level)) // the mirror starts from what is stored, else the setting
    await safe(() =>
      $.command.register({
        name: COMMAND,
        description: 'Change how much command-guard asks about: /command-guard [off|low|medium|high]',
        argumentHint: '[off|low|medium|high]',
      }),
    ) // fail-open: without the command the setting still works
    if (cfg.badPatterns.length)
      await safe(() =>
        $.ui.toast(`command-guard: ignored invalid extra patterns: ${cfg.badPatterns.map(p => p.replace(/\s+/g, ' ')).join(', ')}`, { timeoutMs: 10_000 }),
      )
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await runCommand($, e.args, cfg.askFrom) })).catch(() => ({
    text: 'Blast radius · that did not work, nothing changed',
  }))
}

async function isWindows($: EngineInterface, cwd: string | undefined, home: string | undefined): Promise<boolean> {
  if (looksWindows(cwd) || looksWindows(home)) return true
  return (await safe(() => $.env.get('OS'))) === 'Windows_NT'
}

type Verdict = { isYes: true } | { isYes: false; why: string }

// Only an exact "Proceed" lets the command run; Cancel, free text under Other, Esc, a
// rejected dialog and a run with no surface at all are all a no.
async function confirm($: EngineInterface, text: string): Promise<Verdict> {
  const surfaces = await safe(() => $.session.surfaces())
  if (surfaces !== undefined && surfaces.length === 0) return { isYes: false, why: 'no screen to ask on in this run' }
  try {
    const answer = await $.ui.ask(text, {
      options: ['Cancel', 'Proceed'], // Cancel first: the dialog opens on it
      header: 'Blast radius',
    })
    if (answer === 'Proceed') return { isYes: true }
    return { isYes: false, why: answer === 'Cancel' ? 'cancelled in the dialog' : `answered "${answer.slice(0, 40).replace(/\s+/g, ' ')}", not Proceed` }
  } catch {
    return { isYes: false, why: 'no answer: dialog dismissed, or no one to ask' }
  }
}

async function safe<T>(f: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}
