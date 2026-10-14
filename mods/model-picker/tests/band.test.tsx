import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

/** The engine beneath the mod: a store and status/toast sinks. The on/off switch is drawn by the moddeck side bar,
 *  which reads this mod's `isOff` state; this mod draws nothing above the prompt. */
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
  return w
}

const word = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)
const command = ($: Engine, args: string) =>
  $.command.run({ command: 'model-picker', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } } as never)

test('the switch: /model-picker on|off flips one persisted flag, and off clears the status line', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  await command($, 'off')
  expect(w.store.get('off')).toBe(true)
  expect(w.statuses.at(-1)).toContain('model-picker: off')
  await command($, 'on')
  expect(w.store.has('off')).toBe(false)
  expect(w.statuses.at(-1)).toBeUndefined()
})

test('while off, a mismatch is not even checked', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  w.store.set('off', true)
  const out = await word($, 'derive the BLUP variance of the genomic breeding value under REML')
  expect(out.text).toContain('BLUP')
})

test('a switch left off in an earlier session shows OFF at once', { options: { autoRoute: false } }, async ($, on) => {
  const w = world(on)
  w.store.set('off', true)
  await $.session.start({ cwd: '/work' } as never)
  expect(w.statuses.at(-1)).toContain('model-picker: off')
})

test('nothing is drawn above the prompt any more', { options: { autoRoute: false } }, async ($, on) => {
  world(on)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  const band = await $.ui.mount({
    plugin: 'model-picker',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as never)
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
})
