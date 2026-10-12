import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

const SONNET = 'claude-sonnet-4-5-20250929'
const HAIKU = 'claude-haiku-4-5-20251001'

/** What each agent's requests cost, keyed by agent id; absent = the API reported no usage. */
const USAGE: Record<string, { model: string; input: number; output: number }> = {
  a1: { model: SONNET, input: 10_000, output: 2_000 },
  a2: { model: HAIKU, input: 5_000, output: 1_000 },
}

/** The engine beneath the plugin: spawns hand out ids by description, steps report USAGE. */
function engineBeneath(on: On, list: () => unknown[] = () => []) {
  on('agent.spawn', ($, e) => ({ model: e.model ?? SONNET, agentId: e.description }))
  on('turn.step', async function* ($, e) {
    const known = e.agentId === undefined ? undefined : USAGE[e.agentId]
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage:
        known === undefined
          ? null
          : {
              model: known.model,
              input_tokens: known.input,
              output_tokens: known.output,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
            },
    }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.list', () => ({ value: list() }) as never)
}

async function spawn($: Engine, description: string, model?: string) {
  await $.agent.spawn({
    tool_use_id: `tu-${description}`,
    prompt: 'work',
    description,
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: SONNET,
    background: true,
    fork: false,
    ...(model ? { model } : {}),
  })
}

/** The person typing `/agents-info <args>`. */
const slash = ($: Engine, args = '') =>
  $.command.run({
    command: 'agents-info',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })

async function step($: Engine, agentId: string, turnId = `${agentId}-t1`) {
  const stream = $.turn.step({ turnId, index: 0, model: SONNET, messageCount: 3, agentId })
  for await (const chunk of stream) void chunk
  await stream.result
}

async function finish($: Engine, agentId: string, usage?: { input: number; output: number; model: string }) {
  await $.turn.complete({
    answer: 'done',
    durationMs: 20_000,
    isAborted: false,
    turnId: `${agentId}-t1`,
    agentId,
    reason: 'answer',
    ...(usage
      ? { usage: { model: usage.model, input_tokens: usage.input, output_tokens: usage.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
      : {}),
  })
}

const BAND = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const PANE = { title: 'Subagents', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

for (const surface of SURFACES) {
  test(`${surface}: band shows counts, tokens, est. cost and elapsed; pane lists each helper`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    engineBeneath(on)

    await spawn($, 'a1')
    await spawn($, 'a2', 'haiku')
    await step($, 'a1')
    await step($, 'a2')
    await clock.advance(20_000)
    await finish($, 'a1', USAGE.a1)

    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    const line = (await band.find({ key: 'savvy-band' }))?.text ?? ''
    expect(await texts(band)).toContain('helpers: 1 running, 1 done · 18k tok · est. $0.07 · 20s')
    expect(line).toContain('[details]')

    const pane = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'agents-info', props: PANE })
    expect(await texts(pane)).toContain('2 helpers (1 running) · 18k tok · est. $0.07 · 20s')
    const first = (await pane.find({ key: 'row:a1' }))?.children.length
    expect(first).toBe(2)
    const body = await texts(pane)
    expect(body).toContain('a1 (Explore, sonnet-4-5) finished')
    expect(body).toContain('a2 (Explore, haiku-4-5) running')
    expect(body).toContain('ctx 5% · 12k tok (out 2k) · est. $0.06 · 20s')
    expect(body).toContain('est. $0.01')
  })

  test(`${surface}: quiet before any helper has run`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    // The engine's own drawing of an empty band, which the plugin must leave alone.
    on('ui.render', ($, e) => {
      const { Box } = $.ui.resolve(e)
      return <Box key="engine-band" />
    })
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await band.find({ key: 'savvy-band' })).toBeUndefined()
    expect(await band.find({ key: 'engine-band' })).toBeDefined()
  })

  test(`${surface}: a helper without usage shows grey and no cost`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    await spawn($, 'silent')
    await step($, 'silent')

    const pane = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'agents-info', props: PANE })
    const body = await texts(pane)
    expect(body).toContain('no usage reported')
    expect(body).not.toContain('est. $')
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await texts(band)).toContain('no usage yet')
  })

  test(`${surface}: elapsed time follows the once-a-second timer while a helper runs`, async ($, on) => {
    const clock = mock.clock(on, { now: 5_000 })
    mock.store(on)
    engineBeneath(on)
    await spawn($, 'a1')
    await clock.advance(65_000)
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await texts(band)).toContain('1 running')
    expect(await texts(band)).toContain('1m05s')
  })

  test(`${surface}: the engine saying a helper was killed ends it as failed`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engineBeneath(on, () => [{ id: 'a1', description: 'a1', type: 'Explore', status: 'killed' }])
    await spawn($, 'a1')
    await clock.advance(1_000)
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await texts(band)).toContain('1 failed')
  })

  test(`${surface}: hide button hides the band, /agents-info band brings it back`, async ($, on) => {
    mock.clock(on)
    const hidden = { value: undefined as never }
    mock.store(on)
    engineBeneath(on)
    on('ui.toast', () => hidden)
    on('ui.render', ($$, e) => {
      const { Box } = $$.ui.resolve(e)
      return <Box key="engine-band" />
    })
    await spawn($, 'a1')
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    await band.press({ key: 'hide' })
    expect(await band.find({ key: 'savvy-band' })).toBeUndefined()

    const shown = await slash($, 'band')
    expect(shown.text).toContain('shown')
    const again = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await again.find({ key: 'savvy-band' })).toBeDefined()
  })

  test(`${surface}: /agents-info opens the pane, a second run closes it`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    const open: { id: string; title: string; isShown: boolean; isFocused: boolean }[] = []
    on('ui.panes', () => ({ value: [...open] }) as never)
    on('ui.open', (_$, e) => {
      open.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false })
      return { value: { isPlaced: true as const } } as never
    })
    on('ui.close', (_$, e) => {
      open.splice(0, open.length, ...open.filter(p => p.id !== e.id))
      return { value: undefined } as never
    })

    expect((await slash($)).text).toContain('opened')
    expect(open.map(p => p.id)).toEqual(['agents-info'])
    expect((await slash($)).text).toContain('closed')
    expect(open).toHaveLength(0)
  })

  test(`${surface}: a running helper has a Stop button that ends it through TaskStop; a finished one has none`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    const stopped: unknown[] = []
    const toasts: string[] = []
    on('tool.call', { tool: 'TaskStop' }, (_$, e) => {
      stopped.push((e as unknown as { task_id?: string }).task_id)
      return { result: 'stopped' } as never
    })
    on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }) as never)
    await spawn($, 'a1')
    await spawn($, 'a2')
    await step($, 'a1')
    await finish($, 'a2', USAGE.a2)
    const pane = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'agents-info', props: PANE })
    expect(await pane.find({ key: 'stop:a2' })).toBeUndefined()
    await pane.press({ key: 'stop:a1' })
    expect(stopped).toEqual(['a1'])
    expect(toasts.at(-1)).toBe('Stopped a1')
  })

  test(`${surface}: when the engine refuses the stop, the person is told and nothing breaks`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    const toasts: string[] = []
    on('tool.call', { tool: 'TaskStop' }, () => {
      throw new Error('no such task')
    })
    on('ui.toast', (_$, e) => (toasts.push(e.text), { value: undefined }) as never)
    await spawn($, 'a1')
    await step($, 'a1')
    const pane = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'agents-info', props: PANE })
    await pane.press({ key: 'stop:a1' })
    expect(toasts.at(-1)).toContain('Could not stop a1')
  })

  test(`${surface}: price overrides from userConfig change the estimate`, { options: { priceOverrides: 'sonnet=30/150' } }, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    await spawn($, 'a1')
    await step($, 'a1')
    const band = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
    expect(await texts(band)).toContain('est. $0.60')
  })
}

test('session start registers /agents-info', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const registered: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    registered.push(e.name)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: true })
  expect(registered).toEqual(['agents-info'])
})

// ---- plain words (v0.2.0): agents-info, agents info, agents -----------------------------------

/** A pane list that follows ui.open / ui.close, and a bottom that lets a prompt through as text. */
function panesBeneath(on: On) {
  const open: { id: string; title: string; isShown: boolean; isFocused: boolean; isPlaced: boolean }[] = []
  on('ui.panes', () => ({ value: [...open] }) as never)
  on('ui.open', (_$, e) => {
    open.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })
    return { value: { isPlaced: true as const } } as never
  })
  on('ui.close', (_$, e) => {
    open.splice(0, open.length, ...open.filter(p => p.id !== e.id))
    return { value: undefined } as never
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return open
}

const typed = ($: Engine, text: string, extra: object = {}) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...extra } as never)

for (const surface of SURFACES) {
  test(`${surface}: each plain word toggles the pane like /agents-info and is dropped, not sent`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    const open = panesBeneath(on)
    await spawn($, 'a1')
    await step($, 'a1')

    for (const word of ['agents-info', 'Agents Info', ' agents. ']) {
      const opened = await typed($, word)
      expect(opened.drop).toBe('Subagent pane opened (token counts are real, costs are est.).')
      expect(opened.text).toBeUndefined()
      expect(open.map(p => p.id)).toEqual(['agents-info'])
      if (word === 'agents-info') {
        const pane = await $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'agents-info', props: PANE })
        expect(await texts(pane)).toContain('1 helper')
      }
      expect((await typed($, word)).drop).toBe('Subagent pane closed.')
      expect(open).toHaveLength(0)
    }
    // The slash command still gives the same words.
    expect((await slash($)).text).toBe('Subagent pane opened (token counts are real, costs are est.).')
  })
}

test('only the exact words count: sentences, other senders, attachments and `agents band` pass through', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engineBeneath(on)
  const open = panesBeneath(on)
  for (const text of ['agents are great', 'show agents', 'agents info please', 'agents band', 'agents-info band', 'agent']) {
    const out = await typed($, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect((await typed($, 'agents', { origin: { kind: 'scheduled-trigger' } })).drop).toBeUndefined()
  expect((await typed($, 'agents', { attachments: [{ type: 'image', data: 'x' }] })).drop).toBeUndefined()
  expect(open).toHaveLength(0)
})

test('a failing toggle still drops the plain word, with a short notice', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engineBeneath(on)
  on('ui.panes', () => {
    throw new Error('boom')
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  const out = await typed($, 'agents')
  expect(out.drop).toBe('/agents-info could not run; see the debug log.')
})
