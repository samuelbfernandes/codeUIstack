import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

/** Everything beneath the plugin: store, clock, and a record of toasts, sounds and notifications. */
function world(on: On, hold: { bashMs: number } = { bashMs: 0 }) {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (store.delete(e.key), { value: undefined }))
  const w = {
    store,
    clock: mock.clock(on, { now: 1_000_000 }),
    toasts: [] as string[],
    sounds: [] as string[],
    notes: [] as string[],
    registered: [] as string[],
    failSound: false,
    failToast: false,
    hold,
  }
  on('ui.toast', (_$, e) => {
    if (w.failToast) throw new Error('boom')
    return w.toasts.push(e.text), { value: undefined }
  })
  on('audio.play', (_$, e) => {
    if (w.failSound) throw new Error('no player')
    return w.sounds.push((e.clip as { asset: string }).asset), { value: undefined }
  })
  on('ui.notify', (_$, e) => (w.notes.push(e.text), { value: { isSent: true as const, channel: 'terminal_bell' as const } }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: undefined as never }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', async (_$, e) => {
    if (w.hold.bashMs > 0) await w.clock.sleep(w.hold.bashMs)
    return { result: `ran ${String((e as { command?: string }).command)}` } as never
  })
  return w
}

const slash = ($: Engine, args: string) =>
  $.command.run({ command: 'long-run-ping', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
const submit = ($: Engine) => $.prompt.submit({ text: 'go', wait: false, origin: { kind: 'composer' } } as never)
const finish = ($: Engine, extra: Record<string, unknown> = {}) =>
  $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', ...extra } as never)
const start = ($: Engine) => $.session.start({ cwd: '/x' } as never)

/** A whole turn of `ms` milliseconds. */
async function turn($: Engine, w: ReturnType<typeof world>, ms: number) {
  await submit($)
  await w.clock.advance(ms)
  return finish($)
}

test('a long turn ends with a toast, a sound and a notification', async ($, on) => {
  const w = world(on)
  await start($)
  const out = await turn($, w, 192_000)
  expect(out.text).toBe('done') // the answer passes through untouched
  expect(w.toasts).toEqual(['long-run-ping · done after 3m 12s'])
  expect(w.sounds).toEqual(['sounds/ping.wav'])
  expect(w.notes).toEqual(['long-run-ping · done after 3m 12s'])
})

test('a short turn gets no ping', async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, w, 59_000)
  expect(w.toasts).toEqual([])
  expect(w.sounds).toEqual([])
})

test('a long Bash command pings; a medium one does not', async ($, on) => {
  const w = world(on)
  await start($)
  w.hold.bashMs = 100_000
  const medium = $.tool.call({ tool: 'Bash', command: 'make' } as never)
  await w.clock.advance(100_000)
  expect((await medium).result).toBe('ran make')
  expect(w.toasts).toEqual([])
  w.hold.bashMs = 125_000
  const run = $.tool.call({ tool: 'Bash', command: 'make all' } as never)
  await w.clock.advance(125_000)
  expect((await run).result).toBe('ran make all')
  expect(w.toasts).toEqual(['long-run-ping · done after 2m 5s'])
})

test('a second ping inside the minimum gap is held back, a later one is not', async ($, on) => {
  const w = world(on)
  await start($)
  w.hold.bashMs = 125_000
  await submit($)
  const run = $.tool.call({ tool: 'Bash', command: 'make' } as never)
  await w.clock.advance(125_000)
  await run
  expect(w.toasts).toHaveLength(1)
  w.hold.bashMs = 0
  await w.clock.advance(15_000) // the turn ends 15 s after the command's ping
  await finish($)
  expect(w.toasts).toHaveLength(1)
  await turn($, w, 61_000) // well past the gap
  expect(w.toasts).toHaveLength(2)
})

test('off does nothing, on brings it back, and the atom mirrors the switch', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await slash($, 'off')).text).toContain('off')
  expect(w.store.get('off')).toBe(true)
  await turn($, w, 200_000)
  expect(w.toasts).toEqual([])
  expect((await slash($, 'status')).text).toContain('long-run-ping · off')
  expect((await slash($, 'test')).text).toContain('off')
  expect(w.toasts).toEqual([])
  expect((await slash($, 'on')).text).toBe('long-run-ping · on')
  expect(w.store.has('off')).toBe(false)
  await turn($, w, 200_000)
  expect(w.toasts).toHaveLength(1)
})

test('a stored off survives into a new session', async ($, on) => {
  const w = world(on)
  w.store.set('off', true)
  await start($)
  await turn($, w, 200_000)
  expect(w.toasts).toEqual([])
})

test('/long-run-ping test pings now, status shows thresholds and the last ping', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['long-run-ping'])
  expect((await slash($, 'status')).text).toBe(
    'long-run-ping · on\nturn over 60s · command over 120s · gap 30s · sound on\nno ping yet this session',
  )
  expect((await slash($, 'test')).text).toBe('long-run-ping · test ping sent')
  expect(w.toasts).toEqual(['long-run-ping · test ping'])
  expect(w.sounds).toHaveLength(1)
  await turn($, w, 75_000)
  expect((await slash($, '')).text).toContain('last: long-run-ping · done after 1m 15s')
  expect((await slash($, 'dance')).text).toContain('use /long-run-ping')
})

test('an interrupted turn and a subagent turn get no ping', async ($, on) => {
  const w = world(on)
  await start($)
  await submit($)
  await w.clock.advance(100_000)
  await finish($, { isAborted: true, reason: 'aborted' })
  await submit($)
  await w.clock.advance(100_000)
  await finish($, { agentId: 'sub-1' })
  expect(w.toasts).toEqual([])
})

test('fail-open: a failing toast or sound never changes the answer', async ($, on) => {
  const w = world(on)
  await start($)
  w.failToast = true
  w.failSound = true
  const out = await turn($, w, 200_000)
  expect(out.text).toBe('done')
  expect(w.notes).toHaveLength(1) // the notification still went out
  const run = $.tool.call({ tool: 'Bash', command: 'x' } as never)
  w.hold.bashMs = 0
  expect((await run).result).toBe('ran x')
})
