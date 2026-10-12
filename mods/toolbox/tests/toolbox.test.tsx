import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const SURFACES = ['terminal', 'desktop'] as const
const PANE_PROPS = { title: 'Toolbox', isFocused: false, bodyColumns: 40, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true } as const

// Stand-ins for the mods the side bar reads: each keeps its switch in its own state and answers its own command.
const MODS = {
  plugins: [
    {
      name: 'aside',
      register(on: On) {
        on('command.run', { command: 'aside' }, async ($, e) => {
          const off = e.args === 'off'
          await $.state.set({ plugin: 'aside', key: 'isOff' } as never, off as never)
          return { text: off ? 'Aside · off' : 'Aside · on' }
        })
      },
    },
    {
      name: 'suggest-model',
      register(on: On) {
        on('command.run', { command: 'suggest-model' }, async ($, e) => {
          const off = e.args === 'off'
          await $.state.set({ plugin: 'suggest-model', key: 'isOff' } as never, off as never)
          return { text: `suggest-model · ${off ? 'off' : 'on'}` }
        })
      },
    },
    {
      name: 'tool-skins',
      register(on: On) {
        on('command.run', { command: 'skin' }, async ($, e) => {
          await $.state.set({ plugin: 'tool-skins', key: 'theme' } as never, e.args as never)
          return { text: `Skin · ${e.args}` }
        })
      },
    },
  ],
}

function world(on: On) {
  const w = { toasts: [] as string[], filled: [] as string[], panes: [] as string[] }
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('prompt.fill', (_$, e) => (w.filled.push((e as { text: string }).text), { isFilled: true } as never))
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', (_$, e) => (w.panes.push(e.id), { value: { isPlaced: true as const } }))
  on('ui.close', (_$, e) => ((w.panes = w.panes.filter(p => p !== e.id)), { value: undefined }))
  on('command.register', () => ({ value: undefined as never }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  return w
}

const run = ($: Engine, command: string, args: string) =>
  $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as never)

const mount = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'toolbox', surface, component: 'Pane', requestId: 'toolbox', props: PANE_PROPS, viewport: FULLSCREEN } as never)

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

for (const surface of SURFACES) {
  test(`${surface}: switches are coloured pills; a click runs the mod's own command at once`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'aside', 'on')
    await run($, 'suggest-model', 'on')
    const pane = await mount($, surface)
    expect(await texts(pane)).toContain('$ aside on')
    expect(await texts(pane)).toContain('suggest on')
    expect(JSON.stringify(await pane.findAll({ type: 'Text' }))).toContain('success')
    await pane.press({ key: 'switch:aside' })
    expect(await texts(pane)).toContain('$ aside off')
    expect(JSON.stringify(await pane.findAll({ type: 'Text' }))).toContain('error')
    expect(w.toasts.at(-1)).toBe('Aside · off')
    await pane.press({ key: 'switch:aside' })
    expect(await texts(pane)).toContain('$ aside on')
  })

  test(`${surface}: any other item goes in the prompt box and nothing is sent`, MODS, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    await pane.press({ key: 'tool:branch-janitor' })
    await pane.press({ key: 'tool:aside-ask' })
    await pane.press({ key: 'skill:dual-model-review' })
    expect(w.filled).toEqual(['branch-janitor', '/aside ', 'Use the dual-model-review skill to review my last change'])
  })
}

test('a switch the side bar cannot see is not drawn', async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'switch:aside' })).toBeUndefined()
  expect(await pane.find({ key: 'switch:reflect' })).toBeUndefined()
  expect(await texts(pane)).not.toContain('Switches')
  expect(await pane.find({ key: 'tool:usage' })).toBeDefined()
})

test('the skin dropdown switches at once through /skin', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'skin', 'noir')
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'skin' })).toBeDefined()
  await pane.select({ key: 'skin', value: 'dracula' } as never)
  expect(w.toasts.at(-1)).toBe('Skin · dracula')
})

test('typing toolbox toggles the side bar and is not sent', async ($, on) => {
  const w = world(on)
  const out = await $.prompt.submit({ text: 'toolbox', wait: false, origin: { kind: 'composer' } } as never)
  expect(out.drop).toBe('Toolbox · open')
  expect(w.panes).toEqual(['toolbox'])
  const again = await $.prompt.submit({ text: 'Toolbox.', wait: false, origin: { kind: 'composer' } } as never)
  expect(again.drop).toBe('Toolbox · closed')
  const sentence = await $.prompt.submit({ text: 'open the toolbox please', wait: false, origin: { kind: 'composer' } } as never)
  expect(sentence.text).toBe('open the toolbox please')
})

test('the pane says $ means tokens', async ($, on) => {
  world(on)
  expect(await texts(await mount($, 'terminal'))).toContain('$ = spends model tokens')
})
