import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }

type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }
type World = {
  usd: number | undefined
  ctx: number
  rateLimits: RateLimit[]
  asks: { question: string; options: string[]; header: string }[]
  answer: string
  logs: string[]
  usageThrows: boolean
  registered: string[]
}

/** Everything the mod reaches through `$` sits beneath it, answered from memory. */
function world(on: On): World {
  const w: World = { usd: 0.5, ctx: 20, rateLimits: [], asks: [], answer: 'Hold it', logs: [], usageThrows: false, registered: [] }
  mock.clock(on, { now: Date.parse('2026-01-01T10:00:00Z') })
  on('session.usage', () => {
    if (w.usageThrows) throw new Error('boom')
    return {
      value: {
        startedAt: 0,
        rateLimits: w.rateLimits,
        context: { window: 200_000, tokens: w.ctx * 2000, percent: w.ctx },
        ...(w.usd === undefined ? {} : { cost: { usd: w.usd } }),
      },
    }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!
    w.asks.push({ question: q.question, options: q.options.map(x => x.label), header: q.header })
    if (w.answer === 'REJECT') throw new Error('dialog dismissed')
    return { result: { questions: e.questions, answers: { [q.question]: w.answer } } } as never
  })
  on('ui.log', (_, e) => (w.logs.push(e.text), { value: undefined }))
  on('command.register', (_, e) => (w.registered.push(e.name), { value: { command: e.name } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  return w
}

const usage = (input: number, output: number, read = 0, write = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  model: 'claude-sonnet-4-5',
})

async function turn($: Engine, id: string, durationMs: number, u = usage(1000, 500, 8000, 1000), extra: object = {}) {
  await $.turn.start({ text: 'go', turnId: id })
  await $.turn.complete({ answer: 'done', durationMs, isAborted: false, turnId: id, reason: 'answer', usage: u, ...extra } as never)
}

/** The engine pushing a reading, as it does after each turn. */
const measure = ($: Engine, w: World) =>
  $.session.measure({
    context: { window: 200_000, tokens: w.ctx * 2000, percent: w.ctx },
    rateLimits: w.rateLimits,
    ...(w.usd === undefined ? {} : { cost: { usd: w.usd } }),
    changed: ['cost'],
  } as never)

const submit = ($: Engine, text: string, extra: object = {}) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)
const mountBand = ($: Engine, surface: (typeof SURFACES)[number], props: object = BAND) =>
  $.ui.mount({ plugin: 'usage-meter', surface, component: 'AbovePrompt', props } as never)
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
const LIMIT = { options: { limitPct: 80 } }
const W5 = (percentUsed: number, resetsAt?: string): RateLimit[] => [{ kind: 'five_hour', percentUsed, ...(resetsAt === undefined ? {} : { resetsAt }) }]
const runCmd = ($: Engine, args: string) =>
  $.command.run({ command: 'usage-meter', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }).then(r => r.text ?? '')

// ---- the band ------------------------------------------------------------------------------

for (const surface of SURFACES) {
  test(`${surface}: the band is hidden while nothing matters`, LIMIT, async ($, on) => {
    const w = world(on)
    w.usd = 400 // dollars never trigger the band
    const band = await mountBand($, surface)
    await measure($, w)
    expect(await band.find({ type: 'Text' })).toBeUndefined()
  })

  test(`${surface}: context and plan windows appear, the offender coloured`, LIMIT, async ($, on) => {
    const w = world(on)
    const band = await mountBand($, surface)
    w.usd = 1.2
    w.ctx = 78
    w.rateLimits = W5(74)
    await measure($, w)
    expect(await texts(band)).toBe('Session ~$1.20 · context 78% ! · 5h window 74/100 · limit 80 !')
    const all = await band.findAll({ type: 'Text' })
    const of = (s: string) => JSON.stringify(all.find(t => t.text.startsWith(s)))
    expect(of('context')).toContain('warning')
    expect(of('5h window')).toContain('warning')
    expect(of('Session')).not.toContain('warning')
  })

  test(`${surface}: at the limit the window part turns error`, LIMIT, async ($, on) => {
    const w = world(on)
    const band = await mountBand($, surface)
    w.rateLimits = W5(82)
    await measure($, w)
    const part = (await band.findAll({ type: 'Text' })).find(t => t.text.startsWith('5h window'))
    expect(part!.text).toBe('5h window 82/100 · limit 80 !!')
    expect(JSON.stringify(part)).toContain('error')
  })

  test(`${surface}: the band yields to a survey`, LIMIT, async ($, on) => {
    const w = world(on)
    w.rateLimits = W5(90)
    const band = await mountBand($, surface, { ...BAND, hasSurvey: true })
    await measure($, w)
    expect(await band.find({ type: 'Text' })).toBeUndefined()
  })
}

test('without a ledger the band uses the token estimate and says est.', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = undefined
  w.ctx = 80
  const band = await mountBand($, 'terminal')
  await turn($, 't1', 1000, usage(1_000_000, 100_000)) // ~$4.50 at Sonnet rates
  await measure($, w)
  expect(await texts(band)).toBe('Session ~$4.50 est. · context 80% !')
})

test('showLine = false: no band', { options: { limitPct: 80, showLine: false } }, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(90)
  const band = await mountBand($, 'terminal')
  await measure($, w)
  expect(await band.find({ type: 'Text' })).toBeUndefined()
})

test('a surface that does not raise the band gets nothing', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(90)
  const band = await $.ui.mount({ plugin: 'usage-meter', surface: 'mobile', component: 'AbovePrompt', props: BAND } as never)
  await measure($, w)
  expect(await band.find({ type: 'Text' })).toBeUndefined()
})

// ---- the limit guard -----------------------------------------------------------------------

test('no limit (default): never asks, however full the window is', async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(99)
  const r = await submit($, 'keep going')
  expect(r.drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('under the percent limit: no dialog, however much money is spent (no dollar limit)', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 500
  w.rateLimits = W5(79)
  expect((await submit($, 'keep going')).drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('no plan window and no dollar limit: nothing to enforce, never refuses, never asks', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 500
  w.rateLimits = []
  const r = await submit($, 'keep going')
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe('keep going')
  expect(w.asks).toEqual([])
})

test('at the limit: one dialog with the three options; Hold it drops with one line and echoes the text', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(82, '2026-01-01T11:12:00Z')
  const r = await submit($, 'summarise the repo')
  expect(r.drop).toBe('usage-meter blocked your prompt · nothing was sent')
  expect(w.logs).toEqual(['summarise the repo'])
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.header).toBe('Budget')
  expect(w.asks[0]!.options).toEqual(['Continue (+10 points)', 'Continue without limit', 'Hold it'])
  expect(w.asks[0]!.question).toContain('5h window')
  expect(w.asks[0]!.question).toContain('82/100')
  expect(w.asks[0]!.question).toContain('1h 12m')
  expect(w.asks[0]!.question).toContain('limit of 80')
})

test('any window counts: the 7d window alone can trigger the dialog', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day', percentUsed: 85 }]
  await submit($, 'go')
  expect(w.asks[0]!.question).toContain('7d window')
})

test('Esc holds the prompt the same way', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(82)
  w.answer = 'REJECT'
  expect((await submit($, 'again')).drop).toBe('usage-meter blocked your prompt · nothing was sent')
})

test('Continue (+10 points) sends the prompt and raises the limit, so the next prompt does not ask', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(82)
  w.answer = 'Continue (+10 points)'
  const r = await submit($, 'go on')
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe('go on')
  expect((await submit($, 'and again')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(1)
  expect(await runCmd($, '')).toContain('5h window 82/100 · limit 90')
  w.rateLimits = W5(91) // the raised limit is reached in its turn
  await submit($, 'more')
  expect(w.asks).toHaveLength(2)
})

test('Continue without limit turns the limit off for the session', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(82)
  w.answer = 'Continue without limit'
  expect((await submit($, 'go on')).drop).toBeUndefined()
  w.rateLimits = W5(99)
  expect((await submit($, 'still going')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(1)
})

test('never asks for a slash command, a mid-turn, queued or scripted prompt', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(95)
  expect((await submit($, '/compact')).drop).toBeUndefined()
  expect((await submit($, 'queued', { turnId: 'busy' })).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'scheduled', wait: false, origin: { kind: 'cron' } } as never)).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin' } } as never)).drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('tool calls are never refused', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(95)
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'ok' }) as never)
  const r = await $.tool.call({ tool: 'Bash', input: { command: 'ls' }, toolUseId: 'x' } as never)
  expect(JSON.stringify(r)).not.toContain('deny')
  expect(w.asks).toEqual([])
})

test('fail open: if the usage cannot be read, the prompt goes through', LIMIT, async ($, on) => {
  const w = world(on)
  w.usageThrows = true
  expect((await submit($, 'hello')).drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('enabled = false: no guard, no command answer', { options: { enabled: false, limitPct: 80 } }, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(95)
  expect((await submit($, 'hello')).drop).toBeUndefined()
  expect(await runCmd($, '')).toContain('disabled')
  expect(w.asks).toEqual([])
})

// ---- the slash command, timing -------------------------------------------------------------

test('a typed bare "usage", "budget" or "budget 10" is NOT handled: the prompt passes through', LIMIT, async ($, on) => {
  const w = world(on)
  for (const text of ['usage', 'Usage.', 'budget', 'usage-meter', 'budget 10', 'what is my usage']) {
    const r = await submit($, text)
    expect(r.drop).toBeUndefined()
    expect(r.text).toBe(text)
  }
  expect(w.logs).toEqual([])
  expect(await runCmd($, '')).not.toContain('limit 10') // "budget 10" set nothing
})

test('/usage-meter prints the report with each window as used/total and the limit', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 1.2
  w.ctx = 40
  w.rateLimits = W5(62, '2026-01-01T11:12:00Z')
  await turn($, 't1', 42_000)
  await turn($, 't2', 190_000)
  const box = await runCmd($, '')
  expect(box.split('\n')[0]).toBe('usage-meter · session ~$1.20 · 2 turns')
  expect(box).toContain('Cost      ~$1.20')
  expect(box).toContain('Tokens    in 20k · out 1.0k')
  expect(box).toContain('Cache     hit 89% · read 16k · written 2.0k')
  expect(box).toContain('Context   40% full of 200k')
  expect(box).toContain('Last turn 3m 10s · 11k tokens')
  expect(box).toContain('Longest   3m 10s')
  expect(box).toContain('5h window 62/100 · limit 80 · resets in 1h 12m')
  expect(w.asks).toEqual([])
})

test('/usage-meter with no plan window says so plainly', async ($, on) => {
  world(on)
  const box = await runCmd($, '')
  expect(box).toContain('API-key use: the limit is in dollars')
  expect(box).toContain('Cost      ~$0.50')
})

test('/usage-meter 80 sets the limit for this session, 0 and off clear it', async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(70)
  expect(await runCmd($, '80')).toBe('usage-meter · limit 80/100 for this session')
  w.rateLimits = W5(85)
  expect((await submit($, 'next')).drop).toBe('usage-meter blocked your prompt · nothing was sent')
  expect(await runCmd($, '0')).toBe('usage-meter · no limit for this session')
  expect((await submit($, 'next')).drop).toBeUndefined()
  await runCmd($, '60')
  expect(await runCmd($, 'off')).toBe('usage-meter · no limit for this session')
  expect((await submit($, 'next')).drop).toBeUndefined()
})

test('the session value overrides the setting', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(70)
  expect((await submit($, 'go')).drop).toBeUndefined() // setting 80: fine at 70
  await runCmd($, '60')
  expect((await submit($, 'go')).drop).toBe('usage-meter blocked your prompt · nothing was sent') // session 60: over
})

test('setting a limit with no plan window warns that it cannot be enforced', async ($, on) => {
  world(on)
  const out = await runCmd($, '80')
  expect(out).toContain('cannot be enforced')
  expect(out).toContain('$10')
})

test('/usage-meter registers at session start; a bad argument just gives the report', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  expect(w.registered).toEqual(['usage-meter'])
  expect(await runCmd($, '')).toContain('Cost')
  expect(await runCmd($, 'whatever')).toContain('Cost')
})

test('turn timing: longest survives the cap, subagent turns count tokens but not timing', async ($, on) => {
  world(on)
  for (let i = 0; i < 60; i++) await turn($, `t${i}`, i === 3 ? 600_000 : 1000 + i)
  await turn($, 'sub', 999_000, usage(100, 0), { agentId: 'a1' })
  const box = await runCmd($, '')
  expect(box).toContain('Longest   10m 00s') // turn 3 left the 50-turn list long ago
  expect(box).toContain('Last turn 1s · 11k tokens') // 1059 ms is the last main-loop turn
  expect(box).toContain('in 600k') // 60 x 9000 + the subagent's 100
})

test('/clear starts the totals over', async ($, on) => {
  world(on)
  await turn($, 't1', 5000)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(await runCmd($, '')).toContain('Last turn none yet')
})

// ---- the dollar limit ----------------------------------------------------------------------

const DOLLARS = { options: { limitUsd: 10 } }

test('dollar limit (setting): under it no dialog; at it one dialog with the dollar text and +50%', DOLLARS, async ($, on) => {
  const w = world(on)
  w.usd = 9.99
  expect((await submit($, 'go')).drop).toBeUndefined()
  expect(w.asks).toEqual([])
  w.usd = 12.4
  const r = await submit($, 'summarise')
  expect(r.drop).toBe('usage-meter blocked your prompt · nothing was sent')
  expect(w.logs).toEqual(['summarise'])
  expect(w.asks[0]!.question).toBe('Session cost is ~$12.4, at or above your limit of $10. Continue?')
  expect(w.asks[0]!.options).toEqual(['Continue (+50%)', 'Continue without limit', 'Hold it'])
  expect(w.asks[0]!.header).toBe('Budget')
})

test('dollar limit works with no plan window (API-key use) and Esc holds', DOLLARS, async ($, on) => {
  const w = world(on)
  w.rateLimits = []
  w.usd = 11
  w.answer = 'REJECT'
  expect((await submit($, 'go')).drop).toBe('usage-meter blocked your prompt · nothing was sent')
})

test('Continue (+50%) raises the dollar limit by half; Continue without limit clears it', DOLLARS, async ($, on) => {
  const w = world(on)
  w.usd = 10.5
  w.answer = 'Continue (+50%)'
  expect((await submit($, 'go')).drop).toBeUndefined()
  expect((await submit($, 'again')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(1)
  expect(await runCmd($, '')).toContain('limit $15')
  w.usd = 15.5
  w.answer = 'Continue without limit'
  expect((await submit($, 'more')).drop).toBeUndefined()
  w.usd = 900
  expect((await submit($, 'still')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(2)
})

test('/usage-meter $10 sets the dollar limit for the session; 80 stays percent; off and 0 clear both', async ($, on) => {
  const w = world(on)
  expect(await runCmd($, '$10')).toBe('usage-meter · limit $10 for this session')
  w.usd = 10.5
  expect((await submit($, 'next')).drop).toBe('usage-meter blocked your prompt · nothing was sent')
  expect(await runCmd($, 'off')).toBe('usage-meter · no limit for this session')
  expect((await submit($, 'next')).drop).toBeUndefined()
  await runCmd($, '$10')
  await runCmd($, '0')
  expect((await submit($, 'next')).drop).toBeUndefined()
  w.usd = 1
  w.rateLimits = W5(85)
  await runCmd($, '$10') // dollar only: the window is not a limit
  expect((await submit($, 'next')).drop).toBeUndefined()
  await runCmd($, '80') // now percent as well: the window is over it
  expect((await submit($, 'next')).drop).toBe('usage-meter blocked your prompt · nothing was sent')
  expect(await runCmd($, '')).toContain('5h window 85/100 · limit 80')
})

test('both limits hit: one dialog names both and Continue raises both', { options: { limitUsd: 10, limitPct: 80 } }, async ($, on) => {
  const w = world(on)
  w.usd = 12.4
  w.rateLimits = W5(82)
  w.answer = 'Continue (+10 points / +50%)'
  expect((await submit($, 'go')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(1)
  const q = w.asks[0]!.question
  expect(q).toContain('5h window is at 82/100')
  expect(q).toContain('limit of 80')
  expect(q).toContain('session cost is ~$12.4, at or above your limit of $10')
  expect(w.asks[0]!.options[0]).toBe('Continue (+10 points / +50%)')
  const box = await runCmd($, '')
  expect(box).toContain('limit $15')
  expect(box).toContain('5h window 82/100 · limit 90')
  expect((await submit($, 'again')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(1)
})

test('the band marks cost at 90% and 100% of a dollar limit', DOLLARS, async ($, on) => {
  const w = world(on)
  const band = await mountBand($, 'terminal')
  w.usd = 9.5
  await measure($, w)
  expect(await texts(band)).toBe('Session ~$9.50 · limit $10 ! · context 20%')
  w.usd = 10.5
  await measure($, w)
  expect(await texts(band)).toBe('Session ~$10.5 · limit $10 !! · context 20%')
})

test('fail open: a dollar limit with an unreadable usage still lets the prompt through', DOLLARS, async ($, on) => {
  const w = world(on)
  w.usageThrows = true
  expect((await submit($, 'hello')).drop).toBeUndefined()
})

test('a held multi-line prompt is echoed one transcript line per line, indentation kept, none with a line break', LIMIT, async ($, on) => {
  const w = world(on)
  w.rateLimits = W5(82, '2026-01-01T11:12:00Z')
  await submit($, 'fix this:\n\ndef f():\n\treturn 1\r\n')
  expect(w.logs).toEqual(['fix this:', 'def f():', '  return 1'])
  expect(w.logs.every(l => !/[\r\n]/.test(l))).toBe(true) // a newline in $.ui.log draws as a stray glyph
})

test('a plan window in the band is a button: a click puts /usage in the prompt box', LIMIT, async ($, on) => {
  const w = world(on)
  const filled: string[] = []
  on('prompt.fill', (_$, e) => (filled.push((e as { text: string }).text), { isFilled: true } as never))
  on('ui.toast', () => ({ value: undefined }))
  const band = await mountBand($, 'desktop')
  w.rateLimits = W5(74)
  await measure($, w)
  const buttons = await band.findAll({ type: 'Button' })
  expect(buttons.length).toBe(1) // only the window; the cost and context stay plain text
  await band.press({ key: (buttons[0] as { key: string }).key })
  expect(filled).toEqual(['/usage'])
})
