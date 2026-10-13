import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addEntry, buildPrompt, cutAnswer, headline, isRunning, maxCharsOf, patchEntry, whyNot } from '../hooks/btw'
import { RELEASE, installArgv, isNewer, latestRelease, manualCommand, parseVersion } from '../hooks/update'

const PANE_PROPS = { title: 'Moddeck', isFocused: false, bodyColumns: 60, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true } as const
const USAGE = { input_tokens: 400, output_tokens: 600, cache_read_input_tokens: 11_000, cache_creation_input_tokens: 0 }
const TAGS = 'aaa\trefs/tags/v0.3.0\nbbb\trefs/tags/v0.4.1\nccc\trefs/tags/v0.10.0\nddd\trefs/tags/v0.11.0-rc1\neee\trefs/tags/nightly\n'

function world(on: On, o: { tags?: string; lsExit?: number; answer?: string; runner?: string; installExit?: number } = {}) {
  const store = new Map<string, unknown>()
  const w = {
    store,
    toasts: [] as string[],
    logs: [] as string[],
    ran: [] as string[][],
    asks: [] as { question: string; options: string[]; header: string }[],
    forks: [] as string[],
    answer: o.answer ?? 'Later',
    fork: () => ({ isAnswered: true as const, text: 'A p-value is not the probability the null is true.', usage: USAGE }) as unknown,
    panes: [] as string[],
    registered: [] as string[],
    clock: mock.clock(on, { now: 10_000_000_000 }),
  }
  mock.session(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('process.run', (_$, e) => {
    w.ran.push([...e.argv])
    const [bin, a] = e.argv
    if (bin === 'git' && a === 'ls-remote') return { value: { exitCode: o.lsExit ?? 0, stdout: o.tags ?? TAGS, stderr: '' } } as never
    if (bin === 'git') return { value: { exitCode: 128, stdout: '', stderr: 'not a repository' } } as never
    if (e.argv[1] === '--version') return { value: { exitCode: bin === (o.runner ?? 'pipx') ? 0 : 1, stdout: '1.0', stderr: '' } } as never
    return { value: { exitCode: o.installExit ?? 0, stdout: 'ok', stderr: o.installExit ? 'boom' : '' } } as never
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!
    w.asks.push({ question: q.question, options: q.options.map(x => x.label), header: q.header })
    return { result: { questions: e.questions, answers: { [q.question]: w.answer } } } as never
  })
  on('model.fork', () => ({ value: w.fork() as never }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: undefined as never }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', (_$, e) => (w.logs.push(e.text), { value: undefined }))
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', (_$, e) => (w.panes.includes(e.id) || w.panes.push(e.id), { value: { isPlaced: true as const } }))
  on('ui.close', (_$, e) => ((w.panes = w.panes.filter(p => p !== e.id)), { value: undefined }))
  on('prompt.fill', () => ({ isFilled: true }) as never)
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
const cmd = ($: Engine, command: string, args = '') => $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)
const mount = ($: Engine) => $.ui.mount({ plugin: 'moddeck', surface: 'desktop', component: 'Pane', requestId: 'moddeck', props: PANE_PROPS, viewport: FULLSCREEN } as never)
const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

// ---- pure helpers ----------------------------------------------------------------------------------------------------
test('versions: only plain releases count, and 0.10.0 is newer than 0.4.1', () => {
  expect(parseVersion('v0.4.1')).toEqual([0, 4, 1])
  expect(parseVersion('0.5.0-rc1')).toBeUndefined()
  expect(parseVersion('nightly')).toBeUndefined()
  expect(isNewer('0.10.0', '0.4.1')).toBe(true)
  expect(isNewer('0.4.1', '0.4.1')).toBe(false)
  expect(isNewer('junk', '0.4.1')).toBe(false)
  expect(latestRelease(TAGS)).toBe('0.10.0')
  expect(latestRelease('')).toBeUndefined()
})

test('the update command is the installer\'s own one-liner for that tag, through pipx or uvx', () => {
  expect(installArgv('pipx', '0.5.0')).toEqual(['pipx', 'run', '--spec', 'git+https://github.com/samuelbfernandes/moddeck@v0.5.0', 'moddeck', 'update'])
  expect(installArgv('uvx', '0.5.0')[0]).toBe('uvx')
  expect(manualCommand('0.5.0')).toBe('pipx run --spec git+https://github.com/samuelbfernandes/moddeck@v0.5.0 moddeck update')
})

test('btw helpers: newest first, at most five, a stale question stops blocking, answers are cut and say so', () => {
  let list: ReturnType<typeof addEntry> = []
  for (let id = 1; id <= 7; id++) list = addEntry(list, { id, at: 0, question: `q${id}`, status: 'thinking', answer: '', isCut: false, tokens: null, note: '' })
  expect(list.map(e => e.id)).toEqual([7, 6, 5, 4, 3])
  expect(isRunning(list, 1000)).toBe(true)
  expect(isRunning(list, 10 * 60_000)).toBe(false)
  expect(patchEntry(list, 7, { status: 'done' })[0]!.status).toBe('done')
  expect(cutAnswer('x'.repeat(300), 200)).toEqual({ text: `${'x'.repeat(200)}…`, isCut: true })
  expect(maxCharsOf(5)).toBe(1500)
  expect(headline('  a   b  ')).toBe('a b')
  expect(buildPrompt('why?')).toContain('Side question: why?')
  expect(whyNot({ reason: 'nothing-to-fork' })).toContain('send a message first')
})

// ---- the update check ---------------------------------------------------------------------------------------------------
test('at start a newer release asks once; Later keeps the one-line button, nothing is installed', {}, async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(5)
  expect(w.ran[0]).toEqual(['git', 'ls-remote', '--tags', '--refs', 'https://github.com/samuelbfernandes/moddeck.git'])
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.header).toBe('New version')
  expect(w.asks[0]!.options).toEqual(['Update now', 'Later', 'Skip this version'])
  expect(w.asks[0]!.question).toContain(`Moddeck 0.10.0 is available (you have ${RELEASE})`)
  expect(w.ran.some(a => a[0] === 'pipx' && a[1] === 'run')).toBe(false)
  const pane = await mount($)
  expect(await texts(pane)).toContain('⬆ Moddeck 0.10.0 is available · click to update')
})

test('Update now runs the installer one-liner and says to restart; no runner or a failure gives the command to run by hand', {}, async ($, on) => {
  const ok = world(on, { answer: 'Update now' })
  await start($)
  await ok.clock.advance(5)
  expect(ok.ran.some(a => a.join(' ') === 'pipx run --spec git+https://github.com/samuelbfernandes/moddeck@v0.10.0 moddeck update')).toBe(true)
  expect(ok.toasts.at(-1)).toContain('restart Claude Code')
})

test('a failed install and a missing runner both say the command to run by hand', {}, async ($, on) => {
  const bad = world(on, { answer: 'Update now', installExit: 1 })
  await start($)
  await bad.clock.advance(5)
  expect(bad.toasts.at(-1)).toContain('update by hand: pipx run --spec')
  expect(bad.logs.join('\n')).toContain('update failed (exit 1)')
})

test('Skip this version is remembered: the next start does not ask, a forced /moddeck update still does', {}, async ($, on) => {
  const w = world(on, { answer: 'Skip this version' })
  await start($)
  await w.clock.advance(5)
  expect(w.store.get('skipped')).toBe('0.10.0')
  w.answer = 'Later'
  await w.clock.advance(7 * 3600_000)
  await start($)
  await w.clock.advance(5)
  expect(w.asks).toHaveLength(1)
  const out = await cmd($, 'moddeck', 'update')
  expect(out.text).toBe('Moddeck 0.10.0 is available')
  expect(w.asks).toHaveLength(2)
})

test('the look-up is rate limited: a second start inside six hours reuses the answer', {}, async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(5)
  await start($)
  await w.clock.advance(5)
  expect(w.ran.filter(a => a[1] === 'ls-remote')).toHaveLength(1)
})

test('up to date, offline and the updateCheck setting off all stay quiet', {}, async ($, on) => {
  const same = world(on, { tags: `x\trefs/tags/v${RELEASE}\n` })
  await start($)
  await same.clock.advance(5)
  expect(same.asks).toHaveLength(0)
  expect((await cmd($, 'moddeck', 'update')).text).toBe(`Moddeck ${RELEASE} · up to date`)
})

test('offline: no dialog, and /moddeck update says it could not check', {}, async ($, on) => {
  const w = world(on, { lsExit: 128 })
  await start($)
  await w.clock.advance(5)
  expect(w.asks).toHaveLength(0)
  expect((await cmd($, 'moddeck', 'update')).text).toBe('Moddeck · could not check for updates')
})

test('updateCheck off: no look-up at all', { options: { updateCheck: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await w.clock.advance(5)
  expect(w.ran.filter(a => a[1] === 'ls-remote')).toHaveLength(0)
})

// ---- the Side Question panel -------------------------------------------------------------------------------------------------
test('/btw is registered; /btw <question> opens the side bar, asks over the cached context, and the answer shows there only', {}, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toContain('btw')
  const out = await cmd($, 'btw', 'what is a p-value?')
  expect(out.text).toContain('thinking')
  expect(w.panes).toContain('moddeck')
  await w.clock.advance(5)
  const pane = await mount($)
  const shown = await texts(pane)
  expect(shown).toContain('▾ Side Question')
  expect(shown).toContain('› what is a p-value?')
  expect(shown).toContain('A p-value is not the probability the null is true.')
  expect(shown).toContain('not added to the conversation · ~12k tokens est.')
})

test('the box has a field; Enter asks; a second question while one thinks is refused; no first reply is said plainly', {}, async ($, on) => {
  const w = world(on)
  await start($)
  const pane = await mount($)
  expect(await pane.find({ key: 'btw:input' })).toBeUndefined() // collapsed until the button is clicked
  expect(await texts(pane)).toContain('▸ Side Question')
  await pane.press({ key: 'btw:toggle' })
  expect(await texts(pane)).toContain('▾ Side Question')
  expect(await pane.find({ key: 'btw:input' })).toBeDefined()
  await pane.press({ key: 'btw:toggle' })
  expect(await pane.find({ key: 'btw:input' })).toBeUndefined()
  await pane.press({ key: 'btw:toggle' })
  w.fork = () => ({ isAnswered: false, reason: 'nothing-to-fork' })
  await pane.input({ key: 'btw:input', text: 'hello?', kind: 'submit' })
  await w.clock.advance(5)
  expect(await texts(pane)).toContain('Nothing to ask about yet')
  expect((await cmd($, 'btw', '')).text).toContain('type it in the box')
  expect(await pane.find({ key: 'btw:input' })).toBeDefined() // /btw alone expands the panel
})

test('a failed or empty answer says why and changes nothing else', {}, async ($, on) => {
  const w = world(on)
  await start($)
  w.fork = () => ({ isAnswered: true, text: '   ', usage: USAGE })
  await cmd($, 'btw', 'q')
  await w.clock.advance(5)
  expect(await texts(await mount($))).toContain('The model sent no text')
})
