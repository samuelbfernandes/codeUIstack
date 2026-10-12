import { test, expect } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On, RenderPropsOf } from 'claude-code'

import { THEMES, THEME_NAMES } from '../hooks/themes'

const SURFACES = ['terminal', 'desktop'] as const

type ToolUseProps = RenderPropsOf['ToolUse']

const row = (tool: string, input: unknown, extra: Partial<ToolUseProps> = {}): ToolUseProps => ({
  tool_use_id: `toolu_${tool}`,
  tool,
  input,
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  output: {},
  ...extra,
})

const BASH = row('Bash', { command: 'ls -la\necho done' })

/** Stands in for the engine under the plugin: the session, the command registry and the drawing it would do. */
const writes: { key: string; value: unknown }[] = []
const failure = { store: false }
const logs: string[] = []

function engine($: Engine, on: On, store: Record<string, unknown> = {}) {
  writes.length = 0
  logs.length = 0
  failure.store = false
  on('ui.log', (_$, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  // A small in-memory store that also records the writes (mock.store would not).
  const kept = new Map(Object.entries(store))
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_$, e) => {
    if (failure.store) throw new Error('disk full')
    kept.set(e.key, e.value)
    writes.push({ key: e.key, value: e.value })
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  // What a prompt that no plugin handled becomes: it enters as text.
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return <Text>{`ENGINE ${e.component}`}</Text>
  })
  return $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
}

const skin = ($: Engine, args: string) =>
  $.command.run({
    command: 'skin',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as Parameters<Engine['command']['run']>[0])

const colorOf = async (ui: Pick<Mounted<'terminal'>, 'find'>, text: string) =>
  (await ui.find({ type: 'Text', text }))?.props.color

test('/skin lists every theme and marks the current one', async ($, on) => {
  await engine($, on)
  const { text } = await skin($, '')
  for (const name of THEME_NAMES) expect(text).toContain(name)
  expect((text ?? '').split('\n')[0]).toBe('Skin · Noir')
  expect(text).toContain('● noir')
  expect((text ?? '').split('\n')).toHaveLength(3)
})

test('/skin <theme> switches live, persists, and redraws on both surfaces', async ($, on) => {
  await engine($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', props: BASH })
    expect(await colorOf(ui, 'Bash')).toBe(THEMES.noir.yellow)

    const reply = await skin($, 'dracula')
    expect(reply.text).toBe('Skin · Dracula')
    expect(await colorOf(ui, 'Bash')).toBe(THEMES.dracula.yellow)
    expect((await ui.find({ type: 'Text', text: 'ls -la' }))?.props.color).toBe(THEMES.dracula.muted)

    await skin($, 'nord')
    expect(await colorOf(ui, 'Bash')).toBe(THEMES.nord.yellow)
    expect(writes.at(-1)).toEqual({ key: 'theme', value: 'nord' })
    await ui.unmount()
    await skin($, 'noir')
  }
})

test('every theme defines every token as a hex colour', () => {
  for (const name of THEME_NAMES) {
    for (const value of Object.values(THEMES[name])) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  }
  expect(THEME_NAMES).toEqual(['noir', 'tokyo-night', 'dracula', 'catppuccin', 'gruvbox', 'nord', 'solarized-dark'])
})

test('session.start applies the stored theme and ignores a bad one', async ($, on) => {
  await engine($, on, { theme: 'gruvbox' })
  const ui = await $.ui.mount({ plugin: 'tool-skins', surface: 'terminal', component: 'ToolUse', props: BASH })
  expect(await colorOf(ui, 'Bash')).toBe(THEMES.gruvbox.yellow)
  expect((await skin($, '')).text).toContain('● gruvbox')
})

test('a stored value that is no theme leaves the default', async ($, on) => {
  await engine($, on, { theme: 'plaid' })
  expect((await skin($, '')).text).toContain('● noir')
})

test('an unknown theme gets a helpful reply and changes nothing', async ($, on) => {
  await engine($, on)
  const { text } = await skin($, 'plaid')
  expect((text ?? '').split('\n')[0]).toBe('Skin · no match for “plaid”')
  for (const name of THEME_NAMES) expect(text).toContain(name)
  expect(writes).toHaveLength(0)
  expect((await skin($, '')).text).toContain('● noir')
})

test('theme names match loosely, and only when unambiguous', async ($, on) => {
  await engine($, on)
  expect((await skin($, 'TokyoNight')).text).toBe('Skin · Tokyo Night')
  expect((await skin($, 'sol')).text).toBe('Skin · Solarized Dark')
  expect((await skin($, 'n')).text).toContain('no match') // noir or nord
})

test('tool rows carry an icon, name, dim summary, timing and status', async ($, on) => {
  await engine($, on)
  const cases: [ToolUseProps, string, string][] = [
    [BASH, '❯', 'ls -la echo done'],
    [row('Read', { file_path: '/a/b.R', offset: 10, limit: 5 }), '≡', '/a/b.R :10+5'],
    [row('Edit', { file_path: '/a/b.R' }), '✎', '/a/b.R'],
    [row('Write', { file_path: '/a/c.R' }), '✚', '/a/c.R'],
    [row('Grep', { pattern: 'foo', path: 'src' }), '⊙', 'foo in src'],
    [row('Glob', { pattern: '**/*.rs' }), '✱', '**/*.rs'],
    [row('Agent', { description: 'survey', subagent_type: 'Explore' }), '◆', 'survey (Explore)'],
    [row('WebFetch', { url: 'https://x.org' }, { output: { durationMs: 1234 } }), '⇣', 'https://x.org'],
    [row('mcp__pubmed__search', { query: 'qtl' }), '⬡', 'qtl'],
  ]
  for (const surface of SURFACES) {
    for (const [props, icon, summary] of cases) {
      const ui = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', props, requestId: props.tool_use_id })
      expect(await ui.find({ type: 'Text', text: icon })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: summary })).toBeDefined()
      await ui.unmount()
    }
    const timed = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', props: cases[7]![0], requestId: 'timed' })
    expect(await timed.find({ type: 'Text', text: '1.2s' })).toBeDefined()
    const mcp = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', props: cases[8]![0], requestId: 'mcp' })
    expect(await mcp.find({ type: 'Text', text: 'pubmed:search' })).toBeDefined()
  }
})

test('running, errored and interrupted calls draw their own status', async ($, on) => {
  await engine($, on)
  const states: [Partial<ToolUseProps>, string, string][] = [
    [{ isRunning: true, output: undefined }, '…', THEMES.noir.muted],
    [{ isErrored: true }, '✗', THEMES.noir.red],
    [{ isInterrupted: true }, 'interrupted', THEMES.noir.yellow],
  ]
  for (const surface of SURFACES) {
    for (const [extra, mark, color] of states) {
      const ui = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', props: { ...BASH, ...extra } })
      expect((await ui.find({ type: 'Text', text: mark }))?.props.color).toBe(color)
      await ui.unmount()
    }
  }
})

const EDIT_RESULT = {
  filePath: '/a/b.R',
  oldString: 'x <- 1',
  newString: 'x <- 2',
  originalFile: 'x <- 1\n',
  structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: ['-x <- 1', '+x <- 2', ' y <- 3'] }],
  userModified: false,
  replaceAll: false,
}

const result = (tool: string, output: unknown, isErrored = false) => ({ tool_use_id: 't1', tool, output, isErrored })

test('an Edit result becomes a diff card in the theme colours', async ($, on) => {
  await engine($, on)
  await skin($, 'catppuccin')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolResult', props: result('Edit', EDIT_RESULT) })
    const card = await ui.find({ type: 'Box', key: undefined, text: /Edited/ })
    expect(card?.props.borderColor).toBe(THEMES.catppuccin.border)
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.props.source).toBe('@@ -1,2 +1,2 @@\n-x <- 1\n+x <- 2\n y <- 3')
    expect((await ui.find({ type: 'Text', text: '+1' }))?.props.color).toBe(THEMES.catppuccin.green)
    expect((await ui.find({ type: 'Text', text: '−1' }))?.props.color).toBe(THEMES.catppuccin.red)
    expect((await ui.find({ type: 'Text', text: 'Edited' }))?.props.color).toBe(THEMES.catppuccin.accent)
    await ui.unmount()
  }
})

test('a Write that creates a file shows it as an all-added diff, long ones cut', async ($, on) => {
  await engine($, on)
  const content = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n'
  const out = { type: 'create', filePath: '/a/new.R', content, structuredPatch: [], originalFile: null }
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolResult', props: result('Write', out) })
    const source = String((await ui.find({ type: 'Code' }))?.props.source)
    expect(source.startsWith('@@ -0,0 +1,40 @@\n+line 0\n')).toBe(true)
    expect(source.split('\n')).toHaveLength(41)
    expect(await ui.find({ type: 'Text', text: '+100' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '60 more lines' })).toBeDefined()
    await ui.unmount()
  }
})

test('a cut hunk keeps header counts that match its lines', async ($, on) => {
  await engine($, on)
  const lines = Array.from({ length: 50 }, (_, i) => (i % 2 ? `+n${i}` : ` c${i}`))
  const out = { ...EDIT_RESULT, structuredPatch: [{ oldStart: 5, oldLines: 25, newStart: 5, newLines: 50, lines }] }
  const ui = await $.ui.mount({ plugin: 'tool-skins', surface: 'terminal', component: 'ToolResult', props: result('Edit', out) })
  expect(String((await ui.find({ type: 'Code' }))?.props.source).split('\n')[0]).toBe('@@ -5,20 +5,40 @@')
})

test('results it cannot draw as a card pass through to the engine', async ($, on) => {
  await engine($, on)
  const cases = [
    result('Edit', EDIT_RESULT, true),
    result('Edit', { ...EDIT_RESULT, staged: true }),
    result('Edit', { ...EDIT_RESULT, structuredPatch: [] }),
    result('Edit', 'plain text'),
    result('Bash', { stdout: 'x', stderr: '', interrupted: false }),
  ]
  for (const props of cases) {
    const ui = await $.ui.mount({ plugin: 'tool-skins', surface: 'terminal', component: 'ToolResult', props })
    expect((await ui.drawn()).type).toBe('Text')
    expect((await ui.find({ type: 'Text', text: 'ENGINE ToolResult' }))).toBeDefined()
    await ui.unmount()
  }
})

test('surfaces it cannot style pass through to the engine', async ($, on) => {
  await engine($, on)
  for (const surface of ['mobile', 'vscode'] as const) {
    const use = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', props: BASH })
    expect(await use.find({ type: 'Text', text: 'ENGINE ToolUse' })).toBeDefined()
    const res = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolResult', props: result('Edit', EDIT_RESULT) })
    expect(await res.find({ type: 'Text', text: 'ENGINE ToolResult' })).toBeDefined()
  }
})

test('components it does not know pass through untouched', async ($, on) => {
  await engine($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'tool-skins',
      surface,
      component: 'UserMessage',
      props: { text: 'hi', origin: { kind: 'composer' }, isExpanded: false } as RenderPropsOf['UserMessage'],
    })
    expect(await ui.find({ type: 'Text', text: 'ENGINE UserMessage' })).toBeDefined()
    await ui.unmount()
  }
})

// ---- plain words (v0.2.0): skins, skin <theme> --------------------------------------------------

/** The person typing a prompt. */
const typed = ($: Engine, _on: On, text: string, extra: object = {}) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...extra } as never)

test('`skins` lists like /skin and is dropped, not sent', async ($, on) => {
  await engine($, on)
  const listed = (await skin($, '')).text
  for (const word of ['skins', 'Skins', '  SKINS. ']) {
    const out = await typed($, on, word)
    expect(out.drop).toBe((listed ?? '').split('\n')[0])
    expect(out.text).toBeUndefined()
  }
})

for (const surface of SURFACES) {
  test(`\`skin <theme>\` switches live, persists and redraws (${surface})`, async ($, on) => {
    await engine($, on)
    const ui = await $.ui.mount({ plugin: 'tool-skins', surface, component: 'ToolUse', props: BASH })
    expect(await colorOf(ui, 'Bash')).toBe(THEMES.noir.yellow)

    const out = await typed($, on, 'skin tokyo-night')
    expect(out.drop).toBe('Skin · Tokyo Night')
    expect(out.text).toBeUndefined()
    expect(await colorOf(ui, 'Bash')).toBe(THEMES['tokyo-night'].yellow)
    expect(writes.at(-1)).toEqual({ key: 'theme', value: 'tokyo-night' })

    expect((await typed($, on, 'Skin DRACULA.')).drop).toBe('Skin · Dracula')
    expect(await colorOf(ui, 'Bash')).toBe(THEMES.dracula.yellow)
    await ui.unmount()
  })
}

test('`skin <theme>` needs the exact theme name; anything looser or longer goes to the model', async ($, on) => {
  await engine($, on)
  for (const text of ['skin', 'skin sol', 'skin tokyonight', 'skin n', 'skin plaid', 'skin dracula please', 'skin  dracula', 'change skin dracula', 'what skins are there', 'skinny']) {
    const out = await typed($, on, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect(writes).toHaveLength(0)
  expect((await skin($, '')).text).toContain('● noir')
})

test('only the person typing is handled: other senders and attachments pass through', async ($, on) => {
  await engine($, on)
  expect((await typed($, on, 'skins', { origin: { kind: 'scheduled-trigger' } })).drop).toBeUndefined()
  expect((await typed($, on, 'skin nord', { origin: { kind: 'peer' } })).drop).toBeUndefined()
  expect((await typed($, on, 'skin nord', { attachments: [{ type: 'image', data: 'x' }] })).drop).toBeUndefined()
  expect(writes).toHaveLength(0)
})

test('a store that fails still drops the word, with a short notice, and the theme stays', async ($, on) => {
  await engine($, on)
  failure.store = true
  const out = await typed($, on, 'skin nord')
  expect(out.drop).toBe('Skin · could not change it')
  expect((await skin($, '')).text).toContain('● noir')
})

// ---- one-line drop reasons (the engine draws a newline as a garbled character) ---------------

test('no drop reason has a newline; the overflow lines go to ui.log once', async ($, on) => {
  await engine($, on)
  const listed = await typed($, on, 'skins')
  expect(listed.drop).toBe('Skin · Noir')
  expect(listed.drop).not.toContain('\n')
  expect(logs).toEqual([`${THEME_NAMES.map(n => (n === 'noir' ? '● noir' : n)).join(' · ')}\nType skin followed by a name to switch.`])

  logs.length = 0
  const switched = await typed($, on, 'skin nord')
  expect(switched.drop).toBe('Skin · Nord')
  expect(logs).toEqual([]) // one line says it all

  failure.store = true
  const failed = await typed($, on, 'skin dracula')
  expect(failed.drop).not.toContain('\n')
})
