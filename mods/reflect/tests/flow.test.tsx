import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ModelCompleteResult, On, SessionMessage } from 'claude-code'

const RULE = 'Always use pnpm instead of npm in this repository.'
const REPLY = JSON.stringify({ rule: RULE, scope: 'project' })

type World = {
  clock: ReturnType<typeof mock.clock>
  files: Map<string, string>
  toasts: string[]
  logs: string[]
  asked: string[]
  models: string[]
  submitted: string[]
  /** Behaviours a test may swap; each `on` below may be registered only once. */
  surfaces: () => readonly ('terminal' | 'desktop')[]
  messages: () => SessionMessage[]
  read: (path: string) => string
  write: (path: string, text: string) => void
  /** Set to make every store write throw. */
  storeFails: boolean
}

const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answered = (text: string) => ({ isAnswered: true, text, usage: USAGE }) as const

/** The engine beneath the mod: an in-memory file system, a scripted small model, toasts. */
function world(on: On, answer: (prompt: string) => ModelCompleteResult | Promise<ModelCompleteResult> = () => answered(REPLY)): World {
  const w: World = {
    clock: mock.clock(on),
    files: new Map(),
    toasts: [],
    logs: [],
    asked: [],
    models: [],
    submitted: [],
    surfaces: () => ['terminal'],
    messages: () => [
      { role: 'user', text: 'install deps', toolUses: [] },
      { role: 'assistant', text: 'Running npm install now.', toolUses: [] },
    ],
    read: path => {
      const text = w.files.get(path)
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    write: (path, text) => void w.files.set(path, text),
    storeFails: false,
  }
  const kept = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: kept.get(e.key) }))
  on('store.set', (_$, e) => {
    if (w.storeFails) throw new Error('disk full')
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_$, e) => (kept.delete(e.key), { value: undefined }))
  mock.env(on, { HOME: '/home/sam' })
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('session.surfaces', () => ({ value: w.surfaces() }))
  on('session.messages', () => ({ value: w.messages() }))
  on('fs.exists', (_$, e) => ({ value: w.files.has(e.path) }))
  on('fs.read', (_$, e) => ({ value: w.read(e.path) }))
  on('fs.write', (_$, e) => {
    w.write(e.path, e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('model.complete', async (_$, e) => {
    w.asked.push(e.prompt)
    w.models.push(e.model)
    return { value: await answer(e.prompt) }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // What the engine draws when the mod passes: a marker, so a test can tell "mod hid" from "mod drew".
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') throw new Error('the band is raised on terminal and desktop only')
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  on('prompt.submit', (_$, e) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  return w
}

const submit = ($: Engine, text: string, kind: 'composer' | 'plugin' = 'composer') =>
  $.prompt.submit({ text, wait: false, origin: kind === 'composer' ? { kind } : { kind, name: 'other' } })

const BAND = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {},
} as const

test('a correction passes through unchanged and no model call delays it', async ($, on) => {
  const w = world(on)
  const out = await submit($, 'No, use pnpm instead of npm')
  expect(out.text).toBe('No, use pnpm instead of npm')
  expect(w.submitted).toEqual(['No, use pnpm instead of npm'])
  expect(w.asked.length).toBe(0) // the call waits on a timer, the prompt did not
  await w.clock.settle()
  expect(w.asked.length).toBe(1)
})


type Surface = 'terminal' | 'desktop'
const SURFACES = ['terminal', 'desktop'] as const

const runCommand = async ($: Engine, args: string) =>
  (await $.command.run({ command: 'reflect', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })).text ?? ''

const CORRECTION = 'No, use pnpm instead of npm'

/** Submits a correction and lets the timer-run model call finish. */
async function propose($: Engine, w: World, text = CORRECTION) {
  await submit($, text)
  await w.clock.settle()
}

const mount = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props: BAND })

const labels = async (ui: Awaited<ReturnType<typeof mount>>) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.props.label)

// ------------------------------------------------------------------ pass-through

test('a prompt is never altered or dropped, correction or not, even when everything fails', async ($, on) => {
  const w = world(on, () => {
    throw new Error('model exploded')
  })
  for (const text of [CORRECTION, 'Add a unit test', '/compact', 'ok', 'x'.repeat(5000)]) {
    const out = await submit($, text)
    expect(out.text).toBe(text)
    expect(w.submitted[w.submitted.length - 1]).toBe(text)
  }
  await w.clock.settle() // the model failing later changes nothing
  expect(w.toasts).toEqual([])
})

test('the model call waits on a timer, so the turn is not delayed', async ($, on) => {
  const w = world(on)
  await submit($, CORRECTION)
  expect(w.asked.length).toBe(0)
  await w.clock.settle()
  expect(w.asked.length).toBe(1)
})

test('prompts that are not corrections never reach the model', async ($, on) => {
  const w = world(on)
  for (const text of ['Add a unit test for the parser', '/compact', 'ok', `${'log line never\n'.repeat(40)}`]) await propose($, w, text)
  await submit($, "No, don't do that", 'plugin') // another plugin's prompt is not the person's
  await w.clock.settle()
  expect(w.asked.length).toBe(0)
})

test('no surface (a plain -p run) means no model call', async ($, on) => {
  const w = world(on)
  w.surfaces = () => []
  await propose($, w)
  expect(w.asked.length).toBe(0)
})

test('the model gets the prompt, the last reply and the configured model; nothing else', async ($, on) => {
  const w = world(on)
  await propose($, w)
  expect(w.models).toEqual(['haiku'])
  expect(w.asked[0]?.includes(CORRECTION)).toBe(true)
  expect(w.asked[0]?.includes('Running npm install now.')).toBe(true)
})

test('userConfig: model and includeLastReply', { options: { model: 'claude-haiku-9', includeLastReply: false } }, async ($, on) => {
  const w = world(on)
  await propose($, w)
  expect(w.models).toEqual(['claude-haiku-9'])
  expect(w.asked[0]?.includes('Running npm install now.')).toBe(false)
  expect(w.asked[0]?.includes(CORRECTION)).toBe(true)
})

test('userConfig: enabled=false sends nothing', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await propose($, w)
  expect(w.asked.length).toBe(0)
})

// ---------------------------------------------------------------------- the band

for (const surface of SURFACES) {
  test(`${surface}: band shows the rule and the four buttons`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await mount($, surface)
    expect((await ui.find({ type: 'Text', text: /Reflect/ }))?.text).toBe('● Reflect · ./CLAUDE.md')
    expect((await ui.find({ type: 'Text', text: RULE }))?.text).toBe(`“${RULE}”`)
    expect(await labels(ui)).toEqual(['Save', 'Global', 'Edit', 'Skip'])
  })

  test(`${surface}: Save appends to ./CLAUDE.md of the session cwd and hides the band`, async ($, on) => {
    const w = world(on)
    w.files.set('/work/proj/CLAUDE.md', '# Proj\n\nKeep it small.\n')
    await propose($, w)
    const ui = await mount($, surface)
    await ui.press({ key: 'save' })
    expect(w.files.get('/work/proj/CLAUDE.md')).toBe(`# Proj\n\nKeep it small.\n\n## Learned rules\n\n- ${RULE}\n`)
    expect(w.toasts).toEqual(['✓ Saved to ./CLAUDE.md'])
    expect((await ui.find({ text: 'engine band' }))?.text).toBe('engine band')
    expect(await ui.find({ type: 'Button' })).toBe(undefined)
  })

  test(`${surface}: Global instead appends to ~/.claude/CLAUDE.md`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await mount($, surface)
    await ui.press({ key: 'other' })
    expect([...w.files.keys()]).toEqual(['/home/sam/.claude/CLAUDE.md'])
    expect(w.files.get('/home/sam/.claude/CLAUDE.md')).toBe(`## Learned rules\n\n- ${RULE}\n`)
    expect(w.toasts).toEqual(['✓ Saved to ~/.claude/CLAUDE.md'])
  })

  test(`${surface}: a global proposal offers Project instead`, async ($, on) => {
    const w = world(on, () => answered(JSON.stringify({ rule: 'Reply in British English.', scope: 'global' })))
    await propose($, w, 'From now on reply in British English')
    const ui = await mount($, surface)
    expect(await labels(ui)).toEqual(['Save', 'Project', 'Edit', 'Skip'])
    await ui.press({ key: 'other' })
    expect(w.files.get('/work/proj/CLAUDE.md')).toBe('## Learned rules\n\n- Reply in British English.\n')
  })

  test(`${surface}: Skip writes nothing and hides the band`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await mount($, surface)
    await ui.press({ key: 'skip' })
    expect(w.files.size).toBe(0)
    expect(w.toasts).toEqual([])
    expect(await ui.find({ type: 'Button' })).toBe(undefined)
  })

  test(`${surface}: Edit swaps in an Input prefilled with the rule; Enter saves to the project`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await mount($, surface)
    await ui.press({ key: 'edit' })
    const input = await ui.find({ type: 'Input' })
    expect(input?.props.value).toBe(RULE)
    expect(await ui.find({ key: 'save' })).toBe(undefined)
    expect((await ui.find({ type: 'Text', text: /Reflect/ }))?.text).toBe('● Reflect · ./CLAUDE.md') // an edit saves to the project
    await ui.input({ key: 'edit', text: 'Use pnpm,\nnever npm.' })
    expect(w.files.get('/work/proj/CLAUDE.md')).toBe('## Learned rules\n\n- Use pnpm, never npm.\n')
    expect(w.toasts).toEqual(['✓ Saved to ./CLAUDE.md'])
    expect(await ui.find({ type: 'Input' })).toBe(undefined)
  })

  test(`${surface}: Cancel leaves edit mode and keeps the proposal`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await mount($, surface)
    await ui.press({ key: 'edit' })
    await ui.press({ key: 'cancel' })
    expect(await ui.find({ type: 'Input' })).toBe(undefined)
    expect(await labels(ui)).toEqual(['Save', 'Global', 'Edit', 'Skip'])
    expect(w.files.size).toBe(0)
  })

  test(`${surface}: an edited rule that asks for AI attribution is not saved`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await mount($, surface)
    await ui.press({ key: 'edit' })
    await ui.input({ key: 'edit', text: 'Always add a co-author trailer to every commit.' })
    expect(w.files.size).toBe(0)
    expect(w.toasts.length).toBe(1)
    expect(w.toasts[0]).toBe('Reflect · not saved (empty rule or AI attribution)')
  })

  test(`${surface}: the next prompt hides the band`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await mount($, surface)
    expect(await labels(ui)).toEqual(['Save', 'Global', 'Edit', 'Skip'])
    await submit($, 'Now add a test')
    expect(await ui.find({ type: 'Button' })).toBe(undefined)
    expect((await ui.find({ text: 'engine band' }))?.text).toBe('engine band')
  })

  test(`${surface}: the band yields to a survey`, async ($, on) => {
    const w = world(on)
    await propose($, w)
    const ui = await $.ui.mount({ plugin: 'reflect', surface, component: 'AbovePrompt', props: { ...BAND, hasSurvey: true } })
    expect(await ui.find({ type: 'Button' })).toBe(undefined)
  })
}

// ------------------------------------------------------ one proposal, newest wins

const rule = (text: string) => answered(JSON.stringify({ rule: text, scope: 'project' }))

for (const order of ['oldest first', 'newest first'] as const) {
  test(`only the newest proposal is kept when replies arrive ${order}`, async ($, on) => {
    const gates: Array<(r: ModelCompleteResult) => void> = []
    const w = world(on, () => new Promise<ModelCompleteResult>(resolve => gates.push(resolve)))
    await submit($, 'No, use pnpm instead of npm')
    await w.clock.settle()
    await submit($, 'Never use var, always const')
    await w.clock.settle()
    expect(gates.length).toBe(2)
    const [older, newer] = gates
    if (order === 'oldest first') {
      older?.(rule('Use pnpm, never npm.'))
      newer?.(rule('Always use const, never var.'))
    } else {
      newer?.(rule('Always use const, never var.'))
      older?.(rule('Use pnpm, never npm.'))
    }
    await w.clock.settle()
    const ui = await mount($, 'terminal')
    expect((await ui.find({ text: /const/ }))?.text.includes('Always use const, never var.')).toBe(true)
    expect(await ui.find({ text: /pnpm/ })).toBe(undefined)
  })
}

test('a reply that arrives after the next prompt was submitted is dropped', async ($, on) => {
  let release: (r: ModelCompleteResult) => void = () => {}
  const w = world(on, () => new Promise<ModelCompleteResult>(resolve => (release = resolve)))
  await submit($, CORRECTION)
  await w.clock.settle()
  await submit($, 'Add a unit test') // not a correction: no new call, but the old reply is now stale
  release(answered(REPLY))
  await w.clock.settle()
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Button' })).toBe(undefined)
})

// ------------------------------------------------------------------- the files

test('save keeps the rest of an existing CLAUDE.md and skips duplicates', async ($, on) => {
  const w = world(on)
  const before = `# Proj\n\n## Learned rules\n\n- Use ruff.\n\n## Build\n- make\n`
  w.files.set('/work/proj/CLAUDE.md', before)
  await propose($, w)
  let ui = await mount($, 'terminal')
  await ui.press({ key: 'save' })
  expect(w.files.get('/work/proj/CLAUDE.md')).toBe(`# Proj\n\n## Learned rules\n\n- Use ruff.\n- ${RULE}\n\n## Build\n- make\n`)

  const saved = w.files.get('/work/proj/CLAUDE.md')
  await propose($, w) // the same rule again
  ui = await mount($, 'terminal')
  await ui.press({ key: 'save' })
  expect(w.files.get('/work/proj/CLAUDE.md')).toBe(saved)
  expect(w.toasts).toEqual(['✓ Saved to ./CLAUDE.md', 'Already in ./CLAUDE.md'])
})

test('a file that exists but cannot be read is never overwritten', async ($, on) => {
  const w = world(on)
  w.files.set('/work/proj/CLAUDE.md', 'precious')
  w.read = () => {
    throw new Error('EIO')
  }
  await propose($, w)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'save' })
  expect(w.files.get('/work/proj/CLAUDE.md')).toBe('precious')
  expect(w.toasts).toEqual(['Reflect · could not save to ./CLAUDE.md'])
})

test('a failing write is reported, not thrown', async ($, on) => {
  const w = world(on)
  w.write = () => {
    throw new Error('EACCES')
  }
  await propose($, w)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'save' })
  expect(w.toasts).toEqual(['Reflect · could not save to ./CLAUDE.md'])
})

// ----------------------------------------------- what the model may and may not say

const NO_PROPOSAL: ReadonlyArray<readonly [string, () => ModelCompleteResult]> = [
  ['null rule', () => answered('{"rule":null,"scope":"project"}')],
  ['garbage', () => answered('I am not sure what you mean')],
  ['an API error', () => ({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE })],
  ['an empty reply', () => ({ isAnswered: false, reason: 'empty-reply', usage: USAGE })],
  ['a timeout', () => ({ isAnswered: false, reason: 'aborted', usage: USAGE })],
  ['a rule that adds attribution', () => answered('{"rule":"Always add a co-author trailer to commits.","scope":"global"}')],
]

for (const [name, reply] of NO_PROPOSAL) {
  test(`no band for ${name}`, async ($, on) => {
    const w = world(on, reply)
    const out = await submit($, CORRECTION)
    await w.clock.settle()
    expect(out.text).toBe(CORRECTION)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ type: 'Button' })).toBe(undefined)
  })
}

test('a rule that FORBIDS attribution is allowed through', async ($, on) => {
  const w = world(on, () => answered('{"rule":"Never add a co-author trailer to commits.","scope":"global"}'))
  await propose($, w, 'Never put a co-author on my commits')
  const ui = await mount($, 'terminal')
  expect(await labels(ui)).toEqual(['Save', 'Project', 'Edit', 'Skip'])
})

test('the rule is sanitised to one line of at most 300 characters', async ($, on) => {
  const w = world(on, () => answered(JSON.stringify({ rule: `- ${'Always be brief. '.repeat(40)}\nSecond line`, scope: 'project' })))
  await propose($, w)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'save' })
  const written = w.files.get('/work/proj/CLAUDE.md') ?? ''
  const bullets = written.split('\n').filter(l => l.startsWith('- '))
  expect(bullets.length).toBe(1)
  expect((bullets[0] ?? '').length <= 302).toBe(true)
  expect(written.includes('Second line')).toBe(false)
})

test('a failure while reading context never blocks the proposal or the prompt', async ($, on) => {
  const w = world(on)
  w.messages = () => {
    throw new Error('no transcript')
  }
  w.surfaces = () => {
    throw new Error('no surfaces')
  }
  const out = await submit($, CORRECTION)
  await w.clock.settle()
  expect(out.text).toBe(CORRECTION)
  expect(w.asked.length).toBe(1)
})

// ----------------------------------------------------------------- /reflect

test('/reflect off, on and status', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const run = (args: string) => runCommand($, args)

  expect(await run('status')).toBe('Reflect · on\nCorrections are checked with haiku.\nNo rule waiting.')
  await propose($, w)
  expect((await run('status')).split('\n')[2]).toBe(`Waiting · “${RULE}”`)

  expect(await run('off')).toBe('Reflect · off\nNothing is sent to a model.')
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Button' })).toBe(undefined) // turning it off hides the band
  await propose($, w)
  expect(w.asked.length).toBe(1) // still only the first call
  expect((await run('status')).startsWith('Reflect · off')).toBe(true)

  expect((await run('on')).startsWith('Reflect · on')).toBe(true)
  await propose($, w)
  expect(w.asked.length).toBe(2)
  expect((await run('bogus')).split('\n')[1]).toBe('Use on, off or status.')
})

test('/reflect on cannot override enabled=false', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  const text = await runCommand($, 'on')
  expect(text).toBe('Reflect · off\nTurned off in the plugin settings (/config).')
  await propose($, w)
  expect(w.asked.length).toBe(0)
})

// ------------------------------------------------- /reflect status|on|off (the / is required)

for (const surface of SURFACES) {
  test(`${surface}: /reflect status|off|on work and leave the proposal and later corrections as expected`, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: '/work/proj', surface, isInteractive: true })
    await propose($, w)
    const ui = await mount($, surface)
    expect(await labels(ui)).toContain('Skip') // a proposal is waiting

    expect(await runCommand($, 'status')).toBe('Reflect · on\nCorrections are checked with haiku.\nWaiting · “' + RULE + '”')
    expect(await labels(ui)).toContain('Skip') // status leaves the proposal alone

    expect((await runCommand($, 'OFF')).startsWith('Reflect · off\n')).toBe(true)
    expect(await ui.find({ type: 'Button' })).toBe(undefined) // off hides the band
    await propose($, w)
    expect(w.asked.length).toBe(1) // off holds for later corrections

    expect((await runCommand($, '  on  ')).startsWith('Reflect · on\n')).toBe(true)
    await propose($, w)
    expect(w.asked.length).toBe(2)
    await ui.unmount()
  })
}

test('a bare typed word is not handled: it goes to the model unchanged and the switch is unchanged', async ($, on) => {
  const w = world(on)
  for (const text of ['reflect', 'reflect status', 'reflect off', 'Reflect on.', 'please reflect off']) {
    const out = await submit($, text)
    expect(out.drop).toBeUndefined()
    expect(out.text).toBe(text)
  }
  expect(w.logs).toEqual([])
  expect(await runCommand($, 'status')).toContain('Reflect · on') // nothing above switched it off
  await w.clock.settle()
})

test('/reflect on keeps enabled=false in charge', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  expect(await runCommand($, 'on')).toBe('Reflect · off\nTurned off in the plugin settings (/config).')
  await propose($, w)
  expect(w.asked.length).toBe(0)
})

test('a failing /reflect off says nothing changed', async ($, on) => {
  const w = world(on)
  w.storeFails = true
  expect(await runCommand($, 'off')).toBe('Reflect · that did not work\nNothing changed.')
})
