import { test, expect } from 'claude-code/testing'

import { cheaperBy, fmtRatio, judge, parseCosts, ratingOf, ratingTable, recommend, statusText, tableText } from '../hooks/fit'
import type { Prediction } from '../hooks/predict'

const P = (tier: Prediction['tier'], confidence = 0.9): Prediction => ({ tier, score: 4, confidence, reasons: ['r'] })
const COSTS = parseCosts(undefined).costs

// ----------------------------------------------------------------- the rating table

test('ratings by tier: weak / ok / best per model; review is rated like deep', () => {
  const row = (tier: Prediction['tier']) => tableText(ratingTable(tier, 'sonnet', COSTS))
  expect(row('light')).toBe('Haiku: ok, 1x; Sonnet: ok, 3x; Opus: best, 5x')
  expect(row('standard')).toBe('Haiku: weak, 1x; Sonnet: ok, 3x; Opus: best, 5x')
  expect(row('deep')).toBe('Haiku: weak, 1x; Sonnet: weak, 3x; Opus: best, 5x')
  expect(row('review')).toBe(row('deep'))
  expect(ratingOf('deep', 'fable')).toBe('best')
})

test('the fable row appears only when fable is the current model; no cost set says so', () => {
  expect(tableText(ratingTable('standard', 'fable', COSTS))).toBe('Haiku: weak, 1x; Sonnet: ok, 3x; Opus: best, 5x; Fable: best, cost not set')
  expect(tableText(ratingTable('standard', 'fable', parseCosts('fable=8').costs))).toContain('Fable: best, 8x')
  expect(tableText(ratingTable('standard', 'opus', parseCosts('fable=8').costs))).not.toContain('Fable')
})

// ---------------------------------------------------------------- the recommendation

test('recommendation: the cheapest model rated at least ok, or the only best when deep', () => {
  expect(recommend('light', COSTS)).toBe('haiku')
  expect(recommend('standard', COSTS)).toBe('sonnet')
  expect(recommend('deep', COSTS)).toBe('opus')
  expect(recommend('review', COSTS)).toBe('opus')
})

test('recommendation follows the cost setting, and never recommends fable', () => {
  // a user who found Opus cheaper than Sonnet gets Opus for ordinary work
  expect(recommend('standard', parseCosts('haiku=1,sonnet=6,opus=4').costs)).toBe('opus')
  expect(recommend('deep', parseCosts('fable=0.1').costs)).toBe('opus')
  expect(recommend('light', parseCosts('haiku=9,sonnet=3,opus=5').costs)).toBe('sonnet')
})

// ------------------------------------------------------------------- cost parsing

test('parseCosts: defaults, fable, case, separators and the "x" suffix', () => {
  expect(parseCosts(undefined)).toEqual({ costs: { haiku: 1, sonnet: 3, opus: 5 }, problems: [] })
  expect(parseCosts('haiku=1,sonnet=3,opus=5').costs).toEqual({ haiku: 1, sonnet: 3, opus: 5 })
  expect(parseCosts('Haiku=1x; SONNET=2.5 opus=10 fable=20').costs).toEqual({ haiku: 1, sonnet: 2.5, opus: 10, fable: 20 })
  expect(parseCosts('opus=7').costs).toEqual({ haiku: 1, sonnet: 3, opus: 7 }) // missing ones keep their default
})

test('parseCosts: bad input is ignored piece by piece, reported, and never throws', () => {
  const r = parseCosts('haiku=abc,sonnet=-2,opus=0,gpt=3,sonnet,=4,opus=5,haiku==2')
  expect(r.costs).toEqual({ haiku: 1, sonnet: 3, opus: 5 })
  expect(r.problems).toEqual(['haiku=abc', 'sonnet=-2', 'opus=0', 'gpt=3', 'sonnet', '=4', 'haiku==2'])
  for (const raw of [42, null, {}, [], '', '   ', ',,;;', 'x'.repeat(5000), 'opus=1e9', 'opus=99999', 'opus=NaN', 'opus=Infinity']) {
    const out = parseCosts(raw)
    expect(Object.values(out.costs).every(v => Number.isFinite(v) && v > 0)).toBe(true)
  }
  expect(parseCosts('opus=99999').problems).toEqual(['opus=99999'])
})

test('cost formatting and the saving wording', () => {
  expect(fmtRatio(5)).toBe('5x')
  expect(fmtRatio(1.5)).toBe('1.5x')
  expect(cheaperBy(COSTS, 'opus', 'haiku')).toBe('~5x cheaper')
  expect(cheaperBy(COSTS, 'opus', 'sonnet')).toBe('~1.7x cheaper')
  expect(cheaperBy(COSTS, 'haiku', 'opus')).toBe('') // not cheaper: nothing is claimed
  expect(cheaperBy(COSTS, 'fable', 'haiku')).toBe('') // fable has no cost: no ratio is invented
  expect(cheaperBy(parseCosts('fable=10').costs, 'fable', 'haiku')).toBe('~10x cheaper')
})

// -------------------------------------------------------------------- the verdict

test('under-powered: a deep or review task on a weaker model is a mismatch recommending Opus', () => {
  expect(judge(P('deep'), 'sonnet', 0.6, COSTS)).toEqual({ kind: 'mismatch', risk: 'under', recommended: 'opus' })
  expect(judge(P('deep'), 'haiku', 0.6, COSTS)).toEqual({ kind: 'mismatch', risk: 'under', recommended: 'opus' })
  expect(judge(P('review'), 'sonnet', 0.6, COSTS)).toEqual({ kind: 'mismatch', risk: 'under', recommended: 'opus' })
})

test('over-powered: a light task on a pricier model is a mismatch recommending the cheapest ok model', () => {
  expect(judge(P('light'), 'opus', 0.6, COSTS)).toEqual({ kind: 'mismatch', risk: 'over', recommended: 'haiku' })
  expect(judge(P('light'), 'sonnet', 0.6, COSTS)).toEqual({ kind: 'mismatch', risk: 'over', recommended: 'haiku' })
})

test('fits: no mismatch, so no dialog', () => {
  expect(judge(P('deep'), 'opus', 0.6, COSTS).kind).toBe('fits')
  expect(judge(P('deep'), 'fable', 0.6, COSTS).kind).toBe('fits')
  expect(judge(P('light'), 'haiku', 0.6, COSTS).kind).toBe('fits')
  expect(judge(P('standard'), 'sonnet', 0.6, COSTS).kind).toBe('fits')
})

test('review on a strong-enough model is a self-review verdict (Codex only), subject to confidence', () => {
  expect(judge(P('review'), 'opus', 0.6, COSTS)).toEqual({ kind: 'review' })
  expect(judge(P('review'), 'fable', 0.6, COSTS)).toEqual({ kind: 'review' })
  expect(judge(P('review', 0.7), 'opus', 0.8, COSTS).kind).toBe('none')
  expect(statusText({ kind: 'review' }, 'opus', COSTS)).toBe('suggest-model: review, Codex available')
})

test('fable as the current model: light work is overkill, standard work gets a status hint, deep work fits', () => {
  expect(judge(P('light'), 'fable', 0.6, COSTS)).toEqual({ kind: 'mismatch', risk: 'over', recommended: 'haiku' })
  expect(judge(P('standard', 0.8), 'fable', 0.6, COSTS)).toEqual({ kind: 'hint', recommended: 'sonnet', why: 'spare' })
  expect(judge(P('deep'), 'fable', 0.6, COSTS)).toEqual({ kind: 'fits' })
})

test('standard work: status hints only, never a mismatch; opus gets "spare", haiku "borderline"', () => {
  expect(judge(P('standard', 0.8), 'opus', 0.6, COSTS)).toEqual({ kind: 'hint', recommended: 'sonnet', why: 'spare' })
  expect(judge(P('standard', 0.8), 'haiku', 0.6, COSTS)).toEqual({ kind: 'hint', recommended: 'sonnet', why: 'borderline' })
  // strict (askOnStandard) turns both hints into mismatches
  expect(judge(P('standard', 0.8), 'opus', 0.6, COSTS, true)).toEqual({ kind: 'mismatch', risk: 'over', recommended: 'sonnet' })
  expect(judge(P('standard', 0.8), 'haiku', 0.6, COSTS, true)).toEqual({ kind: 'mismatch', risk: 'under', recommended: 'sonnet' })
  expect(judge(P('standard', 0.8), 'sonnet', 0.6, COSTS, true).kind).toBe('fits')
  expect(judge(P('standard', 0.65), 'haiku', 0.6, COSTS, true).kind).toBe('none') // still needs the standard-tier confidence
})

test('confidence: below the bar is silent; weak standard signals need 0.7; the boundary is inclusive', () => {
  expect(judge(P('deep', 0.59), 'sonnet', 0.6, COSTS).kind).toBe('none')
  expect(judge(P('deep', 0.6), 'sonnet', 0.6, COSTS).kind).toBe('mismatch')
  expect(judge(P('standard', 0.65), 'sonnet', 0.6, COSTS).kind).toBe('none')
  expect(judge(P('standard', 0.7), 'sonnet', 0.6, COSTS).kind).toBe('fits')
  expect(judge(P('deep', 0.95), undefined, 0.6, COSTS).kind).toBe('none') // unknown model
})

test('a cost setting that makes the recommendation no cheaper turns "overkill" into "fits"', () => {
  expect(judge(P('light'), 'sonnet', 0.6, parseCosts('haiku=3,sonnet=3,opus=5').costs).kind).toBe('fits')
})

// -------------------------------------------------------------------- status line

test('status line wording for every verdict', () => {
  const s = (fit: Parameters<typeof statusText>[0], cur: Parameters<typeof statusText>[1]) => statusText(fit, cur, COSTS)
  expect(s({ kind: 'fits' }, 'opus')).toBe('suggest-model: Opus fits')
  expect(s({ kind: 'mismatch', risk: 'over', recommended: 'haiku' }, 'opus')).toBe('suggest-model: overkill, Haiku would do (~5x cheaper)')
  expect(s({ kind: 'mismatch', risk: 'under', recommended: 'opus' }, 'sonnet')).toBe('suggest-model: weak for this, use Opus')
  expect(s({ kind: 'hint', recommended: 'sonnet', why: 'spare' }, 'opus')).toBe('suggest-model: Sonnet would do (~1.7x cheaper)')
  expect(s({ kind: 'hint', recommended: 'sonnet', why: 'borderline' }, 'haiku')).toBe('suggest-model: Haiku is borderline for this, Sonnet is safer')
  expect(s({ kind: 'mismatch', risk: 'over', recommended: 'haiku' }, 'fable')).toBe('suggest-model: overkill, Haiku would do') // no cost known for fable: no ratio
  expect(s({ kind: 'none', why: 'x' }, 'opus')).toBeUndefined() // clears the line
  expect(s({ kind: 'fits' }, undefined)).toBeUndefined()
})
