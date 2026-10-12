// budget-guard: a quiet usage line and a spending limit that asks instead of refusing.
//
//  - The band above the prompt is HIDDEN until something matters (session cost near the limit, a full
//    context window, a plan window near its cap). Then it shows "Session ~$1.20 of $5 · context 78% !".
//  - With a limit set, the NEXT prompt the person types after the estimate reaches it opens one dialog:
//    continue (+50%), continue without a limit, or hold. It never touches tool calls in a running turn
//    and never stops a scheduled, queued or plugin prompt.
//  - The plain words `usage`, `budget` and `budget-guard` print a short report; `budget 10` sets the
//    limit for this session. All of it is local: no model call, no network, zero tokens.
//
// FAIL OPEN everywhere: if reading the usage, the state or the dialog throws, the prompt goes through
// exactly as typed. The only deliberate drops are a plain word answered here and a prompt the person
// chose to hold (Esc or "Hold it").
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { EMPTY_SNAP, EMPTY_TALLY, addTurn, addUsage, bandParts, buildReport, costOf, fmtLimit, fmtUsd, parseWord, raisedLimit } from './lib'
import type { Level, TokenCounts, Word } from './lib'
import { dropWith } from './reply'
import { plainWord } from './words'
import type { BudgetSnap } from '../types'

type Dollar = EngineInterface
type Cfg = { isEnabled: boolean; limitUsd: number; contextWarnPct: number; showLine: boolean }

const tally = atom({ plugin: 'budget-guard', key: 'tally' } as const, EMPTY_TALLY)
const turns = atom({ plugin: 'budget-guard', key: 'turns' } as const, [])
const turnStart = atom({ plugin: 'budget-guard', key: 'turnStart' } as const, null)
const limit = atom({ plugin: 'budget-guard', key: 'limit' } as const, null)
const snapshot = atom({ plugin: 'budget-guard', key: 'snap' } as const, EMPTY_SNAP)

const COLOUR: Record<Level, 'warning' | 'error' | undefined> = { ok: undefined, warn: 'warning', error: 'error' }

const CONTINUE_MORE = 'Continue (+50%)'
const CONTINUE_FREE = 'Continue without limit'
const HOLD = 'Hold it'

const numberOf = (v: unknown, fallback: number, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

export function readConfig(o: Readonly<Record<string, unknown>>): Cfg {
  return {
    isEnabled: o.enabled !== false,
    limitUsd: numberOf(o.limitUsd, 0, 0, 1_000_000),
    contextWarnPct: numberOf(o.contextWarnPct, 75, 10, 99),
    showLine: o.showLine !== false,
  }
}

async function quietly<T>(f: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}

/** What the engine reports as the usage right now, in the shape the band and the report draw from. */
type Reading = {
  context: { percent?: number; tokens?: number; window: number }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

function toSnap(r: Reading): BudgetSnap {
  const { window, tokens } = r.context
  const pct = r.context.percent ?? (tokens !== undefined && window > 0 ? (tokens / window) * 100 : undefined)
  return {
    usd: r.cost?.usd ?? null,
    ctxPct: pct ?? null,
    ctxTokens: tokens ?? null,
    ctxWindow: window > 0 ? window : null,
    windows: r.rateLimits.map(w => ({ kind: w.kind, pct: w.percentUsed, ...(w.resetsAt === undefined ? {} : { resetsAt: w.resetsAt }) })),
  }
}

const effectiveLimit = async ($: Dollar, cfg: Cfg): Promise<number> => (await read($, limit)) ?? cfg.limitUsd

/** A fresh reading, also stored so the band and the report see it. Undefined when the engine has none. */
async function refresh($: Dollar): Promise<BudgetSnap | undefined> {
  const usage = await quietly(() => $.session.usage())
  if (usage === undefined) return undefined
  const snap = toSnap(usage)
  await quietly(() => update($, snapshot, () => snap))
  return snap
}

// ------------------------------------------------------------------ the report and the limit

async function report($: Dollar, cfg: Cfg): Promise<string> {
  const snap = (await refresh($)) ?? (await read($, snapshot))
  return buildReport({
    snap,
    tally: await read($, tally),
    turns: await read($, turns),
    limitUsd: await effectiveLimit($, cfg),
    now: await $.clock.now(),
  })
}

async function setLimit($: Dollar, usd: number): Promise<string> {
  await update($, limit, () => usd)
  return usd === 0 ? 'budget-guard · no limit for this session' : `budget-guard · limit ${fmtLimit(usd)} for this session`
}

async function run($: Dollar, cfg: Cfg, word: Word): Promise<string> {
  return word.kind === 'set' ? setLimit($, word.usd) : report($, cfg)
}

// -------------------------------------------------------------------------------- the guard

/** A prompt the person typed at an idle session: the only kind that is ever asked about. */
const isGuarded = (e: { text: string; origin: { kind: string }; turnId?: string }): boolean =>
  (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && e.turnId === undefined && e.text.trim() !== '' && !e.text.trimStart().startsWith('/')

/** The session cost now, as a number: the engine's ledger, else the token estimate. */
async function spentNow($: Dollar): Promise<number> {
  const snap = (await refresh($)) ?? (await read($, snapshot))
  return costOf(snap, await read($, tally)).usd
}

/** Asks once if the limit is reached; returns a drop when the person holds the prompt, else undefined. */
async function guard($: Dollar, cfg: Cfg, text: string): Promise<{ drop: string } | undefined> {
  const max = await effectiveLimit($, cfg)
  if (max <= 0) return undefined
  const spent = await spentNow($)
  if (spent < max) return undefined

  let answer: string
  try {
    answer = await $.ui.ask(`Session ~${fmtUsd(spent)} has reached your ${fmtLimit(max)} limit. Continue?`, {
      options: [CONTINUE_MORE, CONTINUE_FREE, HOLD],
      header: 'Budget',
    })
  } catch {
    answer = HOLD // Esc or an interrupt: nothing is sent
  }
  if (answer === CONTINUE_MORE) {
    await update($, limit, () => raisedLimit(max, spent))
    return undefined
  }
  if (answer === CONTINUE_FREE) {
    await update($, limit, () => 0)
    return undefined
  }
  const shown = text.length > 2000 ? `${text.slice(0, 2000)}...` : text
  return dropWith(note => $.ui.log(note), `budget-guard blocked your prompt · nothing was sent\n${shown}`)
}

// ------------------------------------------------------------------------------ the register

/** What the hooks below this one drew in the band. Only one tree can fill the band, so a mod that draws returns its row with this under it (never instead of it), and the other mods' rows stay visible. */
async function drawnBelow<E>(next: (e: E) => unknown, e: E): Promise<object | undefined> {
  try {
    const tree = await next(e)
    return tree !== null && typeof tree === 'object' ? tree : undefined
  } catch {
    return undefined
  }
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    if (cfg.isEnabled) {
      await refresh($)
      await quietly(() =>
        $.command.register({ name: 'budget-guard', description: 'Usage report, or budget <usd> to set this session\'s limit (or just type usage)', argumentHint: '[usd]' }),
      )
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // /clear starts the engine's own ledger over; so do the totals kept here.
  on('session.end', async ($, e, next) => {
    if (cfg.isEnabled && e.reason === 'clear') {
      await quietly(async () => {
        await update($, tally, () => EMPTY_TALLY)
        await update($, turns, () => [])
        await update($, limit, () => null)
        await update($, snapshot, () => EMPTY_SNAP)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The engine pushes a reading after each turn and when a plan window moves a whole point.
  on('session.measure', async ($, e, next) => {
    if (cfg.isEnabled) await quietly(() => update($, snapshot, () => toSnap(e)))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (cfg.isEnabled) {
      await quietly(async () => {
        const now = await $.clock.now()
        await update($, turnStart, () => now)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (cfg.isEnabled) await quietly(() => record($, e))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'budget-guard' }, async ($, e) => {
    if (!cfg.isEnabled) return { text: 'budget-guard · disabled\nThe enabled setting is false. Change it in /config.' }
    const word = parseWord(e.args.trim() === '' ? 'budget' : `budget ${e.args.trim().toLowerCase()}`)
    return { text: await run($, cfg, word ?? { kind: 'report' }) }
  }).catch(() => ({ text: 'budget-guard · that did not work, nothing changed' }))

  // The band: its own small tree like every other band here, hidden until something matters, and it
  // steps aside for a survey. Parts carry colour AND a trailing "!" so the level reads without colour.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!cfg.isEnabled || !cfg.showLine || e.props.hasSurvey) return next(e)
    if (e.surface !== 'terminal' && e.surface !== 'desktop') return next(e)
    const parts = bandParts(await read($, snapshot), await read($, tally), {
      limitUsd: await effectiveLimit($, cfg),
      contextWarnPct: cfg.contextWarnPct,
    })
    if (parts === undefined) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const row = (
      <Box key="budget-guard-row">
        {parts.flatMap((p, i) => [
          ...(i > 0 ? [<Text key={`sep${i}`} dimColor>{' · '}</Text>] : []),
          <Text key={`part${i}`} color={COLOUR[p.level]} bold={p.level === 'error'}>{p.text}</Text>,
        ])}
      </Box>
    )
    const below = await drawnBelow(next, e)
    return below === undefined ? row : <Box key="budget-guard-band" flexDirection="column">{row}{below as never}</Box>
  }).catch(($, e, next) => next(e))

  // Exactly one `next` per path. A plain word is answered here and dropped (never sent to the model).
  on('prompt.submit', async ($, e, next) => {
    if (!cfg.isEnabled) return next(e)
    const word = plainWord(e)
    const command = word === undefined ? undefined : parseWord(word)
    if (command !== undefined) {
      const reply = await run($, cfg, command).catch(() => 'budget-guard · that did not work, nothing changed')
      return dropWith(note => $.ui.log(note), reply)
    }
    if (isGuarded(e)) {
      const stop = await guard($, cfg, e.text).catch(() => undefined) // fail open
      if (stop !== undefined) return stop
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // fail open; if `next` already ran this replays its result
}

/** One finished turn: its tokens go into the totals, a main-loop turn also into the timing list. */
async function record($: Dollar, e: { agentId?: string; durationMs: number; usage?: TokenCounts & { model: string } }): Promise<void> {
  if (e.usage !== undefined) await update($, tally, t => addUsage(t, e.usage!.model, e.usage!))
  if (e.agentId !== undefined) return // a subagent: its cost counts, its timing is not a turn of the session
  const started = await read($, turnStart)
  const ms = Number.isFinite(e.durationMs) && e.durationMs >= 0 ? e.durationMs : started === null ? 0 : (await $.clock.now()) - started
  const u = e.usage
  const tokens = u === undefined ? 0 : u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  await update($, turns, list => addTurn(list, { ms, tokens }))
  await update($, tally, t => ({ ...t, turns: t.turns + 1, longestMs: Math.max(t.longestMs, ms) }))
  await update($, turnStart, () => null)
}
