import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, UiPane } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const NO_ANSWER = 'Aside · no answer, nothing changed'

const PANE_PROPS = {
  title: 'Aside',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

/** 12k tokens in all, most of them read from the cache. */
const USAGE = { input_tokens: 400, output_tokens: 600, cache_read_input_tokens: 11_000, cache_creation_input_tokens: 0 }

type Fork = { isAnswered: true; text: string; usage: typeof USAGE } | { isAnswered: false; reason: string; [k: string]: unknown }

/** Everything beneath the plugin: the fork (answered by `w.fork`, optionally held back), panes, log and toasts. */
function world(on: On) {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (store.delete(e.key), { value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  const w = {
    store,
    clock: mock.clock(on, { now: 1_000_000 }),
    session: mock.session(on),
    forkPrompts: [] as string[],
    fork: (): Fork | Promise<Fork> => ({ isAnswered: true, text: 'A p-value is not the probability the null is true.', usage: USAGE }),
    panes: [] as UiPane[],
    isPlaced: true,
    logs: [] as string[],
    toasts: [] as string[],
    registered: [] as string[],
  }
  on('model.fork', async (_$, e) => {
    w.forkPrompts.push(e.prompt)
    return { value: (await w.fork()) as never }
  })
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: undefined as never }))
  on('ui.panes', () => ({ value: [...w.panes] }))
  on('ui.open', (_$, e) => {
    if (!w.panes.some(p => p.id === e.id)) w.panes.push({ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: false, isPlaced: true })
    return { value: w.isPlaced ? { isPlaced: true as const } : { isPlaced: false as const, reason: 'no-room' as never } }
  })
  on('ui.close', (_$, e) => {
    w.panes = w.panes.filter(p => p.id !== e.id)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => (w.logs.push(e.text), { value: undefined }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return w
}

const slash = ($: Engine, args: string) =>
  $.command.run({ command: 'aside', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const typed = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

/** Ask and let the timer-run fork finish. */
async function ask($: Engine, w: ReturnType<typeof world>, question: string) {
  const out = await slash($, question)
  await w.clock.advance(1)
  return out
}

const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'aside', surface, component: 'Pane', requestId: 'aside', props: PANE_PROPS } as never)

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text)

for (const surface of SURFACES) {
  test(`${surface}: the answer shows under the question with the dim line and a Close button`, async ($, on) => {
    const w = world(on)
    const out = await ask($, w, 'what is a p-value?')
    expect(w.panes.map(p => p.id)).toEqual(['aside'])
    expect(out.text).not.toContain('probability') // the answer is not in the command's transcript line

    const ui = await mountPane($, surface)
    expect(await texts(ui)).toEqual([
      'what is a p-value?',
      'A p-value is not the probability the null is true.',
      'Side question · not added to the conversation · ~12k tokens est.',
    ])
    const buttons = await ui.findAll({ type: 'Button' })
    expect(buttons.map(b => b.props.label)).toEqual(['Close'])
    await ui.press({ key: 'close' })
    expect(w.panes).toEqual([])
    await ui.unmount()
  })

  test(`${surface}: shows Thinking… while the fork runs, then the answer`, async ($, on) => {
    const w = world(on)
    let release: (f: Fork) => void = () => undefined
    w.fork = () => new Promise<Fork>(resolve => (release = resolve))
    await slash($, 'why is the sky blue?')
    await w.clock.advance(1)

    const ui = await mountPane($, surface)
    expect(await texts(ui)).toEqual(['why is the sky blue?', 'Thinking…'])
    expect((await slash($, 'second one')).text).toBe('Aside · one is still thinking')
    expect(w.forkPrompts).toHaveLength(1)

    release({ isAnswered: true, text: 'Rayleigh scattering.', usage: USAGE })
    await w.clock.settle()
    expect(await texts(ui)).toContain('Rayleigh scattering.') // the open pane redraws by itself
    expect(await texts(ui)).not.toContain('Thinking…')
    await ui.unmount()
  })

  test(`${surface}: a failed or empty fork says no answer, nothing changed`, async ($, on) => {
    const w = world(on)
    const failures: [Fork | (() => never), string][] = [
      [{ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }, 'The request failed (529) · overloaded'],
      [{ isAnswered: false, reason: 'empty-reply', usage: USAGE }, 'The model sent no text'],
      [{ isAnswered: false, reason: 'nothing-to-fork' }, 'Nothing to ask about yet · send a message first'],
      [{ isAnswered: false, reason: 'aborted', usage: USAGE }, 'Cut short'],
      [{ isAnswered: true, text: '   ', usage: USAGE }, 'The model sent no text'],
      [() => { throw new Error('boom') }, 'The request could not be sent'],
    ]
    for (const [result, why] of failures) {
      w.fork = typeof result === 'function' ? result : () => result
      await ask($, w, 'q')
      const ui = await mountPane($, surface)
      const shown = await texts(ui)
      expect(shown.slice(0, 3), why).toEqual(['q', NO_ANSWER, why])
      expect(shown.some(t => t.startsWith('Side question'))).toBe(false)
      await ui.unmount()
    }
  })

  test(`${surface}: keeps the last five, newest first`, async ($, on) => {
    const w = world(on)
    for (let i = 1; i <= 6; i++) {
      w.fork = () => ({ isAnswered: true, text: `answer ${i}`, usage: USAGE })
      await ask($, w, `question ${i}`)
    }
    const ui = await mountPane($, surface)
    const bold = (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold === true).map(t => t.text)
    expect(bold).toEqual(['question 6', 'question 5', 'question 4', 'question 3', 'question 2'])
    await ui.unmount()
  })

  test(`${surface}: an empty pane says how to ask`, async ($, on) => {
    world(on)
    const ui = await mountPane($, surface)
    expect(await texts(ui)).toEqual(['No side questions yet · /aside your question'])
    await ui.unmount()
  })
}

test('the fork gets the instruction and the question, and nothing reaches the conversation', async ($, on) => {
  const w = world(on)
  await ask($, w, 'what does set.seed do?')
  expect(w.forkPrompts).toEqual([
    'Answer the side question briefly. Do not use tools. Do not change anything.\n\nSide question: what does set.seed do?',
  ])
  expect(w.session.appended()).toHaveLength(0)
})

test('a long answer is cut to maxAnswerChars and says so', { options: { maxAnswerChars: 200 } }, async ($, on) => {
  const w = world(on)
  w.fork = () => ({ isAnswered: true, text: 'x'.repeat(500), usage: USAGE })
  await ask($, w, 'long')
  const ui = await mountPane($, 'terminal')
  const shown = await texts(ui)
  expect(shown[1]!.length).toBe(201)
  expect(shown).toContain('Answer shortened to fit the setting')
  await ui.unmount()
})

test('no usage figure means no token estimate in the dim line', async ($, on) => {
  const w = world(on)
  w.fork = () => ({ isAnswered: true, text: 'fine', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
  await ask($, w, 'q')
  const ui = await mountPane($, 'terminal')
  expect(await texts(ui)).toContain('Side question · not added to the conversation')
  await ui.unmount()
})

test('with no room for the pane nothing is asked', async ($, on) => {
  const w = world(on)
  w.isPlaced = false
  const out = await ask($, w, 'q')
  expect(out.text).toContain('no room for the pane')
  expect(w.forkPrompts).toHaveLength(0)
})

test('enabled=false asks nothing, for the command and the word', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  expect((await ask($, w, 'q')).text).toContain('Aside is off')
  const out = await typed($, 'aside')
  expect(out.drop).toContain('Aside is off')
  expect(w.forkPrompts).toHaveLength(0)
})

test('/aside alone explains itself and asks nothing', async ($, on) => {
  const w = world(on)
  const out = await slash($, '   ')
  expect(out.text).toContain('Type /aside and your question')
  expect(w.forkPrompts).toHaveLength(0)
  expect(w.panes).toEqual([])
})

test('the plain word aside explains locally and is dropped; sentences and attachments pass', async ($, on) => {
  const w = world(on)
  for (const word of ['aside', ' Aside ', 'ASIDE.']) {
    const out = await typed($, word)
    expect(out.drop, word).toBe('Aside · ask a side question without touching this conversation')
  }
  expect(w.logs.some(l => l.includes('/aside'))).toBe(true)
  expect(w.forkPrompts).toHaveLength(0)

  for (const text of ['aside what is a p-value', 'as an aside, fix it', '/aside why', 'asides']) {
    const out = await typed($, text)
    expect(out.drop, text).toBeUndefined()
  }
  const withFile = await $.prompt.submit({ text: 'aside', wait: false, origin: { kind: 'composer' }, attachments: [{ type: 'image' }] } as never)
  expect(withFile.drop).toBeUndefined()
})

test('the plain word brings back the kept asides', async ($, on) => {
  const w = world(on)
  await ask($, w, 'q1')
  w.panes = []
  const out = await typed($, 'aside')
  expect(out.drop).toBe('Aside · 1 kept in the pane')
  expect(w.panes.map(p => p.id)).toEqual(['aside'])
})

test('a toast says the answer is ready when the pane was closed meanwhile', async ($, on) => {
  const w = world(on)
  let release: (f: Fork) => void = () => undefined
  w.fork = () => new Promise<Fork>(resolve => (release = resolve))
  await slash($, 'q')
  await w.clock.advance(1)
  w.panes = []
  release({ isAnswered: true, text: 'a', usage: USAGE })
  await w.clock.settle()
  expect(w.toasts).toEqual(['Aside · answer ready · /aside shows it'])
})

test('the command is registered as immediate and session end clears the asides', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  expect(w.registered).toEqual(['aside'])
  await ask($, w, 'q')
  await $.session.end({ sessionId: 's', reason: 'clear' } as never)
  const ui = await mountPane($, 'terminal')
  expect(await texts(ui)).toEqual(['No side questions yet · /aside your question'])
  await ui.unmount()
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }
const mountBand = ($: Engine, surface: (typeof SURFACES)[number], props: object = BAND) =>
  $.ui.mount({ plugin: 'aside', surface, component: 'AbovePrompt', props } as never)
const bandText = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')

for (const surface of SURFACES) {
  test(`${surface}: the green aside chip is the button; clicking turns aside off (red) and on again`, async ($, on) => {
    const w = world(on)
    const band = await mountBand($, surface)
    expect(await bandText(band)).toContain('aside on')
    expect(JSON.stringify(await band.findAll({ type: 'Text' }))).toContain('success')
    await band.press({ key: 'toggle' })
    expect(w.store.get('off')).toBe(true)
    expect(await bandText(band)).toContain('aside off')
    expect(JSON.stringify(await band.findAll({ type: 'Text' }))).toContain('error')
    expect(JSON.stringify(await band.findAll({ type: 'Text' }))).not.toContain('Turn o')
    await band.press({ key: 'toggle' })
    expect(w.store.has('off')).toBe(false)
    expect(await bandText(band)).toContain('aside on')
  })
}

test('while off, /aside <question> sends nothing and says how to turn it on; /aside on lifts it', async ($, on) => {
  const w = world(on)
  expect((await slash($, 'off')).text).toContain('Aside · off')
  const r = await slash($, 'what is REML?')
  expect(r.text).toContain('Aside is off')
  expect(w.forkPrompts).toHaveLength(0)
  expect((await slash($, 'on')).text).toBe('Aside · on')
  expect((await slash($, 'what is REML?')).text).toContain('thinking')
})

test('typing "aside off" / "aside on" flips the switch and is dropped; a prompt that merely mentions it is not', async ($, on) => {
  const w = world(on)
  expect(await typed($, 'aside off')).toEqual({ drop: 'Aside · off · type aside on, or click the chip, to turn it back on' })
  expect(w.store.get('off')).toBe(true)
  expect(await typed($, 'Aside on.')).toEqual({ drop: 'Aside · on' })
  expect(w.store.has('off')).toBe(false)
  expect(await typed($, 'please aside off now')).toEqual({ text: 'please aside off now' })
})

test('showButton = false: no chip', { options: { showButton: false } }, async ($, on) => {
  world(on)
  const band = await mountBand($, 'terminal')
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
})

test('enabled = false: no chip, and on does not override it', { options: { enabled: false } }, async ($, on) => {
  world(on)
  const band = await mountBand($, 'terminal')
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
  expect((await slash($, 'on')).text).toContain('disabled')
})
