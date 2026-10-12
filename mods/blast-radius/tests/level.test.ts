import { test, expect } from 'claude-code/testing'

import { asLevel } from '../hooks/config'
import { buildDir, world } from './world'

const slash = ($: any, args: string) =>
  $.command.run({ command: 'blast-radius', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const ATOM = 'blast-radius.level'

test('no argument: reports the level in force and what each level means', async ($, on) => {
  world(on)
  const out = await slash($, '')
  expect(out.text).toContain('medium')
  for (const l of ['off', 'low', 'medium', 'high']) expect(out.text).toContain(`${l} = `)
})

test('a level is set, persisted in the store and mirrored into the atom', async ($, on) => {
  const w = world(on)
  const out = await slash($, 'HIGH')
  expect(out.text).toContain('high')
  expect(w.store.get('level')).toBe('high')
  expect(w.state.get(ATOM)).toBe('high')
  expect((await slash($, '')).text).toContain('high (ask only for high risk)')
})

test('an unknown word is said so and changes nothing', async ($, on) => {
  const w = world(on, { store: { level: 'low' } })
  const out = await slash($, 'loud')
  expect(out.text).toContain('not a level')
  expect(w.store.get('level')).toBe('low')
  expect(w.state.has(ATOM)).toBe(false)
})

test('session.start registers the command and loads the stored level into the atom', async ($, on) => {
  const registered: string[] = []
  const w = world(on, { store: { level: 'off' } })
  on('command.register', (_$, e) => (registered.push(e.name), { value: undefined as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  expect(registered).toEqual(['blast-radius'])
  expect(w.state.get(ATOM)).toBe('off')
})

test('session.start with nothing stored mirrors the askFrom default', async ($, on) => {
  const w = world(on)
  on('command.register', () => ({ value: undefined as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  expect(w.state.get(ATOM)).toBe('medium')
})

test('off: a destructive command runs with no question and no probe', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: buildDir, store: { level: 'off' } })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.ran).toEqual(['rm -rf build'])
  expect(w.asks).toHaveLength(0)
  expect(w.probes).toHaveLength(0)
  expect(r.deny).toBeUndefined()
})

test('switching off then back on at runtime takes effect on the next call', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: buildDir })
  await slash($, 'off')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks).toHaveLength(0)
  await slash($, 'medium')
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks).toHaveLength(1)
  expect(r.deny).toBeDefined()
})

test('the runtime level overrides the askFrom setting, and the setting rules again when nothing is stored', { options: { askFrom: 'high' } }, async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: buildDir })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks).toHaveLength(1) // askFrom high still asks about an unknown-risk command
  w.store.set('level', 'off')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks).toHaveLength(1) // the stored level wins: no new question
  w.store.set('level', 'low')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks).toHaveLength(2)
  w.store.delete('level')
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks).toHaveLength(3)
})

test('asLevel accepts the four words, any case, and nothing else', () => {
  expect(asLevel('High ')).toBe('high')
  expect(asLevel('off')).toBe('off')
  expect(asLevel('x')).toBeUndefined()
  expect(asLevel(3)).toBeUndefined()
})
