import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheTaxActivity, CacheTaxKeepwarm, CacheTaxTotals } from '../types'
import {
  DEFAULT_KEEPWARM_MS,
  MAX_KEEPWARM_MS,
  coldUsd,
  fmtApprox,
  fmtDuration,
  fmtLeft,
  fmtTokens,
  hitPercent,
  parseDuration,
  pingIntervalMs,
  plural,
  priceFor,
  skipBelowMs,
  usageUsd,
  warmUsd,
} from './lib'
import type { Usage } from './lib'
import { dropWith } from './reply'
import { bestMove } from './suggest'
import type { Move } from './suggest'
import { plainWord } from './words'

type Dollar = EngineInterface
/** The user's tunables, resolved once in register(). */
type Cfg = { ttlMinutes: number; ttlMs: number; minTokens: number; minExtraUsd: number; onCold: 'ask' | 'stop' | 'off' }

const MINUTE = 60_000
const MAX_STORED_SESSIONS = 50
const PING_PROMPT = 'Cache keepalive. Reply with the single word: ok'

const NO_ACTIVITY: CacheTaxActivity = { at: 0, pingAt: 0, tokens: 0 }
const activity = atom({ plugin: 'cache-tax', key: 'activity' } as const, NO_ACTIVITY)
const isBusy = atom({ plugin: 'cache-tax', key: 'isBusy' } as const, false)
const held = atom({ plugin: 'cache-tax', key: 'held' } as const, null)
const cold = atom({ plugin: 'cache-tax', key: 'cold' } as const, null)
const paid = atom({ plugin: 'cache-tax', key: 'paid' } as const, { count: 0, usd: 0 })
const NO_TOTALS: CacheTaxTotals = { read: 0, write: 0, lastTokens: 0, lastOut: 0 }
const totals = atom({ plugin: 'cache-tax', key: 'totals' } as const, NO_TOTALS)
const hinted = atom({ plugin: 'cache-tax', key: 'hinted' } as const, false)
const keepwarm = atom({ plugin: 'cache-tax', key: 'keepwarm' } as const, null)

// Timer handles of this module instance only (not redraw state). The truth is `keepwarm` in
// $.state; a hot reload drops the timers and ensureTimers() restarts them on the next hook.
const timers: { ping?: Timer; tick?: Timer } = {}

/** Bookkeeping must never break the session: swallow and carry on. */
async function quietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch {
    // fail-open by design
  }
}

const lastTouch = (a: CacheTaxActivity): number => Math.max(a.at, a.pingAt)

// ---- state + store ---------------------------------------------------------

async function remember($: Dollar, next: CacheTaxActivity): Promise<void> {
  await update($, activity, () => next)
  await quietly(async () => {
    const sid = await $.session.id()
    const all = ((await $.store.get('sessions')) ?? {}) as Record<string, CacheTaxActivity>
    all[sid] = next
    const newest = Object.entries(all)
      .sort(([, a], [, b]) => lastTouch(b) - lastTouch(a))
      .slice(0, MAX_STORED_SESSIONS)
    await $.store.set('sessions', Object.fromEntries(newest))
  })
}

async function touch($: Dollar, patch: Partial<CacheTaxActivity>): Promise<void> {
  const current = await read($, activity)
  await remember($, { ...current, ...patch })
}

/** Context size in tokens, best source first; 0 when nothing knows. */
async function estimateTokens($: Dollar): Promise<number> {
  try {
    const live = (await $.session.usage()).context.tokens
    if (live) return live
  } catch {
    // fall through to the next source
  }
  const known = (await read($, activity)).tokens
  if (known) return known
  try {
    const { context } = await $.session.usage({ breakdown: 'summary' })
    return context.breakdown?.totalTokens ?? 0
  } catch {
    return 0
  }
}

// ---- the guard -------------------------------------------------------------

/** A message the person typed at an idle session: the only kind worth stopping. */
const isGuarded = (e: { text: string; origin: { kind: string }; turnId?: string }): boolean =>
  (e.origin.kind === 'composer' || e.origin.kind === 'bridge') &&
  e.turnId === undefined &&
  e.text.trim() !== '' &&
  !e.text.startsWith('/')

type Cold = { headline: string; detail: string; tokens: number; idleMs: number }

/** What a cold cache costs this message: a one-line headline and one detail line. */
async function coldNotice($: Dollar, cfg: Cfg, idleMs: number, tokens: number): Promise<Cold> {
  const { rate } = priceFor(await $.session.model())
  return {
    headline: `Cache went cold · this message ${fmtApprox(coldUsd(rate, cfg.ttlMinutes, tokens))} (warm: ${fmtApprox(warmUsd(rate, tokens))})`,
    detail: `Idle ${fmtDuration(idleMs)} · ~${fmtTokens(tokens)} tokens to re-write · /keepwarm holds the cache · /clear starts fresh`,
    tokens,
    idleMs,
  }
}

const KEEP_WARM_HINT = 'Keep it warm next time: /keepwarm 90m'

/**
 * Mention /keepwarm once per session, only inside a cold-cache question, and only when keep-warm is off, no turn
 * is running and the person has been idle past 70% of the TTL. Nothing is ever started here: pings cost tokens.
 */
async function keepwarmHint(cfg: Cfg, $: Dollar, idleMs: number): Promise<string | undefined> {
  if ((await read($, hinted)) || (await read($, keepwarm)) || (await read($, isBusy))) return undefined
  if (idleMs < cfg.ttlMs * 0.7) return undefined
  await update($, hinted, () => true)
  return KEEP_WARM_HINT
}

/** Is this message cold and costly enough to stop on? Undefined lets it through. */
async function judge(cfg: Cfg, $: Dollar, text: string): Promise<Cold | undefined> {
  if (cfg.onCold === 'off') return undefined
  const now = await $.clock.now()
  const touched = lastTouch(await read($, activity))
  if (touched === 0 || now - touched <= cfg.ttlMs) {
    if (await read($, held)) await update($, held, () => null)
    return undefined
  }
  const tokens = await estimateTokens($)
  if (tokens <= cfg.minTokens) return undefined
  const { rate } = priceFor(await $.session.model())
  if (coldUsd(rate, cfg.ttlMinutes, tokens) - warmUsd(rate, tokens) < cfg.minExtraUsd) return undefined // too cheap to bother with

  const stopped = await read($, held)
  if (stopped?.text === text) {
    // Second send of the same text: the person chose to pay. Reset the guard.
    await update($, held, () => null)
    await update($, cold, () => ({ tokens }))
    return undefined
  }
  await update($, held, () => ({ text }))
  return coldNotice($, cfg, now - touched, tokens)
}

const SEND = 'Send anyway'
const COMPACT = 'Compact first'
const CLEAR = 'Start fresh'
const HOLD = 'Hold it'
const SUGGESTED = ' (suggested)'
const LABEL: Record<Move, string> = { send: SEND, compact: COMPACT, clear: CLEAR }
const COMMAND: Record<Move, string> = { send: '', compact: '/compact', clear: '/clear' }

/** Put a command in the prompt box so one Enter runs it; false when the box could not take it. */
async function fillPrompt($: Dollar, text: string): Promise<boolean> {
  try {
    const out = (await $.prompt.fill({ text } as never)) as { isFilled?: boolean } | undefined
    return out?.isFilled !== false
  } catch {
    return false
  }
}

/**
 * `ask` (default): one small dialog, answered in place, so there is no second send. Esc holds the message.
 * `stop`: the older behaviour, a one-line stop and the same text sent again to pay.
 * Returns a drop, or undefined to let the message through.
 */
async function guard(cfg: Cfg, $: Dollar, text: string): Promise<{ drop: string } | undefined> {
  const c = await judge(cfg, $, text)
  if (c === undefined) return undefined
  if (cfg.onCold === 'stop') return dropWith(note => $.ui.log(note), `cache-tax blocked your prompt · ${c.headline} · send the same text again to continue\n${c.detail}`)
  let answer: string
  const hint = await keepwarmHint(cfg, $, c.idleMs).catch(() => undefined)
  const best = bestMove(c.tokens, c.idleMs)
  const first = LABEL[best.move]
  const options = [first, ...[SEND, COMPACT, CLEAR].filter(x => x !== first), HOLD].map(x => (x === first ? `${x}${SUGGESTED}` : x))
  const advice = `Suggested: ${first.toLowerCase()} · ${best.why}`
  try {
    answer = await $.ui.ask([c.headline, c.detail, advice, hint].filter(Boolean).join('\n'), { options, header: 'Cache cold' })
  } catch {
    answer = HOLD // Esc or an interrupt: nothing is sent
  }
  const picked = answer.endsWith(SUGGESTED) ? answer.slice(0, -SUGGESTED.length) : answer
  if (picked === SEND) {
    await update($, held, () => null)
    await update($, cold, () => ({ tokens: c.tokens }))
    return undefined
  }
  const shown = text.length > 2000 ? `${text.slice(0, 2000)}...` : text
  if (picked === COMPACT || picked === CLEAR) {
    const command = COMMAND[picked === COMPACT ? 'compact' : 'clear']
    const isFilled = await fillPrompt($, command)
    const how = isFilled ? `press Enter to run ${command}` : `type ${command}`
    return dropWith(note => $.ui.log(note), `cache-tax blocked your prompt · ${how}, then send your message again\n${shown}`)
  }
  return dropWith(note => $.ui.log(note), `cache-tax blocked your prompt · nothing was sent. Send it again to choose.\n${shown}`)
}

/** Add a completed turn's real usage to the session totals (cache reads vs writes, last turn). */
async function recordUsage($: Dollar, usage: Usage | undefined): Promise<void> {
  if (!usage) return // interrupted or failed before any request: nothing to count
  await update($, totals, t => ({
    read: t.read + usage.cache_read_input_tokens,
    write: t.write + usage.cache_creation_input_tokens,
    lastTokens: usage.input_tokens + usage.output_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    lastOut: usage.output_tokens,
  }))
}

/** A prompt passed after the TTL: price the write the turn actually made. */
async function payColdWrite(cfg: Cfg, $: Dollar, usage: (Usage & { model: string }) | undefined): Promise<void> {
  if (!(await read($, cold))) return
  await update($, cold, () => null)
  if (!usage) return // interrupted before any request: nothing was paid
  const usd = coldUsd(priceFor(usage.model).rate, cfg.ttlMinutes, usage.cache_creation_input_tokens)
  await update($, paid, p => ({ count: p.count + 1, usd: p.usd + usd }))
}

// ---- keepwarm --------------------------------------------------------------

function stopTimers(): void {
  timers.ping?.cancel()
  timers.tick?.cancel()
  timers.ping = undefined
  timers.tick = undefined
}

const statusLine = (k: CacheTaxKeepwarm, now: number): string =>
  `Keep-warm · ${fmtDuration(k.until - now)} left · ${plural(k.pings, 'ping')} · ${fmtApprox(k.usd)}` +
  (k.lastWasCold ? ' · last ping re-wrote the cache' : '')

async function endKeepwarm($: Dollar, k: CacheTaxKeepwarm, reason: string): Promise<void> {
  stopTimers()
  await update($, keepwarm, () => null)
  $.ui.status(undefined)
  $.ui.toast(`Keep-warm ${reason} · ${plural(k.pings, 'ping')} · ${fmtApprox(k.usd)}`, { timeoutMs: 8000 })
}

/** Every minute: the status countdown and the end of the duration. */
async function housekeeping($: Dollar): Promise<void> {
  const k = await read($, keepwarm)
  if (!k) return stopTimers()
  const now = await $.clock.now()
  if (now >= k.until) return endKeepwarm($, k, 'ended')
  $.ui.status(statusLine(k, now))
}

async function recordPing(cfg: Cfg, $: Dollar, usage: Usage): Promise<void> {
  const now = await $.clock.now()
  const { rate } = priceFor(await $.session.model())
  await update($, keepwarm, cur =>
    cur
      ? {
          ...cur,
          pings: cur.pings + 1,
          usd: cur.usd + usageUsd(rate, cfg.ttlMinutes, usage),
          failures: 0,
          lastCacheRead: usage.cache_read_input_tokens,
          lastWasCold: usage.cache_creation_input_tokens > usage.cache_read_input_tokens,
        }
      : cur,
  )
  if (usage.cache_read_input_tokens + usage.cache_creation_input_tokens > 0) await touch($, { pingAt: now })
  const k = await read($, keepwarm)
  if (k) $.ui.status(statusLine(k, now))
}

/** One keepalive: a cache-read fork, only while idle, never during a turn, never onto a cold cache. */
async function ping(cfg: Cfg, $: Dollar): Promise<void> {
  const k = await read($, keepwarm)
  if (!k) return stopTimers()
  const now = await $.clock.now()
  if (now >= k.until) return endKeepwarm($, k, 'ended')
  if (await read($, isBusy)) return
  const touched = lastTouch(await read($, activity))
  const idle = now - touched
  // No history, or already lapsed: a ping would only pay a write. Too soon: the next one still lands in time.
  if (touched === 0 || idle >= cfg.ttlMs || idle < skipBelowMs(cfg.ttlMinutes)) return

  const r = await $.model.fork({ prompt: PING_PROMPT })
  if (r.isAnswered) return recordPing(cfg, $, r.usage)
  if (r.reason === 'nothing-to-fork') return
  const failures = k.failures + 1
  if (failures >= 3) return endKeepwarm($, k, 'stopped after 3 failed pings')
  await update($, keepwarm, cur => (cur ? { ...cur, failures } : cur))
}

function startTimers(cfg: Cfg, $: Dollar, intervalMs: number): void {
  stopTimers()
  timers.ping = $.clock.every(intervalMs, () => void quietly(() => ping(cfg, $)))
  timers.tick = $.clock.every(MINUTE, () => void quietly(() => housekeeping($)))
}

async function ensureTimers(cfg: Cfg, $: Dollar): Promise<void> {
  const k = await read($, keepwarm)
  if (k && !timers.ping) startTimers(cfg, $, k.intervalMs)
}

async function startKeepwarm(cfg: Cfg, $: Dollar, durationMs: number): Promise<string> {
  const now = await $.clock.now()
  const capped = Math.min(durationMs, MAX_KEEPWARM_MS)
  const intervalMs = pingIntervalMs(cfg.ttlMinutes)
  const k: CacheTaxKeepwarm = {
    startedAt: now, until: now + capped, intervalMs,
    pings: 0, usd: 0, failures: 0, lastCacheRead: null, lastWasCold: false,
  }
  await update($, keepwarm, () => k)
  startTimers(cfg, $, intervalMs)
  $.ui.status(statusLine(k, now))

  const touched = lastTouch(await read($, activity))
  const tokens = await estimateTokens($)
  const { rate } = priceFor(await $.session.model())
  const pings = Math.floor(capped / intervalMs)
  const isCold = touched === 0 || now - touched >= cfg.ttlMs
  return [
    `Keep-warm on for ${fmtDuration(capped)}${capped < durationMs ? ' (the maximum)' : ''} · a ping every ${fmtDuration(intervalMs)}`,
    tokens > 0
      ? `About ${pings} pings · ${fmtApprox(pings * warmUsd(rate, tokens))} at ~${fmtTokens(tokens)} tokens of context`
      : `About ${pings} pings, each a cheap read of your context`,
    isCold
      ? 'The cache is cold: pings wait until your next message'
      : 'Runs only while Claude Code is open · /keepwarm off to stop',
  ].join('\n')
}

/** One line for the report: what keep-warm is doing, or how to start it. */
async function keepwarmLine($: Dollar): Promise<string> {
  const k = await read($, keepwarm)
  if (!k) return 'Keep-warm  off  (/keepwarm 90m to start)'
  const now = await $.clock.now()
  return `Keep-warm  on · ${fmtDuration(Math.max(k.until - now, 0))} left · ${plural(k.pings, 'ping')} · ${fmtApprox(k.usd)}`
}

async function keepwarmStatus($: Dollar): Promise<string> {
  const k = await read($, keepwarm)
  if (!k) return 'Keep-warm is off · /keepwarm 90m to start (default 6h), /keepwarm off to stop'
  const now = await $.clock.now()
  const last = k.lastCacheRead === null ? 'no ping yet' : `last one read ${fmtTokens(k.lastCacheRead)} tokens from cache`
  return [
    `Keep-warm on · ${fmtDuration(Math.max(k.until - now, 0))} left · ${plural(k.pings, 'ping')} · ${fmtApprox(k.usd)}`,
    `A ping every ${fmtDuration(k.intervalMs)} · ${last}`,
  ].join('\n')
}

async function runKeepwarm(cfg: Cfg, $: Dollar, args: string): Promise<string> {
  const arg = args.trim().toLowerCase()
  if (arg === '') return keepwarmStatus($)
  if (arg === 'off' || arg === 'stop') {
    const k = await read($, keepwarm)
    if (!k) return 'Keep-warm was not running'
    await endKeepwarm($, k, 'stopped')
    return 'Keep-warm stopped'
  }
  const ms = arg === 'on' ? DEFAULT_KEEPWARM_MS : parseDuration(arg)
  if (ms === null) return `Couldn't read "${args.trim()}" · try 90m, 2h, 1h30m, off, or nothing for status`
  return startKeepwarm(cfg, $, ms)
}

// ---- /cache-tax ------------------------------------------------------------

/** Headline first, then a few plain lines, then one dim line of estimates. */
async function report(cfg: Cfg, $: Dollar): Promise<string> {
  const now = await $.clock.now()
  const a = await read($, activity)
  const tokens = await estimateTokens($)
  const { label, rate } = priceFor(await $.session.model())
  const touched = lastTouch(a)
  const idle = now - touched
  const isCold = touched !== 0 && idle > cfg.ttlMs
  const total = await read($, paid)
  const t = await read($, totals)
  const next = (usd: number): string => (tokens > 0 ? ` · next message ${fmtApprox(usd)}` : '')
  const headline =
    touched === 0
      ? 'No activity yet · the cache starts with your first message'
      : isCold
        ? `Cache cold${next(coldUsd(rate, cfg.ttlMinutes, tokens))}`
        : `Cache warm · ~${fmtLeft(cfg.ttlMs - idle)} left${next(warmUsd(rate, tokens))}`
  const last = t.lastTokens > 0 ? ` · last turn ${fmtTokens(t.lastTokens)} (${fmtTokens(t.lastOut)} out)` : ''
  const hit = hitPercent(t.read, t.write)
  // At most six lines: the hold note rides on the cold-writes line.
  return [
    headline,
    (tokens > 0 ? `Context  ~${fmtTokens(tokens)} tokens` : 'Context  unknown yet') + last,
    hit === null ? '' : `Cache hits  ${hit}% (est.) · ${fmtTokens(t.read)} read · ${fmtTokens(t.write)} written`,
    await keepwarmLine($),
    `Cold writes this session  ${total.count} · ${fmtApprox(total.usd)}` +
      ((await read($, held)) ? ' · on hold: send the same text again to continue' : ''),
    `Estimates · ${label} · ${cfg.ttlMinutes} min cache`,
  ]
    .filter(line => line !== '')
    .join('\n')
}

// ---- wiring ----------------------------------------------------------------

export const register: Register = (on, options) => {
  const ttlMinutes = Math.max(Number(options.cacheTtlMinutes) || 60, 1)
  const onCold = options.onCold === 'stop' || options.onCold === 'off' ? options.onCold : 'ask'
  const cfg: Cfg = {
    ttlMinutes,
    ttlMs: ttlMinutes * MINUTE,
    minTokens: Number(options.minContextTokens ?? 20_000),
    minExtraUsd: Math.max(Number(options.minExtraUsd ?? 0.25) || 0, 0),
    onCold,
  }

  // Fail-open: a cost guard must never block work. A throw before the verdict lets the prompt through.
  // The plain word `cache-tax` is answered first (read-only, free) and dropped, so it never reaches the model and
  // is never held by the guard. `keepwarm` has no plain word: its pings cost tokens, so it stays /keepwarm.
  on('prompt.submit', async ($, e, next) => {
    if (plainWord(e) === 'cache-tax') {
      return dropWith(note => $.ui.log(note), await report(cfg, $).catch(() => "Couldn't read the cache state"))
    }
    if (isGuarded(e)) {
      await ensureTimers(cfg, $)
      const stop = await guard(cfg, $, e.text)
      if (stop !== undefined) return stop
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await quietly(async () => {
      await update($, isBusy, () => true)
      await touch($, { at: await $.clock.now() })
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e) // a subagent has a prefix of its own
    await quietly(async () => {
      await update($, isBusy, () => false)
      const now = await $.clock.now()
      let tokens = (await read($, activity)).tokens
      try {
        tokens = (await $.session.usage()).context.tokens ?? tokens
      } catch {
        // keep the last known size
      }
      await touch($, { at: now, tokens })
      await payColdWrite(cfg, $, e.usage)
      await recordUsage($, e.usage)
      await ensureTimers(cfg, $)
    })
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await quietly(() =>
      $.command.register({
        name: 'keepwarm',
        description: 'Keep the prompt cache warm with cheap pings: /keepwarm [90m|2h|off]',
        argumentHint: '[duration|off]',
        immediate: true,
      }),
    )
    await quietly(() =>
      $.command.register({
        name: 'cache-tax',
        description: 'Show whether the cache is warm and what the next message costs (typing cache-tax does the same)',
        immediate: true,
      }),
    )
    await quietly(async () => {
      if ((await read($, activity)).at !== 0) return
      const all = ((await $.store.get('sessions')) ?? {}) as Record<string, CacheTaxActivity>
      const mine = all[await $.session.id()]
      if (mine) await update($, activity, () => mine)
    })
    return next(e)
  })

  // A resumed session has no live usage until its first response: the engine's own
  // seconds_since_last_response / context_tokens are the best seed, and beat the store.
  on('classic.SessionStart', async ($, e, next) => {
    await quietly(async () => {
      const idleS = e.seconds_since_last_response
      if ((e.source !== 'resume' && e.source !== 'fork') || idleS === undefined) return
      const now = await $.clock.now()
      await remember($, { at: now - idleS * 1000, pingAt: 0, tokens: e.context_tokens ?? 0 })
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await quietly(async () => {
      await update($, held, () => null)
      await update($, cold, () => null)
      await update($, isBusy, () => false)
      if (e.reason === 'clear') {
        // New empty conversation: nothing cached to lose until the first reply.
        await update($, activity, () => NO_ACTIVITY)
        await update($, totals, () => NO_TOTALS)
      } else {
        stopTimers()
        await update($, keepwarm, () => null)
        $.ui.status(undefined)
      }
    })
    return next(e)
  })

  on('command.run', { command: 'keepwarm' }, async ($, e) => ({ text: await runKeepwarm(cfg, $, e.args) })).catch(
    () => ({ text: "Keep-warm couldn't run · nothing was changed" }),
  )

  on('command.run', { command: 'cache-tax' }, async $ => ({ text: await report(cfg, $) })).catch(() => ({
    text: "Couldn't read the cache state",
  }))
}
