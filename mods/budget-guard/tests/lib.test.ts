import { test, expect } from 'claude-code/testing'

import { EMPTY_SNAP, EMPTY_TALLY, MAX_TURNS, addTurn, addUsage, bandParts, buildReport, estimateUsd, fmtReset, overLimit, parseArgs, raisedLimit, raisedUsd, usdReached } from '../hooks/lib'
import type { BudgetSnap } from '../types'

/** Compares floating-point money to five decimals. */
const near = (n: number): number => Math.round(n * 1e5) / 1e5

const T = { limitPct: 80, limitUsd: 0, contextWarnPct: 75 }
const snap = (o: Partial<BudgetSnap> = {}): BudgetSnap => ({ ...EMPTY_SNAP, usd: 1, ctxPct: 20, ...o })
const text = (parts: ReturnType<typeof bandParts>) => parts?.map(p => p.text).join(' · ')

test('the line stays hidden while nothing matters', () => {
  expect(bandParts(snap(), EMPTY_TALLY, T)).toBeUndefined()
  expect(bandParts(snap({ usd: 400 }), EMPTY_TALLY, T)).toBeUndefined() // no dollar limit: cost alone never triggers
  expect(bandParts(snap({ windows: [{ kind: 'five_hour', pct: 70 }] }), EMPTY_TALLY, T)).toBeUndefined()
  expect(bandParts(snap({ windows: [{ kind: 'five_hour', pct: 79 }] }), EMPTY_TALLY, { limitPct: 0, limitUsd: 0, contextWarnPct: 75 })).toBeUndefined()
})

test('a plan window near or at the limit shows the line as used/total with the limit', () => {
  const warn = bandParts(snap({ windows: [{ kind: 'five_hour', pct: 74 }] }), EMPTY_TALLY, T)!
  expect(text(warn)).toBe('Session ~$1.00 · context 20% · 5h window 74/100 · limit 80 !')
  expect(warn.map(p => p.level)).toEqual(['ok', 'ok', 'warn'])
  const hot = bandParts(snap({ windows: [{ kind: 'five_hour', pct: 82 }, { kind: 'seven_day', pct: 30 }] }), EMPTY_TALLY, T)!
  expect(text(hot)).toBe('Session ~$1.00 · context 20% · 5h window 82/100 · limit 80 !!')
  expect(hot.at(-1)!.level).toBe('error')
})

test('with no limit a window shows at 80% and is an error at 95%', () => {
  const none = { limitPct: 0, limitUsd: 0, contextWarnPct: 75 }
  expect(text(bandParts(snap({ windows: [{ kind: 'seven_day', pct: 80 }] }), EMPTY_TALLY, none))).toBe('Session ~$1.00 · context 20% · 7d window 80/100 !')
  expect(bandParts(snap({ windows: [{ kind: 'seven_day', pct: 96 }] }), EMPTY_TALLY, none)!.at(-1)!.level).toBe('error')
})

test('context shows with the offending part flagged', () => {
  const parts = bandParts(snap({ usd: 1.2, ctxPct: 78 }), EMPTY_TALLY, T)!
  expect(text(parts)).toBe('Session ~$1.20 · context 78% !')
  expect(parts.map(p => p.level)).toEqual(['ok', 'warn'])
  expect(bandParts(snap({ ctxPct: 93 }), EMPTY_TALLY, T)![1]!.text).toBe('context 93% !!')
})

test('contextWarnPct moves the threshold', () => {
  expect(bandParts(snap({ ctxPct: 60 }), EMPTY_TALLY, { limitPct: 0, limitUsd: 0, contextWarnPct: 50 })).toBeDefined()
  expect(bandParts(snap({ ctxPct: 60 }), EMPTY_TALLY, { limitPct: 0, limitUsd: 0, contextWarnPct: 75 })).toBeUndefined()
})

test('without a cost ledger the estimate is used and labelled est.', () => {
  const t = addUsage(EMPTY_TALLY, 'claude-sonnet-4-5', { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  expect(near(t.estUsd)).toBe(near(4.5)) // 1M x $3 + 100k x $15
  expect(text(bandParts({ ...EMPTY_SNAP, ctxPct: 80 }, t, T))).toBe('Session ~$4.50 est. · context 80% !')
})

test('price estimate: cache read is cheap, cache write dear, unknown models priced like Sonnet', () => {
  const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }
  expect(near(estimateUsd('claude-opus-4-5', u))).toBe(near(0.5 + 6.25))
  expect(near(estimateUsd('mystery', u))).toBe(near(0.3 + 3.75))
})

test('/budget-guard argument: empty is the report, a number or off sets the limit', () => {
  expect(parseArgs('')).toEqual({ kind: 'report' })
  expect(parseArgs('80')).toEqual({ kind: 'set', pct: 80 })
  expect(parseArgs(' 82.5% ')).toEqual({ kind: 'set', pct: 82.5 })
  expect(parseArgs('0')).toEqual({ kind: 'set', pct: 0 })
  expect(parseArgs('OFF')).toEqual({ kind: 'set', pct: 0 })
  expect(parseArgs('$10')).toEqual({ kind: 'setUsd', usd: 10 })
  expect(parseArgs(' $7.5 ')).toEqual({ kind: 'setUsd', usd: 7.5 })
  expect(parseArgs('$0')).toEqual({ kind: 'setUsd', usd: 0 })
  expect(parseArgs('250')).toEqual({ kind: 'set', pct: 100 })
  for (const no of ['ten', '-5', '$', '$-3', '80 percent', '1e9']) expect(parseArgs(no)).toEqual({ kind: 'report' })
})

test('+10 points, never above 100; overLimit picks the highest window at or above the limit', () => {
  expect(raisedLimit(80)).toBe(90)
  expect(raisedLimit(95)).toBe(100)
  expect(raisedUsd(10)).toBe(15)
  expect(usdReached(10, 10)).toBe(true)
  expect(usdReached(9.99, 10)).toBe(false)
  expect(usdReached(500, 0)).toBe(false)
  const ws = [{ kind: 'five_hour', pct: 85 }, { kind: 'seven_day', pct: 90 }]
  expect(overLimit(ws, 80)?.kind).toBe('seven_day')
  expect(overLimit(ws, 91)).toBeUndefined()
  expect(overLimit(ws, 0)).toBeUndefined()
  expect(overLimit([], 50)).toBeUndefined()
})

test('the turn list is capped; the longest turn survives the cap', () => {
  let turns: { ms: number; tokens: number }[] = []
  for (let i = 0; i < MAX_TURNS + 20; i++) turns = addTurn(turns, { ms: i, tokens: 1 })
  expect(turns).toHaveLength(MAX_TURNS)
  expect(turns.at(-1)!.ms).toBe(MAX_TURNS + 19)
})

test('reset times read as time left', () => {
  const now = Date.parse('2026-01-01T10:00:00Z')
  expect(fmtReset('2026-01-01T11:12:00Z', now)).toBe('1h 12m')
  expect(fmtReset('2026-01-01T10:35:00Z', now)).toBe('35m')
  expect(fmtReset('2025-12-31T00:00:00Z', now)).toBe('soon')
  expect(fmtReset('2026-01-03T12:00:00Z', now)).toBe('2d 2h')
  expect(fmtReset(undefined, now)).toBeUndefined()
  expect(fmtReset('garbage', now)).toBeUndefined()
})

test('report: aligned rows, headline first, windows as used/total with the limit', () => {
  const tally = { input: 10_000, output: 8_200, cacheRead: 110_000, cacheWrite: 9_000, estUsd: 0, turns: 3, longestMs: 190_000 }
  const out = buildReport({
    snap: snap({ usd: 1.2, ctxPct: 78, ctxWindow: 200_000, windows: [{ kind: 'five_hour', pct: 62, resetsAt: '2026-01-01T11:12:00Z' }, { kind: 'seven_day', pct: 30 }] }),
    tally,
    turns: [{ ms: 90_000, tokens: 5_000 }, { ms: 42_000, tokens: 3_100 }],
    limitPct: 80,
    limitUsd: 0,
    now: Date.parse('2026-01-01T10:00:00Z'),
  })
  const lines = out.split('\n')
  expect(lines[0]).toBe('budget-guard · session ~$1.20 · 3 turns')
  expect(lines).toContain('Cost      ~$1.20')
  expect(lines).toContain('Tokens    in 129k · out 8.2k')
  expect(lines).toContain('Cache     hit 92% · read 110k · written 9.0k')
  expect(lines).toContain('Context   78% full of 200k')
  expect(lines).toContain('Last turn 42s · 3.1k tokens')
  expect(lines).toContain('Longest   3m 10s')
  expect(lines).toContain('5h window 62/100 · limit 80 · resets in 1h 12m')
  expect(lines).toContain('7d window 30/100 · limit 80')
  expect(out).not.toContain('estimated')
})

test('report with a window and no limit says no limit', () => {
  const out = buildReport({ snap: snap({ windows: [{ kind: 'five_hour', pct: 62 }] }), tally: EMPTY_TALLY, turns: [], limitPct: 0, limitUsd: 0, now: 0 })
  expect(out).toContain('5h window 62/100 · no limit')
})

test('report before anything happened: estimated cost, and plainly no plan window', () => {
  const out = buildReport({ snap: EMPTY_SNAP, tally: EMPTY_TALLY, turns: [], limitPct: 0, limitUsd: 0, now: 0 })
  expect(out).toContain('Cost      ~$0.00 est.')
  expect(out).toContain('Plan      API-key use: the limit is in dollars')
  expect(out).toContain('Cache     nothing cached yet')
  expect(out).toContain('Context   not reported yet')
  expect(out).toContain('Last turn none yet')
  expect(out).toContain('estimated from tokens')
})

test('a dollar limit: the line appears at 90% with a mark, error at 100%; report shows the limit next to cost', () => {
  const U = { limitPct: 0, limitUsd: 10, contextWarnPct: 75 }
  expect(bandParts(snap({ usd: 8.9 }), EMPTY_TALLY, U)).toBeUndefined()
  const warn = bandParts(snap({ usd: 9.2 }), EMPTY_TALLY, U)!
  expect(text(warn)).toBe('Session ~$9.20 · limit $10 ! · context 20%')
  expect(warn[0]!.level).toBe('warn')
  expect(bandParts(snap({ usd: 12.4 }), EMPTY_TALLY, U)![0]!.text).toBe('Session ~$12.4 · limit $10 !!')
  const out = buildReport({ snap: snap({ usd: 1.2 }), tally: EMPTY_TALLY, turns: [], limitPct: 0, limitUsd: 10, now: 0 })
  expect(out.split('\n')[0]).toBe('budget-guard · session ~$1.20 · limit $10 · 0 turns')
  expect(out).toContain('Cost      ~$1.20 · limit $10')
  expect(out).toContain('Plan      API-key use: the limit is in dollars')
})
