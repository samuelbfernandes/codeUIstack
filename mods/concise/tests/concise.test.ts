import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { OFF_NOTE, REMINDER, RULES, isStopPhrase } from '../hooks/rules'

const KEY = 'concise.isOff'

/** A store, the host's named values (what the moddeck side bar reads) and a prompt that echoes its context. */
function world(on: On, store = new Map<string, unknown>()) {
  const registered: string[] = []
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
  on('prompt.submit', (_$, e) => ({ text: e.text, context: e.context }))
  on('session.compact', () => ({ messages: [{ role: 'user', text: 'summary', toolUses: [] }] }) as never)
  return { store, registered, mirror: () => state.get(KEY)?.value }
}

const start = ($: Engine) => $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
const slash = ($: Engine, args: string) =>
  $.command.run({ command: 'concise', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
const say = async ($: Engine, text: string) =>
  ((await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)) as { context?: string[] }).context ?? []

test('session start registers /concise once; it ships off and adds nothing to a prompt', async ($, on) => {
  const { registered, mirror } = world(on)
  await start($)
  expect(registered).toEqual(['concise'])
  expect(mirror()).toBe(true)
  expect((await slash($, '')).text).toBe('concise · off')
  expect(await say($, 'fix the login bug')).toEqual([])
})

test('on: the first prompt carries the full rules, later ones one reminder line', async ($, on) => {
  const { store, mirror } = world(on)
  await start($)
  expect((await slash($, 'on')).text).toContain('concise · on')
  expect(store.get('on')).toBe(true)
  expect(mirror()).toBe(false)
  expect(await say($, 'first')).toEqual([RULES])
  expect(await say($, 'second')).toEqual([REMINDER])
  expect(RULES).toContain('## Rules')
  expect(RULES).toContain('Bearer ${token}')
})

test('switching on again, a new session and a compaction each send the full rules again', async ($, on) => {
  world(on)
  await start($)
  await slash($, 'on')
  await say($, 'a')
  await slash($, 'on')
  expect(await say($, 'b')).toEqual([RULES])
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect(await say($, 'c')).toEqual([RULES])
  await start($)
  expect(await say($, 'd')).toEqual([RULES])
})

test('"stop concise mode" or "normal mode" switches it off and says so once', async ($, on) => {
  const { store, mirror } = world(on)
  await start($)
  await slash($, 'on')
  expect(await say($, 'Normal mode.')).toEqual([OFF_NOTE])
  expect(store.has('on')).toBe(false)
  expect(mirror()).toBe(true)
  expect(await say($, 'normal mode')).toEqual([])
})

test('a stored on is loaded at session start; off and an unknown word behave', async ($, on) => {
  const { store, mirror } = world(on, new Map([['on', true]]))
  await start($)
  expect(mirror()).toBe(false)
  expect((await slash($, 'maybe')).text).toContain('unknown word "maybe"')
  expect(store.get('on')).toBe(true)
  expect((await slash($, 'off')).text).toBe('concise · off')
  expect(await say($, 'hello')).toEqual([])
})

test('stop phrases match the whole prompt only', () => {
  expect(isStopPhrase('  Stop   Concise mode! ')).toBe(true)
  expect(isStopPhrase('stop concise mode')).toBe(true)
  expect(isStopPhrase('is normal mode better here?')).toBe(false)
  expect(isStopPhrase(undefined)).toBe(false)
})
