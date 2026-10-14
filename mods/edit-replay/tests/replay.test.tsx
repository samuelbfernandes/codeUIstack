import { test, expect, mock } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const OK = { result: {}, text: 'ok' }

// The test's own `$` has no `state` noun; a plugin's hook does. This inline
// plugin answers /probe with the edit-replay state as JSON.
const WITH_PROBE = {
  plugins: [
    {
      name: 'probe',
      register(on: On) {
        on('command.run', { command: 'probe' }, async $ => ({
          text: JSON.stringify({
            edits: (await $.state.get({ plugin: 'edit-replay', key: 'edits' })).value ?? [],
            ready: (await $.state.get({ plugin: 'edit-replay', key: 'ready' })).value ?? null,
            view: (await $.state.get({ plugin: 'edit-replay', key: 'view' })).value ?? null,
          }),
        }))
      },
    },
  ],
}

/** The engine's tool bottom: every call succeeds, unless the file is /bad. */
function bottom(on: On) {
  on('tool.call', ($, e) => ((e as { file_path?: string }).file_path === '/bad' ? { ...OK, isError: true as const } : OK))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const closed: string[] = []
  on('ui.close', ($, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  // What the engine would draw where no plugin does.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine default</Text>
  })

  return closed
}

const probe = async ($: Engine) =>
  JSON.parse(
    (await $.command.run({ command: 'probe', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })).text ?? '{}',
  ) as { edits: { path: string; tool: string; changes: unknown[]; created?: boolean; note?: string }[]; ready: unknown; view: unknown }

async function edit($: Engine, path: string, from: string, to: string) {
  return $.tool.call({ tool: 'Edit', file_path: path, old_string: from, new_string: to })
}

const stored = async ($: Engine) => (await probe($)).edits

test('records a successful Edit and leaves the result alone', WITH_PROBE, async ($, on) => {
  bottom(on)
  const ran = await edit($, '/p/a.ts', 'let a = 1', 'let a = 2')
  expect(ran).toMatchObject(OK)
  const list = await stored($)
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ path: '/p/a.ts', tool: 'Edit', changes: [{ old: 'let a = 1', new: 'let a = 2' }] })
})

test('does not record an errored call', WITH_PROBE, async ($, on) => {
  bottom(on)
  await edit($, '/bad', 'x', 'y')
  expect(await stored($)).toHaveLength(0)
})

test('does not record a call another plugin denied', WITH_PROBE, async ($, on) => {
  on('tool.call', () => ({ deny: 'nope' }))
  const ran = await edit($, '/p/a.ts', 'a', 'b')
  expect(ran.deny).toBe('nope')
  expect(await stored($)).toHaveLength(0)
})

test('Write records whether it created the file and the previous content', WITH_PROBE, async ($, on) => {
  bottom(on)
  on('fs.exists', ($, e) => ({ value: e.path !== '/p/new.ts' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 3, mtimeMs: 0, isLink: false } }))
  on('fs.read', () => ({ value: 'old' }))
  await $.tool.call({ tool: 'Write', file_path: '/p/new.ts', content: 'fresh' })
  await $.tool.call({ tool: 'Write', file_path: '/p/old.ts', content: 'newer' })
  const [created, over] = await stored($)
  expect(created).toMatchObject({ created: true, changes: [{ old: '', new: 'fresh' }] })
  expect(over).toMatchObject({ changes: [{ old: 'old', new: 'newer' }] })
  expect(over?.created).toBeUndefined()
})

test('fails open: a broken file read never blocks or alters the Write', WITH_PROBE, async ($, on) => {
  bottom(on)
  on('fs.exists', () => {
    throw new Error('boom')
  })
  const ran = await $.tool.call({ tool: 'Write', file_path: '/p/a.ts', content: 'x' })
  expect(ran).toMatchObject(OK)
  const [one] = await stored($)
  expect(one?.note).toContain('not captured')
})

test('band appears after a turn with edits and goes on the next prompt', WITH_PROBE, async ($, on) => {
  bottom(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await edit($, '/p/a.ts', 'a', 'b')
  await edit($, '/p/a.ts', 'b', 'c')
  await edit($, '/p/b.ts', 'x', 'y')
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await probe($)).ready).toEqual({ turn: 1, edits: 3, files: 2 })

  await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
  expect((await probe($)).ready).toBeNull()
})

test('no band for a turn without edits', WITH_PROBE, async ($, on) => {
  bottom(on)
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ answer: 'hello', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect((await probe($)).ready).toBeNull()
})

test('keeps only the most recent 200 edits', WITH_PROBE, async ($, on) => {
  bottom(on)
  for (let i = 0; i < 205; i++) await edit($, `/p/f${i}.ts`, 'a', 'b')
  const list = await stored($)
  expect(list).toHaveLength(200)
  expect(list[0]?.path).toBe('/p/f5.ts')
})

test('/replay with nothing recorded says so and opens no pane', WITH_PROBE, async ($, on) => {
  bottom(on)
  const out = await $.command.run({ command: 'replay', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(out.text).toBe("Replay · nothing to show yet\nOnly Claude's file edits are recorded.")
  expect((await probe($)).view).toBeNull()
})

for (const surface of ['terminal', 'desktop'] as const) {
  const PANE = {
    title: 'Replay Theater',
    isFocused: true,
    bodyColumns: 100,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  } as const

  async function seed($: Engine, on: On) {
    const closed = bottom(on)
    await $.turn.start({ text: 'one', turnId: 't1' })
    await edit($, '/p/old.ts', 'ignored', 'ignored too')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.turn.start({ text: 'two', turnId: 't2' })
    await edit($, '/p/a.ts', 'let a = 1\nkeep', 'let a = 2\nkeep')
    await $.tool.call({ tool: 'Bash', command: 'sed -i s/a/b/ /p/a.ts' })
    await edit($, '/p/b.ts', 'x', 'y')
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })

    return closed
  }

  const run = ($: Engine, args: string) =>
    $.command.run({ command: 'replay', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

  test(`pane steps Prev/Next within bounds, last turn only (${surface})`, WITH_PROBE, async ($, on) => {
    await seed($, on)
    expect((await run($, '')).text).toBe('Replay · 2 edits in the last turn')
    const ui = await $.ui.mount({ plugin: 'edit-replay', surface, component: 'Pane', props: PANE, requestId: 'edit-replay' })

    expect((await ui.find({ type: 'Text', text: '1 of 2' }))?.text).toBe('Replay · 1 of 2')
    expect(await ui.find({ text: '/p/a.ts' })).toBeDefined()
    const code = await ui.find({ type: 'Code' })
    expect(code?.props).toMatchObject({ format: 'diff', source: '@@ -1,2 +1,2 @@\n-let a = 1\n+let a = 2\n keep' })

    await ui.press({ key: 'prev' }) // already first: stays
    expect(await ui.find({ text: '1 of 2' })).toBeDefined()
    await ui.press({ key: 'next' })
    expect(await ui.find({ text: '2 of 2' })).toBeDefined()
    expect(await ui.find({ text: '/p/b.ts' })).toBeDefined()
    await ui.press({ key: 'next' }) // already last: stays
    expect(await ui.find({ text: '2 of 2' })).toBeDefined()
    await ui.press({ key: 'prev' })
    expect(await ui.find({ text: '1 of 2' })).toBeDefined()
    await ui.unmount()
  })

  test(`/replay all covers the whole session and the footer notes shell edits (${surface})`, WITH_PROBE, async ($, on) => {
    await seed($, on)
    await run($, 'all')
    const ui = await $.ui.mount({ plugin: 'edit-replay', surface, component: 'Pane', props: PANE, requestId: 'edit-replay' })
    expect(await ui.find({ text: '1 of 3' })).toBeDefined()
    expect(await ui.find({ text: 'session' })).toBeDefined()
    expect(await ui.find({ text: 'Shell edits are not replayed' })).toBeDefined()
    await ui.unmount()
  })

  test(`Close button closes the pane (${surface})`, WITH_PROBE, async ($, on) => {
    const closed = await seed($, on)
    await run($, '')
    const ui = await $.ui.mount({ plugin: 'edit-replay', surface, component: 'Pane', props: PANE, requestId: 'edit-replay' })
    await ui.press({ key: 'close' })
    expect(closed).toEqual(['edit-replay'])
    await ui.unmount()
  })

  test(`band shows counts and opens the pane from its Button (${surface})`, WITH_PROBE, async ($, on) => {
    await seed($, on)
    const ui = await $.ui.mount({
      plugin: 'edit-replay',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} },
    })
    expect(await ui.find({ text: '● 2 edits in 2 files' })).toBeDefined()
    await ui.press({ key: 'open' })
    expect((await probe($)).view).toMatchObject({ scope: 'turn', i: 0 })
    await ui.unmount()
  })

  test(`band is absent while a survey holds it (${surface})`, WITH_PROBE, async ($, on) => {
    await seed($, on)
    const ui = await $.ui.mount({
      plugin: 'edit-replay',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: true, isWorking: false, maxRows: 5, bodyColumns: 100, scroll: { offset: 0, bodyRows: 5 }, view: {} },
    })
    expect(await ui.find({ text: '2 edits' })).toBeUndefined()
    expect(await ui.find({ text: 'engine default' })).toBeDefined()
    await ui.unmount()
  })
}

// ---- the turn hint (v0.2.0) -------------------------------------------

const HINT = '3 files changed · /replay to review'
const MIN = 60_000

/** `bottom` plus what the hint needs: a clock, the surfaces a person looks at, and the toasts shown. */
function hintWorld(on: On) {
  const w = { toasts: [] as string[], surfaces: ['terminal'] as string[], clock: mock.clock(on, { now: 1_000_000 }) }
  bottom(on)
  on('session.surfaces', () => ({ value: [...w.surfaces] as never }))
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)

    return { value: undefined }
  })

  return w
}

/** One turn that edits the named files (one edit each, plus a second on the first to count edits and files apart). */
async function bigTurn($: Engine, id: string, files: string[]) {
  await $.turn.start({ text: 'go', turnId: id })
  for (const file of files) await edit($, file, 'a', 'b')
  if (files[0] !== undefined) await edit($, files[0], 'b', 'c')
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: id, reason: 'answer' })
}

const THREE = ['/p/a.ts', '/p/b.ts', '/p/c.ts']
const submitTyped = ($: Engine, text: string, extra: object = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)

test('a turn that changed 3 files shows one hint naming the files, not the edits', WITH_PROBE, async ($, on) => {
  const w = hintWorld(on)
  await bigTurn($, 't1', THREE) // 4 edits in 3 files
  expect(w.toasts).toEqual([HINT])
})

test('two files, one file or none: no hint', WITH_PROBE, async ($, on) => {
  const w = hintWorld(on)
  await bigTurn($, 't1', ['/p/a.ts', '/p/b.ts'])
  await bigTurn($, 't2', ['/p/a.ts'])
  await $.turn.start({ text: 'hi', turnId: 't3' })
  await $.turn.complete({ answer: 'hello', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })
  expect(w.toasts).toEqual([])
})

test('the hint shows at most once per 10 minutes', WITH_PROBE, async ($, on) => {
  const w = hintWorld(on)
  await bigTurn($, 't1', THREE)
  await w.clock.advance(9 * MIN)
  await bigTurn($, 't2', THREE)
  expect(w.toasts).toHaveLength(1)
  await w.clock.advance(1 * MIN)
  await bigTurn($, 't3', THREE)
  expect(w.toasts).toHaveLength(2)
})

test('with no surface (a -p run) there is no hint, and the quota is not used up', WITH_PROBE, async ($, on) => {
  const w = hintWorld(on)
  w.surfaces = []
  await bigTurn($, 't1', THREE)
  expect(w.toasts).toEqual([])
  w.surfaces = ['terminal']
  await bigTurn($, 't2', THREE)
  expect(w.toasts).toEqual([HINT])
})

test('turnHint=false shows no hint', { ...WITH_PROBE, options: { turnHint: false } }, async ($, on) => {
  const w = hintWorld(on)
  await bigTurn($, 't1', THREE)
  expect(w.toasts).toEqual([])
  expect((await probe($)).ready).toEqual({ turn: 1, edits: 4, files: 3 }) // the band is unaffected
})

test('a failing toast never touches the turn', WITH_PROBE, async ($, on) => {
  const w = hintWorld(on)
  w.surfaces = null as never // the surfaces read throws inside the hint
  await bigTurn($, 't1', THREE)
  expect(w.toasts).toEqual([])
  expect((await probe($)).ready).toEqual({ turn: 1, edits: 4, files: 3 })
})

test('/replay opens the pane on the last turn and /replay all on the session', WITH_PROBE, async ($, on) => {
  hintWorld(on)
  await bigTurn($, 't1', THREE)
  const run = (args: string) => $.command.run({ command: 'replay', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((await run('')).text).toBe('Replay · 4 edits in the last turn')
  expect((await probe($)).view).toMatchObject({ scope: 'turn', i: 0 })
  expect((await run('all')).text).toContain('Replay')
  expect((await probe($)).view).toMatchObject({ scope: 'all', i: 0 })
})

test('a bare typed replay is not a command: it reaches the model untouched', WITH_PROBE, async ($, on) => {
  hintWorld(on)
  await bigTurn($, 't1', THREE)
  for (const text of ['replay', ' Replay. ', 'replay all', 'please replay']) {
    const out = await submitTyped($, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect((await probe($)).view).toBeNull()
  expect((await probe($)).ready).toBeNull() // the band still goes on the next prompt
})
