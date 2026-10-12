import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

const COMMAND = 'long-run-ping'
const NAME = 'long-run-ping'
const SOUND = 'sounds/ping.wav'

/** Mirror of the persisted on/off switch (`$.store` 'off'), read by the moddeck side bar. */
const isOff = atom({ plugin: 'long-run-ping', key: 'isOff' } as const, false)

type Cfg = { isEnabled: boolean; afterSec: number; commandSec: number; minGapSec: number; hasSound: boolean }

const num = (v: unknown, fallback: number, min: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback

/** "45s", "3m 12s", "1h 2m". */
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** What the mod remembers between events. */
type Seen = { lastAt: number | undefined; lastText: string }

async function isOn($: Dollar, cfg: Cfg): Promise<boolean> {
  if (!cfg.isEnabled) return false
  try {
    return (await $.store.get('off')) !== true
  } catch {
    return true
  }
}

/** The ping itself: a toast, then (setting `sound`) the sound and the terminal notification. Each part fails alone. */
async function ring($: Dollar, cfg: Cfg, text: string): Promise<void> {
  try {
    $.ui.toast(text)
  } catch {
    // a missing toast is harmless
  }
  if (!cfg.hasSound) return
  try {
    await $.audio.play({ asset: SOUND })
  } catch {
    // no player on this machine
  }
  try {
    await $.ui.notify(text)
  } catch {
    // no notification channel
  }
}

/** Pings if a run of `ms` is past `limitSec` and the gap since the last ping allows. */
async function maybePing($: Dollar, cfg: Cfg, st: Seen, ms: number, limitSec: number): Promise<void> {
  try {
    if (ms <= limitSec * 1000) return
    if (!(await isOn($, cfg))) return
    const now = await $.clock.now()
    if (st.lastAt !== undefined && now - st.lastAt < cfg.minGapSec * 1000) return
    st.lastAt = now
    st.lastText = `${NAME} · done after ${span(ms)}`
    await ring($, cfg, st.lastText)
  } catch {
    // bookkeeping only: never get in the way
  }
}

async function setSwitch($: Dollar, off: boolean): Promise<void> {
  if (off) await $.store.set('off', true)
  else await $.store.delete('off')
  await update($, isOff, () => off)
}

async function run($: Dollar, cfg: Cfg, st: Seen, args: string): Promise<string> {
  const word = args.trim().toLowerCase().replace(/\.$/, '')
  if (word === 'on' || word === 'off') {
    if (!cfg.isEnabled) return `${NAME} · disabled · the enabled setting is false (change it in /config)`
    try {
      await setSwitch($, word === 'off')
    } catch {
      return `${NAME} · that did not work, nothing changed`
    }
    return word === 'on' ? `${NAME} · on` : `${NAME} · off · type /long-run-ping on to turn it back on`
  }
  if (word === 'test') {
    if (!(await isOn($, cfg))) return `${NAME} · off · type /long-run-ping on first`
    await ring($, cfg, `${NAME} · test ping`)
    return `${NAME} · test ping sent`
  }
  if (word === '' || word === 'status') {
    const isUp = await isOn($, cfg)
    return [
      `${NAME} · ${isUp ? 'on' : 'off'}`,
      `turn over ${cfg.afterSec}s · command over ${cfg.commandSec}s · gap ${cfg.minGapSec}s · sound ${cfg.hasSound ? 'on' : 'off'}`,
      st.lastText === '' ? 'no ping yet this session' : `last: ${st.lastText}`,
    ].join('\n')
  }
  return `${NAME} · use /long-run-ping on, off, status or test`
}


export const register: Register = (on, options) => {
  const cfg: Cfg = {
    isEnabled: options.enabled !== false,
    afterSec: num(options.afterSec, 60, 1),
    commandSec: num(options.commandSec, 120, 1),
    minGapSec: num(options.minGapSec, 30, 0),
    hasSound: options.sound !== false,
  }
  let turnStart: number | undefined
  const st: Seen = { lastAt: undefined, lastText: '' }

  on('session.start', async ($, e, next) => {
    try {
      const stored = (await $.store.get('off')) === true
      await update($, isOff, () => stored)
    } catch {
      // the switch then reads as on
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Ping when a long turn or command ends: /long-run-ping [on|off|status|test]',
        argumentHint: '[on|off|status|test]',
        immediate: true,
      })
    } catch {
      // fail-open: without the command the mod still pings
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    let t: number | undefined
    try {
      t = await $.clock.now()
    } catch {
      // no start, no ping for this turn
    }
    const out = await next(e)
    turnStart = t
    return out
  })

  on('turn.complete', async ($, e, next) => {
    const out = await next(e)
    try {
      const ev = e as { agentId?: string; isAborted?: boolean; durationMs?: number }
      if (ev.agentId === undefined && ev.isAborted !== true) {
        const start = turnStart
        turnStart = undefined
        let ms = ev.durationMs
        if (start !== undefined) ms = (await $.clock.now()) - start
        if (typeof ms === 'number') await maybePing($, cfg, st, ms, cfg.afterSec)
      }
    } catch {
      // bookkeeping only
    }
    return out
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    let t: number | undefined
    try {
      t = await $.clock.now()
    } catch {
      // no start, no ping for this command
    }
    const out = await next(e)
    try {
      if (t !== undefined) await maybePing($, cfg, st, (await $.clock.now()) - t, cfg.commandSec)
    } catch {
      // bookkeeping only
    }
    return out
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, cfg, st, e.args) })).catch(() => ({
    text: `${NAME} · nothing changed`,
  }))
}
