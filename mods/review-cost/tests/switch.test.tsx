import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { world } from './world'

const PUSH = 'git push origin main'
const KEY = 'review-cost.isOff'

/** The scripted world plus a store and the session/command plumbing the switch needs. */
function switchWorld(on: On, store = new Map<string, unknown>()) {
  const w = world(on)
  const registered: string[] = []
  // the host's named values, as $.state.get({ plugin: 'review-cost', key: 'isOff' }) would see them
  const state = new Map<string, { value: unknown; version: number }>()
  on('state.get', (_$, e) => ({ value: state.get(`${e.plugin}.${e.key}`) ?? { value: undefined, version: 0 } }))
  on('state.set', (_$, e) => {
    const version = (state.get(`${e.plugin}.${e.key}`)?.version ?? 0) + 1
    state.set(`${e.plugin}.${e.key}`, { value: e.value, version })
    return { value: { isSet: true as const, version } }
  })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (store.delete(e.key), { value: undefined }))
  on('command.register', (_$, e) => (registered.push(e.name), { value: undefined as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return { w, store, registered, mirror: () => state.get(KEY)?.value }
}

const slash = ($: Engine, args: string) =>
  $.command.run({ command: 'review-cost', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
const start = ($: Engine) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)

test('session start registers /review-cost once', async ($, on) => {
  const { registered } = switchWorld(on)
  await start($)
  expect(registered).toEqual(['review-cost'])
})

test('no argument says whether it is on or off; the atom defaults to false', async ($, on) => {
  const { mirror } = switchWorld(on)
  await start($)
  expect((await slash($, '')).text).toBe('Review cost · on')
  expect(mirror()).toBe(false)
  await slash($, 'off')
  expect((await slash($, '')).text).toBe('Review cost · off')
})

test('off and on persist in $.store and mirror into the atom', async ($, on) => {
  const { store, mirror } = switchWorld(on)
  await start($)
  expect((await slash($, 'off')).text).toContain('Review cost · off')
  expect(store.get('off')).toBe(true)
  expect(mirror()).toBe(true)
  expect((await slash($, 'on')).text).toBe('Review cost · on')
  expect(store.has('off')).toBe(false)
  expect(mirror()).toBe(false)
})

test('an unknown word says so and changes nothing', async ($, on) => {
  const { store, mirror } = switchWorld(on)
  await start($)
  const r = await slash($, 'maybe')
  expect(r.text).toContain('unknown word "maybe"')
  expect(store.has('off')).toBe(false)
  expect(mirror()).toBe(false)
})

test('a stored off is loaded into the atom at session start', async ($, on) => {
  const { mirror } = switchWorld(on, new Map([['off', true]]))
  await start($)
  expect(mirror()).toBe(true)
  expect((await slash($, '')).text).toBe('Review cost · off')
})

test('while off, a push goes straight through: nothing is estimated, asked, toasted or recorded', async ($, on) => {
  const { w } = switchWorld(on)
  await start($)
  await slash($, 'off')
  const r = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual([PUSH])
  expect(w.runs).toHaveLength(0)
  expect(w.asks).toHaveLength(0)
  expect(w.toasts).toHaveLength(0)
  expect(w.decisions).toHaveLength(0)
})

test('turned back on, the push is estimated again', async ($, on) => {
  const { w } = switchWorld(on)
  await start($)
  await slash($, 'off')
  await slash($, 'on')
  await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(w.asks).toHaveLength(1)
})
