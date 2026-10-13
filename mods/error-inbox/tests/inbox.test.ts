import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { failureOf, inputSummary, scrub } from '../hooks/lib'

type Answer = { isError?: true; text?: string; result?: unknown; deny?: string }

function world(on: On, o: { store?: Record<string, unknown>; isFilled?: boolean; draft?: string } = {}) {
  mock.clock(on, { now: 1_700_000_000_000 })
  const store = new Map(Object.entries(o.store ?? {}))
  const w = {
    store,
    registered: [] as string[],
    opened: [] as string[],
    filled: [] as { text: string; mode?: string }[],
    copied: [] as string[],
    toasts: [] as string[],
    box: o.draft ?? '',
    isFilled: o.isFilled ?? true,
    answer: { result: { ok: true } } as Answer,
  }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (store.delete(e.key), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('ui.open', (_$, e) => (w.opened.push(e.id), { value: { isPlaced: true as const } }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('prompt.read', () => ({ value: { text: w.box, cursor: w.box.length } as never }))
  on('prompt.fill', (_$, e) => {
    w.filled.push({ text: e.text, mode: e.mode })
    return { isFilled: w.isFilled } as never
  })
  on('ui.copy', (_$, e) => (w.copied.push(e.text), { value: { isCopied: true } as never }))
  on('tool.call', () => (w.answer.deny !== undefined ? ({ deny: w.answer.deny } as never) : ({ ref: 1, ...w.answer } as never)))
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'error-inbox', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const call = ($: Engine, input: Record<string, unknown>) => $.tool.call(input as never) as Promise<Record<string, unknown>>
const PANE_PROPS = { title: 'Errors', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'error-inbox', surface, component: 'Pane', requestId: 'error-inbox', props: PANE_PROPS, viewport: { columns: 140, rows: 40, isFullscreen: true } } as never)

test('what counts: an error, a denial, a refusal; a success does not', () => {
  expect(failureOf({ result: {} })).toBeUndefined()
  expect(failureOf({ deny: 'blocked by policy' })).toEqual({ kind: 'refused', text: 'blocked by policy' })
  expect(failureOf({ isError: true, text: 'Exit code 1\nboom', result: 'x' })?.kind).toBe('failed')
  expect(failureOf({ isError: true, text: "The user doesn't want to proceed with this tool use.", result: '' })?.kind).toBe('denied')
  expect(failureOf({ isError: true, text: 'Permission to use Bash with command rm -rf x has been denied.', result: '' })?.kind).toBe('denied')
  expect(failureOf({ isError: true, result: 'from result' })?.text).toBe('from result')
})

test('the input summary is the command or path only, scrubbed and cut', () => {
  expect(inputSummary({ tool: 'Write', file_path: '/w/a.R', content: 'SECRET CONTENT' })).toBe('/w/a.R')
  expect(inputSummary({ tool: 'Bash', command: 'curl -H "Authorization: Bearer abcdef123456" x' })).toBe('curl -H "Authorization: Bearer ***" x')
  expect(inputSummary({ tool: 'WebFetch', url: 'https://x' })).toBe('')
  expect(inputSummary({ command: 'x'.repeat(500) })).toHaveLength(200)
  expect(scrub('export OPENAI_API_KEY=sk-proj-abcdefgh12345')).not.toContain('abcdefgh12345')
})

test('records failed calls with tool, input and error (cut to 600, scrubbed); results pass through unchanged', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['error-inbox'])
  const ok = await call($, { tool: 'Read', file_path: '/w/a.R' })
  expect(ok.result).toEqual({ ok: true })
  w.answer = { isError: true, text: `Exit code 2\nerror: token=abc123secret ${'x'.repeat(2000)}`, result: 'e' }
  const bad = await call($, { tool: 'Bash', command: 'make test' })
  expect(bad.isError).toBe(true)
  expect(bad.context).toBeUndefined()
  w.answer = { isError: true, text: 'File has not been read yet.', result: 'e' }
  await call($, { tool: 'Write', file_path: '/w/b.R', content: 'contents never kept' })
  expect(await slash($, 'status')).toContain('2 kept')
  const ui = await mount($, 'terminal')
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const joined = all.join('\n')
  expect(joined).toContain('make test')
  expect(joined).toContain('/w/b.R')
  expect(joined).not.toContain('contents never kept')
  expect(joined).not.toContain('abc123secret')
  const longest = Math.max(...all.filter(t => t.includes('Exit code 2')).map(t => t.trim().length))
  expect(longest).toBeLessThanOrEqual(600)
  expect(all.findIndex(t => t.includes('/w/b.R'))).toBeLessThan(all.findIndex(t => t.includes('make test'))) // newest first
  await ui.unmount()
})

test('keeps the last 30; Clear empties it', async ($, on) => {
  const w = world(on)
  await start($)
  w.answer = { isError: true, text: 'nope', result: 'nope' }
  for (let i = 0; i < 35; i++) await call($, { tool: 'Bash', command: `run ${i}` })
  expect(await slash($, 'status')).toContain('30 kept')
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /run 34$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /run 4$/ })).toBeUndefined()
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /No failed or refused/ })).toBeDefined()
  await ui.unmount()
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`Ask Claude puts a draft in the prompt box, not sent (${surface})`, async ($, on) => {
    const w = world(on)
    await start($)
    w.answer = { isError: true, text: 'ModuleNotFoundError: No module named x', result: '' }
    await call($, { tool: 'Bash', command: 'python run.py' })
    const ui = await mount($, surface)
    const button = (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('ask:'))!
    await ui.press({ key: button.key! })
    expect(w.filled).toHaveLength(1)
    expect(w.filled[0]!.mode).toBe('replace')
    expect(w.filled[0]!.text).toContain('explain this error from a Bash call')
    expect(w.filled[0]!.text).toContain('Input: python run.py')
    expect(w.filled[0]!.text).toContain('ModuleNotFoundError')
    expect(w.copied).toEqual([])
    await ui.unmount()
  })
}

test('a draft already in the box is kept: the ask is appended', async ($, on) => {
  const w = world(on, { draft: 'my own words' })
  await start($)
  w.answer = { isError: true, text: 'boom', result: '' }
  await call($, { tool: 'Bash', command: 'x' })
  const ui = await mount($, 'terminal')
  const button = (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('ask:'))!
  await ui.press({ key: button.key! })
  expect(w.filled[0]!.mode).toBe('append')
  await ui.unmount()
})

test('where the box cannot take it, the draft goes to the clipboard and a toast says so', async ($, on) => {
  const w = world(on, { isFilled: false })
  await start($)
  w.answer = { deny: 'a hook said no' }
  await call($, { tool: 'Bash', command: 'rm -rf build' })
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /refused · Bash/ })).toBeDefined()
  const button = (await ui.findAll({ type: 'Button' })).find(b => b.key?.startsWith('ask:'))!
  await ui.press({ key: button.key! })
  expect(w.copied).toHaveLength(1)
  expect(w.copied[0]).toContain('a hook said no')
  expect(w.toasts.at(-1)).toContain('clipboard')
  await ui.unmount()
})

test('off stops keeping errors and is stored; the command opens the pane', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await slash($, 'off')).toContain('off')
  expect(w.store.get('off')).toBe(true)
  w.answer = { isError: true, text: 'boom', result: '' }
  await call($, { tool: 'Bash', command: 'x' })
  expect(await slash($, 'status')).toContain('off · 0 kept')
  expect(await slash($, 'on')).toBe('error-inbox · on')
  await call($, { tool: 'Bash', command: 'x' })
  expect(await slash($)).toContain('on · 1 kept')
  expect(w.opened).toEqual(['error-inbox'])
  expect(await slash($, 'nope')).toContain('unknown option')
})

test('the stored off switch is read at session start', async ($, on) => {
  const w = world(on, { store: { off: true } })
  await start($)
  w.answer = { isError: true, text: 'boom', result: '' }
  await call($, { tool: 'Bash', command: 'x' })
  expect(await slash($, 'status')).toContain('off · 0 kept')
})
