import { test, expect } from 'claude-code/testing'

import { paceOf, runOutMs } from '../hooks/pace'
import { EMPTY_SNAP, EMPTY_TALLY, bandParts, paceWords } from '../hooks/lib'

const H = 3_600_000
const NOW = Date.parse('2026-01-01T10:00:00Z')
/** A five-hour window that has run `elapsedH` hours. */
const five = (pct: number, elapsedH: number) => ({ kind: 'five_hour', pct, resetsAt: new Date(NOW + (5 - elapsedH) * H).toISOString() })
const seven = (pct: number, elapsedDays: number) => ({ kind: 'seven_day', pct, resetsAt: new Date(NOW + (7 - elapsedDays) * 24 * H).toISOString() })

test('thresholds: projected >= 100 is red, >= 90 amber, else ok', () => {
  expect(paceOf(five(50, 2.5), NOW)).toBe('red') // 50% at half the window projects exactly 100
  expect(paceOf(five(62, 2.5), NOW)).toBe('red')
  expect(paceOf(five(45, 2.5), NOW)).toBe('amber') // projected 90 exactly
  expect(paceOf(five(49, 2.5), NOW)).toBe('amber') // 98
  expect(paceOf(five(44, 2.5), NOW)).toBe('ok') // 88
  expect(paceOf(five(20, 2.5), NOW)).toBe('ok')
})

test('the seven-day window uses its own length', () => {
  expect(paceOf(seven(50, 3.5), NOW)).toBe('red')
  expect(paceOf(seven(30, 3.5), NOW)).toBe('ok')
  expect(paceOf(seven(46, 3.5), NOW)).toBe('amber')
})

test('a window under 10% used is never alarmed, however early', () => {
  expect(paceOf(five(9.9, 0.2), NOW)).toBe('ok')
  expect(paceOf(five(9, 1), NOW)).toBe('ok')
  expect(paceOf(five(10, 1), NOW)).toBe('ok') // exactly 10% counts, but projects only 50
  expect(paceOf(five(10, 0.5), NOW)).toBe('red') // 10% at 10% elapsed projects 100
})

test('a window under 2% elapsed is neutral', () => {
  expect(paceOf(five(30, 0.05), NOW)).toBe('ok') // 1% elapsed
  expect(paceOf(five(30, 0.1), NOW)).toBe('red') // exactly 2% elapsed counts
})

test('other kinds, unreadable or out-of-window timestamps have no pace', () => {
  expect(paceOf({ kind: 'spend_limit', pct: 90, resetsAt: five(1, 1).resetsAt }, NOW)).toBe('none')
  expect(paceOf({ kind: 'five_hour', pct: 90 }, NOW)).toBe('none')
  expect(paceOf({ kind: 'five_hour', pct: 90, resetsAt: 'soon' }, NOW)).toBe('none')
  expect(paceOf(five(90, 0), NOW)).toBe('none') // resets 5h away: window just opened (elapsed 0)
  expect(paceOf({ kind: 'five_hour', pct: 90, resetsAt: new Date(NOW + 6 * H).toISOString() }, NOW)).toBe('none') // longer than the window
  expect(paceOf({ kind: 'five_hour', pct: 90, resetsAt: new Date(NOW - H).toISOString() }, NOW)).toBe('none') // already reset
  expect(paceOf({ kind: 'five_hour', pct: Number.NaN, resetsAt: five(1, 1).resetsAt }, NOW)).toBe('none')
})

test('run-out time: 62% after 2.5h leaves ~1.5h', () => {
  expect(Math.round((runOutMs(five(62, 2.5), NOW) ?? 0) / 60_000)).toBe(92)
  expect(runOutMs(five(5, 2.5), NOW)).toBeUndefined()
  expect(runOutMs({ kind: 'x', pct: 80 }, NOW)).toBeUndefined()
})

test('report words: one clear phrase, nothing for ok', () => {
  expect(paceWords(five(62, 2.5), NOW)).toBe('▲ on pace to run out in ~1h 32m')
  expect(paceWords(five(47, 2.5), NOW)).toBe('▲ running close to the cap by the reset')
  expect(paceWords(five(20, 2.5), NOW)).toBe('')
})

test('the line: a window on pace shows with the arrow and colour level, an ok one stays hidden', () => {
  const T = { limitPct: 0, limitUsd: 0, contextWarnPct: 75 }
  const snap = (w: ReturnType<typeof five>) => ({ ...EMPTY_SNAP, usd: 1, ctxPct: 20, windows: [w] })
  const hot = bandParts(snap(five(62, 2.5)), EMPTY_TALLY, T, { pace: true, now: NOW })!
  expect(hot.map(p => p.text).at(-1)).toBe('5h window 62/100 ▲ !!')
  expect(hot.at(-1)!.level).toBe('error')
  const amber = bandParts(snap(five(47, 2.5)), EMPTY_TALLY, T, { pace: true, now: NOW })!
  expect(amber.at(-1)).toEqual({ text: '5h window 47/100 ▲ !', level: 'warn', isWindow: true })
  expect(bandParts(snap(five(20, 2.5)), EMPTY_TALLY, T, { pace: true, now: NOW })).toBeUndefined()
  expect(bandParts(snap(five(62, 2.5)), EMPTY_TALLY, T, { pace: false, now: NOW })).toBeUndefined() // showPace off: old behaviour
})
