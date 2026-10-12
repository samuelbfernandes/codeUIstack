import { test, expect } from 'claude-code/testing'

import { EMPTY_SNAP, EMPTY_TALLY, MAX_TURNS, addTurn, addUsage, bandParts, buildReport, estimateUsd, fmtReset, parseWord, raisedLimit } from '../hooks/lib'
import type { BudgetSnap } from '../types'

/** Compares floating-point money to five decimals. */
const near = (n: number): number => Math.round(n * 1e5) / 1e5

const T = { limitUsd: 5, contextWarnPct: 75 }
const snap = (o: Partial<BudgetSnap> = {}): BudgetSnap => ({ ...EMPTY_SNAP, usd: 1, ctxPct: 20, ...o })
const text = (parts: ReturnType<typeof bandParts>) => parts?.map(p => p.text).join(' · ')

test('the line stays hidden while nothing matters', () => {
  expect(bandParts(snap(), EMPTY_TALLY, T)).toBeUndefined()
  expect(bandParts(snap({ usd: 3.4 }), EMPTY_TALLY, T)).toBeUndefined() // 68% of $5
  expect(bandParts(snap({ windows: [{ kind: 'five_hour', pct: 79 }] }), EMPTY_TALLY, T)).toBeUndefined()
  expect(bandParts(snap({ usd: 400 }), EMPTY_TALLY, { limitUsd: 0, contextWarnPct: 75 })).toBeUndefined() // no limit: cost alone never matters
})

test('cost at 70% of the limit shows the line; at the limit it is an error', () => {
  const warn = bandParts(snap({ usd: 3.5 }), EMPTY_TALLY, T)!
  expect(text(warn)).toBe('Session ~$3.50 of $5 ! · context 20%')
  expect(warn.map(p => p.level)).toEqual(['warn', 'ok'])
  expect(bandParts(snap({ usd: 5 }), EMPTY_TALLY, T)![0]!.level).toBe('error')
})

test('context and plan windows show with the offending part flagged', () => {
  const parts = bandParts(snap({ usd: 1.2, ctxPct: 78, windows: [{ kind: 'five_hour', pct: 82 }, { kind: 'seven_day', pct: 30 }] }), EMPTY_TALLY, T)!
  expect(text(parts)).toBe('Session ~$1.20 of $5 · context 78% ! · 5h plan 82% !')
  expect(parts.map(p => p.level)).toEqual(['ok', 'warn', 'warn'])
  const hot = bandParts(snap({ ctxPct: 93, windows: [{ kind: 'five_hour', pct: 97 }] }), EMPTY_TALLY, T)!
  expect(hot.map(p => p.level)).toEqual(['ok', 'error', 'error'])
  expect(hot[1]!.text).toBe('context 93% !!')
})

test('contextWarnPct moves the threshold', () => {
  expect(bandParts(snap({ ctxPct: 60 }), EMPTY_TALLY, { limitUsd: 0, contextWarnPct: 50 })).toBeDefined()
  expect(bandParts(snap({ ctxPct: 60 }), EMPTY_TALLY, { limitUsd: 0, contextWarnPct: 75 })).toBeUndefined()
})

test('without a cost ledger the estimate is used and labelled est.', () => {
  const t = addUsage(EMPTY_TALLY, 'claude-sonnet-4-5', { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
  expect(near(t.estUsd)).toBe(near(4.5)) // 1M x $3 + 100k x $15
  expect(text(bandParts({ ...EMPTY_SNAP, ctxPct: 10 }, t, T))).toBe('Session ~$4.50 est. of $5 ! · context 10%')
})

test('price estimate: cache read is cheap, cache write dear, unknown models priced like Sonnet', () => {
  const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }
  expect(near(estimateUsd('claude-opus-4-5', u))).toBe(near(0.5 + 6.25))
  expect(near(estimateUsd('mystery', u))).toBe(near(0.3 + 3.75))
})

test('plain words: usage, budget, budget-guard and budget <number> only', () => {
  expect(parseWord('usage')).toEqual({ kind: 'report' })
  expect(parseWord('budget')).toEqual({ kind: 'report' })
  expect(parseWord('budget-guard')).toEqual({ kind: 'report' })
  expect(parseWord('budget 10')).toEqual({ kind: 'set', usd: 10 })
  expect(parseWord('budget $7.5')).toEqual({ kind: 'set', usd: 7.5 })
  expect(parseWord('budget 0')).toEqual({ kind: 'set', usd: 0 })
  for (const no of ['budget ten', 'budget 10 dollars', 'what is my usage', 'usage please', 'budget -5', 'budget 1e9', 'my budget 10', '']) {
    expect(parseWord(no)).toBeUndefined()
  }
})

test('+50% is 50% more, and never under 10% above what is spent', () => {
  expect(near(raisedLimit(5, 5.2))).toBe(near(7.5))
  expect(near(raisedLimit(5, 9))).toBe(near(9.9))
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

test('report: aligned rows, headline first, honest about estimates', () => {
  const tally = { input: 10_000, output: 8_200, cacheRead: 110_000, cacheWrite: 9_000, estUsd: 0, turns: 3, longestMs: 190_000 }
  const out = buildReport({
    snap: snap({ usd: 1.2, ctxPct: 78, ctxWindow: 200_000, windows: [{ kind: 'five_hour', pct: 82, resetsAt: '2026-01-01T11:12:00Z' }] }),
    tally,
    turns: [{ ms: 90_000, tokens: 5_000 }, { ms: 42_000, tokens: 3_100 }],
    limitUsd: 5,
    now: Date.parse('2026-01-01T10:00:00Z'),
  })
  const lines = out.split('\n')
  expect(lines[0]).toBe('budget-guard · session ~$1.20 of $5 · 3 turns')
  expect(lines).toContain('Cost      ~$1.20 of $5 limit (24%)')
  expect(lines).toContain('Tokens    in 129k · out 8.2k')
  expect(lines).toContain('Cache     hit 92% · read 110k · written 9.0k')
  expect(lines).toContain('Context   78% full of 200k')
  expect(lines).toContain('Last turn 42s · 3.1k tokens')
  expect(lines).toContain('Longest   3m 10s')
  expect(lines).toContain('5h plan   82% · resets in 1h 12m')
  expect(out).not.toContain('estimated')
})

test('report before anything happened, with estimated cost and no limit', () => {
  const out = buildReport({ snap: EMPTY_SNAP, tally: EMPTY_TALLY, turns: [], limitUsd: 0, now: 0 })
  expect(out).toContain('Cost      ~$0.00 est. · no limit set')
  expect(out).toContain('Cache     nothing cached yet')
  expect(out).toContain('Context   not reported yet')
  expect(out).toContain('Last turn none yet')
  expect(out).toContain('estimated from tokens')
})
