// checkpoint: /checkpoint saves a safety snapshot of the working tree without touching the branch, index or
// stash; see checkpoint.ts. FAIL-OPEN: every error here ends in one plain message or silence, never a block.
import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { autoSnapshot, count, runCommand } from './checkpoint'
import type { Deps } from './checkpoint'

const COMMAND = 'checkpoint'
const AUTO_DELAY_MS = 300 // the prompt is in and its turn started before the snapshot is made
const OFF = 'Checkpoint · off · the enabled setting is false (change it in /config)'

const countAtom = atom({ plugin: 'checkpoint', key: 'count' } as const, 0)

type Cfg = { isEnabled: boolean; isAuto: boolean; maxAuto: number }

const maxAutoOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(1, Math.round(v))) : 10)

async function depsOf($: EngineInterface): Promise<Deps> {
  let cwd: string | undefined
  try {
    cwd = await $.session.cwd()
  } catch {
    cwd = undefined
  }
  let t = 0
  try {
    t = await $.clock.now()
  } catch {
    t = 0
  }
  return {
    run: (argv, o) => $.process.run(argv, o),
    cwd,
    now: () => t,
    ask: (text, options, header) => $.ui.ask(text, { options, header }),
    canAsk: async () => {
      try {
        return (await $.session.surfaces()).length > 0
      } catch {
        return true
      }
    },
  }
}

async function mirror($: EngineInterface, n: number | undefined): Promise<void> {
  if (n === undefined) return
  try {
    await update($, countAtom, () => n)
  } catch {
    // the side bar then shows an older number
  }
}

export const register: Register = (on, options) => {
  const cfg: Cfg = { isEnabled: options.enabled !== false, isAuto: options.autoBeforePrompt === true, maxAuto: maxAutoOf(options.maxAuto) }
  let isBusy = false

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Safety snapshots of your working tree: /checkpoint [name] | list | diff <name> | restore <name> | drop <name>',
        argumentHint: '[name | list | diff <name> | restore <name> | drop <name>]',
      })
    } catch {
      // fail-open: without the command the mod is simply quiet
    }
    if (cfg.isEnabled) {
      try {
        await mirror($, await count(await depsOf($)))
      } catch {
        // see above
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    // Only the person's own words, and only the first prompt of a turn (not one typed over a running turn).
    const own = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (cfg.isEnabled && cfg.isAuto && own && e.turnId === undefined && !isBusy) {
      // Nothing is awaited here: the snapshot is made from a timer after the prompt has gone in.
      $.clock.after(AUTO_DELAY_MS, () => {
        if (isBusy) return
        isBusy = true
        void (async () => {
          try {
            await mirror($, await autoSnapshot(await depsOf($), cfg.maxAuto))
          } catch {
            // never throws into the session
          } finally {
            isBusy = false
          }
        })()
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (!cfg.isEnabled) return { text: OFF }
    const out = await runCommand(await depsOf($), e.args)
    await mirror($, out.count)
    return { text: out.text }
  }).catch(() => ({ text: 'Checkpoint · that did not work, nothing was changed' }))
}
