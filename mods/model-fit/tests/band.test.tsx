import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} }

/** The engine beneath the mod: a store, status/toast sinks, an empty band of its own. */
function world(on: On) {
  const w = { toasts: [] as string[], statuses: [] as (string | undefined)[], store: new Map<string, unknown>() }
  mock.clock(on)
  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => (w.store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (w.store.delete(e.key), { value: undefined }))
  on('session.model', () => ({ value: 'claude-sonnet-4-5' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.toast', (_$, e) => (w.toasts.push(e.text), { value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.status', (_$, e) => (w.statuses.push(e.text), { value: undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  return w
}

const mount = ($: Engine, surface: (typeof SURFACES)[number], props: object = BAND) =>
  $.ui.mount({ plugin: 'model-fit', surface, component: 'AbovePrompt', props } as never)

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')

const word = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

for (const surface of SURFACES) {
  test(`${surface}: the band shows ON and a Turn off button`, async ($, on) => {
    world(on)
    const band = await mount($, surface)
    expect(await texts(band)).toContain('model-fit on')
    expect(await band.find({ key: 'toggle' })).toBeDefined()
  })

  test(`${surface}: pressing the button turns model-fit off, clears the status, persists, and flips back`, async ($, on) => {
    const w = world(on)
    const band = await mount($, surface)
    await band.press({ key: 'toggle' })
    expect(w.store.get('off')).toBe(true)
    expect(w.statuses.at(-1)).toContain('model-fit: off')
    expect(w.toasts.at(-1)).toContain('model-fit · off')
    expect(await texts(band)).toContain('model-fit off')
    await band.press({ key: 'toggle' })
    expect(w.store.has('off')).toBe(false)
    expect(w.statuses.at(-1)).toBeUndefined()
    expect(await texts(band)).toContain('model-fit on')
    expect(w.toasts.at(-1)).toContain('model-fit · on')
  })

  test(`${surface}: the plain words and the button are one switch`, async ($, on) => {
    const w = world(on)
    const band = await mount($, surface)
    await word($, 'model-fit off')
    expect(await texts(band)).toContain('model-fit off')
    await word($, 'model-fit on')
    expect(await texts(band)).toContain('model-fit on')
    await band.press({ key: 'toggle' })
    expect(w.store.get('off')).toBe(true)
    // while off, a mismatch is not even checked
    const out = await word($, 'derive the BLUP variance of the genomic breeding value under REML')
    expect(out.text).toContain('BLUP')
  })

  test(`${surface}: a switch left off in an earlier session shows OFF at once`, async ($, on) => {
    const w = world(on)
    w.store.set('off', true)
    await $.session.start({ cwd: '/work' } as never)
    const band = await mount($, surface)
    expect(await texts(band)).toContain('model-fit off')
    expect(w.statuses.at(-1)).toContain('model-fit: off')
  })

  test(`${surface}: the band yields to a survey`, async ($, on) => {
    world(on)
    const band = await mount($, surface, { ...BAND, hasSurvey: true })
    expect(await band.find({ key: 'toggle' })).toBeUndefined()
  })
}

test('surfaces that do not raise the band get nothing from the mod', async ($, on) => {
  world(on)
  const band = await $.ui.mount({ plugin: 'model-fit', surface: 'mobile', component: 'AbovePrompt', props: BAND } as never)
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
})

test('showButton = false: no button', { options: { showButton: false } }, async ($, on) => {
  world(on)
  const band = await mount($, 'terminal')
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
})

test('enabled = false in the settings: no button either', { options: { enabled: false } }, async ($, on) => {
  world(on)
  const band = await mount($, 'terminal')
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
})

test('the chip is green when on and red when off, and sits outside the button', async ($, on) => {
  world(on)
  const band = await mount($, 'desktop')
  const chip = async () => (await band.findAll({ type: 'Text' })).find(t => t.text.includes('model-fit'))
  const before = await chip()
  expect(JSON.stringify(before)).toContain('success')
  await word($, 'model-fit off')
  expect(JSON.stringify(await chip())).toContain('error')
  const button = (await band.findAll({ type: 'Button' }))[0]
  expect(JSON.stringify(button)).toContain('Turn on')
})

for (const surface of SURFACES) {
  test(`${surface}: another mod's band below it stays visible (the chip is stacked on top, never instead)`, async ($, on) => {
    world(on)
    const band = await mount($, surface)
    expect(await band.find({ key: 'toggle' })).toBeDefined()
    expect(await band.find({ key: 'engine-band' })).toBeDefined()
  })
}
