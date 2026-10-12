// Pure helpers: rough prices, formatting, the band's parts and the report. No engine access.
import type { BudgetSnap, BudgetTally, BudgetTurn, BudgetWindow } from '../types'

// ---- prices (an estimate only, used where the engine keeps no cost ledger) -----------------

/** USD per million tokens. */
type Rate = { in: number; out: number }

// Rough list prices; they drift, so every figure built from them is labelled "est.".
// First match wins; an unknown model is priced like Sonnet.
const PRICES: ReadonlyArray<readonly [RegExp, Rate]> = [
  [/opus-4(-1)?(-\d{8})?$/, { in: 15, out: 75 }],
  [/opus/, { in: 5, out: 25 }],
  [/haiku-3/, { in: 0.8, out: 4 }],
  [/haiku/, { in: 1, out: 5 }],
  [/sonnet/, { in: 3, out: 15 }],
]
const FALLBACK: Rate = { in: 3, out: 15 }

/** A cache write is billed at 1.25x the input price (5-minute tier), a read at 0.1x. */
const WRITE_RATIO = 1.25
const READ_RATIO = 0.1

export type TokenCounts = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function estimateUsd(model: string, u: TokenCounts): number {
  const id = model.toLowerCase()
  const rate = PRICES.find(([re]) => re.test(id))?.[1] ?? FALLBACK
  const inUsd = u.input_tokens + u.cache_creation_input_tokens * WRITE_RATIO + u.cache_read_input_tokens * READ_RATIO
  return (inUsd * rate.in + u.output_tokens * rate.out) / 1e6
}

// ---- bookkeeping ---------------------------------------------------------------------------

/** How many finished turns are kept in memory. */
export const MAX_TURNS = 50

export const EMPTY_TALLY: BudgetTally = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, estUsd: 0, turns: 0, longestMs: 0 }

export const EMPTY_SNAP: BudgetSnap = { usd: null, ctxPct: null, ctxTokens: null, ctxWindow: null, windows: [] }

/** Adds one turn's real token counts (and its estimated cost) to the totals. */
export function addUsage(t: BudgetTally, model: string, u: TokenCounts): BudgetTally {
  return {
    ...t,
    input: t.input + u.input_tokens,
    output: t.output + u.output_tokens,
    cacheRead: t.cacheRead + u.cache_read_input_tokens,
    cacheWrite: t.cacheWrite + u.cache_creation_input_tokens,
    estUsd: t.estUsd + estimateUsd(model, u),
  }
}

export const addTurn = (turns: BudgetTurn[], turn: BudgetTurn): BudgetTurn[] => [...turns, turn].slice(-MAX_TURNS)

/** The session cost to show: the engine's ledger when it has one, else the token estimate. */
export function costOf(snap: BudgetSnap, tally: BudgetTally): { usd: number; isEst: boolean } {
  return snap.usd === null ? { usd: tally.estUsd, isEst: true } : { usd: snap.usd, isEst: false }
}

// ---- formatting ----------------------------------------------------------------------------

export function fmtUsd(n: number): string {
  if (n > 0 && n < 0.01) return '<$0.01'
  return `$${n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : n.toFixed(0)}`
}

/** A limit as the person typed it: 80, 82.5. */
export const fmtLimit = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** A dollar limit as the person typed it: $10, $7.50. */
export const fmtUsdLimit = (n: number): string => `$${Number.isInteger(n) ? n : n.toFixed(2)}`

/** Used out of total, both in plan points: 82/100. */
export const fmtUsed = (n: number): string => `${Math.round(n)}/100`

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  return n < 10_000 ? `${(n / 1000).toFixed(1)}k` : n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1e6).toFixed(1)}M`
}

export function fmtDuration(ms: number): string {
  const s = Math.max(Math.round(ms / 1000), 0)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const MIN = 60_000

/** Time until a window resets: "1h 12m", "35m", "soon"; undefined when the timestamp is unreadable. */
export function fmtReset(resetsAt: string | undefined, now: number): string | undefined {
  const at = resetsAt === undefined ? NaN : Date.parse(resetsAt)
  if (!Number.isFinite(at)) return undefined
  const m = Math.round((at - now) / MIN)
  if (m < 1) return 'soon'
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
}

export const fmtPct = (n: number): string => `${Math.round(n)}%`

/** "5h window", "7d window"; any other kind is shown as the engine names it, spaced. */
export function windowLabel(kind: string): string {
  if (kind === 'five_hour') return '5h window'
  if (kind === 'seven_day') return '7d window'
  return kind.replace(/_/g, ' ')
}

// ---- the usage line ------------------------------------------------------------------------

export type Level = 'ok' | 'warn' | 'error'
export type Part = { text: string; level: Level }

export type Thresholds = { limitPct: number; limitUsd: number; contextWarnPct: number }

/** A dollar limit warns at 90% of it and is an error at 100%. */
const USD_WARN_FRACTION = 0.9

export const PLAN_WARN_PCT = 80
const PLAN_ERROR_PCT = 95

const levelAt = (v: number, warn: number, error: number): Level => (v >= error ? 'error' : v >= warn ? 'warn' : 'ok')

/** The words that stand in for colour: a flagged part ends in "!" (warning) or "!!" (error). */
export const MARK: Record<Level, string> = { ok: '', warn: ' !', error: ' !!' }

/** A window text: "5h window 62/100", with " · limit 80" when a limit is set. */
export const windowText = (w: BudgetWindow, limitPct: number): string =>
  `${windowLabel(w.kind)} ${fmtUsed(w.pct)}${limitPct > 0 ? ` · limit ${fmtLimit(limitPct)}` : ''}`

/** True when the session cost has reached a dollar limit (never with no limit). */
export const usdReached = (usd: number, limitUsd: number): boolean => limitUsd > 0 && usd >= limitUsd

/** The first plan window at or above the limit (none when there is no limit or no window). */
export const overLimit = (windows: readonly BudgetWindow[], limitPct: number): BudgetWindow | undefined =>
  limitPct > 0 ? windows.reduce<BudgetWindow | undefined>((hit, w) => (w.pct >= limitPct && (hit === undefined || w.pct > hit.pct) ? w : hit), undefined) : undefined

/**
 * The parts of the line, or undefined while nothing matters: context at the warning percentage, a plan
 * window at 80% (or 90% of your limit), or session cost at 90% of a dollar limit. When one matters, cost
 * and context are shown too, so the line reads as a whole; plan windows only when they themselves are high.
 */
export function bandParts(snap: BudgetSnap, tally: BudgetTally, t: Thresholds): Part[] | undefined {
  const { usd, isEst } = costOf(snap, tally)
  const ctxLevel: Level = snap.ctxPct === null ? 'ok' : levelAt(snap.ctxPct, t.contextWarnPct, Math.max(90, t.contextWarnPct + 5))
  const warnAt = t.limitPct > 0 ? Math.min(PLAN_WARN_PCT, t.limitPct * 0.9) : PLAN_WARN_PCT
  const errorAt = t.limitPct > 0 ? t.limitPct : PLAN_ERROR_PCT
  const high = snap.windows.filter(w => w.pct >= warnAt)
  const costLevel: Level = t.limitUsd > 0 ? levelAt(usd, t.limitUsd * USD_WARN_FRACTION, t.limitUsd) : 'ok'
  if (ctxLevel === 'ok' && high.length === 0 && costLevel === 'ok') return undefined

  const parts: Part[] = [{ text: `Session ~${fmtUsd(usd)}${isEst ? ' est.' : ''}${t.limitUsd > 0 ? ` · limit ${fmtUsdLimit(t.limitUsd)}` : ''}`, level: costLevel }]
  if (snap.ctxPct !== null) parts.push({ text: `context ${fmtPct(snap.ctxPct)}`, level: ctxLevel })
  for (const w of high) parts.push({ text: windowText(w, t.limitPct), level: levelAt(w.pct, warnAt, errorAt) })
  return parts.map(p => ({ ...p, text: p.text + MARK[p.level] }))
}

// ---- the report ----------------------------------------------------------------------------

type ReportInput = {
  snap: BudgetSnap
  tally: BudgetTally
  turns: BudgetTurn[]
  limitPct: number
  limitUsd: number
  now: number
}

/** One aligned row of the report. */
const row = (label: string, value: string): string => `${label.padEnd(10)}${value}`

function windowRow(w: BudgetWindow, limitPct: number, now: number): string {
  const reset = fmtReset(w.resetsAt, now)
  return row(windowLabel(w.kind), `${fmtUsed(w.pct)} · ${limitPct > 0 ? `limit ${fmtLimit(limitPct)}` : 'no limit'}${reset === undefined ? '' : ` · resets in ${reset}`}`)
}

/** The first line is the headline (it becomes the one-line answer); the rest is the aligned box. */
export function buildReport(r: ReportInput): string {
  const { usd, isEst } = costOf(r.snap, r.tally)
  const cost = `~${fmtUsd(usd)}${isEst ? ' est.' : ''}${r.limitUsd > 0 ? ` · limit ${fmtUsdLimit(r.limitUsd)}` : ''}`
  const last = r.turns.at(-1)
  const cached = r.tally.cacheRead + r.tally.cacheWrite
  const tokensIn = r.tally.input + cached
  const ctx = r.snap
  return [
    `budget-guard · session ${cost} · ${r.tally.turns} ${r.tally.turns === 1 ? 'turn' : 'turns'}`,
    row('Cost', cost),
    row('Tokens', `in ${fmtTokens(tokensIn)} · out ${fmtTokens(r.tally.output)}`),
    row('Cache', cached === 0 ? 'nothing cached yet' : `hit ${fmtPct((r.tally.cacheRead / cached) * 100)} · read ${fmtTokens(r.tally.cacheRead)} · written ${fmtTokens(r.tally.cacheWrite)}`),
    row('Context', ctx.ctxPct === null ? 'not reported yet' : `${fmtPct(ctx.ctxPct)} full${ctx.ctxWindow === null ? '' : ` of ${fmtTokens(ctx.ctxWindow)}`}`),
    row('Last turn', last === undefined ? 'none yet' : `${fmtDuration(last.ms)} · ${fmtTokens(last.tokens)} tokens`),
    row('Longest', r.tally.turns === 0 ? 'none yet' : fmtDuration(r.tally.longestMs)),
    ...(r.snap.windows.length === 0
      ? [row('Plan', `API-key use: the limit is in dollars${r.limitPct > 0 ? `; the ${fmtLimit(r.limitPct)} plan limit is idle` : ''}`)]
      : r.snap.windows.map(w => windowRow(w, r.limitPct, r.now))),
    `Counts start when the mod loads${isEst ? '; cost is estimated from tokens at rough list prices' : ''}.`,
  ].join('\n')
}

// ---- the /budget-guard argument -----------------------------------------------------------

export type Word = { kind: 'report' } | { kind: 'set'; pct: number } | { kind: 'setUsd'; usd: number }

/**
 * The text after `/budget-guard`: nothing for the report; `80` (or `80%`, decimals allowed, above 100
 * counts as 100) sets the limit in plan points; `$10` sets a dollar limit; `0` or `off` clears both.
 * Anything else is the report.
 */
export function parseArgs(args: string): Word {
  const a = args.trim().toLowerCase()
  if (a === 'off') return { kind: 'set', pct: 0 }
  const d = /^\$(\d+(?:\.\d+)?)$/.exec(a)
  if (d?.[1] !== undefined) return { kind: 'setUsd', usd: Number(d[1]) }
  const m = /^(\d+(?:\.\d+)?)%?$/.exec(a)
  return m?.[1] === undefined ? { kind: 'report' } : { kind: 'set', pct: Math.min(100, Number(m[1])) }
}

 /** What "Continue (+50%)" raises a dollar limit to: half of itself more. */
export const raisedUsd = (limit: number): number => limit * 1.5

/** What "Continue (+10 points)" raises the limit to: ten points more, never above 100. */
export const raisedLimit = (limit: number): number => Math.min(100, limit + 10)
