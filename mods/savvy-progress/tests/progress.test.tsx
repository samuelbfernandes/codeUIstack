// v0.4.0: task bar, helper bar, subagent tree, per-helper tool count (both surfaces).
import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const SONNET = 'claude-sonnet-4-5-20250929'

/** The engine beneath: spawns answer agentId = description; every tool call answers with RESULTS[tool]. */
type Answer = Record<string, unknown> | ((e: { tool: string; [k: string]: unknown }) => unknown)

function engineBeneath(on: On, results: Answer = {}, list: () => unknown[] = () => []) {
  on('agent.spawn', (_$, e) => ({ model: SONNET, agentId: e.description }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.list', () => ({ value: list() }) as never)
  on('tool.call', (_$, e) => (typeof results === 'function' ? results(e) : { result: results[e.tool] ?? 'ok' }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
}

async function spawn($: Engine, description: string, parentAgentId?: string) {
  await $.agent.spawn({
    tool_use_id: `tu-${description}`,
    prompt: 'work',
    description,
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: SONNET,
    background: true,
    fork: false,
    ...(parentAgentId ? { parentAgentId } : {}),
  })
}

/** A tool call made by a subagent's loop (the engine stamps agentId on it). */
const helperTool = ($: Engine, agentId: string) => $.tool.call({ tool: 'Read', file_path: '/x', agentId } as never)

const BAND = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const PANE = { title: 'Subagents', isFocused: false, bodyColumns: 100, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} }
const mountBand = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ plugin: 'savvy-progress', surface, component: 'AbovePrompt', props: BAND })
const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'savvy-progress', surface, component: 'Pane', requestId: 'agents-info', props: PANE })

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

const todo = (content: string, status: string) => ({ content, status, activeForm: content })

for (const surface of SURFACES) {
  test(`${surface}: TodoWrite shows "▰▰▰▱▱ 3/5 tasks" alone on one line, with no helpers`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const newTodos = [todo('a', 'completed'), todo('b', 'completed'), todo('c', 'completed'), todo('d', 'in_progress'), todo('e', 'pending')]
    engineBeneath(on, { TodoWrite: { oldTodos: [], newTodos } })

    const ran = await $.tool.call({ tool: 'TodoWrite', todos: newTodos } as never)
    expect(ran.result).toEqual({ oldTodos: [], newTodos }) // the hook only watches: the result is the engine's

    const band = await mountBand($, surface)
    expect(await texts(band)).toContain('▰▰▰▱▱ 3/5 tasks')
    expect(await band.find({ key: 'savvy-band' })).toBeDefined()
    expect(await band.find({ key: 'details' })).toBeUndefined()
    expect(await band.find({ key: 'hide' })).toBeDefined()
    expect(await band.findAll({ type: 'Box' })).toHaveLength(1)
  })

  test(`${surface}: TaskCreate then TaskUpdate drive the same bar; a failed update changes nothing`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let n = 0
    engineBeneath(on, e => {
      if (e.tool === 'TaskCreate') return { result: { task: { id: String(++n), subject: e.subject } } }
      if (e.tool === 'TaskUpdate') return { result: { success: e.taskId !== '9', taskId: e.taskId, updatedFields: ['status'] } }
      return { result: 'ok' }
    })
    for (const subject of ['one', 'two', 'three']) await $.tool.call({ tool: 'TaskCreate', subject, description: subject } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '9', status: 'completed' } as never)
    expect(await texts(await mountBand($, surface))).toContain('▰▱▱ 1/3 tasks')
    await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' } as never)
    expect(await texts(await mountBand($, surface))).toContain('▰▱ 1/2 tasks')
  })

  test(`${surface}: while helpers run the band adds a helper bar, the task bar and the running helpers with time and tools`, async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    mock.store(on)
    engineBeneath(on, { TodoWrite: { newTodos: [todo('a', 'completed'), todo('b', 'pending')] } })
    await $.tool.call({ tool: 'TodoWrite', todos: [] } as never)
    await spawn($, 'scout')
    await spawn($, 'digger', 'scout')
    await spawn($, 'quick')
    await helperTool($, 'scout')
    await helperTool($, 'scout')
    await helperTool($, 'digger')
    await clock.advance(65_000)

    const band = await mountBand($, surface)
    const body = await texts(band)
    expect(body).toContain('helpers: 3 running')
    expect(body).toContain('▱▱▱ 0/3 helpers')
    expect(body).toContain('▰▱ 1/2 tasks')
    expect(body).toMatch(/▶ scout · 1m05s · 2 tools/)
    expect(body).toMatch(/└ ▶ digger · 1m05s · 1 tool\b/)
    expect(body).toMatch(/▶ quick · 1m05s · 0 tools/)
    expect(await band.find({ key: 'savvy-band' })).toBeDefined()
    expect((await band.find({ key: 'savvy-band' }))?.text).toContain('[details]')
  })

  test(`${surface}: the band lists at most three running helpers and counts the rest`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on)
    for (const id of ['h1', 'h2', 'h3', 'h4', 'h5']) await spawn($, id)
    const body = await texts(await mountBand($, surface))
    expect(body).toContain('+2 more running')
  })

  test(`${surface}: the pane nests a helper started by another helper and shows tool counts`, async ($, on) => {
    const clock = mock.clock(on, { now: 5_000 })
    mock.store(on)
    engineBeneath(on)
    await spawn($, 'parent')
    await spawn($, 'child', 'parent')
    await spawn($, 'grandchild', 'child')
    await helperTool($, 'child')
    await clock.advance(12_000)

    const pane = await mountPane($, surface)
    const body = await texts(pane)
    expect(body).toContain('▶ parent')
    expect(body).toContain('└ ▶ child')
    expect(body).toContain('  └ ▶ grandchild')
    expect(body.indexOf('parent')).toBeLessThan(body.indexOf('child'))
    expect(body.indexOf('child')).toBeLessThan(body.indexOf('grandchild'))
    expect(body).toContain('12s · 1 tool')
    expect(body).toContain('12s · 0 tools')
    expect(await pane.find({ key: 'stop:child' })).toBeDefined() // the Stop button is still on every running row
  })

  test(`${surface}: the parent also comes from the engine's agent list when spawn did not say`, async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    engineBeneath(on, {}, () => [
      { id: 'b', description: 'b', type: 'Explore', status: 'running', parentId: 'a' },
      { id: 'a', description: 'a', type: 'Explore', status: 'running' },
    ])
    await spawn($, 'a')
    await spawn($, 'b')
    await clock.advance(1_000)
    expect(await texts(await mountPane($, surface))).toContain('└ ▶ b')
  })

  test(`${surface}: a refused tool call is not counted and the task list ignores helpers' own task tools`, async ($, on) => {
    mock.clock(on)
    mock.store(on)
    engineBeneath(on, e => (e.tool === 'Bash' ? { deny: 'no' } : { result: { newTodos: [todo('x', 'pending')] } }))
    await spawn($, 'a')
    const denied = await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a' } as never)
    expect(denied.deny).toBe('no')
    await $.tool.call({ tool: 'TodoWrite', todos: [], agentId: 'a' } as never)
    const body = await texts(await mountPane($, surface))
    expect(body).toContain('· 1 tool') // the TodoWrite ran; the refused Bash did not count
    expect(body).not.toContain('tasks')
  })
}

test('/agents-info tree prints the nested list; the plain words give one line and are dropped', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  engineBeneath(on)
  await spawn($, 'parent')
  await spawn($, 'child', 'parent')
  await helperTool($, 'child')
  await clock.advance(3_000)

  const slash = await $.command.run({ command: 'agents-info', args: 'tree', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(slash.text).toBe('▶ parent · running · 3s · 0 tools\n└ ▶ child · running · 3s · 1 tool')

  for (const word of ['agents tree', 'Agents-Info Tree.']) {
    const out = await $.prompt.submit({ text: word, origin: { kind: 'composer' }, wait: false } as never)
    expect(out.text).toBeUndefined()
    expect(out.drop).toBe('▶ parent · running · 3s · 0 tools | └ ▶ child · running · 3s · 1 tool')
    expect(out.drop).not.toContain('\n')
  }
  const sentence = await $.prompt.submit({ text: 'agents tree please', origin: { kind: 'composer' }, wait: false } as never)
  expect(sentence.drop).toBeUndefined()
})

test('/agents-info tree with no helpers says so', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  engineBeneath(on)
  const out = await $.prompt.submit({ text: 'agents tree', origin: { kind: 'composer' }, wait: false } as never)
  expect(out.drop).toBe('No subagents have run in this session.')
})
