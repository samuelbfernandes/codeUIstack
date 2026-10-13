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
  ],
}

function world(on: On) {
  const w = { toasts: [] as string[], logs: [] as string[], filled: [] as string[], panes: [] as string[], opened: [] as { id: string; columns?: number }[] }
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', (_$, e) => (w.logs.push(e.text), { value: undefined }))
  on('prompt.fill', (_$, e) => (w.filled.push((e as { text: string }).text), { isFilled: true } as never))
  on('ui.panes', () => ({ value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', (_$, e) => (w.panes.push(e.id), w.opened.push({ id: e.id, columns: (e as { columns?: number }).columns }), { value: { isPlaced: true as const } }))
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
  test(`${surface}: suggest's name is its switch, green when on and red when off; a click flips it, and its actions show only while it is on`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'suggest-model', 'on')
    const pane = await mount($, surface)
    const pill = async (id: string) => JSON.stringify(await pane.find({ key: `switch:${id}` }))
    expect(await pill('suggest')).toContain('"backgroundColor":"success"')
    expect(await pill('suggest')).toContain('suggest')
    expect(await pill('suggest')).not.toContain('on ●') // no on/off word: the colour says it
    expect(await pane.find({ key: 'option:suggest:/suggest-model' })).toBeDefined()
    await pane.press({ key: 'switch:suggest' })
    expect(await pill('suggest')).toContain('"backgroundColor":"error"')
    expect(await pill('suggest')).toContain('suggest switch, off')
    expect(await pane.find({ key: 'option:suggest:/suggest-model' })).toBeUndefined() // hidden while off
    expect(w.toasts.at(-1)).toBe('suggest-model · off')
    await pane.press({ key: 'switch:suggest' })
    expect(await pill('suggest')).toContain('"backgroundColor":"success"')
  })

  test(`${surface}: reflect and secret-guard are coloured switches too; a click flips each at once`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'reflect', 'on')
    await run($, 'secret-guard', 'on')
    const pane = await mount($, surface)
    const pill = async (id: string) => JSON.stringify(await pane.find({ key: `switch:${id}` }))
    expect(await texts(pane)).toContain('$ reflect')
    expect(await pill('reflect')).toContain('"backgroundColor":"success"')
    expect(await pill('secret-guard')).toContain('"backgroundColor":"success"')
    await pane.press({ key: 'switch:reflect' })
    await pane.press({ key: 'switch:secret-guard' })
    expect(await pill('reflect')).toContain('"backgroundColor":"error"')
    expect(await pill('secret-guard')).toContain('"backgroundColor":"error"')
    expect(w.toasts.at(-1)).toBe('Secret guard · off')
    expect(await pane.find({ key: 'tool:reflect' })).toBeUndefined() // no separate status button: the pill is the status
  })

  test(`${surface}: a one-task tool is just its row and runs at once; the reply goes to a toast and the transcript`, MODS, async ($, on) => {
    const w = world(on)
    const pane = await mount($, surface)
    await pane.press({ key: 'tool:budget-guard' })
    expect(w.toasts.at(-1)).toBe('Moddeck · could not run /budget-guard') // no such command in this test: the failure is said, nothing breaks
    expect(await pane.find({ key: 'option:budget-guard:/budget-guard' })).toBeUndefined() // no repeated indented button
  })

  test(`${surface}: a command that needs your text, or changes something, goes in the prompt box (with its slash) and nothing is sent`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'reflect', 'on')
    const pane = await mount($, surface)
    await pane.press({ key: 'option:checkpoint:/checkpoint restore ' })
    await pane.press({ key: 'option:branch-janitor:/branch-janitor clean' })
    await pane.press({ key: 'option:cache-tax:/keepwarm 90m' })
    await pane.press({ key: 'skill:dual-model-review' })
    expect(w.filled).toEqual(['/checkpoint restore ', '/branch-janitor clean', '/keepwarm 90m', 'Use the dual-model-review skill to review my last change'])
  })
}

test('with suggest-model missing its switch is not drawn, and the other rows still are', MODS_NONE, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'switch:suggest' })).toBeUndefined()
  expect(await pane.find({ key: 'tool:branch-janitor' })).toBeDefined()
})

test('every tool is one row inside its group card, rules separate rows, and there is no separate Options list', MODS, async ($, on) => {
  world(on)
  await run($, 'suggest-model', 'on')
  await run($, 'reflect', 'on')
  await run($, 'secret-guard', 'on')
  await run($, 'blast-radius', 'medium')
  await run($, 'review-cost', 'on')
  for (const c of ['data-guard', 'big-file-guard', 'repro', 'auto-test', 'long-run-ping']) await run($, c, 'on')
  const pane = await mount($, 'desktop')
  for (const id of ['suggest', 'reflect', 'secret-guard', 'data-guard', 'big-file-guard', 'repro-log', 'auto-test', 'long-run-ping', 'checkpoint', 'blast-radius', 'review-cost', 'branch-janitor', 'cache-tax', 'budget-guard', 'savvy-progress', 'filetree', 'replay-theater', 'diagram']) {
    expect(await pane.find({ key: `row:${id}` })).toBeDefined()
  }
  const shown = await texts(pane)
  expect(shown).toContain('Skills')
  expect(shown).not.toContain('Options')
  // two-or-more options sit under their own row; one-task tools have none
  expect(await pane.find({ key: 'option:cache-tax:/keepwarm off' })).toBeDefined()
  expect(await pane.find({ key: 'option:checkpoint:/checkpoint' })).toBeUndefined()
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

test('the skills list has no scroll buttons while all of its skills fit', { ...MODS, options: { skillRows: 5 } }, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'skills:down' })).toBeUndefined()
  expect(await pane.find({ key: 'skill:dual-model-review' })).toBeDefined()
})

test('with more skills than fit, the list has a scroll bar (no arrows); a click on its track moves a page', { options: { skillRows: 2 } }, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  const shown = async () => (await pane.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key).filter((k): k is string => k?.startsWith('skill:') === true)
  expect(await shown()).toEqual(['skill:dual-model-review', 'skill:agents-md-scaffold'])
  expect(await texts(pane)).toContain('Skills · 5')
  expect(await texts(pane)).not.toContain('▼')
  expect(await pane.find({ key: 'skills:bar:0' })).toBeDefined()
  expect(JSON.stringify(await pane.find({ key: 'skills:bar:0' }))).toContain('┃') // the thumb at the top
  await pane.press({ key: 'skills:bar:1' }) // the track below the thumb: a page down
  expect(await shown()).toEqual(['skill:align', 'skill:burst'])
  await pane.press({ key: 'skills:bar:1' }) // on the thumb, in the lower half: down
  await pane.press({ key: 'skills:bar:1' }) // past the end: stays on the last page
  expect(await shown()).toEqual(['skill:burst', 'skill:assess-plugin'])
  await pane.press({ key: 'skills:bar:0' }) // the track above: a page up
  expect(await shown()).toEqual(['skill:agents-md-scaffold', 'skill:align'])
})

test('blast-radius keeps its level dropdown right after its name, and its name is a switch back to the last level', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'blast-radius', 'high')
  const pane = await mount($, 'desktop')
  expect(JSON.stringify(await pane.find({ key: 'level:blast-radius' }))).toContain('high')
  expect(JSON.stringify(await pane.find({ key: 'switch:blast-radius' }))).toContain('"backgroundColor":"success"')
  await pane.select({ key: 'level:blast-radius', value: 'off' } as never)
  expect(w.toasts.at(-1)).toBe('blast-radius · off')
  expect(JSON.stringify(await pane.find({ key: 'switch:blast-radius' }))).toContain('"backgroundColor":"error"')
  await pane.select({ key: 'level:blast-radius', value: 'low' } as never)
  await pane.press({ key: 'switch:blast-radius' }) // on -> off
  expect(w.toasts.at(-1)).toBe('blast-radius · off')
  await pane.press({ key: 'switch:blast-radius' }) // off -> the level it had
  expect(w.toasts.at(-1)).toBe('blast-radius · low')
  expect(JSON.stringify(await pane.find({ key: 'level:blast-radius' }))).toContain('low')
})

test('review-cost has only on and off, so it is a switch, not a dropdown', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'review-cost', 'on')
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'level:review-cost' })).toBeUndefined()
  expect(JSON.stringify(await pane.find({ key: 'switch:review-cost' }))).toContain('"backgroundColor":"success"')
  await pane.press({ key: 'switch:review-cost' })
  expect(w.toasts.at(-1)).toBe('review-cost · off')
  expect(JSON.stringify(await pane.find({ key: 'switch:review-cost' }))).toContain('"backgroundColor":"error"')
})

test('the plugins are grouped in cards, one line per tool: name, its controls, then the description last', MODS, async ($, on) => {
  world(on)
  await run($, 'suggest-model', 'on')
  await run($, 'blast-radius', 'medium')
  const pane = await mount($, 'desktop')
  const shown = await texts(pane)
  const at = ['Moddeck', 'Side Question', 'Prompt helpers', 'Model controls', 'Workspace utilities', 'Skills'].map(h => shown.indexOf(h))
  expect(at.every(i => i !== -1)).toBe(true)
  expect([...at].sort((x, y) => x - y)).toEqual(at) // in the design's order
  const row = await pane.drawn()
  const line = JSON.stringify(row).match(/"key":"row:suggest".*?Checks each prompt against the model/)?.[0] ?? ''
  expect(line.indexOf('switch:suggest')).toBeLessThan(line.indexOf('[explain]')) // name, then actions, then the description
  expect(line).toContain('"wrap":"truncate-end"') // a narrow pane cuts the description with "…"
})

test('a narrow pane gives every card its own line; a wide one sets the short-named cards side by side', MODS, async ($, on) => {
  world(on)
  await run($, 'suggest-model', 'off')
  await run($, 'blast-radius', 'medium')
  const lineOf = async (columns: number) => {
    const pane = await $.ui.mount({ plugin: 'moddeck', surface: 'desktop', component: 'Pane', requestId: 'moddeck', props: { ...PANE_PROPS, bodyColumns: columns }, viewport: FULLSCREEN } as never)
    const tree = JSON.stringify(await pane.drawn())
    await pane.unmount()
    return (g: string) => tree.match(new RegExp(`"key":"cards:(\\d+)"((?!"key":"cards:).)*"key":"group:${g}"`))?.[1]
  }
  const narrow = await lineOf(40)
  expect(narrow('Prompt helpers')).not.toBe(narrow('Model controls'))
  const wide = await lineOf(120)
  expect(wide('Prompt helpers')).toBe(wide('Model controls'))
})

test('the expand button reopens the pane wider, and again at its usual width', MODS, async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'expand' })).toBeDefined()
  await pane.press({ key: 'expand' })
  expect(w.opened.at(-1)).toMatchObject({ columns: 96 })
  await pane.press({ key: 'expand' })
  expect(w.opened.at(-1)).toMatchObject({ columns: 40 })
})

test('the new switches are coloured and a click runs the mod\'s own on/off', MODS, async ($, on) => {
  const w = world(on)
  for (const c of ['data-guard', 'big-file-guard', 'repro', 'auto-test', 'long-run-ping']) await run($, c, 'on')
  const pane = await mount($, 'desktop')
  await pane.press({ key: 'switch:data-guard' })
  expect(w.toasts.at(-1)).toBe('data-guard · off')
  expect(JSON.stringify(await pane.find({ key: 'switch:data-guard' }))).toContain('"backgroundColor":"error"')
  await pane.press({ key: 'switch:repro-log' })
  expect(w.toasts.at(-1)).toBe('repro-log · off')
})

test('saved prompts from prompt-library are listed, and a click puts the text in the prompt box', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'prompts', '')
  const pane = await mount($, 'desktop')
  await pane.press({ key: 'prompt:tests' })
  expect(w.filled.at(-1)).toBe('Write tests for my last change')
  expect(await texts(pane)).toContain('Prompts')
})

test('without prompt-library there is no Prompts section', MODS_NONE, async ($, on) => {
  world(on)
  expect(await texts(await mount($, 'desktop'))).not.toContain('Prompts')
})
