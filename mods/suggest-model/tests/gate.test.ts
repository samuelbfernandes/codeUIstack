import { test, expect } from 'claude-code/testing'

import { findModelRow, valueFor } from '../hooks/actions'
import { buildDialog, choiceOf } from '../hooks/dialog'
import {
  canRunAlone,
  describeTask,
  familyOf,
  fmtTokens,
  pushHistory,
  refsPriorContext,
} from '../hooks/gate'
import { parseCosts, ratingTable } from '../hooks/fit'
import type { Prediction } from '../hooks/predict'
import { predict } from '../hooks/predict'
import type { ConfigRow } from 'claude-code'

const P = (tier: Prediction['tier'], confidence: number): Prediction => ({ tier, score: 4, confidence, reasons: ['r1', 'r2', 'r3', 'r4'] })

test('familyOf maps resolved ids by substring and leaves unknown ids alone', () => {
  expect(familyOf('claude-sonnet-4-5-20250929')).toBe('sonnet')
  expect(familyOf('claude-opus-4-1')).toBe('opus')
  expect(familyOf('Claude-Haiku-4-5')).toBe('haiku')
  expect(familyOf('claude-fable-1')).toBe('fable')
  expect(familyOf('gpt-5')).toBeUndefined()
  expect(familyOf('')).toBeUndefined()
})

test('pushHistory keeps the newest ten', () => {
  let h: string[] = []
  for (let i = 0; i < 14; i++) h = pushHistory(h, i % 2 ? 'a' : 'd')
  expect(h).toHaveLength(10)
  expect(h[9]).toBe('a')
})

test('subagent fitness: prior-context words rule it out unless files are named', () => {
  for (const t of ['fix it', 'explain this', 'do that again', 'as discussed, continue', 'the file we edited', 'see the above', 'use the previous result']) {
    expect(refsPriorContext(t)).toBe(true)
    expect(canRunAlone(t)).toBe(false)
  }
  expect(canRunAlone('rename x to n in src/fit.R')).toBe(true)
  expect(canRunAlone('fix it in src/fit.R')).toBe(true) // names a file: allowed
  expect(canRunAlone('write a testthat test for foo()')).toBe(true)
})

test('small display helpers', () => {
  expect(fmtTokens(950)).toBe('950')
  expect(fmtTokens(45_300)).toBe('45k')
  expect(fmtTokens(1_250_000)).toBe('1.3M')
  expect(describeTask('one two three four five six seven eight').split(' ')).toHaveLength(6)
  expect(describeTask('x'.repeat(100)).length).toBeLessThanOrEqual(40)
})

// ------------------------------------------------------------------ the dialog text

const table = ratingTable('deep', 'sonnet', parseCosts(undefined).costs)
const base = { current: 'sonnet' as const, contextTokens: 0, canSubagent: true, hasCodex: false, table, cheaper: '' }
const UNDER = { ...base, risk: 'under' as const, target: 'opus' as const }
const OVER = { ...base, risk: 'over' as const, target: 'haiku' as const, cheaper: '~3x cheaper', table: ratingTable('light', 'sonnet', parseCosts(undefined).costs) }

test('dialog, under-powered: headline "Don\'t use <Current> for this task", the cues, one table line', () => {
  const d = buildDialog({ ...UNDER, prediction: P('deep', 0.9) })
  const lines = d.question.split('\n')
  expect(lines[0]).toBe("Don't use Sonnet for this task")
  expect(lines[1]).toBe('Deep task · r1, r2, r3')
  expect(lines[2]).toBe('Haiku 1x weak · Sonnet 3x weak · Opus 5x best')
  expect(lines[3]).toContain('Opus is the cheapest model that should handle it')
  expect(d.question.split('\n').length).toBeLessThanOrEqual(7) // short: headline, cues, table, advice, one note
  expect(d.order.map(c => d.labels[c])).toEqual([
    'Keep Sonnet',
    'Switch session to Opus',
    'Run this task as a subagent on Opus',
    "Keep Sonnet and don't suggest again this session",
  ])
  expect(d.order.length).toBeLessThanOrEqual(4) // the ask dialog takes 2 to 4 options
})

test('dialog, over-powered: "<Current> is overkill for this" and the saving', () => {
  const d = buildDialog({ ...OVER, prediction: predict('fix typo in README') })
  const lines = d.question.split('\n')
  expect(lines[0]).toBe('Sonnet is overkill for this')
  expect(lines[1]).toBe('Light task · typo or spelling')
  expect(lines[2]).toBe('Haiku 1x ok · Sonnet 3x ok · Opus 5x best')
  expect(lines[3]).toBe('Haiku would do · ~3x cheaper.')
  expect(d.order[1]).toBe('switch')
  expect(d.labels.switch).toBe('Switch session to Haiku')
})

test('dialog: a big context puts the subagent first and warns about the uncached re-read', () => {
  const d = buildDialog({ ...UNDER, contextTokens: 61_000, prediction: P('deep', 0.9) })
  expect(d.order.slice(0, 3)).toEqual(['keep', 'subagent', 'switch'])
  expect(d.question).toContain('re-reads ~61k tokens uncached')
})

test('dialog: a small context says nothing about re-reading', () => {
  const d = buildDialog({ ...UNDER, contextTokens: 9_000, prediction: P('deep', 0.9) })
  expect(d.question).not.toContain('uncached')
  expect(d.order.slice(0, 3)).toEqual(['keep', 'switch', 'subagent'])
})

test('dialog: no subagent option for a prompt that leans on the conversation', () => {
  const d = buildDialog({ ...UNDER, canSubagent: false, prediction: P('deep', 0.9) })
  expect(d.order).toEqual(['keep', 'switch', 'mute'])
})

test('dialog: a review on a weaker model offers Switch and Codex (no subagent, to stay within 4 options)', () => {
  const d = buildDialog({ ...UNDER, prediction: P('review', 0.9), hasCodex: true })
  expect(d.order.map(c => d.labels[c])).toEqual([
    'Keep Sonnet',
    'Switch session to Opus',
    'Ask Codex for a read-only review',
    "Keep Sonnet and don't suggest again this session",
  ])
  expect(d.question).toContain('uses Codex credit')
  expect(d.question).toContain('Review task')
  expect(buildDialog({ ...UNDER, prediction: P('review', 0.9), hasCodex: false }).order).toEqual(['keep', 'switch', 'mute'])
})

test('dialog, self-review: a different model reviews; Keep, Codex, mute only (no model move)', () => {
  const d = buildDialog({ ...base, current: 'opus', risk: 'self', target: undefined, prediction: P('review', 0.9), hasCodex: true })
  expect(d.question.split('\n')[0]).toBe('Get a second opinion on this')
  expect(d.question).toContain('A different model (Codex) catches more than Opus reviewing its own work')
  expect(d.question).toContain('uses Codex credit')
  expect(d.order.map(c => d.labels[c])).toEqual(['Keep Opus', 'Ask Codex for a read-only review', "Keep Opus and don't suggest again this session"])
})

test('choiceOf matches labels exactly and treats free text as no choice', () => {
  const d = buildDialog({ ...UNDER, prediction: P('deep', 0.9) })
  expect(choiceOf(d, 'Switch session to Opus')).toBe('switch')
  expect(choiceOf(d, 'Keep Sonnet')).toBe('keep')
  expect(choiceOf(d, 'switch to opus please')).toBeUndefined()
})

// ------------------------------------------------------------------ /config model row

const row = (o: Partial<ConfigRow> & { key: string }): ConfigRow => ({
  label: o.key,
  kind: 'choice',
  value: 'sonnet',
  provider: { plugin: 'engine', tier: 'core' },
  isLocked: false,
  ...o,
})

test('findModelRow prefers the engine `model` row and never picks another plugin\'s model setting', () => {
  const rows = [
    row({ key: 'reflect.model', kind: 'text', provider: { plugin: 'reflect', tier: 'user' } as never }),
    row({ key: 'fastMode', label: 'Fast model' }),
    row({ key: 'model', options: ['default', 'sonnet', 'opus', 'haiku'] }),
  ]
  expect(findModelRow(rows)?.key).toBe('model')
  expect(findModelRow(rows.slice(0, 2))).toBeUndefined()
})

test('findModelRow falls back to an engine row whose label mentions model', () => {
  const r = findModelRow([row({ key: 'defaultModel', label: 'Default model', options: ['sonnet'] })])
  expect(r?.key).toBe('defaultModel')
})

test('valueFor picks an exact option, else the shortest option containing the alias', () => {
  expect(valueFor(row({ key: 'model', options: ['default', 'opus[1m]', 'opus', 'sonnet'] }), 'opus')).toBe('opus')
  expect(valueFor(row({ key: 'model', options: ['Default', 'Opus 4.1 (1M context)', 'Opus 4.1', 'Haiku 4.5'] }), 'opus')).toBe('Opus 4.1')
  expect(valueFor(row({ key: 'model', options: ['default', 'sonnet'] }), 'opus')).toBeUndefined()
  expect(valueFor(row({ key: 'model', kind: 'text' }), 'haiku')).toBe('haiku')
})
