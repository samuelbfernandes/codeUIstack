import { expect, mock, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

import { DEFAULT_BOX, buildRows, groupRuns, hideRow, layoutLines, parseRows, providerOf, showRow } from '../hooks/sessionrows'

type On = Parameters<TestBody>[1]

const PANE_PROPS = { title: 'Moddeck', isFocused: false, bodyColumns: 40, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true } as const
const T0 = Date.UTC(2026, 5, 1, 12, 0, 0)
const MIN = 60_000
const H = 60 * MIN

// Stand-ins for the two mods whose atoms the Session box reads: `seed-<mod>` sets the atom to the JSON it is given.
const MODS = {
  plugins: [
    {
      name: 'usage-meter',
      register(on: On) {
        on('command.run', { command: 'seed-budget-guard' }, async ($, e) => {
          await $.state.set({ plugin: 'usage-meter', key: 'ledger' } as never, (e.args === 'none' ? null : JSON.parse(e.args)) as never)
          return { text: 'seeded' }
        })
      },
    },
    {
      name: 'suggest-model',
      register(on: On) {
        on('command.run', { command: 'seed-effort' }, async ($, e) => {
          await $.state.set({ plugin: 'suggest-model', key: 'effortAdvice' } as never, (e.args === 'none' ? '' : e.args) as never)
          return { text: 'seeded' }
        })
      },
    },
    {
      name: 'cache-guard',
      register(on: On) {
        on('command.run', { command: 'seed-cache-tax' }, async ($, e) => {
          await $.state.set({ plugin: 'cache-guard', key: 'cache' } as never, (e.args === 'none' ? null : JSON.parse(e.args)) as never)
          return { text: 'seeded' }
        })
      },
    },
  ],
}

type Data = {
  usage?: unknown
  usageThrows?: boolean
  gitStatus?: string
  gitRev?: string
  /** Epoch seconds `git log -1` and the newest checkpoint ref answer with. */
  commitAt?: number
  checkpointAt?: number
  gitThrows?: boolean
  tools?: { name: string; description: string; mcp: boolean }[]
  settings?: Record<string, unknown>
  settingsThrows?: boolean
  ancestors?: { dir: string; name: string; content: string; parts: never[] }[]
  rules?: { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }[]
  home?: string
  /** Which sources throw: the engine call by name. */
  throws?: string[]
  env?: Record<string, string>
  model?: string
  /** Files fs.read can read, by path. */
  files?: Record<string, string>
  store?: Record<string, unknown>
}

function world(on: On, d: Data = {}) {
  const w = {
    clock: mock.clock(on, { now: T0 }),
    store: new Map<string, unknown>(Object.entries(d.store ?? {})),
    breakdownAsked: [] as unknown[],
    panes: [] as string[],
    /** What a tool call answers, by tool name; a test sets or replaces one. */
    tools: {} as Record<string, () => unknown>,
    data: d,
  }
  const boom = (name: string) => {
    if (d.throws?.includes(name)) throw new Error(`no ${name}`)
  }
  mock.env(on, { ...(d.home ? { HOME: d.home } : {}), ...(d.env ?? {}) })
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', (_$, e) => (w.panes.push(e.id), { value: { isPlaced: true as const } }))
  on('ui.close', (_$, e) => ((w.panes = w.panes.filter(p => p !== e.id)), { value: undefined }))
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', (_$, e) => {
    if (d.usageThrows || d.usage === undefined) throw new Error('no usage figures')
    if (e.breakdown) w.breakdownAsked.push(e.breakdown)
    const u = d.usage as { context: Record<string, unknown> }
    const categories = [
      { name: 'Messages', tokens: 120_000, color: 'x', isDeferred: false, kind: 'used' },
      { name: 'System prompt', tokens: 20_000, color: 'x', isDeferred: false, kind: 'used' },
      { name: 'Free space', tokens: 9_000, color: 'x', isDeferred: false, kind: 'free' },
    ]
    return { value: (e.breakdown ? { ...u, context: { ...u.context, breakdown: { categories } } } : u) as never }
  })
  on('session.model', () => (boom('session.model'), { value: d.model ?? 'claude-sonnet-5-5' }))
  on('config.list', () => (boom('config.list'), { value: [] as never }))
  on('process.run', (_$, e) => {
    if (d.gitThrows) throw new Error('git missing')
    const argv = e.argv.join(' ')
    if (argv.includes('for-each-ref')) return { value: { exitCode: 0, stdout: d.checkpointAt === undefined ? '' : `${d.checkpointAt}\n`, stderr: '' } } as never
    if (argv.includes(' log ')) return { value: { exitCode: d.commitAt === undefined ? 128 : 0, stdout: d.commitAt === undefined ? '' : `${d.commitAt}\n`, stderr: '' } } as never
    if (argv.includes('status')) {
      return { value: d.gitStatus === undefined ? { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' } : { exitCode: 0, stdout: d.gitStatus, stderr: '' } } as never
    }
    return { value: { exitCode: 0, stdout: d.gitRev ?? '.git\n.git\n', stderr: '' } } as never
  })
  on('tool.list', () => (boom('tool.list'), { value: (d.tools ?? []) as never }))
  on('settings.read', () => {
    if (d.settingsThrows) throw new Error('no settings')
    return { value: (d.settings ?? {}) as never }
  })
  on('fs.ancestors', () => (boom('fs.ancestors'), { value: (d.ancestors ?? []) as never }))
  on('fs.list', () => (boom('fs.list'), { value: (d.rules ?? []) as never }))
  on('fs.read', (_$, e) => {
    const text = d.files?.[e.path]
    if (text === undefined) throw new Error('missing')
    return { value: text }
  })
  on('tool.call', async (_$, e) => ((await w.tools[e.tool]?.()) ?? { result: {} }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) as never)
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  return w
}

const GOOD_USAGE = {
  startedAt: T0 - 72 * MIN,
  context: { tokens: 90_000, window: 200_000, percent: 45 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 34, resetsAt: new Date(T0 + 90 * MIN).toISOString() },
    { kind: 'seven_day', percentUsed: 12, resetsAt: new Date(T0 + 2 * 24 * H).toISOString() },
  ],
  cost: { usd: 1.234 },
}

/** A window without its token counts draws short enough for the context and cost rows to share a line. */
const SHORT_USAGE = { ...GOOD_USAGE, context: { window: 200_000, percent: 45 }, rateLimits: [] }

const run = ($: Engine, command: string, args: string) => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)
// One pane at a time: a fresh drawing replaces the last one.
let shownPane: { unmount: () => Promise<unknown> } | undefined
const mount = async ($: Engine) => {
  await shownPane?.unmount().catch(() => undefined)
  const pane = await $.ui.mount({ plugin: 'moddeck', surface: 'terminal', component: 'Pane', requestId: 'moddeck', props: PANE_PROPS, viewport: FULLSCREEN } as never)
  shownPane = pane as never
  return pane
}
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
const start = async ($: Engine, w: ReturnType<typeof world>) => {
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false } as never)
  await w.clock.advance(10)
  await w.clock.settle()
}
const measure = ($: Engine, usage: { context: unknown; rateLimits: unknown; cost?: unknown }, changed: string[] = ['context', 'rateLimits', 'cost']) =>
  $.session.measure({ context: usage.context, rateLimits: usage.rateLimits, cost: usage.cost, changed } as never)
const clockText = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
// The props (colour, dim, bold) of the first Text that holds `text`. A line is one Text (cut with "…" when narrow) holding a Text per coloured part: the first part that matches.
const colorOf = async (pane: { findAll: (q: { type: string; text: string }) => Promise<unknown[]> }, text: string) =>
  JSON.stringify(((await pane.findAll({ type: 'Text', text })) as { props?: { wrap?: string } }[]).find(t => t.props?.wrap === undefined)?.props)

test('with nothing known the Session box is not drawn and the side bar is the old one', MODS, async ($, on) => {
  const w = world(on, { usageThrows: true, throws: ['session.model'] })
  await start($, w)
  const pane = await mount($)
  const shown = await texts(pane)
  expect(shown).not.toContain('Session')
  expect(shown).toContain('Workspace utilities')
  expect(shown).toContain('Skills')
  expect(await pane.find({ key: 'row:checkpoint' })).toBeDefined()
})

test('every row draws from the data it is given, in order, above the tools', MODS, async ($, on) => {
  const w = world(on, {
    usage: GOOD_USAGE,
    home: '/home/u',
    files: { '/home/u/.claude/CLAUDE.md': 'rules' },
    env: { CLAUDE_CODE_USE_BEDROCK: '1' },
    gitStatus: '# branch.oid abcdef1234567\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 1 1 1 a b f.ts\n? n.txt\n',
    gitRev: '/repo/.git/worktrees/wt1\n/repo/.git\n',
    tools: [{ name: 'Read', description: '', mcp: false }, { name: 'mcp__github__search', description: '', mcp: true }],
    settings: { mcpServers: { linear: {} }, hooks: { PreToolUse: [{ hooks: [{}, {}] }], Stop: [{ hooks: [{}] }] }, enabledPlugins: { 'a@m': true, 'b@m': false, 'c@m': true } },
    ancestors: [{ dir: '/home/u/proj', name: 'CLAUDE.md', content: 'x', parts: [] }, { dir: '/home/u', name: 'CLAUDE.md', content: 'x', parts: [] }, { dir: '/', name: 'CLAUDE.md', content: 'x', parts: [] }],
    rules: [{ name: 'a.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: 'b.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }, { name: 'c.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false }],
  })
  await run($, 'seed-budget-guard', JSON.stringify({ today: 3.5, week: 12 }))
  await run($, 'seed-cache-tax', JSON.stringify({ expiresAt: T0 + 2 * H, hitRate: 0.87 }))
  await start($, w)
  // a step, a few tools, a skill, an MCP call, a turn with usage, a compaction
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-4-5', effort: 'high', messageCount: 1 } as never)) void _
  await w.clock.advance(10)
  await $.tool.call({ tool: 'Read', file_path: '/work/src/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/work/src/b.ts' } as never)
  await $.tool.call({ tool: 'Skill', skill: 'dual-model-review' } as never)
  await $.tool.call({ tool: 'mcp__github__search', query: 'x' } as never)
  await $.turn.complete({ answer: 'ok', durationMs: 2000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'm', input_tokens: 1200, output_tokens: 500, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 10 } } as never)
  await w.clock.advance(10)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  await measure($, GOOD_USAGE)
  const pane = await mount($)
  const shown = await texts(pane)
  expect(shown).toContain('Session')
  expect(shown).toContain('claude-opus-4-5') // model row: the step's model, provider, effort, duration
  expect(shown).toContain('Bedrock')
  expect(shown).toContain('high')
  expect(shown).toContain('1h 12m')
  expect(shown).toContain('45%') // context
  expect(shown).toContain('90k/200k')
  expect(shown).toContain('5h ')
  expect(shown).toContain('34%')
  expect(shown).toContain('resets in 1h 30m')
  expect(shown).not.toContain('7d ') // 12% < 80%
  expect(shown).toContain('$1.23') // cost
  expect(shown).toContain('Today $3.50')
  expect(shown).toContain('Week $12.00')
  expect(shown).toContain(`Cache until ${clockText(T0 + 2 * H)}`)
  expect(shown).toContain('hit 87%')
  expect(shown).toContain('main*') // git: dirty
  expect(shown).toContain('↑2')
  expect(shown).toContain('↓1')
  expect(shown).toContain('!1 +0 ✘0 ?1')
  expect(shown).toContain('⎇ wt1')
  expect(shown).toContain('in 1.2k')
  expect(shown).toContain('out 500')
  expect(shown).toContain('cache 80k')
  expect(shown).toContain('250 tok/s')
  expect(shown).toContain('✓ Read ×2') // activity
  expect(shown).toContain('✓ Skill')
  expect(shown).toContain('Skills: dual-model-review')
  expect(shown).toContain('MCP: github')
  expect(shown).toContain('Compactions: 1')
  expect(shown).toContain('3 CLAUDE.md · 2 rules · 2 MCP · 3 hooks · 2 plugins')
  // order: the Session box sits on top, and its rows keep the setting's order
  expect(shown.indexOf('Session')).toBeLessThan(shown.indexOf('Side Question'))
  expect(shown.indexOf('Side Question')).toBeLessThan(shown.indexOf('Workspace utilities')) // Side Question sits right under the Session box
  const order = ['claude-opus-4-5', 'Context', '5h ', '$1.23', 'Cache until', 'main*', 'in 1.2k', '✓ Read', '3 CLAUDE.md'].map(t => shown.indexOf(t))
  expect([...order].sort((a, b) => a - b)).toEqual(order)
})

test('each row is hidden when its figure is missing, and the rest still draw', MODS, async ($, on) => {
  const w = world(on, { usage: { startedAt: T0 - 5 * MIN, context: { window: 200_000 }, rateLimits: [] } })
  await start($, w)
  const pane = await mount($)
  const shown = await texts(pane)
  expect(shown).toContain('5m') // only the duration of the model row
  for (const absent of ['Context', '5h ', 'Today', 'Cache', 'tok/s', 'in 0', 'CLAUDE.md', 'Compactions', '✓']) expect(shown).not.toContain(absent)
  expect(await pane.find({ key: 'session:row:context' })).toBeUndefined() // a window with no fill is not drawn as zero
  expect(await pane.find({ key: 'session:row:usage' })).toBeUndefined()
  expect(await pane.find({ key: 'session:row:cost' })).toBeUndefined()
  expect(await pane.find({ key: 'session:row:git' })).toBeUndefined() // not a repository
})

test('context goes green, yellow at 70% and red at 85%, and at 85% the biggest categories show without a paid count', MODS, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE })
  await start($, w)
  const atStart = w.breakdownAsked.length // the Skills box reads the skill list once, from the free local estimate
  await measure($, { ...GOOD_USAGE, context: { tokens: 90_000, window: 200_000, percent: 45 } })
  expect(await colorOf(await mount($), '▰')).toContain('success')
  await measure($, { ...GOOD_USAGE, context: { tokens: 150_000, window: 200_000, percent: 75 } })
  expect(await colorOf(await mount($), '▰')).toContain('warning')
  expect(w.breakdownAsked.length).toBe(atStart)
  await measure($, { ...GOOD_USAGE, context: { tokens: 180_000, window: 200_000, percent: 90 } })
  const pane = await mount($)
  expect(await colorOf(pane, '▰')).toContain('error')
  expect(await texts(pane)).toContain('Messages 120k · System prompt 20k')
  expect(w.breakdownAsked.length).toBe(atStart + 1)
  expect(w.breakdownAsked.every(d => d === 'summary')).toBe(true) // never 'full': that sends one token-count request per tool
  await measure($, { ...GOOD_USAGE, context: { tokens: 90_000, window: 200_000, percent: 45 } })
  expect(await texts(await mount($))).not.toContain('Messages 120k')
})

test('usage pace: amber and red get a ▲, a window under 10% or on pace gets none', { ...MODS, options: { skillRows: 6 } }, async ($, on) => {
  const w = world(on)
  await start($, w)
  const at = (kind: string, percentUsed: number, leftMs: number) => ({ kind, percentUsed, resetsAt: new Date(w.clock.now() + leftMs).toISOString() })
  const draw = async (rateLimits: ReturnType<typeof at>[]) => {
    await measure($, { ...GOOD_USAGE, rateLimits })
    const pane = await mount($)
    return { shown: (await texts(pane)).split('Side Question')[0]!, pane } // the Session box only: the lists below have ▲ arrows
  }
  // five hours, 2.5 h left: 45% is 90% projected (amber), 50% is 100% (red), 30% is on pace
  let r = await draw([at('five_hour', 45, 2.5 * H)])
  expect(r.shown).toContain('▲')
  expect(await colorOf(r.pane, '▲')).toContain('warning')
  r = await draw([at('five_hour', 50, 2.5 * H)])
  expect(r.shown).toContain('▲')
  expect(await colorOf(r.pane, '▲')).toContain('error')
  r = await draw([at('five_hour', 30, 2.5 * H)])
  expect(r.shown).not.toContain('▲')
  expect(await colorOf(r.pane, '30%')).toContain('success')
  r = await draw([at('five_hour', 8, 0.2 * H)]) // far ahead of the clock but under 10%: neutral
  expect(r.shown).not.toContain('▲')
  expect(r.shown).toContain('resets in 12m')
})

test('the 7d window shows only once it is 80% used, and another kind shows by its name', MODS, async ($, on) => {
  const w = world(on)
  await start($, w)
  const reset = new Date(T0 + 24 * H).toISOString()
  await measure($, { ...GOOD_USAGE, rateLimits: [{ kind: 'seven_day', percentUsed: 79, resetsAt: reset }, { kind: 'spend_limit', percentUsed: 20 }] })
  let shown = await texts(await mount($))
  expect(shown).not.toContain('7d ')
  expect(shown).toContain('spend_limit ')
  await measure($, { ...GOOD_USAGE, rateLimits: [{ kind: 'seven_day', percentUsed: 80, resetsAt: reset }] })
  shown = await texts(await mount($))
  expect(shown).toContain('7d ')
  expect(shown).toContain('resets in 1d')
})

test('the 7d threshold is a setting', { ...MODS, options: { usageSevenDayAt: 10 } }, async ($, on) => {
  const w = world(on)
  await start($, w)
  await measure($, { ...GOOD_USAGE, rateLimits: [{ kind: 'seven_day', percentUsed: 12, resetsAt: new Date(T0 + 24 * H).toISOString() }] })
  expect(await texts(await mount($))).toContain('7d ')
})

test('the ledger and cache atoms: present they draw; absent (or null parts) they draw nothing', MODS, async ($, on) => {
  const w = world(on)
  await start($, w)
  await measure($, GOOD_USAGE)
  let shown = await texts(await mount($))
  expect(shown).toContain('$1.23')
  expect(shown).not.toContain('Today')
  expect(shown).not.toContain('Cache')
  await run($, 'seed-budget-guard', JSON.stringify({ today: 2, week: null }))
  await run($, 'seed-cache-tax', JSON.stringify({ expiresAt: null, hitRate: 0.5 }))
  shown = await texts(await mount($))
  expect(shown).toContain('Today $2.00')
  expect(shown).not.toContain('Week')
  expect(shown).not.toContain('Cache until')
  expect(shown).toContain('hit 50%')
  await run($, 'seed-cache-tax', JSON.stringify({ expiresAt: T0 - 1, hitRate: null }))
  shown = await texts(await mount($))
  expect(shown).toContain('Cache expired')
  expect(shown).not.toContain('hit')
  await run($, 'seed-budget-guard', 'none')
  await run($, 'seed-cache-tax', 'none')
  shown = await texts(await mount($))
  expect(shown).not.toContain('Today')
  expect(shown).not.toContain('Cache')
})

test('the ahead count turns to the warning colour from pushWarn unpushed commits', { ...MODS, options: { pushWarn: 3 } }, async ($, on) => {
  const w = world(on, { gitStatus: '# branch.oid abc\n# branch.head main\n# branch.upstream o/main\n# branch.ab +2 -0\n' })
  await start($, w)
  const pane = await mount($)
  expect(await texts(pane)).toContain('↑2')
  expect(await colorOf(pane, '↑2')).not.toContain('warning')
})

test('at pushWarn unpushed commits the ahead count is the warning colour', { ...MODS, options: { pushWarn: 3 } }, async ($, on) => {
  const w = world(on, { gitStatus: '# branch.oid abc\n# branch.head main\n# branch.upstream o/main\n# branch.ab +3 -0\n' })
  await start($, w)
  expect(await colorOf(await mount($), '↑3')).toContain('warning')
})

test('git refreshes after each turn: a new change shows without a restart', MODS, async ($, on) => {
  const w = world(on, { gitStatus: '# branch.oid abc\n# branch.head main\n' })
  await start($, w)
  expect(await texts(await mount($))).toContain('main')
  expect(await texts(await mount($))).not.toContain('main*')
  w.data.gitStatus += '? new.txt\n'
  await $.turn.complete({ answer: 'ok', durationMs: 100, isAborted: false, turnId: 't', reason: 'answer' } as never)
  await w.clock.advance(10)
  await w.clock.settle()
  expect(await texts(await mount($))).toContain('main*')
})

test('activity: finished calls group, a running call shows its target, and the visible count is a setting', { ...MODS, options: { toolsMaxVisible: 2 } }, async ($, on) => {
  const w = world(on)
  let release: () => void = () => undefined
  const gate = new Promise<void>(r => (release = r))
  w.tools.Edit = async () => (await gate, { result: {} })
  await start($, w)
  await $.tool.call({ tool: 'Read', file_path: '/a/one.ts' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'foo' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'bar' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/a/two.ts' } as never)
  const editing = $.tool.call({ tool: 'Edit', file_path: '/work/src/auth.ts' } as never)
  await w.clock.advance(10)
  await w.clock.settle()
  const shown = await texts(await mount($))
  expect(shown).toContain('◐ Edit auth.ts')
  expect(shown).toContain('✓ Read ×2') // the last two groups only: Grep ×2 scrolled off
  expect(shown).not.toContain('Grep')
  release()
  await editing
  await w.clock.settle()
  expect(await texts(await mount($))).toContain('✓ Edit')
  expect(await texts(await mount($))).not.toContain('Compactions') // hidden until the first
})

test('a tool call passes through whatever the books do', MODS, async ($, on) => {
  const w = world(on)
  w.tools.Read = () => ({ result: { text: 'file body' } })
  await start($, w)
  const out = await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never)
  expect(JSON.stringify(out)).toContain('file body')
})

test('environment: counts show at the default threshold', MODS, async ($, on) => {
  const w = world(on, { home: '/home/u', ancestors: [{ dir: '/home/u/p', name: 'CLAUDE.md', content: 'x', parts: [] }], rules: [{ name: 'a.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] })
  await start($, w)
  expect(await texts(await mount($))).toContain('1 CLAUDE.md · 1 rules')
})

test('environment: a total under envThreshold hides the row', { ...MODS, options: { envThreshold: 5 } }, async ($, on) => {
  const w = world(on, { home: '/home/u', ancestors: [{ dir: '/home/u/p', name: 'CLAUDE.md', content: 'x', parts: [] }] })
  await start($, w)
  expect(await texts(await mount($))).not.toContain('CLAUDE.md')
})

test('environment: a total at envThreshold shows', { ...MODS, options: { envThreshold: 1 } }, async ($, on) => {
  const w = world(on, { home: '/home/u', ancestors: [{ dir: '/home/u/p', name: 'CLAUDE.md', content: 'x', parts: [] }] })
  await start($, w)
  expect(await texts(await mount($))).toContain('1 CLAUDE.md')
})

test('the provider shows for a custom base URL host, not for the default API', MODS, async ($, on) => {
  const w = world(on, { env: { ANTHROPIC_BASE_URL: 'https://llm.example.com:8443/v1' }, model: 'm1' })
  await start($, w)
  expect(await texts(await mount($))).toContain('llm.example.com:8443')
  expect(providerOf({ baseUrl: 'https://api.anthropic.com' })).toBeUndefined()
  expect(providerOf({ vertex: '1' })).toBe('Vertex')
  expect(providerOf({ bedrock: '0', vertex: 'false' })).toBeUndefined()
})

test('/moddeck rows hide and show change the box, keep the choice in the store, and list says what is shown', MODS, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE })
  await start($, w)
  expect(await texts(await mount($))).toContain('$1.23')
  expect((await run($, 'moddeck', 'rows hide cost')).text).toContain('hid cost')
  expect(w.store.get('rows')).toBe('model,mode,context,usage,cache,git,backup,tokens,activity,environment')
  expect(await texts(await mount($))).not.toContain('$1.23')
  expect((await run($, 'moddeck', 'rows list')).text).toContain('Hidden: cost')
  expect((await run($, 'moddeck', 'rows show cost')).text).toContain('showing cost')
  expect(w.store.get('rows')).toBe('model,mode,context,usage,cost,cache,git,backup,tokens,activity,environment') // back in its place
  expect(await texts(await mount($))).toContain('$1.23')
  expect(w.panes).toEqual([]) // none of this opened or closed the pane
})

test('hidden rows come back after a restart: the store is read at session start', MODS, async ($, on) => {
  const w = world(on, { usage: SHORT_USAGE, store: { rows: 'context,cost', layout: 'compact' } })
  await start($, w)
  const pane = await mount($)
  expect(await texts(pane)).toContain('45%')
  expect(await texts(pane)).not.toContain('claude-sonnet') // the model row was hidden
  expect(await pane.find({ key: 'session:row:context+cost' })).toBeDefined() // the saved compact layout too
})

test('compact joins the rows with │ on fewer lines; expanded puts one on each', MODS, async ($, on) => {
  const w = world(on, { usage: SHORT_USAGE })
  await start($, w)
  const lines = async () => (await (await mount($)).findAll({ type: 'Box' })).map(b => (b as { key?: string }).key).filter((k): k is string => k?.startsWith('session:row:') === true)
  const before = await lines()
  expect(before).toEqual(['session:row:model', 'session:row:context', 'session:row:cost'])
  expect((await run($, 'moddeck', 'rows compact')).text).toContain('compact')
  expect(w.store.get('layout')).toBe('compact')
  const after = await lines()
  expect(after).toEqual(['session:row:model', 'session:row:context+cost'])
  expect(await texts(await mount($))).toContain('│')
  await run($, 'moddeck', 'rows expanded')
  expect(w.store.get('layout')).toBe('expanded')
  expect(await lines()).toEqual(before)
})

test('unknown words give help and change nothing; no argument still toggles the pane', MODS, async ($, on) => {
  const w = world(on)
  await start($, w)
  for (const args of ['rows hide nothing', 'rows wobble', 'rows hide', 'nonsense', 'rows show cost extra']) {
    const out = await run($, 'moddeck', args)
    expect(out.text).toContain('/moddeck rows')
  }
  expect(w.store.has('rows')).toBe(false)
  expect(w.store.has('layout')).toBe(false)
  expect(w.panes).toEqual([])
  expect((await run($, 'moddeck', '')).text).toBe('Moddeck · open')
  expect(w.panes).toEqual(['moddeck'])
})

test('showSession off: no box at all', { ...MODS, options: { showSession: false } }, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE })
  await start($, w)
  await measure($, GOOD_USAGE)
  expect(await texts(await mount($))).not.toContain('Session')
})

test('fail-open: every data source throwing leaves the start, the events and the side bar working', MODS, async ($, on) => {
  const w = world(on, { usageThrows: true, gitThrows: true, settingsThrows: true, throws: ['fs.ancestors', 'fs.list', 'tool.list', 'config.list', 'session.model'] })
  w.tools.Read = () => ({ result: { text: 'body' } })
  await start($, w)
  expect(JSON.stringify(await $.tool.call({ tool: 'Read', file_path: '/a.ts' } as never))).toContain('body')
  const done = await $.turn.complete({ answer: 'fine', durationMs: 10, isAborted: false, turnId: 't', reason: 'answer' } as never)
  expect(done.text).toBe('fine')
  await w.clock.advance(10)
  await w.clock.settle()
  const pane = await mount($)
  expect(await texts(pane)).toContain('Workspace utilities')
  expect(await pane.find({ key: 'row:checkpoint' })).toBeDefined()
})

// ---- the pure parts, directly ----

test('layoutLines packs rows into lines of the width, and a row that does not fit starts the next line', async () => {
  const rows = [
    { id: 'model' as const, parts: [{ text: 'aaaaaaaaaa' }] },
    { id: 'cost' as const, parts: [{ text: 'bbbbbbbbbb' }] },
    { id: 'git' as const, parts: [{ text: 'cccccccccc' }] },
  ]
  expect(layoutLines(rows, 'expanded', 25).map(l => l.key)).toEqual(['model', 'cost', 'git'])
  const packed = layoutLines(rows, 'compact', 25)
  expect(packed.map(l => l.key)).toEqual(['model+cost', 'git'])
  expect(packed[0]!.parts.map(p => p.text).join('')).toBe('aaaaaaaaaa │ bbbbbbbbbb')
  expect(layoutLines(rows, 'compact', 100).map(l => l.key)).toEqual(['model+cost+git'])
})

test('rows lists parse, hide and show keep the canonical order; unknown ids are dropped', async () => {
  expect(parseRows('git, MODEL,nope,git')).toEqual(['git', 'model'])
  expect(parseRows('')).toEqual([])
  expect(hideRow(['model', 'git'], 'git')).toEqual(['model'])
  expect(showRow(['model', 'git'], 'cost')).toEqual(['model', 'cost', 'git'])
  expect(showRow(['model'], 'environment')).toEqual(['model', 'environment'])
  expect(showRow(['model'], 'model')).toEqual(['model'])
})

test('groupRuns merges finished calls of one tool, keeps running ones apart, and keeps the newest', async () => {
  const runs = [
    { id: '1', name: 'Read', state: 'done' as const },
    { id: '2', name: 'Grep', state: 'done' as const },
    { id: '3', name: 'Read', state: 'done' as const },
    { id: '4', name: 'Edit', state: 'running' as const, target: 'x.ts' },
    { id: '5', name: 'Bash', state: 'error' as const },
  ]
  expect(groupRuns(runs, 10).map(g => `${g.name}${g.count}`)).toEqual(['Grep1', 'Read2', 'Edit1', 'Bash1'])
  expect(groupRuns(runs, 2).map(g => g.name)).toEqual(['Edit', 'Bash'])
})

test('buildRows draws nothing for a snapshot with no figures', async () => {
  const rows = buildRows({ now: T0 }, DEFAULT_BOX)
  expect(Object.values(rows).filter(Boolean)).toEqual([])
})

// ---- mode, backup and effort-fit rows ---------------------------------------------------------------------------------------
const DIRTY = '# branch.oid abc\n# branch.head main\n1 .M N... 1 1 1 a b f.ts\n? n.txt\n'
const CLEAN = '# branch.oid abc\n# branch.head main\n'

test('the permission mode shows only when it is not the ordinary one, red for bypass', MODS, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE, settings: { permissions: { defaultMode: 'bypassPermissions' } } })
  await start($, w)
  const pane = await mount($)
  expect(await texts(pane)).toContain('permissions bypassed !')
  expect(await texts(pane)).toContain('Mode: ') // its label, with a colon
  expect(await colorOf(pane, 'permissions bypassed !')).toContain('error')
})

test('no mode row for the default mode', MODS, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE, settings: { permissions: { defaultMode: 'default' } } })
  await start($, w)
  expect(await texts(await mount($))).not.toContain('Mode:')
})

test('backup: time since the newest commit or checkpoint; amber after 2 h with files unsaved, red after 8 h', MODS, async ($, on) => {
  const now = T0 / 1000
  const w = world(on, { usage: GOOD_USAGE, gitStatus: DIRTY, commitAt: now - 3 * 3600 })
  await start($, w)
  let pane = await mount($)
  expect(await texts(pane)).toContain('3h ago')
  expect(await texts(pane)).toContain('2 unsaved')
  expect(await colorOf(pane, '3h ago')).toContain('warning')
})

test('backup: a checkpoint newer than the last commit counts; a clean tree is green; a dirty tree with nothing saved says none', MODS, async ($, on) => {
  const now = T0 / 1000
  const a = world(on, { usage: GOOD_USAGE, gitStatus: DIRTY, commitAt: now - 10 * 3600, checkpointAt: now - 600 })
  await start($, a)
  const pane = await mount($)
  expect(await texts(pane)).toContain('10m ago')
  expect(await colorOf(pane, '10m ago')).toContain('success')
})

test('backup: nothing saved and files changed says so; a clean repository with no commit shows no row', MODS, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE, gitStatus: DIRTY })
  await start($, w)
  expect(await texts(await mount($))).toContain('none · 2 unsaved')
})

test('backup: a clean tree is green however old the commit', MODS, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE, gitStatus: CLEAN, commitAt: T0 / 1000 - 30 * 3600 })
  await start($, w)
  const pane = await mount($)
  expect(await colorOf(pane, '1d 6h ago')).toContain('success')
})

test('effort fit: the model row shows suggest-model\'s advice beside the effort, in the warning colour, and nothing when it fits', MODS, async ($, on) => {
  const w = world(on, { usage: GOOD_USAGE })
  await start($, w)
  await run($, 'seed-effort', 'medium would do')
  const pane = await mount($)
  expect(await texts(pane)).toContain('⚠ medium would do')
  expect(await colorOf(pane, ' ⚠ medium would do')).toContain('warning')
  await run($, 'seed-effort', 'none')
  expect(await texts(await mount($))).not.toContain('⚠')
})

test('a conversation suggest-model routed shows the session model dimmed, then → the routed one', () => {
  const rows = buildRows({ now: T0, model: 'claude-opus-5-5', routedTo: 'Haiku' }, DEFAULT_BOX)
  const text = rows.model!.parts.map(p => p.text).join('')
  expect(text).toContain('claude-opus-5-5 → Haiku (routed)')
})
