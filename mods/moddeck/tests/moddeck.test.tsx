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

/** A switch's drawing: the terminal colours the Text in its Button, the desktop the box around the name. */
const switchOf = async (pane: { find: (q: { key: string }) => Promise<unknown> }, surface: string, id: string) =>
  JSON.stringify(await pane.find({ key: surface === 'desktop' ? `pill:${id}` : `switch:${id}` }))

/** The pill fill a surface draws: the app's "Deep solid" colours, the terminal's theme keys. */
const ON = (surface: string) => `"backgroundColor":"${surface === 'desktop' ? '#166534' : 'success'}"`
const OFF = (surface: string) => `"backgroundColor":"${surface === 'desktop' ? '#991B1B' : 'error'}"`

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

for (const surface of SURFACES) {
  test(`${surface}: suggest's name is its switch, green when on and red when off; a click flips it, and its actions show only while it is on`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'suggest-model', 'on')
    const pane = await mount($, surface)
    const pill = (id: string) => switchOf(pane, surface, id)
    expect(await pill('suggest')).toContain(ON(surface))
    expect(await pill('suggest')).toContain('suggest')
    expect(await pill('suggest')).not.toContain('on ●') // no on/off word: the colour says it
    expect(await pane.find({ key: 'option:suggest:/suggest-model' })).toBeDefined()
    await pane.press({ key: 'switch:suggest' })
    expect(await pill('suggest')).toContain(OFF(surface))
    expect(await pill('suggest')).toContain('suggest')
    expect(await pane.find({ key: 'option:suggest:/suggest-model' })).toBeUndefined() // hidden while off
    expect(w.toasts.at(-1)).toBe('suggest-model · off')
    await pane.press({ key: 'switch:suggest' })
    expect(await pill('suggest')).toContain(ON(surface))
  })

  test(`${surface}: reflect and secret-guard are coloured switches too; a click flips each at once`, MODS, async ($, on) => {
    const w = world(on)
    await run($, 'reflect', 'on')
    await run($, 'secret-guard', 'on')
    const pane = await mount($, surface)
    const pill = (id: string) => switchOf(pane, surface, id)
    expect(await texts(pane)).toContain('$ reflect')
    expect(await pill('reflect')).toContain(ON(surface))
    expect(await pill('secret-guard')).toContain(ON(surface))
    await pane.press({ key: 'switch:reflect' })
    await pane.press({ key: 'switch:secret-guard' })
    expect(await pill('reflect')).toContain(OFF(surface))
    expect(await pill('secret-guard')).toContain(OFF(surface))
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

test('the skills list has no scroll buttons while all of its skills fit', { ...MODS, options: { skillRows: 6 } }, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(await pane.find({ key: 'skills:down' })).toBeUndefined() // everything fits: no bar, no arrows
  expect(await pane.find({ key: 'skill:dual-model-review' })).toBeDefined()
})

test('with more skills than fit, the list has a scroll bar with ▲ and ▼ (a line each); a click on its track moves a page', async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  const shown = async () => (await pane.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key).filter((k): k is string => k?.startsWith('skill:') === true)
  expect(await shown()).toEqual(['skill:dual-model-review', 'skill:agents-md-scaffold', 'skill:align', 'skill:burst', 'skill:assess-plugin'])
  expect(await texts(pane)).toContain('Skills · 6')
  expect(JSON.stringify(await pane.find({ key: 'skills:up' }))).toContain('▲')
  expect(JSON.stringify(await pane.find({ key: 'skills:down' }))).toContain('▼')
  expect(JSON.stringify(await pane.find({ key: 'skills:bar:0' }))).toContain('┃') // the thumb at the top
  await pane.press({ key: 'skills:down' }) // ▼: one line down
  expect((await shown())[0]).toBe('skill:agents-md-scaffold')
  await pane.press({ key: 'skills:down' }) // already at the end: stays
  expect((await shown()).at(-1)).toBe('skill:no-ai-text')
  await pane.press({ key: 'skills:up' }) // ▲: one line up
  expect((await shown())[0]).toBe('skill:dual-model-review')
  await pane.press({ key: 'skills:bar:2' }) // the track below the thumb: a page down, clamped to the last page
  expect((await shown()).at(-1)).toBe('skill:no-ai-text')
})

test('more and fewer change how many lines the Skills list shows, never below five, and the choice is kept in the store', async ($, on) => {
  world(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  const pane = await mount($, 'desktop')
  const shown = async () => (await pane.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key).filter((k): k is string => k?.startsWith('skill:') === true)
  expect((await shown()).length).toBe(5)
  expect(await pane.find({ key: 'skills:fewer' })).toBeUndefined() // five is the floor
  await pane.press({ key: 'skills:more' })
  expect((await shown()).length).toBe(6)
  expect(store.get('listRows')).toEqual({ skills: 6 })
  expect(await pane.find({ key: 'skills:more' })).toBeUndefined() // all six show
  await pane.press({ key: 'skills:fewer' })
  expect((await shown()).length).toBe(5)
})

test('a star moves a skill to the top; the list still shows five and scrolls; a second click takes it off', async ($, on) => {
  world(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  const pane = await mount($, 'desktop')
  const shown = async () => (await pane.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key).filter((k): k is string => k?.startsWith('skill:') === true)
  await pane.press({ key: 'skills:down' }) // scroll to reach no-ai-text
  await pane.press({ key: 'star:no-ai-text' })
  await pane.press({ key: 'skills:up' })
  expect((await shown())[0]).toBe('skill:no-ai-text')
  expect((await shown()).length).toBe(5)
  expect(await pane.find({ key: 'skills:bar:0' })).toBeDefined()
  expect(JSON.stringify(await pane.find({ key: 'star:no-ai-text' }))).toContain('★')
  expect(store.get('starred')).toEqual(['no-ai-text'])
  await pane.press({ key: 'star:no-ai-text' })
  expect((await shown())[0]).toBe('skill:dual-model-review')
})

test('a group with more than 8 tools shows 8, scrolls with ▲ ▼, and a starred tool moves to the top', async ($, on) => {
  world(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  const pane = await mount($, 'desktop')
  const rowsOf = async () => (await pane.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key).filter((k): k is string => k?.startsWith('star:tool:') === true)
  const first = await rowsOf()
  expect(first.length).toBe(8)
  expect(await pane.find({ key: 'group:Guards:up' })).toBeUndefined() // a small group: no stars, no arrows
  await pane.press({ key: 'group:Workspace utilities:down' })
  expect((await rowsOf())[0]).toBe(first[1])
  await pane.press({ key: 'group:Workspace utilities:up' })
  const last = first.at(-1)!
  await pane.press({ key: last })
  expect((await rowsOf())[0]).toBe(last)
  expect((await rowsOf()).length).toBe(5) // one star: the floor of five lines
  expect(store.get('starred')).toEqual([last.slice('star:'.length)])
})

test('typing in the Skills search moves the matches to the top; Enter puts the first in the prompt box and clears the field', async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'desktop')
  const shown = async () => (await pane.findAll({ type: 'Button' })).map(b => (b as { key?: string }).key).filter((k): k is string => k?.startsWith('skill:') === true)
  expect(JSON.stringify(await pane.find({ key: 'skills:search' }))).toContain('Search skills')
  await pane.input({ key: 'skills:search', text: 'no', kind: 'change' })
  expect((await shown())[0]).toBe('skill:no-ai-text')
  expect(await texts(pane)).toContain('Skills · 1 found')
  await pane.input({ key: 'skills:search', text: 'zz', kind: 'change' })
  expect(await texts(pane)).toContain('Skills · no match')
  await pane.input({ key: 'skills:search', text: 'bu', kind: 'change' })
  await pane.input({ key: 'skills:search', text: 'bu', kind: 'submit' })
  expect(w.filled.at(-1)).toContain('burst skill')
  expect(JSON.stringify(await pane.find({ key: 'skills:search' }))).toContain('"value":""')
})

test('▾ folds a card down to its title (with its count), ▸ opens it again, and the choice is kept', async ($, on) => {
  world(on)
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  const pane = await mount($, 'desktop')
  expect(JSON.stringify(await pane.find({ key: 'fold:group:Workspace utilities' }))).toContain('▾')
  expect(await pane.find({ key: 'group:Workspace utilities:down' })).toBeDefined()
  await pane.press({ key: 'fold:group:Workspace utilities' })
  expect(await pane.find({ key: 'group:Workspace utilities:down' })).toBeUndefined() // the box is gone
  expect(await texts(pane)).toContain('Workspace utilities · 11')
  expect(JSON.stringify(await pane.find({ key: 'fold:group:Workspace utilities' }))).toContain('▸')
  expect(store.get('folded')).toEqual(['group:Workspace utilities'])
  await pane.press({ key: 'fold:group:Guards' })
  expect(await texts(pane)).toMatch(/Guards · \d/) // a small group shows its count once folded
  await pane.press({ key: 'fold:group:Workspace utilities' })
  expect(await pane.find({ key: 'group:Workspace utilities:down' })).toBeDefined()
  await pane.press({ key: 'title:group:Workspace utilities' }) // the name folds it too
  expect(await pane.find({ key: 'group:Workspace utilities:down' })).toBeUndefined()
  await pane.press({ key: 'title:group:Workspace utilities' })
  expect(await pane.find({ key: 'group:Workspace utilities:down' })).toBeDefined()
})

test('advisor: a dropdown and a red/green name like blast-radius; a pick or a click puts /advisor in the prompt box', async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'desktop')
  expect(JSON.stringify(await pane.find({ key: 'level:advisor' }))).toContain('"value":"off"')
  expect(await switchOf(pane, 'desktop', 'advisor')).toContain(OFF('desktop'))
  await pane.select({ key: 'level:advisor', value: 'fable' } as never)
  expect(w.filled.at(-1)).toBe('/advisor fable') // Claude Code's own command: a mod cannot run it
  await pane.press({ key: 'switch:advisor' }) // off -> the first model
  expect(w.filled.at(-1)).toBe('/advisor opus')
})

test('advisor kept off by DISABLE_TELEMETRY: picking a model explains why and offers to ask Claude for the fix', async ($, on) => {
  const w = world(on)
  const asked: string[] = []
  on('env.get', (_$, e) => ({ value: (e as { name: string }).name === 'DISABLE_TELEMETRY' ? '1' : undefined }) as never)
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const q = e.questions[0]!
    asked.push(q.question)
    return { result: { questions: e.questions, answers: { [q.question]: 'Ask Claude to fix it' } } } as never
  })
  const pane = await mount($, 'desktop')
  expect(await texts(pane)).toContain('Kept off by DISABLE_TELEMETRY=1')
  await pane.select({ key: 'level:advisor', value: 'opus' } as never)
  expect(asked[0]).toContain('DISABLE_TELEMETRY=1')
  expect(w.filled.at(-1)).toContain('Remove DISABLE_TELEMETRY from the env block of ~/.claude/settings.json')
  expect(w.filled).not.toContain('/advisor opus') // nothing to run until the variable is gone
})

test('blast-radius keeps its level dropdown right after its name, and its name is a switch back to the last level', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'blast-radius', 'high')
  const pane = await mount($, 'desktop')
  expect(JSON.stringify(await pane.find({ key: 'level:blast-radius' }))).toContain('high')
  expect(await switchOf(pane, 'desktop', 'blast-radius')).toContain(ON('desktop'))
  await pane.select({ key: 'level:blast-radius', value: 'off' } as never)
  expect(w.toasts.at(-1)).toBe('blast-radius · off')
  expect(await switchOf(pane, 'desktop', 'blast-radius')).toContain(OFF('desktop'))
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
  expect(await switchOf(pane, 'desktop', 'review-cost')).toContain(ON('desktop'))
  await pane.press({ key: 'switch:review-cost' })
  expect(w.toasts.at(-1)).toBe('review-cost · off')
  expect(await switchOf(pane, 'desktop', 'review-cost')).toContain(OFF('desktop'))
})

test('the plugins are grouped in cards, one line per tool: name, its controls, then the description last', MODS, async ($, on) => {
  world(on)
  await run($, 'suggest-model', 'on')
  await run($, 'blast-radius', 'medium')
  const pane = await mount($, 'desktop')
  const shown = await texts(pane)
  const at = ['Side Question', 'Prompt helpers', 'Model controls', 'Workspace utilities', 'Skills'].map(h => shown.indexOf(h))
  expect(at.every(i => i !== -1)).toBe(true)
  expect([...at].sort((x, y) => x - y)).toEqual(at) // in the design's order
  const row = await pane.drawn()
  const line = JSON.stringify(row).match(/"key":"row:suggest".*?Checks each prompt against the model/)?.[0] ?? ''
  expect(line.indexOf('switch:suggest')).toBeLessThan(line.indexOf('[explain]')) // name, then actions, then the description
  expect(line).toContain('"wrap":"truncate-end"') // a narrow pane cuts the description with "…"
})

test('the cards stand in one column, however wide the pane', MODS, async ($, on) => {
  world(on)
  await run($, 'suggest-model', 'off')
  await run($, 'blast-radius', 'medium')
  for (const columns of [40, 120]) {
    const pane = await $.ui.mount({ plugin: 'moddeck', surface: 'desktop', component: 'Pane', requestId: 'moddeck', props: { ...PANE_PROPS, bodyColumns: columns }, viewport: FULLSCREEN } as never)
    const tree = JSON.stringify(await pane.drawn())
    await pane.unmount()
    expect(tree).not.toContain('"key":"cards:') // no line of cards side by side
    expect(tree).toContain('"key":"group:Prompt helpers"')
    expect(tree).toContain('"key":"group:Model controls"')
  }
})

test('the expand button reopens the pane wider, and again at its usual width', MODS, async ($, on) => {
  const w = world(on)
  const pane = await mount($, 'terminal')
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
  expect(await switchOf(pane, 'desktop', 'data-guard')).toContain(OFF('desktop'))
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

test('a reply shows its first line as a toast and adds no moddeck note to the transcript (the engine prints the reply already)', MODS, async ($, on) => {
  const w = world(on)
  await run($, 'suggest-model', 'on')
  const pane = await mount($, 'terminal')
  await pane.press({ key: 'option:suggest:/suggest-model' })
  expect(w.toasts.at(-1)).toBe('suggest-model · on · Sonnet')
  expect(w.logs).toEqual([])
})

test('desktop: no button carries a label (the app would draw it instead of the name), the switch colour is the box around the name, and every box may shrink and clips its text', MODS, async ($, on) => {
  world(on)
  for (const c of ['suggest-model', 'reflect', 'secret-guard', 'data-guard', 'big-file-guard', 'repro', 'auto-test', 'long-run-ping', 'review-cost']) await run($, c, 'on')
  await run($, 'blast-radius', 'low')
  await run($, 'prompts', '')
  const pane = await mount($, 'desktop')
  const tree = JSON.stringify(await pane.drawn())
  expect(tree).not.toContain('switch, ')
  expect(tree).not.toContain('Expand the panel')
  // a Button's label is its own text: the engine fills it in from the children, nothing else
  expect(JSON.stringify(await pane.find({ key: 'switch:suggest' }))).toMatch(/"label":" ?suggest *"/)
  expect(await pane.find({ key: 'expand' })).toBeUndefined() // the app's own frame has expand and close
  expect(await switchOf(pane, 'desktop', 'suggest')).toContain(ON('desktop'))
  expect(await switchOf(pane, 'desktop', 'checkpoint')).toContain('"backgroundColor":"#374151"') // a command: a gray pill
  expect(JSON.stringify(await pane.find({ key: 'pill:suggest' }))).not.toContain('padding') // the whole coloured area is the button
  for (const key of ['row:suggest', 'row:blast-radius', 'group:Prompt helpers', 'session', 'btw']) {
    const box = await pane.find({ key })
    if (box) expect(JSON.stringify((box as { props?: unknown }).props)).toContain('"minWidth":0')
  }
  expect(tree.match(/"width":\d/g)).toBeNull() // a card's width is never a count of cells
})

test('desktop: the boxes are filled in the dark colours by default, the light ones after /moddeck theme light; skill names start with "/"', MODS, async ($, on) => {
  world(on)
  on('config.list', () => ({ value: [{ key: 'theme', value: 'light' }] as never })) // /config's theme is not read: the app's may differ
  const boxOf = async (pane: { find: (q: { key: string }) => Promise<unknown> }) => JSON.stringify(await pane.find({ key: 'group:Workspace utilities' }))
  let pane = await mount($, 'desktop')
  expect(await boxOf(pane)).toContain('"backgroundColor":"#1F1F1E"')
  expect(await boxOf(pane)).toContain('"color":"#9A9893"') // the descriptions
  expect(await texts(pane)).toContain('/dual-model-review')
  await pane.unmount()
  await run($, 'moddeck', 'theme light')
  pane = await mount($, 'desktop')
  expect(await boxOf(pane)).toContain('"backgroundColor":"#FAF9F5"')
  await pane.unmount()
  pane = await mount($, 'terminal')
  expect(await boxOf(pane)).not.toContain('#1F1F1E') // the terminal keeps its theme
  expect(await texts(pane)).not.toContain('/dual-model-review')
})

test('terminal: rows keep the plain tree (no minWidth or overflow props), the switch colour is on its text, and the top bar is drawn', MODS, async ($, on) => {
  world(on)
  await run($, 'suggest-model', 'on')
  const pane = await mount($, 'terminal')
  const tree = JSON.stringify(await pane.drawn())
  expect(tree).not.toContain('minWidth')
  expect(tree).not.toContain('overflow')
  expect(await switchOf(pane, 'terminal', 'suggest')).toContain('"backgroundColor":"success"')
  expect(await pane.find({ key: 'expand' })).toBeDefined()
})

test('desktop: /moddeck theme light gives the light fill and pale pills (the app draws button text dark there); dark changes it back, whatever /config says', MODS, async ($, on) => {
  world(on)
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] as never })) // the app can be light while /config says dark
  await run($, 'suggest-model', 'on')
  const look = async () => {
    const pane = await mount($, 'desktop')
    const out = { box: JSON.stringify(await pane.find({ key: 'group:Workspace utilities' })), pill: await switchOf(pane, 'desktop', 'suggest') }
    await pane.unmount()
    return out
  }
  expect((await look()).box).toContain('"backgroundColor":"#1F1F1E"')
  expect(await run($, 'moddeck', 'theme light')).toMatchObject({ text: 'Moddeck · theme light' })
  const light = await look()
  expect(light.box).toContain('"backgroundColor":"#FAF9F5"')
  expect(light.pill).toContain('"backgroundColor":"#BBF7D0"')
  expect(await run($, 'moddeck', 'theme dark')).toMatchObject({ text: 'Moddeck · theme dark' })
  expect((await look()).box).toContain('"backgroundColor":"#1F1F1E"')
  expect(((await run($, 'moddeck', 'theme pink')) as { text: string }).text).toContain('light or dark')
})

test('desktop: the appTheme setting picks the light colours without a command', { ...MODS, options: { appTheme: 'light' } }, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  expect(JSON.stringify(await pane.find({ key: 'group:Workspace utilities' }))).toContain('"backgroundColor":"#FAF9F5"')
  expect(await switchOf(pane, 'desktop', 'checkpoint')).toContain('"backgroundColor":"#E5E7EB"')
})

test('desktop: the sun and the moon at the top switch the colours, the one in use at full strength; the terminal has neither', MODS, async ($, on) => {
  world(on)
  const pane = await mount($, 'desktop')
  const box = async () => JSON.stringify(await pane.find({ key: 'group:Workspace utilities' }))
  expect(JSON.stringify(await pane.find({ key: 'theme:light' }))).toContain('"dimColor":true')
  expect(JSON.stringify(await pane.find({ key: 'theme:dark' }))).not.toContain('"dimColor":true')
  await pane.press({ key: 'theme:light' })
  expect(await box()).toContain('"backgroundColor":"#FAF9F5"')
  expect(JSON.stringify(await pane.find({ key: 'theme:light' }))).not.toContain('"dimColor":true')
  await pane.press({ key: 'theme:dark' })
  expect(await box()).toContain('"backgroundColor":"#1F1F1E"')
  await pane.unmount()
  const term = await mount($, 'terminal')
  expect(await term.find({ key: 'theme:light' })).toBeUndefined()
})
