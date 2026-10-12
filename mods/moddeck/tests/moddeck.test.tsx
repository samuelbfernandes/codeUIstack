import { expect, test } from 'claude-code/testing'
import type { Engine, TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]

const SURFACES = ['terminal', 'desktop'] as const
const MODS_NONE = {}
const PANE_PROPS = { title: 'Moddeck', isFocused: false, bodyColumns: 40, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} }
const FULLSCREEN = { columns: 120, rows: 40, isFullscreen: true } as const

// Stand-ins for the mods the side bar reads: each keeps its switch in its own state and answers its own command.
const MODS = {
  plugins: [
    {
      name: 'suggest-model',
      register(on: On) {
        on('command.run', { command: 'suggest-model' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') {
            await $.state.set({ plugin: 'suggest-model', key: 'isOff' } as never, (e.args === 'off') as never)
            return { text: `suggest-model · ${e.args}` }
          }
          return { text: 'suggest-model · on · Sonnet\nBlocks and asks on a mismatch' }
        })
      },
    },
    {
      name: 'reflect',
      register(on: On) {
        on('command.run', { command: 'reflect' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') await $.state.set({ plugin: 'reflect', key: 'isOff' } as never, (e.args === 'off') as never)
          return { text: `Reflect · ${e.args || 'on'}\nCorrections are checked with haiku.` }
        })
      },
    },
    {
      name: 'secret-guard',
      register(on: On) {
        on('command.run', { command: 'secret-guard' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') await $.state.set({ plugin: 'secret-guard', key: 'isOn' } as never, (e.args === 'on') as never)
          return { text: `Secret guard · ${e.args || 'on'}` }
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
  const w = { toasts: [] as string[], logs: [] as string[], filled: [] as string[], panes: [] as string[] }
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', (_$, e) => (w.logs.push(e.text), { value: undefined }))
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
  $.ui.mount({ plugin: 'moddeck', surface, component: 'Pane', requestId: 'moddeck', props: PANE_PROPS, viewport: FULLSCREEN } as never)

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

for (const surface of SURFACES) {
  test(`${surface}: suggest is the one coloured switch; a click flips it at once, and its options show only while it is green`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'suggest-model', 'on')
    const pane = await mount($, surface)
    expect(await texts(pane)).toContain('suggest · on')
    expect(JSON.stringify(await pane.findAll({ type: 'Text' }))).toContain('success')
    expect(await pane.find({ key: 'option:suggest:/suggest-model' })).toBeDefined()
    await pane.press({ key: 'switch:suggest' })
    expect(await texts(pane)).toContain('suggest · off')
    expect(JSON.stringify(await pane.findAll({ type: 'Text' }))).toContain('error')
    expect(await pane.find({ key: 'option:suggest:/suggest-model' })).toBeUndefined() // hidden while red
    expect(w.toasts.at(-1)).toBe('suggest-model · off')
    await pane.press({ key: 'switch:suggest' })
    expect(await texts(pane)).toContain('suggest · on')
  })

  test(`${surface}: reflect and secret-guard are coloured switches too; a click flips each at once`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'reflect', 'on')
    await run($, 'secret-guard', 'on')
    const pane = await mount($, surface)
    expect(await texts(pane)).toContain('$ reflect · on')
    expect(await texts(pane)).toContain('secret-guard · on')
    await pane.press({ key: 'switch:reflect' })
    await pane.press({ key: 'switch:secret-guard' })
    expect(await texts(pane)).toContain('$ reflect · off')
    expect(await texts(pane)).toContain('secret-guard · off')
    expect(w.toasts.at(-1)).toBe('Secret guard · off')
    expect(await pane.find({ key: 'tool:reflect' })).toBeUndefined() // no separate status button: the colour is the status
  })

  test(`${surface}: a one-task tool is just its row and runs at once; the reply goes to a toast and the transcript`, MODS, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    await pane.press({ key: 'tool:budget-guard' })
    expect(w.toasts.at(-1)).toBe('Moddeck · could not run /budget-guard') // no such command in this test: the failure is said, nothing breaks
    expect(await pane.find({ key: 'option:aside:/aside ' })).toBeUndefined() // no repeated indented button
  })

  test(`${surface}: a command that needs your text, or changes something, goes in the prompt box (with its slash) and nothing is sent`, MODS, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    await pane.press({ key: 'tool:aside' })
    await pane.press({ key: 'option:branch-janitor:/branch-janitor clean' })
    await pane.press({ key: 'option:cache-tax:/keepwarm 90m' })
    await pane.press({ key: 'skill:dual-model-review' })
    expect(w.filled).toEqual(['/aside ', '/branch-janitor clean', '/keepwarm 90m', 'Use the dual-model-review skill to review my last change'])
  })
}

test('with suggest-model missing its switch is not drawn, and the other rows still are', MODS_NONE, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'switch:suggest' })).toBeUndefined()
  expect(await pane.find({ key: 'tool:branch-janitor' })).toBeDefined()
})

test('the skin dropdown is always listed, even before a skin was ever picked, and switches at once through /skin', MODS, async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'skin' })).toBeDefined()
  await pane.select({ key: 'skin', value: 'dracula' } as never)
  expect(w.toasts.at(-1)).toBe('Skin · dracula')
})

test('every tool is one boxed row, the tools and skills are split by a divider, and there is no separate Options list', MODS, async ($, on) => {
  world(on)
  await run($, 'suggest-model', 'on')
  await run($, 'reflect', 'on')
  await run($, 'secret-guard', 'on')
  const pane = await mount($, 'desktop')
  for (const id of ['suggest', 'aside', 'reflect', 'secret-guard', 'skin', 'blast-radius', 'review-cost', 'branch-janitor', 'cache-tax', 'budget-guard', 'savvy-progress', 'filetree', 'replay-theater', 'diagram']) {
    expect(await pane.find({ key: `row:${id}` })).toBeDefined()
  }
  const shown = await texts(pane)
  expect(shown).toContain('blast-radius · appears before a risky command')
  expect(shown).toContain('────') // the divider
  expect(shown.indexOf('────')).toBeLessThan(shown.indexOf('Skills'))
  expect(shown).not.toContain('Options')
  // two-or-more options sit under their own row; one-task tools have none
  expect(await pane.find({ key: 'option:cache-tax:/keepwarm off' })).toBeDefined()
  expect(await pane.find({ key: 'option:aside:/aside ' })).toBeUndefined()
})

test('there is no typed word for the moddeck: it needs its slash', async ($, on) => {
  const w = world(on)
  const sentence = await $.prompt.submit({ text: 'moddeck', wait: false, origin: { kind: 'composer' } } as never)
  expect(sentence.text).toBe('moddeck')
  expect(w.panes).toEqual([])
  expect((await run($, 'moddeck', '')).text).toBe('Moddeck · open')
})

test('the pane says $ means tokens', async ($, on) => {
  world(on)
  expect(await texts(await mount($, 'terminal'))).toContain('$ = spends model tokens')
})

test('the skills list has no scroll buttons while all of its skills fit', MODS, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'skills:down' })).toBeUndefined()
  expect(await pane.find({ key: 'skill:dual-model-review' })).toBeDefined()
})

test('with more skills than fit, ▼ and ▲ scroll the list one row at a time and the counter follows', { options: { skillRows: 1 } }, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(await texts(pane)).toContain('1–1 of 2')
  expect(await pane.find({ key: 'skill:dual-model-review' })).toBeDefined()
  expect(await pane.find({ key: 'skill:agents-md-scaffold' })).toBeUndefined()
  await pane.press({ key: 'skills:down' })
  expect(await texts(pane)).toContain('2–2 of 2')
  expect(await pane.find({ key: 'skill:dual-model-review' })).toBeUndefined()
  expect(await pane.find({ key: 'skill:agents-md-scaffold' })).toBeDefined()
  await pane.press({ key: 'skills:down' }) // already at the end: stays
  expect(await texts(pane)).toContain('2–2 of 2')
  await pane.press({ key: 'skills:up' })
  expect(await texts(pane)).toContain('1–1 of 2')
})
