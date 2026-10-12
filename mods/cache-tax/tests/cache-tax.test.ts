import { expect, mock, test } from 'claude-code/testing'
import { bestMove } from '../hooks/suggest'
import type { On } from 'claude-code'

import { dropWith } from '../hooks/reply'

const MIN = 60_000
/** The one-line stop mode (the dialog is the default). */
const STOP = { options: { onCold: 'stop' } }
const T0 = 100 * 60 * MIN

type World = {
  clock: ReturnType<typeof mock.clock>
  statuses: (string | undefined)[]
  toasts: string[]
  logs: string[]
  forks: number
  tokens: number
  forkResult: () => unknown
  store: Map<string, unknown>
  modelThrows: boolean
  asks: { question: string; options: string[]; header: string }[]
  answer: string
  filled: string[]
}

const usage = (read: number, creation: number) => ({
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: creation,
})

/** Everything the plugin reaches through `$` sits beneath it, answered from memory. */
function world(on: On, tokens = 150_000): World {
  const w: World = {
    clock: mock.clock(on, { now: T0 }),
    statuses: [],
    toasts: [],
    logs: [],
    forks: 0,
    store: new Map(),
    modelThrows: false,
    asks: [],
    answer: 'Send anyway',
    filled: [],
    tokens,
    forkResult: () => ({ isAnswered: true, text: 'ok', usage: usage(150_000, 0) }),
  }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('session.id', () => ({ value: 'sid-1' }))
  on('session.model', () => {
    if (w.modelThrows) throw new Error('boom')
    return { value: 'claude-opus-4-5' }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { window: 200_000, tokens: w.tokens || undefined } },
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!
    w.asks.push({ question: q.question, options: q.options.map(x => x.label), header: q.header })
    if (w.answer === 'REJECT') throw new Error('dialog dismissed')
    return { result: { questions: e.questions, answers: { [q.question]: w.answer } } } as never
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.status', (_, e) => (w.statuses.push(e.text), { value: undefined }))
  on('ui.log', (_, e) => (w.logs.push(e.text), { value: undefined }))
  on('ui.toast', (_, e) => (w.toasts.push(e.text), { value: undefined }))
  on('model.fork', () => (w.forks += 1, { value: w.forkResult() as never }))
  on('prompt.fill', (_, e) => (w.filled.push((e as { text: string }).text), { isFilled: true } as never))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  return w
}

const turn = async ($: any, id: string, cacheCreation = 0, cacheRead = 0) => {
  await $.turn.start({ text: 'go', turnId: id })
  await $.turn.complete({
    answer: 'done', durationMs: 1000, isAborted: false, turnId: id, reason: 'answer',
    usage: { ...usage(cacheRead, cacheCreation), model: 'claude-opus-4-5' },
  })
}
const submit = ($: any, text: string, extra: object = {}) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...extra })
const slash = async ($: any, command: string, args = ''): Promise<string> =>
  (
    await $.command.run({
      command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 },
    })
  ).text ?? ''
const start = ($: any) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

test('idle past the ttl drops once with the price, then the same text passes', STOP, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)

  const first = await submit($, 'summarise the repo')
  // 150k tokens x $10/M (1h write, Opus) cold vs $0.50/M warm
  expect(first.drop).toBe('cache-tax blocked your prompt · Cache went cold · this message ~$1.50 (warm: ~$0.07) · send the same text again to continue')
  expect(w.logs).toEqual([
    'Idle 1h 1m · ~150k tokens to re-write · /keepwarm holds the cache · /clear starts fresh',
  ])

  const second = await submit($, 'summarise the repo')
  expect(second.drop).toBeUndefined()
  expect(second.text).toBe('summarise the repo')
})

test('a different text after the stop is stopped again; a paid send resets the guard', STOP, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(90 * MIN)

  expect((await submit($, 'one')).drop).toBeDefined()
  expect((await submit($, 'two')).drop).toBeDefined()
  expect((await submit($, 'two')).drop).toBeUndefined()

  await turn($, 't2', 150_000)
  expect(await slash($, 'cache-tax')).toContain('Cold writes this session  1 · ~$1.50')

  expect((await submit($, 'three')).drop).toBeUndefined() // warm again
  await w.clock.advance(61 * MIN)
  expect((await submit($, 'three')).drop).toBeDefined() // guard armed again
})

test('under the ttl, a small context, a slash command, a queued or scripted prompt all pass', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(30 * MIN)
  expect((await submit($, 'soon')).drop).toBeUndefined()

  await w.clock.advance(60 * MIN)
  expect((await submit($, '/compact')).drop).toBeUndefined()
  expect((await submit($, 'typed mid-turn', { turnId: 't9' })).drop).toBeUndefined()
  expect((await submit($, 'cron', { origin: { kind: 'scheduled-trigger' } })).drop).toBeUndefined()

  w.tokens = 5_000
  expect((await submit($, 'small context')).drop).toBeUndefined()
})

test('a new session with no history is never stopped', async ($, on) => {
  world(on)
  await start($)
  expect((await submit($, 'first message')).drop).toBeUndefined()
})

test('fails open: a throw inside the guard lets the prompt through', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(2 * 60 * MIN)
  w.modelThrows = true
  const out = await submit($, 'still goes')
  expect(out.drop).toBeUndefined()
  expect(out.text).toBe('still goes')
})

test('/clear forgets the old cache', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(2 * 60 * MIN)
  await $.session.end({ reason: 'clear', sessionId: 'sid-1', resume: { id: 'sid-1' } as never })
  expect((await submit($, 'fresh')).drop).toBeUndefined()
})

test('a resumed session is judged from the engine seconds_since_last_response', STOP, async ($, on) => {
  const w = world(on, 0)
  await start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 7200, context_tokens: 90_000 })
  const out = await submit($, 'welcome back')
  expect(out.drop).toContain('Cache went cold')
  expect(w.logs.join('\n')).toContain('Idle 2h')
  expect(w.logs.join('\n')).toContain('~90k tokens')
})

test('activity is stored under the session id and restored when the state is empty', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  const stored = w.store.get('sessions') as Record<string, { at: number; tokens: number }>
  expect(stored['sid-1']?.at).toBe(T0)
  expect(stored['sid-1']?.tokens).toBe(150_000)
})

test('/keepwarm pings through the idle hours, then stops itself with a toast', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(MIN)

  const text = await slash($, 'keepwarm', '2h')
  expect(text).toContain('Keep-warm on for 2h · a ping every 55m')
  expect(text.split('\n').length).toBeLessThanOrEqual(3)
  expect(w.statuses.at(-1)).toContain('Keep-warm · 2h left')

  await w.clock.advance(55 * MIN)
  expect(w.forks).toBe(1)
  expect(w.statuses.at(-1)).toContain('1 ping ·')
  expect(await slash($, 'keepwarm')).toContain('last one read 150k tokens from cache')

  // The ping kept the cache warm, so the next message is not stopped.
  await w.clock.advance(50 * MIN)
  expect((await submit($, 'still warm')).drop).toBeUndefined()

  await w.clock.advance(5 * MIN)
  expect(w.forks).toBe(2)
  await w.clock.advance(70 * MIN) // past the 2h
  expect(w.toasts.at(-1)).toContain('Keep-warm ended')
  expect(w.statuses.at(-1)).toBeUndefined()
  expect(await slash($, 'keepwarm')).toContain('Keep-warm is off')

  const forks = w.forks
  await w.clock.advance(6 * 60 * MIN)
  expect(w.forks).toBe(forks)
})

test('/keepwarm off stops the pings', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await slash($, 'keepwarm', '6h')
  expect(await slash($, 'keepwarm', 'off')).toBe('Keep-warm stopped')
  await w.clock.advance(3 * 60 * MIN)
  expect(w.forks).toBe(0)
})

test('keepwarm never pings during a turn', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await slash($, 'keepwarm', '6h')
  await $.turn.start({ text: 'long one', turnId: 't2' }) // still running at the first period
  await w.clock.advance(56 * MIN)
  expect(w.forks).toBe(0)
})

test('keepwarm does not ping a cache that already lapsed', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)
  expect(await slash($, 'keepwarm', '6h')).toContain('The cache is cold')
  await w.clock.advance(3 * 60 * MIN)
  expect(w.forks).toBe(0)
})

test('a failing ping three times ends keepwarm', async ($, on) => {
  const w = world(on)
  w.forkResult = () => ({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: usage(0, 0) })
  await start($)
  await turn($, 't1')
  await slash($, 'keepwarm', '6h')
  await w.clock.advance(56 * MIN)
  await turn($, 't2') // keep the cache looking warm so each period tries again
  await w.clock.advance(55 * MIN)
  await turn($, 't3')
  await w.clock.advance(55 * MIN)
  expect(w.forks).toBe(3)
  expect(w.toasts.at(-1)).toContain('after 3 failed pings')
})

test('/keepwarm reads its argument', async ($, on) => {
  world(on)
  await start($)
  await turn($, 't1')
  expect(await slash($, 'keepwarm')).toBe('Keep-warm is off · /keepwarm 90m to start (default 6h), /keepwarm off to stop')
  expect(await slash($, 'keepwarm', '90m')).toContain('Keep-warm on for 1h 30m')
  expect(await slash($, 'keepwarm', ' 2H ')).toContain('Keep-warm on for 2h')
  expect(await slash($, 'keepwarm', '1h30m')).toContain('Keep-warm on for 1h 30m')
  expect(await slash($, 'keepwarm', '45')).toContain('Keep-warm on for 45m')
  expect(await slash($, 'keepwarm', 'on')).toContain('Keep-warm on for 6h')
  expect(await slash($, 'keepwarm', '99h')).toContain('(the maximum)')
  expect(await slash($, 'keepwarm', 'banana')).toContain(`Couldn't read "banana"`)
  expect(await slash($, 'keepwarm', '0m')).toContain(`Couldn't read`)
  expect(await slash($, 'keepwarm', 'off')).toBe('Keep-warm stopped')
  expect(await slash($, 'keepwarm', 'off')).toBe('Keep-warm was not running')
})

test('every /keepwarm reply is short: one to three lines', async ($, on) => {
  world(on)
  await start($)
  await turn($, 't1')
  const replies = [
    await slash($, 'keepwarm'),
    await slash($, 'keepwarm', '2h'),
    await slash($, 'keepwarm'),
    await slash($, 'keepwarm', 'off'),
    await slash($, 'keepwarm', 'oops'),
  ]
  for (const reply of replies) {
    const lines = reply.split('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThanOrEqual(3)
  }
})

test('/cache-tax leads with a headline, then a few plain lines', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(10 * MIN)
  expect(await slash($, 'cache-tax')).toBe(
    [
      'Cache warm · ~50 min left · next message ~$0.07',
      'Context  ~150k tokens · last turn 15 (5 out)',
      'Keep-warm  off  (/keepwarm 90m to start)',
      'Cold writes this session  0 · ~$0.00',
      'Estimates · Opus · 60 min cache',
    ].join('\n'),
  )

  await w.clock.advance(60 * MIN)
  const cold = (await slash($, 'cache-tax')).split('\n')
  expect(cold[0]).toBe('Cache cold · next message ~$1.50')
})

test('the ttl comes from userConfig', { options: { cacheTtlMinutes: 5, onCold: 'stop' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(6 * MIN)
  expect((await submit($, 'five minute cache')).drop).toContain('Cache went cold')
  expect(w.logs.join('\n')).toContain('Idle 6m')
})

// ---- plain word `cache-tax` (v0.2.0) ----------------------------------------------------------

test('the plain word cache-tax answers like /cache-tax and never reaches the model', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(10 * MIN)
  const slashText = await slash($, 'cache-tax')
  for (const typed of ['cache-tax', '  Cache-Tax  ', 'CACHE-TAX.']) {
    w.logs.length = 0
    const out = await submit($, typed)
    const [headline, ...rest] = slashText.split('\n')
    expect(out.drop).toBe(headline)
    expect(w.logs).toEqual([rest.join('\n')])
    expect(out.text).toBeUndefined()
  }
  expect(w.forks).toBe(0)
})

test('the plain word is answered even when the cache is cold, and does not arm the guard', STOP, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(90 * MIN)
  const out = await submit($, 'cache-tax')
  expect(out.drop).toBe('Cache cold · next message ~$1.50')
  expect(await slash($, 'cache-tax')).not.toContain('on hold')
  expect((await submit($, 'a real message')).drop).toContain('Cache went cold') // the guard still stops this once
  expect(await slash($, 'cache-tax')).toContain('on hold: send the same text again to continue')
})

test('only the exact word counts: a sentence, another sender or an attachment goes through', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(10 * MIN)
  for (const text of ['what is cache-tax', 'cache-tax now', 'cache-taxes', 'the cache-tax']) {
    const out = await submit($, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect((await submit($, 'cache-tax', { origin: { kind: 'scheduled-trigger' } })).drop).toBeUndefined()
  expect((await submit($, 'cache-tax', { attachments: [{ type: 'image', data: 'x' }] })).drop).toBeUndefined()
})

test('keepwarm has no plain word: typing it starts nothing and reaches the model', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  for (const text of ['keepwarm', 'keepwarm on', 'keep warm']) {
    const out = await submit($, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect(await slash($, 'keepwarm')).toContain('Keep-warm is off')
  expect(w.forks).toBe(0)
})

test('the plain word fails soft: a broken report still drops, with a short notice', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  w.modelThrows = true // the report reads the model name
  const out = await submit($, 'cache-tax')
  expect(out.drop).toBe("Couldn't read the cache state")
})

// ---- one-line drop reasons ------------------------------------------------------------------

test('no drop reason ever contains a line break; the detail goes to ui.log', STOP, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  const reasons: string[] = []

  await w.clock.advance(10 * MIN)
  reasons.push((await submit($, 'cache-tax')).drop) // warm report
  await w.clock.advance(60 * MIN)
  reasons.push((await submit($, 'cache-tax')).drop) // cold report
  reasons.push((await submit($, 'hold me')).drop) // the cold stop
  await slash($, 'keepwarm', '2h')
  reasons.push((await submit($, 'cache-tax')).drop) // report with keep-warm on

  expect(reasons).toHaveLength(4)
  for (const reason of reasons) {
    expect(typeof reason).toBe('string')
    expect(reason).not.toMatch(/[\r\n\t\u0000-\u001f]/)
    expect(reason.length).toBeGreaterThan(0)
  }
  // detail lines were logged, as multi-line notes, and none repeats the headline
  expect(w.logs.length).toBe(4)
  for (const note of w.logs) expect(note.split('\n')[0]).not.toBe('')
  expect(w.logs.filter(note => note.includes('\n'))).toHaveLength(3) // the three reports; the stop's detail is one line
  expect(w.logs.join('\n')).toContain('Context  ~150k tokens')
  expect(w.logs.join('\n')).toContain('Estimates · Opus · 60 min cache')
  expect(w.logs.join('\n')).not.toContain('Cache warm')
})

test('dropWith: first line is the reason, the rest is one ui.log call', () => {
  const logged: string[] = []
  const ui = (text: string) => void logged.push(text)

  expect(dropWith(ui, 'one line only')).toEqual({ drop: 'one line only' })
  expect(logged).toEqual([])

  expect(dropWith(ui, '  head\u0007er \t x  \n\n   a  \r\n b\n  ')).toEqual({ drop: 'head er x' })
  expect(logged).toEqual(['a\nb'])

  expect(dropWith(ui, '\n \n')).toEqual({ drop: 'cache-tax' })
  expect(logged).toHaveLength(1)

  // a log that throws never undoes the drop
  const broken = () => { throw new Error('no surface') }
  expect(dropWith(broken, 'head\ndetail')).toEqual({ drop: 'head' })
})

// ---- the dialog (default) -------------------------------------------------------------------

test('cold cache: one small dialog, Send anyway passes the same message at once', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)

  const r = await submit($, 'summarise the repo')
  expect(r.drop).toBeUndefined()
  expect(r.text).toBe('summarise the repo')
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.header).toBe('Cache cold')
  expect(w.asks[0]!.options).toEqual(['Compact first (suggested)', 'Send anyway', 'Start fresh', 'Hold it'])
  expect(w.asks[0]!.question).toContain('this message ~$1.50 (warm: ~$0.07)')
  expect(w.asks[0]!.question).toContain('Idle 1h 1m')
  expect(w.logs).toEqual([]) // nothing left in the transcript

  await turn($, 't2', 150_000)
  expect(await slash($, 'cache-tax')).toContain('Cold writes this session  1 · ~$1.50') // the paid write is still counted
})

test('cold cache: Hold it and Esc both hold the message and echo it so nothing typed is lost', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)

  w.answer = 'Hold it'
  const held = await submit($, 'summarise the repo')
  expect(held.drop).toBe('cache-tax blocked your prompt · nothing was sent. Send it again to choose.')
  expect(w.logs).toEqual(['summarise the repo'])

  w.answer = 'REJECT'
  expect((await submit($, 'again')).drop).toBe('cache-tax blocked your prompt · nothing was sent. Send it again to choose.')
  expect(w.asks).toHaveLength(2)
})

test('cold cache: a message that costs little extra is never asked about', { options: { minExtraUsd: 5 } }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)
  expect((await submit($, 'summarise the repo')).drop).toBeUndefined() // $1.43 extra is under $5
  expect(w.asks).toEqual([])
})

test('onCold off: the cache is never stopped on', { options: { onCold: 'off' } }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)
  expect((await submit($, 'summarise the repo')).drop).toBeUndefined()
  expect(w.asks).toEqual([])
})

// ---- 0.5.0: hit ratio, last turn, keep-warm hint -------------------------------------------------

test('/cache-tax shows the real hit ratio, last turn and totals from turn.complete usage', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1', 80_000, 0) // wrote the context
  await turn($, 't2', 5_000, 95_000) // then mostly read it
  await w.clock.advance(MIN)
  const lines = (await slash($, 'cache-tax')).split('\n')
  // 95k read vs 85k written = 53%; the last turn is 10 in + 5 out + 95k read + 5k written
  expect(lines[1]).toBe('Context  ~150k tokens · last turn 100k (5 out)')
  expect(lines[2]).toBe('Cache hits  53% (est.) · 95k read · 85k written')
})

test('no hit ratio line before a turn has completed with usage', async ($, on) => {
  world(on)
  await start($)
  const text = await slash($, 'cache-tax')
  expect(text).not.toContain('Cache hits')
  expect(text).not.toContain('last turn')
})

test('an interrupted turn without usage adds nothing to the totals', async ($, on) => {
  world(on)
  await start($)
  await turn($, 't1', 0, 50_000)
  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.turn.complete({ answer: '', durationMs: 5, isAborted: true, turnId: 't2', reason: 'aborted' })
  expect(await slash($, 'cache-tax')).toContain('Cache hits  100% (est.) · 50k read · 0 written')
})

test('subagent turns and /clear do not pollute the totals', async ($, on) => {
  world(on)
  await start($)
  await $.turn.complete({
    answer: 'x', durationMs: 5, isAborted: false, turnId: 'sub', reason: 'answer', agentId: 'a1',
    usage: { ...usage(900_000, 0), model: 'claude-opus-4-5' },
  })
  expect(await slash($, 'cache-tax')).not.toContain('Cache hits')
  await turn($, 't1', 0, 10_000)
  await $.session.end({ reason: 'clear', sessionId: 'sid-1', resume: { id: 'sid-1' } as never })
  expect(await slash($, 'cache-tax')).not.toContain('Cache hits')
})

test('the report never exceeds six lines, even on hold with everything known', STOP, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1', 10_000, 20_000)
  await w.clock.advance(90 * MIN)
  expect((await submit($, 'real message')).drop).toContain('Cache went cold') // arms the hold
  const lines = (await slash($, 'cache-tax')).split('\n')
  expect(lines.length).toBeLessThanOrEqual(6)
  expect(lines.join('\n')).toContain('on hold')
})

test('the cold-cache dialog mentions /keepwarm 90m once per session and keeps its options', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)
  await submit($, 'first')
  expect(w.asks[0]!.question.split('\n').at(-1)).toBe('Keep it warm next time: /keepwarm 90m')
  expect(w.asks[0]!.question).toContain('Suggested: compact first')
  expect(w.asks[0]!.options).toEqual(['Compact first (suggested)', 'Send anyway', 'Start fresh', 'Hold it'])

  await turn($, 't2', 150_000)
  await w.clock.advance(61 * MIN)
  await submit($, 'second')
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]!.question).not.toContain('/keepwarm 90m') // once only
  expect(w.asks[1]!.question).toContain('/keepwarm holds the cache')
})

test('no hint while keep-warm is already on', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await slash($, 'keepwarm', '6h')
  w.forkResult = () => ({ isAnswered: false, reason: 'nothing-to-fork' }) // pings do not touch the cache: it lapses
  await w.clock.advance(61 * MIN)
  await submit($, 'hello')
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).not.toContain('Keep it warm next time')
})

test('the hint never starts keep-warm or a ping', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)
  await submit($, 'x')
  await w.clock.advance(3 * 60 * MIN)
  expect(w.forks).toBe(0)
  expect(await slash($, 'keepwarm')).toContain('Keep-warm is off')
})

// ---- the suggested way forward --------------------------------------------------------------

test('bestMove: long away starts fresh, a big context compacts, a small one just sends', () => {
  expect(bestMove(500_000, 7 * 60 * MIN).move).toBe('clear')
  expect(bestMove(150_000, 61 * MIN).move).toBe('compact')
  expect(bestMove(40_000, 61 * MIN).move).toBe('send')
})

test('a small context suggests sending, first in the list', async ($, on) => {
  const w = world(on, 60_000)
  await start($)
  await turn($, 't1', 60_000)
  await w.clock.advance(61 * MIN)
  await submit($, 'next step')
  expect(w.asks[0]?.options[0]).toBe('Send anyway (suggested)')
})

test('picking the suggested Compact first holds the message and puts /compact in the prompt box', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)
  w.answer = 'Compact first (suggested)'
  const r = await submit($, 'summarise the repo')
  expect(r.drop).toBe('cache-tax blocked your prompt · press Enter to run /compact, then send your message again')
  expect(w.filled).toEqual(['/compact'])
  expect(w.logs).toEqual(['summarise the repo'])
})

test('Start fresh puts /clear in the prompt box', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, 't1')
  await w.clock.advance(61 * MIN)
  w.answer = 'Start fresh'
  expect((await submit($, 'new task')).drop).toBe('cache-tax blocked your prompt · press Enter to run /clear, then send your message again')
  expect(w.filled).toEqual(['/clear'])
})
