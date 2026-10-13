import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classify, cut, scrub } from '../hooks/lib'

type Answer = { isError?: true; text?: string; result?: unknown; deny?: string }

function world(on: On, o: { store?: Record<string, unknown> } = {}) {
  const clock = mock.clock(on, { now: 1_700_000_000_000 })
  const store = new Map(Object.entries(o.store ?? {}))
  const w = { registered: [] as string[], opened: [] as string[], store, clock, answer: { result: { stdout: 'ok', stderr: '', interrupted: false } } as Answer, takesMs: 1500 }
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_$, e) => (store.delete(e.key), { value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => (w.registered.push(e.name), { value: { command: e.name } as never }))
  on('ui.open', (_$, e) => (w.opened.push(e.id), { value: { isPlaced: true as const } }))
  on('tool.call', async () => {
    await clock.sleep(w.takesMs)
    return w.answer.deny !== undefined ? ({ deny: w.answer.deny } as never) : ({ ref: 1, text: w.answer.text ?? 'ok', ...w.answer } as never)
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true } as never)
const slash = async ($: Engine, args = '') =>
  ((await $.command.run({ command: 'test-ledger', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })) as { text?: string }).text ?? ''
const bash = async ($: Engine, w: ReturnType<typeof world>, command: string) => {
  const call = $.tool.call({ tool: 'Bash', command } as never) as Promise<Record<string, unknown>>
  await w.clock.advance(w.takesMs)
  return call
}
const PANE_PROPS = { title: 'Checks', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const
const mount = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'test-ledger', surface, component: 'Pane', requestId: 'test-ledger', props: PANE_PROPS, viewport: { columns: 140, rows: 40, isFullscreen: true } } as never)

test('recognises the Python, R, Rust, JS and other check commands', () => {
  const kindOf = (c: string) => classify(c)?.kind
  expect(kindOf('pytest -q tests/')).toBe('test')
  expect(kindOf('python -m pytest -x')).toBe('test')
  expect(kindOf('uv run python3 -m pytest')).toBe('test')
  expect(kindOf('tox -e py312')).toBe('test')
  expect(kindOf('nox -s tests')).toBe('test')
  expect(kindOf('ruff check .')).toBe('lint')
  expect(kindOf('ruff format --check .')).toBe('format')
  expect(kindOf('mypy src')).toBe('check')
  expect(kindOf('pyright')).toBe('check')
  expect(kindOf('Rscript -e "devtools::test()"')).toBe('test')
  expect(kindOf("Rscript -e 'testthat::test_dir(\"tests\")'")).toBe('test')
  expect(kindOf('Rscript -e "library(x); devtools::check()"')).toBe('check')
  expect(kindOf('Rscript -e "rcmdcheck::rcmdcheck()"')).toBe('check')
  expect(kindOf('Rscript -e "lintr::lint_package()"')).toBe('lint')
  expect(kindOf('R CMD check pkg_0.1.tar.gz')).toBe('check')
  expect(kindOf('air format .')).toBe('format')
  expect(kindOf('jarl check .')).toBe('lint')
  expect(kindOf('cargo test --all')).toBe('test')
  expect(kindOf('cargo clippy -- -D warnings')).toBe('lint')
  expect(kindOf('cargo build --release')).toBe('build')
  expect(kindOf('npm test')).toBe('test')
  expect(kindOf('pnpm run build')).toBe('build')
  expect(kindOf('yarn run lint')).toBe('lint')
  expect(kindOf('pnpm lint')).toBe('lint')
  expect(kindOf('npx vitest run')).toBe('test')
  expect(kindOf('jest --ci')).toBe('test')
  expect(kindOf('npx eslint .')).toBe('lint')
  expect(kindOf('prettier --check .')).toBe('format')
  expect(kindOf('biome check .')).toBe('check')
  expect(kindOf('make test')).toBe('test')
  expect(kindOf('quarto render report.qmd')).toBe('build')
  expect(kindOf('quarto check')).toBe('check')
  expect(kindOf('cd pkg && CI=1 cargo test')).toBe('test')
  expect(classify('ruff check . && pytest')?.tool).toBe('ruff + pytest')
})

test('ordinary commands are not checks', () => {
  for (const c of ['ls -la', 'git status', 'npm install', 'cargo run', 'python script.py', 'Rscript analysis.R', 'make', 'echo test', 'cat tests/a.py', 'quarto preview']) {
    expect(classify(c)).toBeUndefined()
  }
})

test('secrets are scrubbed and the command is cut to 200', () => {
  const s = scrub('GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456 curl -H "Authorization: Bearer abc.def.ghi" --token s3cr3t https://u:pw@host/x password=hunter2 sk-ant-api03-abcdefghijk AKIAABCDEFGHIJKLMNOP')
  expect(s).not.toContain('ghp_abc')
  expect(s).not.toContain('abc.def.ghi')
  expect(s).not.toContain('s3cr3t')
  expect(s).not.toContain(':pw@')
  expect(s).not.toContain('hunter2')
  expect(s).not.toContain('sk-ant')
  expect(s).not.toContain('AKIAABCDEFGHIJKLMNOP')
  expect(s).toContain('Bearer ***')
  expect(s).toContain('--token ***')
  expect(cut('x'.repeat(500), 200)).toHaveLength(200)
})

test('a passing and a failing run are recorded with time, duration and exit code; others are not', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['test-ledger'])
  await bash($, w, 'pytest -q')
  w.answer = { isError: true, text: 'Exit code 1\n2 failed', result: 'Exit code 1\n2 failed' }
  await bash($, w, 'cargo test')
  w.answer = { result: { stdout: '', stderr: '', interrupted: false } }
  await bash($, w, 'ls -la')
  const text = await slash($, 'status')
  expect(text).toContain('2 runs recorded, 1 failed')
  expect(text).toContain('Last: fail · cargo test')
  const ui = await mount($, 'terminal')
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const fail = texts.findIndex(t => /✗ fail test · cargo test .* 1\.5s \(exit 1\)/.test(t))
  const pass = texts.findIndex(t => /✓ pass test · pytest .* 1\.5s$/.test(t))
  expect(fail).toBeGreaterThan(-1)
  expect(pass).toBeGreaterThan(fail) // newest first
  await ui.unmount()
})

test('the result goes back unchanged; a denied call and a background run are handled', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await bash($, w, 'pytest')
  expect(r.text).toBe('ok')
  expect(r.context).toBeUndefined()
  w.answer = { deny: 'no' }
  await bash($, w, 'pytest')
  w.answer = { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }
  await bash($, w, 'npm run build')
  w.answer = { result: { stdout: '', stderr: '', interrupted: true } }
  await bash($, w, 'jest')
  expect(await slash($, 'status')).toContain('3 runs recorded, 1 failed')
})

test('secrets never reach the ledger', async ($, on) => {
  const w = world(on)
  await start($)
  await bash($, w, 'API_KEY=abc123secret pytest --token tok_9999')
  const ui = await mount($, 'desktop')
  const all = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(all).toContain('API_KEY=***')
  expect(all).not.toContain('abc123secret')
  expect(all).not.toContain('tok_9999')
  await ui.unmount()
})

test('keeps the last 40; Clear empties it', async ($, on) => {
  const w = world(on)
  w.takesMs = 1
  await start($)
  for (let i = 0; i < 45; i++) await bash($, w, `pytest -k case${i}`)
  expect(await slash($, 'status')).toContain('40 runs recorded')
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /case44/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /case4$/ })).toBeUndefined()
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Text', text: /No test, lint/ })).toBeDefined()
  await ui.unmount()
})

test('off stops recording and is stored; on resumes; the command opens the pane', async ($, on) => {
  const w = world(on)
  await start($)
  expect(await slash($, 'off')).toContain('off')
  expect(w.store.get('off')).toBe(true)
  await bash($, w, 'pytest')
  expect(await slash($, 'status')).toContain('off · 0 runs')
  expect(await slash($, 'on')).toBe('test-ledger · on')
  expect(w.store.has('off')).toBe(false)
  await bash($, w, 'pytest')
  expect(await slash($)).toContain('1 run recorded')
  expect(w.opened).toEqual(['test-ledger'])
  expect(await slash($, 'maybe')).toContain('unknown option')
})

test('the stored off switch is read at session start', async ($, on) => {
  const w = world(on, { store: { off: true } })
  await start($)
  await bash($, w, 'pytest')
  expect(await slash($, 'status')).toContain('test-ledger · off · 0 runs')
})
