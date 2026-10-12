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
      name: 'data-guard',
      register(on: On) {
        on('command.run', { command: 'data-guard' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') await $.state.set({ plugin: 'data-guard', key: 'isOff' } as never, (e.args === 'off') as never)
          return { text: `data-guard · ${e.args || 'on'}` }
        })
      },
    },
    {
      name: 'big-file-guard',
      register(on: On) {
        on('command.run', { command: 'big-file-guard' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') await $.state.set({ plugin: 'big-file-guard', key: 'isOff' } as never, (e.args === 'off') as never)
          return { text: `big-file-guard · ${e.args || 'on'}` }
        })
      },
    },
    {
      name: 'repro-log',
      register(on: On) {
        on('command.run', { command: 'repro' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') await $.state.set({ plugin: 'repro-log', key: 'isOff' } as never, (e.args === 'off') as never)
          return { text: `repro-log · ${e.args || 'on'}` }
        })
      },
    },
    {
      name: 'auto-test',
      register(on: On) {
        on('command.run', { command: 'auto-test' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') await $.state.set({ plugin: 'auto-test', key: 'isOff' } as never, (e.args === 'off') as never)
          return { text: `auto-test · ${e.args || 'on'}` }
        })
      },
    },
    {
      name: 'long-run-ping',
      register(on: On) {
        on('command.run', { command: 'long-run-ping' }, async ($, e) => {
          if (e.args === 'on' || e.args === 'off') await $.state.set({ plugin: 'long-run-ping', key: 'isOff' } as never, (e.args === 'off') as never)
          return { text: `long-run-ping · ${e.args || 'on'}` }
        })
      },
    },
    {
      name: 'prompt-library',
      register(on: On) {
        on('command.run', { command: 'prompts' }, async ($) => {
          await $.state.set({ plugin: 'prompt-library', key: 'items' } as never, [{ name: 'tests', text: 'Write tests for my last change' }, { name: 'eda', text: 'Profile this dataset' }] as never)
          return { text: 'prompts · 2' }
        })
      },
    },
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
      name: 'blast-radius',
      register(on: On) {
        on('command.run', { command: 'blast-radius' }, async ($, e) => {
          if (e.args !== '') await $.state.set({ plugin: 'blast-radius', key: 'level' } as never, e.args as never)
          return { text: `blast-radius · ${e.args || 'medium'}` }
        })
      },
    },
    {
      name: 'review-cost',
      register(on: On) {
        on('command.run', { command: 'review-cost' }, async ($, e) => {
          if (e.args !== '') await $.state.set({ plugin: 'review-cost', key: 'isOff' } as never, (e.args === 'off') as never)
          return { text: `review-cost · ${e.args || 'on'}` }
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
  await run($, 'blast-radius', 'medium')
  await run($, 'review-cost', 'on')
  for (const c of ['data-guard', 'big-file-guard', 'repro', 'auto-test', 'long-run-ping']) await run($, c, 'on')
  const pane = await mount($, 'desktop')
  for (const id of ['suggest', 'aside', 'reflect', 'secret-guard', 'data-guard', 'big-file-guard', 'repro-log', 'auto-test', 'long-run-ping', 'checkpoint', 'skin', 'blast-radius', 'review-cost', 'branch-janitor', 'cache-tax', 'budget-guard', 'savvy-progress', 'filetree', 'replay-theater', 'diagram']) {
    expect(await pane.find({ key: `row:${id}` })).toBeDefined()
  }
  const shown = await texts(pane)
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

test('blast-radius and review-cost are level dropdowns: green while on, red once set to off, and the pick runs the mod\'s command', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'blast-radius', 'medium')
  await run($, 'review-cost', 'on')
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'level:blast-radius' })).toBeDefined()
  expect(JSON.stringify(await pane.find({ key: 'row:blast-radius' }))).toContain('success')
  await pane.select({ key: 'level:blast-radius', value: 'off' } as never)
  expect(w.toasts.at(-1)).toBe('blast-radius · off')
  expect(JSON.stringify(await pane.find({ key: 'row:blast-radius' }))).toContain('error')
  await pane.select({ key: 'level:review-cost', value: 'off' } as never)
  expect(JSON.stringify(await pane.find({ key: 'row:review-cost' }))).toContain('error')
  await pane.select({ key: 'level:review-cost', value: 'on' } as never)
  expect(JSON.stringify(await pane.find({ key: 'row:review-cost' }))).toContain('success')
})

test('a skin pick shows at once and runs /skin', MODS, async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'desktop')
  await pane.select({ key: 'skin', value: 'nord' } as never)
  expect(w.toasts.at(-1)).toBe('Skin · nord')
  expect(JSON.stringify(await pane.find({ key: 'skin' }))).toContain('nord')
})

test('a row is clickable across its whole width: its text is padded to the pane', MODS, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  const found = (await pane.find({ key: 'tool:aside' })) as { text: string }
  expect(found.text.length).toBeGreaterThan(30)
  expect(found.text.endsWith('\u00a0')).toBe(true)
})

test('the new switches are coloured and a click runs the mod\'s own on/off', MODS, async ($, on) => {
  const w = world(on)
  for (const c of ['data-guard', 'big-file-guard', 'repro', 'auto-test', 'long-run-ping']) await run($, c, 'on')
  const pane = await mount($, 'desktop')
  await pane.press({ key: 'switch:data-guard' })
  expect(w.toasts.at(-1)).toBe('data-guard · off')
  expect(JSON.stringify(await pane.find({ key: 'row:data-guard' }))).toContain('error')
  await pane.press({ key: 'switch:repro-log' })
  expect(w.toasts.at(-1)).toBe('repro-log · off')
})

test('saved prompts from prompt-library are listed, and a click puts the text in the prompt box', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'prompts', '')
  const pane = await mount($, 'desktop')
  await pane.press({ key: 'prompt:tests' })
  expect(w.filled.at(-1)).toBe('Write tests for my last change')
})

test('without prompt-library there is no Prompts section', MODS_NONE, async ($, on) => {
  world(on)
  expect(await texts(await mount($, 'desktop'))).not.toContain('Prompts')
})
