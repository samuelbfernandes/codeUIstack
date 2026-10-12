import { expect, test } from 'claude-code/testing'

import { WINDOW_MS, fmtDuration, fmtTokens, paceOf, parseTime, projectedPercent } from '../hooks/pace'

const H = 3_600_000
const NOW = 1_000_000_000_000
const FIVE = WINDOW_MS.five_hour!
const WEEK = WINDOW_MS.seven_day!

test('a window under 10% used stays neutral however fast it is going', async () => {
  expect(paceOf(9.9, NOW + 4.9 * H, NOW, FIVE)).toBe('neutral') // 0.1 h in, 9.9% used: would be far past the limit
  expect(paceOf(0, NOW + 2 * H, NOW, FIVE)).toBe('neutral')
})

test('amber when the burn rate reaches 90% before the reset, red at 100%, neutral below 90%', async () => {
  // halfway through a five-hour window (2.5 h left):
  expect(paceOf(44, NOW + 2.5 * H, NOW, FIVE)).toBe('neutral') // 88% projected
  expect(paceOf(45, NOW + 2.5 * H, NOW, FIVE)).toBe('amber') // 90% projected
  expect(paceOf(49, NOW + 2.5 * H, NOW, FIVE)).toBe('amber') // 98%
  expect(paceOf(50, NOW + 2.5 * H, NOW, FIVE)).toBe('red') // 100%
  expect(paceOf(80, NOW + 2.5 * H, NOW, FIVE)).toBe('red')
})

test('the seven-day window is measured over seven days', async () => {
  const left = 3.5 * 24 * H // halfway
  expect(paceOf(46, NOW + left, NOW, WEEK)).toBe('amber')
  expect(paceOf(30, NOW + left, NOW, WEEK)).toBe('neutral')
  expect(Math.round(projectedPercent(30, NOW + left, NOW, WEEK)!)).toBe(60)
})

test('a window already at 100% is red; unknown length, no reset or a passed reset gives no pace', async () => {
  expect(paceOf(100, undefined, NOW, undefined)).toBe('red')
  expect(paceOf(60, NOW + 2 * H, NOW, undefined)).toBe('neutral') // a kind with no known length
  expect(paceOf(60, undefined, NOW, FIVE)).toBe('neutral')
  expect(paceOf(60, NOW - 1, NOW, FIVE)).toBe('neutral') // already reset
  expect(paceOf(60, NOW + 6 * H, NOW, FIVE)).toBe('neutral') // the window has not started by this clock
  expect(paceOf(Number.NaN, NOW + H, NOW, FIVE)).toBe('neutral')
})

test('durations and token counts read short', async () => {
  expect(fmtDuration(72 * 60_000)).toBe('1h 12m')
  expect(fmtDuration(90 * 60_000)).toBe('1h 30m')
  expect(fmtDuration(3 * H)).toBe('3h')
  expect(fmtDuration(45 * 60_000)).toBe('45m')
  expect(fmtDuration(30_000)).toBe('30s')
  expect(fmtDuration(52 * H)).toBe('2d 4h')
  expect(fmtDuration(-5)).toBe('0s')
  expect(fmtTokens(850)).toBe('850')
  expect(fmtTokens(1500)).toBe('1.5k')
  expect(fmtTokens(90_000)).toBe('90k')
  expect(fmtTokens(200_000)).toBe('200k')
  expect(fmtTokens(1_400_000)).toBe('1.4M')
  expect(parseTime('2026-01-01T00:00:00Z')).toBe(Date.UTC(2026, 0, 1))
  expect(parseTime('nope')).toBeUndefined()
  expect(parseTime(undefined)).toBeUndefined()
})
