import { expect, test } from 'claude-code/testing'

import { fmtSeconds, parseArgs, tailOf, timeoutOf, whyOf } from '../hooks/lib'
import { world } from './world'
import type { Run } from './world'

const slash = ($: any, args: string) =>
  $.command.run({ command: 'auto-test', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })

const edit = ($: any) => $.tool.call({ tool: 'Edit', file_path: '/proj/a.py', old_string: 'a', new_string: 'b' })
const endTurn = ($: any, reason = 'answer') => $.turn.complete({ answer: 'done', durationMs: 5, isAborted: reason === 'aborted', turnId: 't', reason })
const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true } as never)
const IS_OFF = 'auto-test.isOff'
const LAST = 'auto-test.last'

/** Fires the 1 ms timer and lets the run it started finish. */
async function settle(w: ReturnType<typeof world>) {
  await w.clock.advance(1)
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))
}

/** A turn that edits, ends, and lets the timer-run tests finish. */
async function editedTurn($: any, w: ReturnType<typeof world>) {
  await edit($)
  await endTurn($)
  await settle(w)
}

const ON = { store: { on: true } }

// ---------------------------------------------------------------- detection

const PROJECTS: [string, Record<string, string>, string[]][] = [
  ['pytest.ini', { 'pytest.ini': '' }, ['python3', '-m', 'pytest', '-q']],
  ['pyproject.toml', { 'pyproject.toml': '' }, ['python3', '-m', 'pytest', '-q']],
  ['tests/ with setup.py', { tests: '', 'setup.py': '' }, ['python3', '-m', 'pytest', '-q']],
  ['package.json with a test script', { 'package.json': '{"scripts":{"test":"vitest run"}}' }, ['npm', 'test']],
  ['Cargo.toml', { 'Cargo.toml': '' }, ['cargo', 'test']],
  ['DESCRIPTION', { DESCRIPTION: '' }, ['Rscript', '-e', 'devtools::test()']],
  ['go.mod', { 'go.mod': '' }, ['go', 'test', './...']],
]
for (const [name, files, argv] of PROJECTS) {
  test(`detects the command for ${name}`, async ($, on) => {
    const w = world(on, { files, ...ON })
    await start($)
    await editedTurn($, w)
    expect(w.runs).toHaveLength(1)
    expect(w.runs[0]!.argv).toEqual(argv)
    expect(w.runs[0]!.cwd).toBe('/proj')
  })
}

const NOTHING: [string, Record<string, string>][] = [
  ['package.json with the npm placeholder test script', { 'package.json': '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' }],
  ['package.json with no scripts', { 'package.json': '{}' }],
  ['a bare tests/ folder', { tests: '' }],
]
for (const [name, files] of NOTHING) {
  test(`finds nothing for ${name}`, async ($, on) => {
    const w = world(on, { files, ...ON })
    await start($)
    await editedTurn($, w)
    expect(w.runs).toHaveLength(0)
  })
}

// ---------------------------------------------------------------- when it runs

test('off by default: an edited turn runs nothing, and the atom says off', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' } })
  await start($)
  expect(w.state.get(IS_OFF)).toBe(true)
  await editedTurn($, w)
  expect(w.runs).toHaveLength(0)
  expect(w.toasts).toHaveLength(0)
})

test('/auto-test on and off switch it, persist in the store and mirror into the atom', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' } })
  await start($)
  expect((await slash($, 'on')).text).toContain('on')
  expect(w.store.get('on')).toBe(true)
  expect(w.state.get(IS_OFF)).toBe(false)
  await editedTurn($, w)
  expect(w.runs).toHaveLength(1)
  expect((await slash($, 'off')).text).toContain('off')
  expect(w.store.has('on')).toBe(false)
  expect(w.state.get(IS_OFF)).toBe(true)
  await editedTurn($, w)
  expect(w.runs).toHaveLength(1)
})

test('session.start registers the command and loads the stored switch', async ($, on) => {
  const w = world(on, ON)
  await start($)
  expect(w.registered).toEqual(['auto-test'])
  expect(w.state.get(IS_OFF)).toBe(false)
  expect(w.state.get(LAST)).toBe('idle')
})

test('several edits in one turn run the tests once, at the end', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await edit($)
  await $.tool.call({ tool: 'Write', file_path: '/proj/b.py', content: 'x' })
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: '/proj/n.ipynb', new_source: 'x' })
  await w.clock.advance(5)
  expect(w.runs).toHaveLength(0) // nothing runs per edit
  await endTurn($)
  await settle(w)
  expect(w.runs).toHaveLength(1)
})

test('a turn that edited nothing runs nothing, and the next one is not charged for an earlier edit', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/proj/a.py' })
  await endTurn($)
  await settle(w)
  expect(w.runs).toHaveLength(0)
  await editedTurn($, w)
  await endTurn($)
  await settle(w)
  expect(w.runs).toHaveLength(1) // the second plain turn adds nothing
})

test('an interrupted turn waits: the edit is tested when a turn ends in an answer', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await edit($)
  await endTurn($, 'aborted')
  await settle(w)
  expect(w.runs).toHaveLength(0)
  await endTurn($)
  await settle(w)
  expect(w.runs).toHaveLength(1)
})

test('the enabled setting off: nothing runs, not even /auto-test run', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.runs).toHaveLength(0)
  expect((await slash($, 'run')).text).toContain('disabled')
  expect((await slash($, 'on')).text).toContain('disabled')
  expect(w.runs).toHaveLength(0)
})

// ---------------------------------------------------------------- results

test('pass: a toast with the time, the atom goes pass, nothing is logged or sent to the model', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, run: { exitCode: 0, afterMs: 12_000 }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.toasts).toEqual(['auto-test · passed (12s)'])
  expect(w.state.get(LAST)).toBe('pass')
  expect(w.logs).toHaveLength(0)
  expect(w.session.appended()).toHaveLength(0)
})

test('fail: a FAILED toast, only the last 40 lines in the log, and still nothing sent to the model', async ($, on) => {
  const out = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
  const w = world(on, { files: { 'Cargo.toml': '' }, run: { exitCode: 101, stdout: out, stderr: 'boom' }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.toasts).toEqual(['auto-test · FAILED'])
  expect(w.state.get(LAST)).toBe('fail')
  expect(w.logs).toHaveLength(1)
  const log = w.logs[0]!
  expect(log).toContain('line 100')
  expect(log).toContain('boom')
  expect(log).not.toContain('line 50\n')
  expect(log).not.toContain('line 1\n')
  expect(log.split('\n').length).toBeLessThanOrEqual(42)
  expect(w.session.appended()).toHaveLength(0)
})

test('tellModel adds a note on failure only', { options: { tellModel: true } }, async ($, on) => {
  const failing = world(on, { files: { 'Cargo.toml': '' }, run: { exitCode: 1, stdout: 'test x failed' }, ...ON })
  await start($)
  await editedTurn($, failing)
  const rows = failing.session.appended()
  expect(rows).toHaveLength(1)
  expect(JSON.stringify(rows[0]!.message)).toContain('test x failed')
})

test('tellModel stays quiet when the tests pass', { options: { tellModel: true } }, async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.session.appended()).toHaveLength(0)
})

// ---------------------------------------------------------------- command override

test('the command setting overrides detection', { options: { command: 'make check' } }, async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.runs[0]!.argv).toEqual(['sh', '-c', 'make check'])
})

test('/auto-test command sets a project command, persisted in the store; reset detects again', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  expect((await slash($, 'command just test')).text).toContain('just test')
  expect(w.store.get('command:/proj')).toBe('just test')
  await editedTurn($, w)
  expect(w.runs[0]!.argv).toEqual(['sh', '-c', 'just test'])
  expect((await slash($, 'command')).text).toContain('just test')
  await slash($, 'command reset')
  expect(w.store.has('command:/proj')).toBe(false)
  await editedTurn($, w)
  expect(w.runs[1]!.argv).toEqual(['cargo', 'test'])
})

test('the project command wins over the setting', { options: { command: 'from setting' } }, async ($, on) => {
  const w = world(on, { files: {}, store: { on: true, 'command:/proj': 'from project' } })
  await start($)
  await editedTurn($, w)
  expect(w.runs[0]!.argv).toEqual(['sh', '-c', 'from project'])
})

// ---------------------------------------------------------------- timeout and fail-open

test('the time limit is handed to the runner (default 120 s, settable)', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.runs[0]!.timeoutMs).toBe(120_000)
})

test('timeoutSec setting', { options: { timeoutSec: 30 } }, async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.runs[0]!.timeoutMs).toBe(30_000)
})

test('a run that cannot complete says could not run, once, and the turn is never blocked', async ($, on) => {
  // A hook cannot reject process.run in the kit (a throwing hook is skipped and the call rejects with the kit's own text), so this is that rejection.
  const w = world(on, { files: { 'Cargo.toml': '' }, run: { throws: 'x' } as Run, ...ON })
  await start($)
  await editedTurn($, w)
  await editedTurn($, w)
  expect(w.toasts).toHaveLength(1) // said once
  expect(w.toasts[0]).toContain('auto-test · could not run: ')
  expect(w.state.get(LAST)).toBe('idle')
  expect(w.logs).toHaveLength(0)
  const out = await endTurn($) // the hook chain still answers
  expect(out.text).toBe('done')
})

test('the reason is a short plain phrase (timeout, spawn error, empty)', () => {
  expect(whyOf(new Error('process timed out'), 120_000)).toBe('timed out after 2m 00s')
  expect(whyOf(new Error('Timeout'), 30_000)).toBe('timed out after 30s')
  expect(whyOf(new Error('spawn cargo ENOENT\n  at x'), 1000)).toBe('spawn cargo ENOENT')
  expect(whyOf('', 1000)).toBe('it did not start')
})

test('exit 127 (command not found) is could not run, not FAILED', async ($, on) => {
  const w = world(on, { files: { DESCRIPTION: '' }, run: { exitCode: 127 }, ...ON })
  await start($)
  await editedTurn($, w)
  expect(w.toasts).toEqual(['auto-test · could not run: Rscript not found'])
  expect(w.logs).toHaveLength(0)
})

test('no test command found says so once', async ($, on) => {
  const w = world(on, { files: {}, ...ON })
  await start($)
  await editedTurn($, w)
  await editedTurn($, w)
  expect(w.runs).toHaveLength(0)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('no test command found')
})

test('a store that throws leaves the turn alone', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, storeThrows: true })
  await start($)
  await edit($)
  const out = await endTurn($)
  await settle(w)
  expect(out.text).toBe('done')
  expect(w.runs).toHaveLength(0)
})

// ---------------------------------------------------------------- commands

test('/auto-test run runs now, even with the switch off, and status reports it', async ($, on) => {
  const w = world(on, { files: { 'go.mod': '' }, run: { exitCode: 0, afterMs: 3000 } })
  await start($)
  expect((await slash($, 'run')).text).toContain('running')
  await settle(w)
  expect(w.runs[0]!.argv).toEqual(['go', 'test', './...'])
  const s = (await slash($, 'status')).text
  expect(s).toContain('auto-test · off')
  expect(s).toContain('go test ./... (detected)')
  expect(s).toContain('last: passed (3s)')
})

test('status before any run, and an unknown word', async ($, on) => {
  world(on, { files: { 'Cargo.toml': '' } })
  await start($)
  expect((await slash($, '')).text).toContain('last: no run yet')
  expect((await slash($, 'bogus')).text).toContain('"bogus" is not a choice')
})

test('the last state is running while a run is in flight, a second turn waits and reruns once', async ($, on) => {
  const w = world(on, { files: { 'Cargo.toml': '' }, ...ON })
  let release = () => {}
  w.gate = new Promise<void>(r => (release = r))
  await start($)
  await editedTurn($, w)
  expect(w.state.get(LAST)).toBe('running')
  expect((await slash($, 'status')).text).toContain('last: running now')
  await editedTurn($, w) // a turn ends while the first run is still going
  expect(w.runs).toHaveLength(1)
  w.gate = undefined
  release()
  for (let i = 0; i < 10; i++) await settle(w)
  expect(w.runs).toHaveLength(2) // the held-back one ran once more
  expect(w.state.get(LAST)).toBe('pass')
})

test('tailOf keeps the last 40 lines, drops colour codes and blank ends', () => {
  const out = Array.from({ length: 60 }, (_, i) => `\u001b[31mL${i + 1}\u001b[0m`).join('\n') + '\n\n'
  const lines = tailOf(out, '').split('\n')
  expect(lines).toHaveLength(40)
  expect(lines[0]).toBe('L21')
  expect(lines[39]).toBe('L60')
  expect(tailOf('', 'only stderr')).toBe('only stderr')
})

test('parseArgs, timeoutOf and fmtSeconds', () => {
  expect(parseArgs('')).toEqual({ kind: 'status' })
  expect(parseArgs(' ON ')).toEqual({ kind: 'on' })
  expect(parseArgs('command  cargo test -q')).toEqual({ kind: 'command', text: 'cargo test -q' })
  expect(parseArgs('dance')).toEqual({ kind: 'unknown', word: 'dance' })
  expect(timeoutOf(undefined)).toBe(120)
  expect(timeoutOf(0)).toBe(5)
  expect(timeoutOf(99999)).toBe(600)
  expect(fmtSeconds(12_400)).toBe('12s')
  expect(fmtSeconds(185_000)).toBe('3m 05s')
})
