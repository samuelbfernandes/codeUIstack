import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addSpend, atomOf, cleanLedger, dateKey, deltaOf, lastDays, pruneLedger } from '../hooks/ledger'
import { ledgerReport, parseArgs } from '../hooks/lib'

const at = (y: number, m: number, d: number, h = 10) => new Date(y, m - 1, d, h).getTime()
const DAY = 86_400_000
const near = (n: number | undefined): number => Math.round((n ?? NaN) * 1e6) / 1e6
const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }

// ---- pure ----------------------------------------------------------------------------------

test('dateKey is the local date; deltaOf counts growth, and a first reading only for a session begun today', () => {
  expect(dateKey(at(2026, 3, 9, 23))).toBe('2026-03-09')
  const now = at(2026, 1, 1)
  expect(deltaOf(null, at(2026, 1, 1, 8), 2, now).delta).toBe(2) // began today: its 2 dollars are today's
  expect(deltaOf(null, at(2025, 12, 30), 7, now).delta).toBe(0) // resumed: old spend not counted again
  const first = deltaOf(null, at(2025, 12, 30), 7, now).last
  expect(near(deltaOf(first, at(2025, 12, 30), 7.5, now).delta)).toBe(0.5)
  expect(deltaOf(first, at(2025, 12, 30), 7, now).delta).toBe(0)
  expect(deltaOf(first, at(2025, 12, 30), 1, now).delta).toBe(0) // falling total: restarted, counted from here
  expect(deltaOf(first, at(2026, 1, 1), 3, now).delta).toBe(3) // a new startedAt is a new session
})

test('60-day cap: older days are dropped, the newest 60 kept', () => {
  const now = at(2026, 6, 1)
  const l: Record<string, number> = {}
  for (let i = 0; i < 90; i++) l[dateKey(now - i * DAY)] = 1
  const kept = pruneLedger(l, now)
  expect(Object.keys(kept)).toHaveLength(60)
  expect(kept[dateKey(now)]).toBe(1)
  expect(kept[dateKey(now - 59 * DAY)]).toBe(1)
  expect(kept[dateKey(now - 60 * DAY)]).toBeUndefined()
  expect(Object.keys(addSpend(l, now, 0.5))).toHaveLength(60)
})

test('week total: with a seven_day window, days since it opened; without, null', () => {
  const now = at(2026, 1, 10)
  const l = { '2026-01-10': 2, '2026-01-09': 3, '2026-01-04': 5, '2026-01-02': 7 }
  const reset = new Date(at(2026, 1, 12)).toISOString() // opened 5 Jan... resetsAt - 7d = Jan 5
  expect(atomOf(l, now, [{ kind: 'seven_day', pct: 30, resetsAt: reset }])).toEqual({ today: 2, week: 5 })
  expect(atomOf(l, now, [{ kind: 'five_hour', pct: 30, resetsAt: reset }])).toEqual({ today: 2, week: null })
  expect(atomOf(l, now, [{ kind: 'seven_day', pct: 30 }])).toEqual({ today: 2, week: null }) // no readable reset
  expect(atomOf(l, now, [])).toEqual({ today: 2, week: null })
})

test('cleanLedger drops junk; lastDays lists zeros; ledger report', () => {
  expect(cleanLedger({ '2026-01-01': 2, bad: 1, '2026-01-02': -1, '2026-01-03': 'x' })).toEqual({ '2026-01-01': 2 })
  expect(cleanLedger(null)).toEqual({})
  expect(cleanLedger([1])).toEqual({})
  const now = at(2026, 1, 8)
  expect(lastDays({ '2026-01-08': 1.5 }, now, 3).map(d => d.date)).toEqual(['2026-01-08', '2026-01-07', '2026-01-06'])
  const r = ledgerReport({ '2026-01-08': 1.5, '2026-01-06': 2 }, now)
  expect(r.split('\n')).toHaveLength(9)
  expect(r).toContain('Today     $1.50  (2026-01-08)')
  expect(r).toContain('2026-01-06  $2.00')
  expect(r).toContain('Total     $3.50')
})

test('the /usage-meter ledger words', () => {
  expect(parseArgs('ledger')).toEqual({ kind: 'ledger' })
  expect(parseArgs(' Ledger  Clear ')).toEqual({ kind: 'report' }) // exact words only: two spaces are not the command
  expect(parseArgs('ledger clear')).toEqual({ kind: 'ledgerClear' })
})

// ---- through the engine --------------------------------------------------------------------

type W = {
  usd: number | undefined
  startedAt: number
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  store: Map<string, unknown>
  state: Map<string, unknown>
  storeThrows: boolean
  clock: ReturnType<typeof mock.clock>
}

function world(on: On, o: { now: number; startedAt?: number; store?: Record<string, unknown>; spyState?: boolean }): W {
  const w: W = { usd: 0, startedAt: o.startedAt ?? o.now, rateLimits: [], store: new Map(Object.entries(o.store ?? {})), state: new Map(), storeThrows: false, clock: mock.clock(on, { now: o.now }) }
  on('session.usage', () => ({
    value: { startedAt: w.startedAt, rateLimits: w.rateLimits, context: { window: 200_000, tokens: 1000, percent: 1 }, ...(w.usd === undefined ? {} : { cost: { usd: w.usd } }) },
  }))
  on('store.get', (_$, e) => {
    if (w.storeThrows) throw new Error('store down')
    return { value: w.store.get(e.key) }
  })
  on('store.set', (_$, e) => {
    if (w.storeThrows) throw new Error('store down')
    return w.store.set(e.key, e.value), { value: undefined }
  })
  // The engine's own state redraws the band; spying on it (to read the atom) is for the tests that do not draw.
  if (o.spyState !== false) on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  if (o.spyState !== false) on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  return w
}

const measure = ($: Engine, w: W) =>
  $.session.measure({ context: { window: 200_000, tokens: 1000, percent: 1 }, rateLimits: w.rateLimits, ...(w.usd === undefined ? {} : { cost: { usd: w.usd } }), changed: ['cost'] } as never)
const runCmd = ($: Engine, args: string) =>
  $.command.run({ command: 'usage-meter', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }).then(r => r.text ?? '')
const ledger = (w: W) => w.store.get('ledger') as Record<string, number> | undefined
const atomOfState = (w: W) => w.state.get('usage-meter.ledger')
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')

const NOW = at(2026, 1, 10)
const TODAY = '2026-01-10'

test('delta math across measurements: growth is added, a repeat adds nothing', async ($, on) => {
  const w = world(on, { now: NOW })
  w.usd = 1
  await measure($, w)
  w.usd = 1 // no growth
  await measure($, w)
  w.usd = 2.5
  await measure($, w)
  expect(near(ledger(w)![TODAY])).toBe(2.5)
})

test('across midnight: spend after midnight lands on the next day', async ($, on) => {
  const w = world(on, { now: at(2026, 1, 10, 23) })
  w.usd = 1
  await measure($, w)
  await w.clock.advance(2 * 3_600_000) // 01:00 on the 11th
  w.usd = 3
  await measure($, w)
  expect(ledger(w)).toEqual({ '2026-01-10': 1, '2026-01-11': 2 })
  expect(atomOfState(w)).toEqual({ today: 2, week: null })
})

test('a resumed session does not double count its old spend; only new spend counts', async ($, on) => {
  const w = world(on, { now: NOW, startedAt: at(2026, 1, 8), store: { ledger: { '2026-01-08': 9 } } })
  w.usd = 9
  await measure($, w)
  expect(ledger(w)).toEqual({ '2026-01-08': 9 }) // nothing added
  w.usd = 9.75
  await measure($, w)
  expect(near(ledger(w)![TODAY])).toBe(0.75)
  expect(ledger(w)!['2026-01-08']).toBe(9)
})

test('a session that began today counts from zero on its first reading; two sessions add up', async ($, on) => {
  const w = world(on, { now: NOW, startedAt: at(2026, 1, 10, 8), store: { ledger: { [TODAY]: 4 } } })
  w.usd = 1.5
  await measure($, w)
  expect(near(ledger(w)![TODAY])).toBe(5.5)
})

test('week total with a seven_day window, null without; the atom mirrors { today, week }', async ($, on) => {
  const w = world(on, { now: NOW, store: { ledger: { '2026-01-04': 5, '2026-01-02': 7, '2026-01-09': 3 } } })
  w.usd = 2
  await measure($, w)
  expect(atomOfState(w)).toEqual({ today: 2, week: null })
  w.rateLimits = [{ kind: 'seven_day', percentUsed: 40, resetsAt: new Date(at(2026, 1, 12)).toISOString() }]
  w.usd = 2.5
  await measure($, w)
  expect(atomOfState(w)).toEqual({ today: 2.5, week: 5.5 }) // since Jan 5: the 9th (3) + today (2.5); the 2nd and 4th are before the window opened
})

test('clear empties the ledger and the atom; ledger prints the last 7 days', async ($, on) => {
  const w = world(on, { now: NOW, startedAt: at(2026, 1, 1), store: { ledger: { '2026-01-09': 3, [TODAY]: 1 } } })
  w.usd = 1
  await measure($, w)
  const shown = await runCmd($, 'ledger')
  expect(shown).toContain('last 7 days')
  expect(shown).toContain('2026-01-09  $3.00')
  expect(await runCmd($, 'ledger clear')).toContain('cleared')
  expect(ledger(w)).toEqual({})
  expect(atomOfState(w)).toEqual({ today: 0, week: null })
  expect(await runCmd($, 'ledger')).toContain('Total     $0.00')
})

test('the report and the line show Today / Week; the settings turn them off', async ($, on) => {
  const w = world(on, { spyState: false, now: NOW, startedAt: NOW, store: { ledger: { '2026-01-09': 3 } } })
  w.rateLimits = [{ kind: 'seven_day', percentUsed: 85, resetsAt: new Date(at(2026, 1, 12)).toISOString() }]
  w.usd = 1.25
  const band = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  await measure($, w)
  expect(await texts(band)).toContain('Today $1.25 · Week $4.25')
  const r = await runCmd($, '')
  expect(r).toContain('Today     $1.25')
  expect(r).toContain('Week      $4.25')
})

test('showDailyCost = false hides Today everywhere', { options: { showDailyCost: false } }, async ($, on) => {
  const w = world(on, { spyState: false, now: NOW })
  w.rateLimits = [{ kind: 'seven_day', percentUsed: 85, resetsAt: new Date(at(2026, 1, 12)).toISOString() }]
  w.usd = 1.25
  const band = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  await measure($, w)
  expect(await texts(band)).not.toContain('Today')
  expect(await texts(band)).toContain('Week $1.25')
  const r = await runCmd($, '')
  expect(r).not.toContain('Today ')
  expect(r).toContain('Week      $1.25')
})

test('showWeeklyCost = false hides Week everywhere', { options: { showWeeklyCost: false } }, async ($, on) => {
  const w = world(on, { spyState: false, now: NOW })
  w.rateLimits = [{ kind: 'seven_day', percentUsed: 85, resetsAt: new Date(at(2026, 1, 12)).toISOString() }]
  w.usd = 1.25
  const band = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  await measure($, w)
  expect(await texts(band)).toContain('Today $1.25')
  expect(await texts(band)).not.toContain('Week')
  expect(await runCmd($, '')).not.toContain('Week ')
})

test('pace in the report and the setting; showPace = false keeps the old report', async ($, on) => {
  const w = world(on, { now: Date.parse('2026-01-01T10:00:00Z') })
  w.rateLimits = [{ kind: 'five_hour', percentUsed: 62, resetsAt: '2026-01-01T12:30:00Z' }]
  expect(await runCmd($, '')).toContain('5h window 62/100 · no limit · resets in 2h 30m · ▲ on pace to run out in ~1h 32m')
})

test('showPace = false: no arrow in the report or the line', { options: { showPace: false } }, async ($, on) => {
  const w = world(on, { spyState: false, now: Date.parse('2026-01-01T10:00:00Z') })
  w.rateLimits = [{ kind: 'five_hour', percentUsed: 62, resetsAt: '2026-01-01T12:30:00Z' }]
  const band = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  await measure($, w)
  expect(await runCmd($, '')).not.toContain('▲')
  expect(await band.find({ type: 'Text' })).toBeUndefined()
})

test('pace shows the arrow in the line for a window on pace', async ($, on) => {
  const w = world(on, { spyState: false, now: Date.parse('2026-01-01T10:00:00Z') })
  w.rateLimits = [{ kind: 'five_hour', percentUsed: 62, resetsAt: '2026-01-01T12:30:00Z' }]
  const band = await $.ui.mount({ plugin: 'usage-meter', surface: 'terminal', component: 'AbovePrompt', props: BAND } as never)
  await measure($, w)
  expect(await texts(band)).toContain('5h window 62/100 ▲ !')
})

test('fail open: a broken store never throws into the engine, the report still answers', async ($, on) => {
  const w = world(on, { now: NOW })
  w.storeThrows = true
  w.usd = 2
  await measure($, w)
  expect(await runCmd($, '')).toContain('usage-meter · session')
  expect(await runCmd($, 'ledger')).toContain('Total     $0.00')
})

test('no engine cost: nothing is added and the atom stays zero', async ($, on) => {
  const w = world(on, { now: NOW })
  w.usd = undefined
  await measure($, w)
  expect(ledger(w)).toBeUndefined()
  expect(atomOfState(w)).toEqual({ today: 0, week: null })
})

test('disabled: the ledger is untouched', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { now: NOW })
  w.usd = 5
  await measure($, w)
  expect(ledger(w)).toBeUndefined()
})
