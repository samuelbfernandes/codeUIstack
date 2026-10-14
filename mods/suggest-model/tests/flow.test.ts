import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentSpawnResult, ConfigRow, ConfigSetResult, On } from 'claude-code'

type Surface = 'terminal' | 'desktop'
const SURFACES = ['terminal', 'desktop'] as const

type Ask = { question: string; options: string[]; header: string }
type World = {
  clock: ReturnType<typeof mock.clock>
  /** What the person picks: a label prefix, 'REJECT', or a function of the options. */
  answer: string
  model: string
  tokens: number
  surfaces: readonly Surface[]
  rows: ConfigRow[]
  setResult: () => ConfigSetResult
  codex: 'ok' | 'missing' | 'fails' | 'execFails' | 'empty'
  classifier: () => string | undefined
  spawnResult: () => AgentSpawnResult
  asks: Ask[]
  toasts: string[]
  logs: string[]
  /** Every $.ui.status call, in order; undefined = the line was cleared. */
  statuses: (string | undefined)[]
  sets: { key: string; value: unknown }[]
  spawns: { prompt: string; description: string; model?: string }[]
  runs: string[][]
  classified: number
  arrived: { text: string; context?: readonly string[] }[]
  store: Map<string, unknown>
  /** Operations that throw, to prove the hook fails open. */
  breaks: Set<string>
}

const MODEL_ROW: ConfigRow = {
  key: 'model',
  label: 'Model',
  kind: 'choice',
  value: 'sonnet',
  options: ['default', 'sonnet', 'opus', 'haiku'],
  provider: { plugin: 'engine', tier: 'core' },
  isLocked: false,
}

const DEEP = 'derive the BLUP variance of the genomic breeding value under REML'
const LIGHT = 'fix the typo in the second paragraph of the abstract'
const REVIEW = 'review my diff and try to falsify it'

function world(on: On, init: Partial<World> = {}): World {
  const w: World = {
    clock: mock.clock(on),
    answer: 'Keep',
    model: 'claude-sonnet-4-5',
    tokens: 5_000,
    surfaces: ['terminal'],
    rows: [MODEL_ROW],
    setResult: () => ({ value: 'ok' }),
    codex: 'ok',
    classifier: () => undefined,
    spawnResult: () => ({ model: 'opus', agentId: 'a1' }),
    asks: [],
    toasts: [],
    logs: [],
    statuses: [],
    sets: [],
    spawns: [],
    runs: [],
    classified: 0,
    arrived: [],
    store: new Map(),
    breaks: new Set(),
    ...init,
  }
  const maybeBreak = (name: string) => {
    if (w.breaks.has(name)) throw new Error(`${name} broken`)
  }
  on('store.get', (_$, e) => (maybeBreak('store'), { value: w.store.get(e.key) }))
  on('store.set', (_$, e) => (maybeBreak('storeSet'), w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('session.model', () => (maybeBreak('model'), { value: w.model }))
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('session.usage', () => (maybeBreak('usage'), { value: { startedAt: 0, rateLimits: [], context: { window: 200_000, tokens: w.tokens } } }))
  on('config.list', () => (maybeBreak('config'), { value: w.rows }))
  on('config.set', (_$, e) => {
    w.sets.push({ key: e.key, value: e.value })
    return w.setResult()
  })
  on('agent.spawn', (_$, e) => {
    w.spawns.push({ prompt: e.prompt, description: e.description, model: e.model })
    return w.spawnResult()
  })
  on('model.classify', () => ((w.classified += 1), { value: w.classifier() }))
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    w.runs.push(argv)
    if (argv[0] !== 'codex' || w.codex === 'missing') throw new Error('spawn codex ENOENT')
    const done = { isStdoutTruncated: false, isStderrTruncated: false }
    if (argv[1] === '--version') return { value: { exitCode: w.codex === 'fails' ? 1 : 0, stdout: 'codex 1.0', stderr: '', ...done } }
    if (w.codex === 'execFails') return { value: { exitCode: 2, stdout: '', stderr: 'auth error\nmore', ...done } }
    return { value: { exitCode: 0, stdout: w.codex === 'empty' ? '  ' : 'PASS claim 1\nFAIL claim 2 (a.R:10)', stderr: '', ...done } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    const q = e.questions[0]!
    const options = q.options.map(x => x.label)
    w.asks.push({ question: q.question, options, header: q.header })
    if (w.answer === 'REJECT') throw new Error('dialog dismissed')
    const picked = options.find(o => o.startsWith(w.answer)) ?? w.answer
    return { result: { questions: e.questions, answers: { [q.question]: picked } } } as never
  })
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.status', (_$, e) => (maybeBreak('status'), w.statuses.push(e.text), { value: undefined }))
  on('ui.log', (_$, e) => (w.logs.push(e.text), { value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // The engine's own bottom: whatever reaches it is what the model would be sent.
  on('prompt.submit', (_$, e) => {
    w.arrived.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return w
}

const submit = ($: Engine, text: string, origin: { kind: string; name?: string } = { kind: 'composer' }) =>
  $.prompt.submit({ text, wait: false, origin } as never)

const command = async ($: Engine, args: string) =>
  (await $.command.run({ command: 'suggest-model', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })).text ?? ''

// ------------------------------------------------------------------------ pass-through

test('a prompt that fits its model is sent untouched and nothing is asked', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  const out = await submit($, 'write a testthat test for foo()')
  expect(out.text).toBe('write a testthat test for foo()')
  expect(w.asks).toEqual([])
  expect(w.arrived).toHaveLength(1)
  expect(w.statuses).toEqual(['suggest-model: Sonnet fits'])
})

test('only the person typing is analysed: plugin, task, schedule, slash, mid-turn and short prompts pass silently', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  await submit($, DEEP, { kind: 'plugin', name: 'other' })
  await submit($, DEEP, { kind: 'task-notification' })
  await submit($, DEEP, { kind: 'scheduled-trigger' })
  await submit($, '/suggest-model derive the BLUP variance of everything')
  await submit($, 'ok thanks') // short and no strong rule
  expect(w.asks).toEqual([])
  expect(w.arrived).toHaveLength(5)
  expect(w.statuses).toEqual([]) // nothing was evaluated, so the status line was never touched
})

test('a short prompt is judged only when it matches a strong rule', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  await submit($, 'fix typo') // 2 words, light but only 3 points: ignored (minWords is 3)
  expect(w.asks).toEqual([])
  expect(w.statuses).toEqual([])
  await submit($, 'prove it') // 2 words, deep with 4 points: judged
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('Deep task')
  expect(w.arrived).toHaveLength(2)
})

test('unknown model, disabled mod and /suggest-model off do nothing', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'some-other-model' })
  await submit($, DEEP)
  expect(w.asks).toEqual([])
  w.model = 'claude-sonnet-4-5'
  await command($, 'off')
  await submit($, DEEP)
  expect(w.asks).toEqual([])
  await command($, 'on')
  await submit($, DEEP)
  expect(w.asks).toHaveLength(1)
})

test('settings: enabled=false wins over /suggest-model on', { options: { autoRoute: false, enabled: false } }, async ($, on) => {
  const w = world(on)
  await submit($, DEEP)
  expect(w.asks).toEqual([])
  expect(await command($, 'on')).toContain('The enabled setting is false')
})

// ------------------------------------------------------------------------------ dialog

for (const surface of SURFACES) {
  test(`dialog on ${surface}: first line, order, header, Keep sends the prompt unchanged`, async ($, on) => {
    const w = world(on, { surfaces: [surface] })
    const out = await submit($, DEEP)
    expect(out.text).toBe(DEEP)
    expect(w.arrived).toEqual([{ text: DEEP, context: undefined }])
    const ask = w.asks[0]!
    expect(ask.question.split('\n')[0]).toBe("Don't use Sonnet for this task")
    expect(ask.question.split('\n')[1]).toMatch(/^Deep task · .+/)
    expect(ask.question).toContain('Haiku 1x weak · Sonnet 20x weak · Opus 40x best')
    expect(ask.question).toContain('Opus is the cheapest model that should handle it')
    expect(ask.header).toBe('Model choice')
    expect(ask.options).toEqual([
      'Keep Sonnet',
      'Switch session to Opus',
      'Run this task as a subagent on Opus',
      "Keep Sonnet and don't suggest again this session",
    ])
    expect(w.statuses).toEqual(['suggest-model: weak for this, use Opus']) // the status line is set before the dialog
    expect(w.sets).toEqual([])
    expect(w.spawns).toEqual([])
  })

  test(`switch on ${surface}: the model row is set and the prompt continues`, async ($, on) => {
    const w = world(on, { surfaces: [surface], answer: 'Switch' })
    const out = await submit($, DEEP)
    expect(w.sets).toEqual([{ key: 'model', value: 'opus' }])
    expect(out.text).toBe(DEEP) // next(e): the same prompt, now read by the new model
    expect(w.arrived).toHaveLength(1)
    expect(w.toasts.join(' ')).toContain('switched to Opus')
  })

  test(`subagent on ${surface}: spawned on the alias and the prompt is dropped`, async ($, on) => {
    const w = world(on, { surfaces: [surface], answer: 'Run this task' })
    const out = await submit($, DEEP)
    expect(w.spawns).toEqual([{ prompt: DEEP, description: 'derive the BLUP variance of the', model: 'opus' }])
    expect(out).toEqual({ drop: 'Sent to a opus subagent; its answer will appear when done' })
    expect(w.arrived).toEqual([]) // the current model never saw it
  })
}

test('a light task on opus offers haiku', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-1' })
  await submit($, LIGHT)
  expect(w.asks[0]!.options[1]).toBe('Switch session to Haiku')
  expect(w.asks[0]!.question.split('\n')[0]).toBe('Opus is overkill for this')
  expect(w.asks[0]!.question.split('\n')[1]).toBe('Light task · typo or spelling')
  expect(w.asks[0]!.question).toContain('Haiku 1x ok · Sonnet 20x ok · Opus 40x best')
  expect(w.asks[0]!.question).toContain('Haiku would do · ~40x cheaper')
  expect(w.statuses).toEqual(['suggest-model: overkill, Haiku would do (~40x cheaper)'])
})

test('no cheaper offer is made when already on haiku, and no stronger one on opus', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-haiku-4-5' })
  await submit($, LIGHT)
  w.model = 'claude-opus-4-1'
  await submit($, DEEP)
  expect(w.asks).toEqual([])
})

test('an overkill task in a big warm session that cannot go to a subagent is not asked about: no switch, sent as typed', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { tokens: 456_000, model: 'claude-opus-4-5' } as never)
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't0', reason: 'answer' } as never)
  const r = await submit($, 'rename that variable we discussed above to count')
  expect(w.asks.length).toBe(0)
  expect((r as { drop?: string }).drop).toBeUndefined()
})

test('a prompt that leans on the conversation gets no subagent option', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  await submit($, 'derive the BLUP variance of this, as we discussed above')
  expect(w.asks[0]!.options.some(o => o.includes('subagent'))).toBe(false)
  expect(w.asks[0]!.options[1]).toBe('Switch session to Opus')
})

test('a big context with a warm cache says a switch re-caches it and offers the subagent first', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { tokens: 85_000 })
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't0', reason: 'answer' } as never) // a response just now: the cache is warm
  await submit($, DEEP)
  const ask = w.asks[0]!
  expect(ask.question).toContain('re-caches ~85k tokens on Opus')
  expect(ask.options.slice(0, 3)).toEqual(['Keep Sonnet', 'Run this task as a subagent on Opus', 'Switch session to Opus'])
})

// ----------------------------------------------------------------------- switch failures

test('switch: a locked row falls back to a toast telling the person to type /model', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch', rows: [{ ...MODEL_ROW, isLocked: true }] })
  const out = await submit($, DEEP)
  expect(w.sets).toEqual([])
  expect(w.toasts.join(' ')).toContain('Type /model opus yourself')
  expect(out.text).toBe(DEEP)
})

test('switch: set returning deny falls back to the toast, prompt still goes on', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch', setResult: () => ({ deny: 'policy' }) })
  const out = await submit($, DEEP)
  expect(w.sets).toHaveLength(1)
  expect(w.toasts.join(' ')).toContain('/model opus')
  expect(out.text).toBe(DEEP)
})

test('switch: no model row at all falls back to the toast', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch', rows: [] })
  await submit($, DEEP)
  expect(w.toasts.join(' ')).toContain('/model opus')
})

test('switch: a row with no matching option falls back to the toast', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch', rows: [{ ...MODEL_ROW, options: ['default', 'sonnet'] }] })
  await submit($, DEEP)
  expect(w.sets).toEqual([])
  expect(w.toasts.join(' ')).toContain('/model opus')
})

test('subagent: a refused spawn keeps the prompt for the current model', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Run this task', spawnResult: () => ({ deny: 'no agents' }) })
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.arrived).toHaveLength(1)
  expect(w.toasts.join(' ')).toContain('could not start the subagent')
})

// -------------------------------------------------------------------------------- codex

test('review on a weaker model with Codex present: Switch and Codex offered, one read-only ephemeral run, result logged and attached as context', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Ask Codex' })
  const out = await submit($, REVIEW)
  expect(w.asks[0]!.options).toEqual([
    'Keep Sonnet',
    'Switch session to Opus',
    'Ask Codex for a read-only review',
    "Keep Sonnet and don't suggest again this session",
  ])
  expect(w.asks[0]!.question).toContain('uses Codex credit')
  expect(w.asks[0]!.question).toContain("Don't use Sonnet for this task")
  const exec = w.runs.find(r => r[1] === 'exec')!
  expect(exec.slice(0, 7)).toEqual(['codex', 'exec', '-s', 'read-only', '--ephemeral', '-C', '/work/proj'])
  expect(exec[7]).toContain('review my diff and try to falsify it')
  expect(exec[7]).toContain('PASS, FAIL or UNVERIFIABLE')
  expect(w.logs.join('\n')).toContain('FAIL claim 2 (a.R:10)')
  expect(out.text).toBe(REVIEW)
  expect(w.arrived[0]!.context?.[0]).toContain('FAIL claim 2 (a.R:10)')
})

test('review on Opus with Codex present: a self-review dialog (Keep, Codex, mute), status "review, Codex available"', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-1', answer: 'Ask Codex' })
  const out = await submit($, REVIEW)
  expect(w.statuses).toEqual(['suggest-model: review, Codex available'])
  expect(w.asks[0]!.question.split('\n')[0]).toBe('Get a second opinion on this')
  expect(w.asks[0]!.question).toContain('A different model (Codex) catches more than Opus reviewing its own work')
  expect(w.asks[0]!.options).toEqual(['Keep Opus', 'Ask Codex for a read-only review', "Keep Opus and don't suggest again this session"])
  expect(w.runs.some(r => r[1] === 'exec')).toBe(true)
  expect(out.text).toBe(REVIEW)
  expect(w.arrived[0]!.context?.[0]).toContain('FAIL claim 2 (a.R:10)')
})

test('review on Opus: Keep is the default and sends the prompt untouched; every review asks again', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-1' })
  expect((await submit($, REVIEW)).text).toBe(REVIEW)
  await submit($, 'give me a second opinion on this approach to the model')
  expect(w.asks).toHaveLength(2) // no "already asked" memory
  expect(w.statuses).toEqual(Array(2).fill('suggest-model: review, Codex available'))
  await submit($, 'write a testthat test for foo()')
  await submit($, REVIEW)
  expect(w.asks).toHaveLength(3)
  expect(w.arrived.every(x => x.context === undefined)).toBe(true)
})

test('review on Opus with Codex absent: silent apart from the status line, which just says it fits', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-1', codex: 'missing' })
  const out = await submit($, REVIEW)
  expect(out.text).toBe(REVIEW)
  expect(w.asks).toEqual([])
  expect(w.statuses).toEqual(['suggest-model: Opus fits'])
})

test('review on Opus respects minConfidence', { options: { autoRoute: false, minConfidence: 0.8 } }, async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-1' })
  await submit($, 'audit the data cleaning script for leakage') // review confidence 0.7: below the bar
  expect(w.asks).toEqual([])
  expect(w.statuses).toEqual([undefined])
  await submit($, REVIEW) // 0.97: asks
  expect(w.asks).toHaveLength(1)
})

test('review on Fable with Codex present also offers the Codex review', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-fable-1' })
  await submit($, REVIEW)
  expect(w.asks[0]!.options).toEqual(['Keep Fable', 'Ask Codex for a read-only review', "Keep Fable and don't suggest again this session"])
})

test('review with Codex absent: the dialog still warns and offers Switch, without the Codex option; the probe runs once per session', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { codex: 'missing' })
  await submit($, REVIEW)
  expect(w.asks[0]!.options).toEqual(['Keep Sonnet', 'Switch session to Opus', "Keep Sonnet and don't suggest again this session"])
  await submit($, 'write a testthat test for foo()') 
  await submit($, 'give me a second opinion on this approach to the model')
  expect(w.asks).toHaveLength(2)
  expect(w.runs.filter(r => r[1] === '--version')).toHaveLength(1)
  expect(w.arrived).toHaveLength(3)
})

test('review: a failing codex --version also hides the option', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { codex: 'fails' })
  await submit($, REVIEW)
  expect(w.asks[0]!.options.some(o => o.includes('Codex'))).toBe(false)
})

test('Codex errors out: the person is told and the prompt goes on untouched, with no context', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Ask Codex', codex: 'execFails' })
  const out = await submit($, REVIEW)
  expect(out.text).toBe(REVIEW)
  expect(w.arrived).toEqual([{ text: REVIEW, context: undefined }])
  expect(w.toasts.join(' ')).toContain('Codex did not answer (auth error)')
  expect(w.logs).toEqual([])
})

test('Codex returning nothing is treated as an error, not as a review', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Ask Codex', codex: 'empty' })
  await submit($, REVIEW)
  expect(w.arrived[0]!.context).toBeUndefined()
  expect(w.toasts.join(' ')).toContain('Codex returned nothing')
})

// ------------------------------------------------------------- mute, cooldown, adaptivity

test('"don\'t suggest again" mutes the dialogs for the session, but the status line stays on', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: "Keep Sonnet and don't" })
  await submit($, DEEP)
  expect(w.asks).toHaveLength(1)
  for (let i = 0; i < 6; i++) {
    await submit($, 'write a testthat test for foo()')
    await submit($, DEEP)
  }
  expect(w.asks).toHaveLength(1)
  expect(w.statuses.filter(x => x === 'suggest-model: weak for this, use Opus')).toHaveLength(7)
  expect(await command($, 'status')).toContain('Questions muted this session')
})

test('by default every prompt can ask: a mismatch, a fit, then the mismatch again asks twice', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  for (let i = 0; i < 3; i++) {
    await submit($, DEEP)
    await submit($, 'write a testthat test for foo()')
  }
  expect(w.asks).toHaveLength(3)
  expect(w.arrived).toHaveLength(6)
})

test('the same mismatch asks EVERY time, back to back; the status line updates too', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  await submit($, DEEP)
  await submit($, 'prove that the estimator is unbiased when the relationship matrix is singular')
  await submit($, 'design the architecture for a pipeline that scores a million genotypes per hour')
  expect(w.asks).toHaveLength(3)
  expect(w.statuses).toEqual(Array(3).fill('suggest-model: weak for this, use Opus'))
  expect(w.arrived).toHaveLength(3)
  // non-tasks in between are never judged
  await submit($, 'yes')
  await submit($, '/clear')
  expect(w.asks).toHaveLength(3)
  await submit($, DEEP)
  await submit($, LIGHT)
  await submit($, DEEP)
  expect(w.asks).toHaveLength(6)
})

test('after switching models the situation is new: an overkill warning on the new model can ask again', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch' })
  await submit($, DEEP)
  w.model = 'claude-opus-4-1' // what the switch did
  w.answer = 'Keep'
  await submit($, LIGHT)
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]!.question).toContain('Opus is overkill for this')
})

test('there is no cooldown: ten mismatches in a row are ten dialogs', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  for (let i = 0; i < 10; i++) await submit($, DEEP)
  expect(w.asks).toHaveLength(10)
})

test('dismissing dialogs never raises the confidence bar: the same borderline mismatch asks after eight Keeps', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  for (let i = 0; i < 8; i++) await submit($, DEEP) // all Keep: 8 dismissals
  expect(w.asks).toHaveLength(8)
  const text = await command($, 'status')
  expect(text).not.toContain('raised from')
  expect(text).toContain('≥ 0.60')
  expect(text).toContain('0 accepted · 8 dismissed')
  const thin = 'load the data with dplyr and check the convergence' // deep, confidence 0.6: exactly the bar
  await submit($, thin)
  expect(w.asks).toHaveLength(9)
})

test('accepting counts too: the status report gives the accept rate', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch' })
  await submit($, DEEP)
  await submit($, 'write a testthat test for foo()')
  w.answer = 'Keep'
  await submit($, DEEP)
  expect(await command($, 'status')).toContain('1 accepted · 1 dismissed')
})

// ---------------------------------------------------------------- classifier (optional)

test('classifier is off by default: an unclear prompt never calls a model', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { classifier: () => 'deep' })
  await submit($, 'please help me with my analysis of the field trial')
  expect(w.classified).toBe(0)
  expect(w.asks).toEqual([])
})

test('classifier on: an unclear prompt asks haiku once and can trigger a suggestion', { options: { autoRoute: false, useClassifier: true } }, async ($, on) => {
  const w = world(on, { classifier: () => 'deep' })
  await submit($, 'please help me with my analysis of the field trial')
  expect(w.classified).toBe(1)
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('small-model classifier says deep')
})

test('classifier on: clear prompts never call it, and "standard" or no answer means no dialog', { options: { autoRoute: false, useClassifier: true } }, async ($, on) => {
  const w = world(on, { classifier: () => 'standard', model: 'claude-opus-4-1' })
  await submit($, DEEP) // on opus already: decided locally, no classifier call
  await submit($, 'write a testthat test for foo()') // confident standard: no call
  expect(w.classified).toBe(0)
  await submit($, 'please help me with my analysis of the field trial')
  expect(w.classified).toBe(1)
  expect(w.asks).toEqual([])
})

test('classifier failure is ignored', { options: { autoRoute: false, useClassifier: true } }, async ($, on) => {
  const w = world(on, { classifier: () => { throw new Error('api down') } })
  const out = await submit($, 'please help me with my analysis of the field trial')
  expect(out.text).toBe('please help me with my analysis of the field trial')
  expect(w.asks).toEqual([])
})

// ---------------------------------------------------------------------------- commands

test('/suggest-model status lists the last 5 predictions with reasons and outcomes', { options: { autoRoute: false } }, async ($, on) => {
  world(on)
  const prompts = [DEEP, 'write a testthat test for foo()', LIGHT, 'add a --verbose flag to the cli', REVIEW + ' now', 'fix typo in README please', 'rename x to y in analysis.R']
  for (const p of prompts) await submit($, p)
  const text = await command($, '')
  expect(text).toContain('suggest-model · on · Sonnet')
  const rows = text.split('\n').filter(l => /^ {2}(light|standard|deep|review) /.test(l))
  expect(rows).toHaveLength(5)
  expect(rows.some(r => r.includes('typo or spelling'))).toBe(true)
})

test('/suggest-model explain is a dry run: cues, per-model table, costs, recommendation, no dialog, no model call', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  const text = await command($, 'explain derive the BLUP variance of the genomic breeding value under REML')
  expect(text).toContain('Deep task')
  expect(text).toContain('Because proof or derivation')
  expect(text).toContain('Haiku 1x weak · Sonnet 20x weak · Opus 40x best')
  expect(text).toContain('Cheapest good enough: Opus')
  expect(text).toContain(`blocks with "Don't use Sonnet for this task" and offers Opus`)
  expect(text).toContain('not measurements')
  expect(text).toContain('Dry run')
  expect(w.asks).toEqual([])
  expect(w.classified).toBe(0)
  expect(w.arrived).toEqual([])
  expect(w.statuses).toEqual([])
  expect(await command($, 'explain')).toContain('Usage')
  const std = await command($, 'explain write a testthat test for foo()')
  expect(std).toContain('Sonnet fits')
  expect(std).toContain('Cheapest good enough: Sonnet')
  expect(await command($, 'explain fix the typo in the abstract')).toContain(`blocks with "Sonnet is overkill for this" and offers Haiku`)
  expect(await command($, 'explain yes')).toContain('would not be checked')
})

test('explain with the cost setting: shows the user ratios and names the pieces it ignored', { options: { autoRoute: false, costRatios: 'haiku=2,sonnet=abc,opus=9,gpt=1' } }, async ($, on) => {
  world(on)
  const text = await command($, 'explain write a testthat test for foo()')
  expect(text).toContain('Haiku 2x weak · Sonnet 20x ok · Opus 9x best') // sonnet=abc ignored: default 3
  expect(text).toContain('Ignored in costRatios: sonnet=abc, gpt=1.')
  expect(await command($, '')).toContain('Ignored in costRatios: sonnet=abc, gpt=1')
})

test('explain on fable lists Fable in the table', { options: { autoRoute: false } }, async ($, on) => {
  world(on, { model: 'claude-fable-1' })
  const text = await command($, 'explain write a testthat test for foo()')
  expect(text).toContain('Fable best')
  expect(text).toContain('status line only (spare capacity, Sonnet is the alternative')
})

test('/suggest-model with an unknown word shows status plus usage', { options: { autoRoute: false } }, async ($, on) => {
  world(on)
  expect(await command($, 'banana')).toContain('Try: /suggest-model')
})

// -------------------------------------------------------------------------- fail-open

test('dialog dismissed (Esc): the prompt is HELD by default, never sent, and echoed back in full', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'REJECT' })
  const out = await submit($, DEEP)
  expect(w.arrived).toEqual([]) // nothing reached the model
  expect(JSON.stringify(out)).toContain('suggest-model blocked your prompt · nothing was sent')
  expect(w.logs.join('\n')).toContain(DEEP) // the prompt text is returned in the transcript note
  expect(w.sets).toEqual([])
  expect(w.spawns).toEqual([])
  expect(await command($, 'status')).toContain('dialog dismissed: prompt held')
  // and it asks again when the person resends it
  w.answer = 'Keep'
  expect((await submit($, DEEP)).text).toBe(DEEP)
  expect(w.asks).toHaveLength(2)
  expect(w.arrived).toHaveLength(1)
})

test('onDismiss = send: Esc sends the prompt as typed, once', { options: { autoRoute: false, onDismiss: 'send' } }, async ($, on) => {
  const w = world(on, { answer: 'REJECT' })
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.arrived).toHaveLength(1)
  expect(w.sets).toEqual([])
  expect(w.spawns).toEqual([])
})

test('no surface (headless run): no dialog, prompt untouched', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { surfaces: [] })
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.asks).toEqual([])
})

test('free text under Other is read as keep', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'switch to whatever you like' })
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.sets).toEqual([])
})

test('an exception anywhere (store, usage, config) never blocks the prompt', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch', breaks: new Set(['store', 'usage', 'config']) })
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.arrived).toHaveLength(1)
})

test('session.model rejecting is fail-open', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { breaks: new Set(['model']) })
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.asks).toEqual([])
})

// ------------------------------------------------------------------- every prompt, zero tokens

test('every prompt is evaluated locally: each checked prompt refreshes the status line and costs no model call', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  await submit($, 'write a testthat test for foo()')
  await submit($, LIGHT)
  await submit($, DEEP)
  await submit($, 'please help me with my analysis of the field trial') // cannot be placed: silent, line cleared
  expect(w.statuses).toEqual([
    'suggest-model: Sonnet fits',
    'suggest-model: overkill, Haiku would do (~20x cheaper)',
    'suggest-model: weak for this, use Opus',
    undefined,
  ])
  expect(w.asks).toHaveLength(2)
  expect(w.classified).toBe(0)
  expect(w.spawns).toEqual([])
  expect(w.runs).toEqual([])
  expect(w.arrived).toHaveLength(4)
})

for (const surface of SURFACES) {
  test(`status line on ${surface}: fits, overkill and weak wording, set on every checked prompt`, { options: { autoRoute: false } }, async ($, on) => {
    const w = world(on, { surfaces: [surface], model: 'claude-opus-4-1' })
    await submit($, 'write a testthat test for foo()')
    expect(w.statuses.at(-1)).toBe('suggest-model: Sonnet would do (~2x cheaper)')
    await submit($, DEEP)
    expect(w.statuses.at(-1)).toBe('suggest-model: Opus fits')
    await submit($, LIGHT)
    expect(w.statuses.at(-1)).toBe('suggest-model: overkill, Haiku would do (~40x cheaper)')
    expect(w.asks).toHaveLength(1) // only the mismatch asked
    w.model = 'claude-haiku-4-5'
    await submit($, 'write a testthat test for foo()')
    expect(w.statuses.at(-1)).toBe('suggest-model: Haiku is borderline for this, Sonnet is safer')
    w.model = 'claude-sonnet-4-5'
    await submit($, DEEP)
    expect(w.statuses.at(-1)).toBe('suggest-model: weak for this, use Opus')
    expect(w.asks).toHaveLength(2)
  })
}

test('statusLine = false: the verdict still works but the status line is never touched', { options: { autoRoute: false, statusLine: false } }, async ($, on) => {
  const w = world(on)
  await submit($, DEEP)
  await submit($, 'write a testthat test for foo()')
  expect(w.asks).toHaveLength(1)
  expect(w.statuses).toEqual([])
})

test('a switch updates the status line to say so', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { answer: 'Switch' })
  await submit($, DEEP)
  expect(w.statuses.at(-1)).toBe('suggest-model: switched to Opus')
})

test('no dialog for anything that fits: opus on deep, sonnet on standard, haiku on light, fable on deep', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-1' })
  await submit($, DEEP)
  w.model = 'claude-sonnet-4-5'
  await submit($, 'write a testthat test for foo()')
  w.model = 'claude-haiku-4-5'
  await submit($, LIGHT)
  w.model = 'claude-fable-1'
  await submit($, DEEP)
  expect(w.asks).toEqual([])
  expect(w.statuses).toEqual(['suggest-model: Opus fits', 'suggest-model: Sonnet fits', 'suggest-model: Haiku fits', 'suggest-model: Fable fits'])
  expect(w.arrived).toHaveLength(4)
})

// ------------------------------------------------------------------------ fable and costs

test('fable as the current model: light work warns (overkill) and shows Fable in the table; fable is never offered', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-fable-1' })
  await submit($, LIGHT)
  const ask = w.asks[0]!
  expect(ask.question.split('\n')[0]).toMatch(/^Fable is overkill for this/)
  expect(ask.question).toContain('Haiku 1x ok · Sonnet 20x ok · Opus 40x best · Fable best')
  expect(ask.question).toContain('Haiku would do.') // no ratio is invented for fable
  expect(ask.options).toEqual(['Keep Fable', 'Switch session to Haiku', 'Run this task as a subagent on Haiku', "Keep Fable and don't suggest again this session"])
  expect(w.statuses.at(-1)).toBe('suggest-model: overkill, Haiku would do')
})

test('askOnStandard: an ordinary task on a borderline or roomy model blocks and asks too', { options: { autoRoute: false, askOnStandard: true } }, async ($, on) => {
  const w = world(on, { model: 'claude-haiku-4-5' })
  const out = await submit($, 'write a testthat test for foo()')
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain("Don't use Haiku for this task")
  expect(out.text).toBe('write a testthat test for foo()')
  w.model = 'claude-opus-4-1'
  await submit($, 'write a testthat test for foo()')
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]!.question).toContain('Opus is overkill for this')
  w.model = 'claude-sonnet-4-5'
  await submit($, 'write a testthat test for foo()') // fits: no dialog
  expect(w.asks).toHaveLength(2)
})

test('without askOnStandard an ordinary task never asks, whatever the model', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-haiku-4-5' })
  await submit($, 'write a testthat test for foo()')
  w.model = 'claude-opus-4-1'
  await submit($, 'write a testthat test for foo()')
  expect(w.asks).toEqual([])
})

test('fable as the current model: standard work gets a status hint only, deep work fits', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-fable-1' })
  await submit($, 'write a testthat test for foo()')
  expect(w.statuses.at(-1)).toBe('suggest-model: Sonnet would do')
  await submit($, DEEP)
  expect(w.statuses.at(-1)).toBe('suggest-model: Fable fits')
  expect(w.asks).toEqual([])
})

test('fable with a cost in the setting shows the saving', { options: { autoRoute: false, costRatios: 'haiku=1,sonnet=3,opus=5,fable=10' } }, async ($, on) => {
  const w = world(on, { model: 'claude-fable-1' })
  await submit($, LIGHT)
  expect(w.asks[0]!.question).toContain('Fable 10x best')
  expect(w.statuses.at(-1)).toBe('suggest-model: overkill, Haiku would do (~10x cheaper)')
})

test('the cost setting changes the recommendation; bad input falls back to the defaults, never breaks a prompt', { options: { autoRoute: false, costRatios: 'haiku=1,sonnet=6,opus=4' } }, async ($, on) => {
  const w = world(on, { model: 'claude-haiku-4-5' })
  await submit($, 'write a testthat test for foo()')
  expect(w.statuses.at(-1)).toBe('suggest-model: Haiku is borderline for this, Opus is safer')
})

test('garbage in the cost setting is ignored and the defaults apply', { options: { autoRoute: false, costRatios: 'banana, ===, opus=-4' } }, async ($, on) => {
  const w = world(on)
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.asks[0]!.question).toContain('Haiku 1x weak · Sonnet 20x weak · Opus 40x best')
})

// ------------------------------------------------------------------- typed words need the slash

test('a bare typed suggest-model word is not a command: it is reviewed like any prompt and the switch is unchanged', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  const words = ['suggest-model', 'suggest model', 'suggest-model off', 'Suggest-Model on.']
  for (const t of words) expect(await submit($, t), t).toEqual({ text: t })
  expect(w.arrived.map(x => x.text)).toEqual(words)
  expect(await command($, '')).toContain('suggest-model · on')
  await submit($, DEEP)
  expect(w.asks).toHaveLength(1) // still on
})

test('a prompt that merely contains the keyword is untouched and goes to the model', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  const prompts = ['what does suggest-model do', 'suggest-model please', 'turn suggest-model off for this session', 'the model fit is poor, refit with REML']
  for (const t of prompts) {
    const out = await submit($, t)
    expect(out.text).toBe(t)
  }
  expect(w.arrived.map(x => x.text)).toEqual(prompts)
})

test('/suggest-model on respects enabled = false', { options: { autoRoute: false, enabled: false } }, async ($, on) => {
  world(on)
  expect(await command($, 'on')).toContain('suggest-model · disabled')
})

test('the slash command still works with the same functions', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  expect(await command($, 'off')).toContain('suggest-model · off')
  await submit($, DEEP)
  expect(w.asks).toEqual([])
  expect(await command($, 'on')).toContain('suggest-model · on · Sonnet')
  expect(await command($, 'status')).toContain('Blocks and asks on a mismatch')
})

// --------------------------------------------------------------------- not evaluated

test('slash commands, confirmations and pasted tool output are not evaluated at all', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  const pasted = ['Error: boom', '    at run (/a/b.js:10:5)', '    at main (/a/c.js:3:1)', '    at x (/a/d.js:9:9)', 'Caused by: derive the proof of the lemma'].join('\n')
  for (const t of ['/clear', '/model opus', 'yes', 'OK.', 'thanks', 'go ahead', pasted]) {
    const out = await submit($, t)
    expect(out.text).toBe(t)
  }
  expect(w.asks).toEqual([])
  expect(w.statuses).toEqual([])
  expect(w.arrived).toHaveLength(7)
  expect(await command($, '')).not.toContain('Recent')
})

// ---------------------------------------------------------------------- fail-open (more)

test('a failing status line never blocks the prompt or the dialog', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { breaks: new Set(['status']) })
  const out = await submit($, DEEP)
  expect(out.text).toBe(DEEP)
  expect(w.asks).toHaveLength(1)
  expect(w.arrived).toHaveLength(1)
})

test('a failing /suggest-model off says nothing changed', { options: { autoRoute: false } }, async ($, on) => {
  world(on, { breaks: new Set(['storeSet']) })
  expect(await command($, 'off')).toBe('suggest-model · that did not work, nothing changed')
})

// ------------------------------------------------------------------- effort-watch

test('effort-watch: max effort on a light task adds a note to the status line, and never blocks', { }, async ($, on) => {
  const w = world(on, { model: 'claude-haiku-5-5' })
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'max', messageCount: 1 } as never)) void _
  await w.clock.advance(5)
  await submit($, LIGHT)
  expect(w.statuses.at(-1)).toBe('suggest-model: Haiku fits · effort max is more than this needs · /effort medium')
  expect(w.asks).toHaveLength(0)
  expect(w.arrived).toHaveLength(1) // the prompt went through
})

test('effort-watch: medium effort says nothing extra; the effortWatch setting off silences it', { options: { autoRoute: false, effortWatch: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-haiku-5-5' })
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'max', messageCount: 1 } as never)) void _
  await w.clock.advance(5)
  await submit($, LIGHT)
  expect(w.statuses.at(-1)).toBe('suggest-model: Haiku fits')
})

// ---------------------------------------------------------------------- routing without a switch
const step = ($: Engine) => $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as never)

test('the first prompt of a conversation routes a light task to Haiku for the whole conversation, without asking', async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-5' })
  const named: string[] = []
  on('turn.step', async function* (_$, e) {
    named.push((e as { model: string }).model)
    return { turnId: 't', index: 0, answer: '', toolUses: [] } as never
  })
  await submit($, LIGHT)
  expect(w.asks.length).toBe(0) // no dialog: nothing is cached yet, so there is nothing to lose
  expect(w.toasts.at(-1)).toContain('this conversation runs on Haiku')
  for await (const _ of step($) as never) void _
  for await (const _ of step($) as never) void _
  expect(named).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']) // every request names it, so the cache holds
})

test('routing never goes up, and /model ends it until the next conversation', async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-5' })
  const named: string[] = []
  on('turn.step', async function* (_$, e) {
    named.push((e as { model: string }).model)
    return { turnId: 't', index: 0, answer: '', toolUses: [] } as never
  })
  await submit($, LIGHT)
  w.model = 'claude-sonnet-4-5' // the person picked a model with /model
  for await (const _ of step($) as never) void _
  expect(named).toEqual(['claude-opus-5-5']) // left as the engine named it
})

test('a subagent started without a model gets the cheapest that fits its task; a named model or a fork is left alone', async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-5' })
  const got: unknown[] = []
  on('tool.call', { tool: 'Agent' }, (_$, e) => (got.push((e as { model?: string }).model), { result: 'ok' }) as never)
  const agent = (input: object) => $.tool.call({ tool: 'Agent', description: 'x', ...input } as never)
  await agent({ prompt: LIGHT })
  await agent({ prompt: LIGHT, model: 'opus' })
  await agent({ prompt: LIGHT, subagent_type: 'fork' })
  await agent({ prompt: DEEP })
  expect(got).toEqual(['haiku', 'opus', undefined, undefined]) // the deep task keeps the parent's model
  void w
})

test('autoRoute off: the first prompt asks as before', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on, { model: 'claude-opus-4-5' })
  await submit($, LIGHT)
  expect(w.asks.length).toBe(1)
})
