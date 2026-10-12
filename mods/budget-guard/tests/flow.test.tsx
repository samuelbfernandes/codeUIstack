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
  $.ui.mount({ plugin: 'budget-guard', surface, component: 'AbovePrompt', props } as never)
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
const LIMIT = { options: { limitUsd: 5 } }

// ---- the band ------------------------------------------------------------------------------

for (const surface of SURFACES) {
  test(`${surface}: the band is hidden while nothing matters`, LIMIT, async ($, on) => {
    const w = world(on)
    const band = await mountBand($, surface)
    await measure($, w)
    expect(await band.find({ type: 'Text' })).toBeUndefined()
  })

  test(`${surface}: cost, context and plan windows appear, the offender coloured`, LIMIT, async ($, on) => {
    const w = world(on)
    const band = await mountBand($, surface)
    w.usd = 1.2
    w.ctx = 78
    w.rateLimits = [{ kind: 'five_hour', percentUsed: 82 }]
    await measure($, w)
    expect(await texts(band)).toBe('Session ~$1.20 of $5 · context 78% ! · 5h plan 82% !')
    const all = await band.findAll({ type: 'Text' })
    const of = (s: string) => JSON.stringify(all.find(t => t.text.startsWith(s)))
    expect(of('context')).toContain('warning')
    expect(of('5h plan')).toContain('warning')
    expect(of('Session')).not.toContain('warning')
  })

  test(`${surface}: at the limit the cost part turns error`, LIMIT, async ($, on) => {
    const w = world(on)
    const band = await mountBand($, surface)
    w.usd = 5.4
    await measure($, w)
    const cost = (await band.findAll({ type: 'Text' })).find(t => t.text.startsWith('Session'))
    expect(cost!.text).toBe('Session ~$5.40 of $5 !!')
    expect(JSON.stringify(cost)).toContain('error')
  })

  test(`${surface}: the band yields to a survey`, LIMIT, async ($, on) => {
    const w = world(on)
    w.usd = 4.9
    const band = await mountBand($, surface, { ...BAND, hasSurvey: true })
    await measure($, w)
    expect(await band.find({ type: 'Text' })).toBeUndefined()
  })
}

test('without a ledger the band uses the token estimate and says est.', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = undefined
  const band = await mountBand($, 'terminal')
  await turn($, 't1', 1000, usage(1_000_000, 100_000)) // ~$4.50 at Sonnet rates
  await measure($, w)
  expect(await texts(band)).toBe('Session ~$4.50 est. of $5 ! · context 20%')
})

test('showLine = false and enabled = false: no band', { options: { limitUsd: 5, showLine: false } }, async ($, on) => {
  const w = world(on)
  w.usd = 6
  const band = await mountBand($, 'terminal')
  await measure($, w)
  expect(await band.find({ type: 'Text' })).toBeUndefined()
})

test('a surface that does not raise the band gets nothing', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 6
  const band = await $.ui.mount({ plugin: 'budget-guard', surface: 'mobile', component: 'AbovePrompt', props: BAND } as never)
  await measure($, w)
  expect(await band.find({ type: 'Text' })).toBeUndefined()
})

// ---- the limit guard -----------------------------------------------------------------------

test('no limit (default): never asks, however much is spent', async ($, on) => {
  const w = world(on)
  w.usd = 500
  const r = await submit($, 'keep going')
  expect(r.drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('under the limit: no dialog', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 4.99
  expect((await submit($, 'keep going')).drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('at the limit: one dialog with the three options; Hold it drops with one line and echoes the text', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 5.2
  const r = await submit($, 'summarise the repo')
  expect(r.drop).toBe('budget-guard blocked your prompt · nothing was sent')
  expect(w.logs).toEqual(['summarise the repo'])
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.header).toBe('Budget')
  expect(w.asks[0]!.options).toEqual(['Continue (+50%)', 'Continue without limit', 'Hold it'])
  expect(w.asks[0]!.question).toContain('~$5.20')
  expect(w.asks[0]!.question).toContain('$5 limit')
})

test('Esc holds the prompt the same way', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 5.2
  w.answer = 'REJECT'
  expect((await submit($, 'again')).drop).toBe('budget-guard blocked your prompt · nothing was sent')
})

test('Continue (+50%) sends the prompt and raises the limit, so the next prompt does not ask', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 5.2
  w.answer = 'Continue (+50%)'
  const r = await submit($, 'go on')
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe('go on')
  expect((await submit($, 'and again')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(1)
  expect(await $.command.run({ command: 'budget-guard', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }).then(r => r.text)).toContain('of $7.50 limit')
  w.usd = 7.6 // the raised limit is reached in its turn
  await submit($, 'more')
  expect(w.asks).toHaveLength(2)
})

test('Continue without limit turns the limit off for the session', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 5.2
  w.answer = 'Continue without limit'
  expect((await submit($, 'go on')).drop).toBeUndefined()
  w.usd = 50
  expect((await submit($, 'still going')).drop).toBeUndefined()
  expect(w.asks).toHaveLength(1)
})

test('never asks for a slash command, a mid-turn, queued or scripted prompt', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 9
  expect((await submit($, '/compact')).drop).toBeUndefined()
  expect((await submit($, 'queued', { turnId: 'busy' })).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'scheduled', wait: false, origin: { kind: 'cron' } } as never)).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin' } } as never)).drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

test('tool calls are never refused', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 9
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

test('enabled = false: no guard, no plain words', { options: { enabled: false, limitUsd: 5 } }, async ($, on) => {
  const w = world(on)
  w.usd = 9
  expect((await submit($, 'hello')).drop).toBeUndefined()
  const r = await submit($, 'usage')
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe('usage')
})

// ---- plain words, command, timing ----------------------------------------------------------

test('usage prints the report locally and drops the prompt', LIMIT, async ($, on) => {
  const w = world(on)
  w.usd = 1.2
  w.ctx = 40
  w.rateLimits = [{ kind: 'five_hour', percentUsed: 82, resetsAt: '2026-01-01T11:12:00Z' }]
  await turn($, 't1', 42_000)
  await turn($, 't2', 190_000)
  const r = await submit($, 'Usage.')
  expect(r.drop).toBe('budget-guard · session ~$1.20 of $5 · 2 turns')
  const box = w.logs.join('\n')
  expect(box).toContain('Cost      ~$1.20 of $5 limit (24%)')
  expect(box).toContain('Tokens    in 20k · out 1.0k')
  expect(box).toContain('Cache     hit 89% · read 16k · written 2.0k')
  expect(box).toContain('Context   40% full of 200k')
  expect(box).toContain('Last turn 3m 10s · 11k tokens')
  expect(box).toContain('Longest   3m 10s')
  expect(box).toContain('5h plan   82% · resets in 1h 12m')
  expect(w.asks).toEqual([])
})

test('budget and budget-guard print the same report', async ($, on) => {
  const w = world(on)
  expect((await submit($, 'budget')).drop).toContain('budget-guard · session')
  expect((await submit($, 'budget-guard')).drop).toContain('budget-guard · session')
  expect(w.logs).toHaveLength(2)
})

test('budget 10 sets the limit for this session, budget 0 clears it', async ($, on) => {
  const w = world(on)
  expect((await submit($, 'budget 10')).drop).toBe('budget-guard · limit $10 for this session')
  w.usd = 10.5
  expect((await submit($, 'next')).drop).toBe('budget-guard blocked your prompt · nothing was sent')
  expect((await submit($, 'budget 0')).drop).toBe('budget-guard · no limit for this session')
  expect((await submit($, 'next')).drop).toBeUndefined()
})

test('a sentence that merely contains the words is an ordinary prompt', LIMIT, async ($, on) => {
  const w = world(on)
  for (const text of ['what is my usage', 'budget 10 dollars', 'usage please', 'set the budget 10']) {
    const r = await submit($, text)
    expect(r.drop).toBeUndefined()
    expect(r.text).toBe(text)
  }
  expect(w.logs).toEqual([])
})

test('a plain word with an attachment, or from a scheduled run, is not a command', async ($, on) => {
  world(on)
  expect((await submit($, 'usage', { attachments: [{ kind: 'image' }] })).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'usage', wait: false, origin: { kind: 'cron' } } as never)).drop).toBeUndefined()
})

test('/budget-guard registers at session start and answers with the report; an argument sets the limit', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  expect(w.registered).toEqual(['budget-guard'])
  const run = (args: string) =>
    $.command.run({ command: 'budget-guard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }).then(r => r.text ?? '')
  expect(await run('')).toContain('Cost')
  expect(await run('12.5')).toBe('budget-guard · limit $12.50 for this session')
  expect(await run('whatever')).toContain('Cost')
})

test('turn timing: longest survives the cap, subagent turns count tokens but not timing', async ($, on) => {
  const w = world(on)
  for (let i = 0; i < 60; i++) await turn($, `t${i}`, i === 3 ? 600_000 : 1000 + i)
  await turn($, 'sub', 999_000, usage(100, 0), { agentId: 'a1' })
  await submit($, 'usage')
  const box = w.logs.join('\n')
  expect(box).toContain('Longest   10m 00s') // turn 3 left the 50-turn list long ago
  expect(box).toContain('Last turn 1s · 11k tokens') // 1059 ms is the last main-loop turn
  expect(box).toContain('in 600k') // 60 x 9000 + the subagent's 100
})

test('/clear starts the totals over', async ($, on) => {
  const w = world(on)
  await turn($, 't1', 5000)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  await submit($, 'usage')
  expect(w.logs.join('\n')).toContain('Last turn none yet')
})
