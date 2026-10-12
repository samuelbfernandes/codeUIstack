import { test, expect } from 'claude-code/testing'

import { estimate, levelOf, parseUsage } from '../hooks/estimate'
import type { Usage } from '../hooks/estimate'
import { readConfig } from '../hooks/config'
import { bar, dollars, fmtTokens } from '../hooks/format'

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b) <= tol).toBe(true)
const base = { files: 3, reviewer: 'codex' as const, history: [] as Usage[] }

test('estimate: the documented formula, worked by hand for a 35000-byte diff', () => {
  // diffTokens 10000, input 11800; low 11800+6000+1500; high 3*11800+12000+5000; expected = midpoint
  const e = estimate({ ...base, diffBytes: 35_000 })
  expect(e.low).toBe(19_300)
  expect(e.high).toBe(52_400)
  expect(e.expected).toBe(35_850)
  expect(e.output).toBe(3250)
  expect(e.input).toBe(35_850 - 3250)
  expect(e.level).toBe('amber')
  expect(e.calibratedFrom).toBe(0)
  expect(e.factor).toBe(1)
})

test('estimate: an empty diff still costs the prompt and overhead; low <= expected <= high always', () => {
  for (const bytes of [0, 1, 200, 5000, 120_000, 10_000_000]) {
    const e = estimate({ ...base, diffBytes: bytes })
    expect(e.low).toBeLessThanOrEqual(e.expected)
    expect(e.expected).toBeLessThanOrEqual(e.high)
  }
  expect(estimate({ ...base, diffBytes: 0 }).low).toBe(1800 + 6000 + 1500)
})

test('levels: green <= greenMax, red >= redMin, amber between, thresholds are configurable', () => {
  const t = { greenMax: 25_000, redMin: 60_000 }
  expect(levelOf(25_000, t)).toBe('green')
  expect(levelOf(30_001, t)).toBe('amber')
  expect(levelOf(59_999, t)).toBe('amber')
  expect(levelOf(60_000, t)).toBe('red')
  expect(estimate({ ...base, diffBytes: 4_000 }).level).toBe('green') // a small diff
  expect(estimate({ ...base, diffBytes: 40_000 }).level).toBe('amber')
  expect(estimate({ ...base, diffBytes: 120_000 }).level).toBe('red') // the default cap: expected ~84k
})

test('levels: a small diff is green by default, and custom thresholds move the boundary', () => {
  expect(estimate({ ...base, diffBytes: 3000 }).level).toBe('green')
  expect(estimate({ ...base, diffBytes: 3000, thresholds: { greenMax: 1000, redMin: 5000 } }).level).toBe('red')
})

const past = (bytes: number, factor: number): Usage => ({ bytes, tokens: Math.round(estimate({ ...base, diffBytes: bytes }).expected * factor) })

test('calibration: fewer than 3 past reviews changes nothing', () => {
  const e = estimate({ ...base, diffBytes: 35_000, history: [past(35_000, 2), past(20_000, 2)] })
  expect(e.calibratedFrom).toBe(0)
  expect(e.expected).toBe(35_850)
})

test('calibration: scales by the median actual/predicted ratio and says from how many', () => {
  const history = [past(10_000, 2), past(20_000, 2), past(30_000, 2), past(40_000, 100)] // median of 2,2,2,100 = 2
  const e = estimate({ ...base, diffBytes: 35_000, history })
  expect(e.calibratedFrom).toBe(4)
  near(e.factor, 2, 0.05)
  near(e.expected, 71_700, 1500)
  near(e.low, 2 * 19_300, 800)
})

test('calibration: factor is clamped to 0.3..4; only the last 10 count; junk entries are ignored', () => {
  expect(estimate({ ...base, diffBytes: 35_000, history: [past(1000, 50), past(2000, 50), past(3000, 50)] }).factor).toBe(4)
  expect(estimate({ ...base, diffBytes: 35_000, history: [past(1000, 0.01), past(2000, 0.01), past(3000, 0.01)] }).factor).toBe(0.3)
  const old = Array.from({ length: 20 }, () => past(5000, 4)) // 20 old, wildly high
  const recent = Array.from({ length: 10 }, () => past(5000, 1))
  near(estimate({ ...base, diffBytes: 5000, history: [...old, ...recent] }).factor, 1, 0.05)
  const junk: Usage[] = [{ bytes: NaN, tokens: 5 }, { bytes: 10, tokens: 0 }, { bytes: -1, tokens: 9 }]
  expect(estimate({ ...base, diffBytes: 5000, history: junk }).calibratedFrom).toBe(0)
})

test('reviewer does not change the numbers (only the label the caller shows)', () => {
  expect(estimate({ ...base, diffBytes: 9000, reviewer: 'claude' })).toEqual(estimate({ ...base, diffBytes: 9000 }))
})

test('parseUsage: reads <bytes>:<tokens>, ignores junk', () => {
  expect(parseUsage(['1200:34000', ' 5:6 ', 'abc', '12:', ':9', '1:2:3', '-4:5', ''])).toEqual([
    { bytes: 1200, tokens: 34_000 },
    { bytes: 5, tokens: 6 },
  ])
})

test('format helpers: tokens, bar, dollars (none unless both prices are set)', () => {
  expect(fmtTokens(950)).toBe('950')
  expect(fmtTokens(4200)).toBe('4.2k')
  expect(fmtTokens(42_400)).toBe('42k')
  expect(bar(50_000, 100_000)).toBe('\u25B0\u25B0\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1')
  expect(bar(1, 100_000)).toBe('\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1')
  expect(bar(900_000, 100_000)).toBe('\u25B0'.repeat(10))
  const e = estimate({ ...base, diffBytes: 35_000 })
  expect(dollars(e, { inputUsdPerMTok: 0, outputUsdPerMTok: 0 })).toBeUndefined()
  expect(dollars(e, { inputUsdPerMTok: 3, outputUsdPerMTok: 0 })).toBeUndefined()
  expect(dollars(e, { inputUsdPerMTok: 2, outputUsdPerMTok: 10 })).toBe('$0.10')
})

test('readConfig: defaults, bad values, red always above green', () => {
  const d = readConfig({})
  expect(d).toMatchObject({ thresholds: { greenMax: 25_000, redMin: 60_000 }, askAlways: false, coloredBanner: true })
  expect(readConfig({ greenMaxTokens: -5, redMinTokens: 'x' as never }).thresholds).toEqual({ greenMax: 25_000, redMin: 60_000 })
  expect(readConfig({ greenMaxTokens: 200_000 }).thresholds.redMin).toBe(200_001)
  expect(readConfig({ askWhen: 'always', coloredBanner: false })).toMatchObject({ askAlways: true, coloredBanner: false })
})
