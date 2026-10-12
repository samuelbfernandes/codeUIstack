import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

type Item = { name: string; text: string }
const ATOM = 'prompt-library.items'

function world(on: On, o: { cwd?: string; fill?: 'ok' | 'no' | 'throw' } = {}) {
  const w = {
    store: new Map<string, unknown>(),
    cwd: o.cwd ?? '/proj-a',
    fill: o.fill ?? 'ok',
    filled: [] as string[],
    registered: [] as string[],
    writes: 0,
    failStore: false,
    state: new Map<string, unknown>(),
  }
  on('store.get', (_$, e) => {
    if (w.failStore) throw new Error('disk')
    return { value: w.store.get(e.key) }
  })
  on('state.get', (_$, e) => ({ value: { value: w.state.get(`${e.plugin}.${e.key}`), version: w.state.has(`${e.plugin}.${e.key}`) ? 1 : 0 } as never }))
  on('state.set', (_$, e) => (w.state.set(`${e.plugin}.${e.key}`, e.value), { value: { isSet: true, version: 1 } as never }))
  on('store.set', (_$, e) => (w.writes++, w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('session.cwd', () => ({ value: w.cwd }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: undefined as never }))
  on('prompt.fill', (_$, e) => {
    if (w.fill === 'throw') throw new Error('no box')
    w.filled.push((e as { text: string }).text)
    return { isFilled: w.fill === 'ok' } as never
  })
  return w
}

const slash = ($: Engine, args: string) =>
  $.command.run({ command: 'prompts', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
const text = async ($: Engine, args: string) => ((await slash($, args)) as { text: string }).text
const start = ($: Engine) => $.session.start({ cwd: '/proj-a', surface: 'terminal', isInteractive: true } as never)

test('session.start registers the command and mirrors the four starters', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['prompts'])
  expect((w.state.get(ATOM) as Item[] | undefined)?.map(i => i.name)).toEqual(['explain', 'tests', 'review', 'eda'])
  expect(w.store.has('items:/proj-a')).toBe(true)
})

test('no args and list give a numbered list cut at 60 characters', async ($, on) => {
  world(on)
  const a = await text($, '')
  expect(a).toBe(await text($, 'list'))
  expect(a).toContain('1. explain · Explain this code step by step, then list anything risky or …')
  for (const row of a.split('\n').slice(1)) expect(row.split(' · ')[1].replace('…', '').length).toBeLessThanOrEqual(60)
  expect(a.split('\n')).toHaveLength(5)
})

test('add saves, mirrors and persists; name is lowercased', async ($, on) => {
  const w = world(on)
  expect(await text($, 'add My-Prompt | do the thing | twice')).toBe('Prompts · saved "my-prompt"')
  expect((w.state.get(ATOM) as Item[] | undefined)?.at(-1)).toEqual({ name: 'my-prompt', text: 'do the thing | twice' })
  expect((w.store.get('items:/proj-a') as Item[]).at(-1)?.name).toBe('my-prompt')
  expect(await text($, 'list')).toContain('5. my-prompt')
})

test('add validates name, text, separator and duplicates', async ($, on) => {
  const w = world(on)
  expect(await text($, 'add nobar')).toContain('/prompts add <name> | <prompt text>')
  expect(await text($, 'add bad_name | x')).toContain('lowercase letters, digits and hyphens')
  expect(await text($, `add ${'a'.repeat(25)} | x`)).toContain('too long')
  expect(await text($, 'add fine |  ')).toContain('Prompts · use /prompts add')
  expect(await text($, 'add fine | x'.padEnd(10) + 'y'.repeat(4001))).toContain('text is too long')
  expect(await text($, 'add explain | other')).toContain('already exists')
  expect(await text($, `add ${'a'.repeat(24)} | ok`)).toContain('saved')
  expect(w.store.get('items:/proj-a')).toHaveLength(5)
})

test('4000 characters of text is accepted', async ($, on) => {
  world(on)
  expect(await text($, `add big | ${'y'.repeat(4000)}`)).toContain('saved')
})

test('remove deletes, and says so for a missing name', async ($, on) => {
  const w = world(on)
  expect(await text($, 'remove tests')).toBe('Prompts · removed "tests"')
  expect((w.state.get(ATOM) as Item[] | undefined)?.map(i => i.name)).toEqual(['explain', 'review', 'eda'])
  expect(await text($, 'remove tests')).toContain('no prompt named')
  expect(await text($, 'remove')).toContain('use /prompts remove')
})

test('rename changes the name and validates', async ($, on) => {
  const w = world(on)
  expect(await text($, 'rename tests unit-tests')).toBe('Prompts · renamed "tests" to "unit-tests"')
  expect((w.state.get(ATOM) as Item[] | undefined)?.[1]).toEqual({ name: 'unit-tests', text: expect.stringContaining('Write tests') })
  expect(await text($, 'rename nope x')).toContain('no prompt named')
  expect(await text($, 'rename eda review')).toContain('already exists')
  expect(await text($, 'rename eda Bad_Name')).toContain('lowercase')
  expect(await text($, 'rename eda')).toContain('use /prompts rename')
})

test('use puts the text in the box and sends nothing', async ($, on) => {
  const w = world(on)
  const out = await text($, 'use review')
  expect(w.filled).toEqual(['Review my last change for bugs, edge cases and missing tests; do not edit anything'])
  expect(out).toContain('in the prompt box')
  expect(await text($, 'use nope')).toContain('no prompt named')
})

test('use says to type it yourself when the fill fails or throws', async ($, on) => {
  world(on, { fill: 'no' })
  expect(await text($, 'use eda')).toBe('Prompts · could not fill the box, type it yourself')
})
test('use survives a throwing fill', async ($, on) => {
  world(on, { fill: 'throw' })
  expect(await text($, 'use eda')).toContain('type it yourself')
})

test('starters are seeded once: removing all stays empty', async ($, on) => {
  const w = world(on)
  for (const n of ['explain', 'tests', 'review', 'eda']) await text($, `remove ${n}`)
  expect(await text($, 'list')).toContain('none saved')
  await start($)
  expect(w.state.get(ATOM) as Item[] | undefined).toEqual([])
  expect(w.store.get('items:/proj-a')).toEqual([])
})

test('lists are per project', async ($, on) => {
  const w = world(on)
  await text($, 'add mine | a')
  w.cwd = '/proj-b'
  const b = await text($, 'list')
  expect(b).not.toContain('mine')
  expect(b).toContain('4 saved')
  expect(w.store.has('items:/proj-b')).toBe(true)
  expect(w.state.get(ATOM) as Item[] | undefined).toHaveLength(4)
})

test('maxItems caps adds', { options: { maxItems: 5 } }, async ($, on) => {
  world(on)
  expect(await text($, 'add one | a')).toContain('saved')
  expect(await text($, 'add two | a')).toContain('full (5)')
})

test('unknown subcommand gives the help', async ($, on) => {
  world(on)
  expect(await text($, 'wat')).toContain('/prompts add <name> | <prompt text>')
})

test('a failing store never throws into the engine', async ($, on) => {
  const w = world(on)
  w.failStore = true
  expect(await text($, 'list')).toBe('Prompts · that did not work, nothing changed')
  await start($)
})

test('disabled does nothing', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual([])
  expect(await text($, 'add x | y')).toContain('disabled')
  expect(w.writes).toBe(0)
})
