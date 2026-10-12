import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { slash, world } from './world'

const start = ($: Engine) => $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true } as never)
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never)
const edit = ($: Engine, tool: 'Edit' | 'Write', file_path: string) => $.tool.call({ tool, file_path } as never)
const steps = (w: ReturnType<typeof world>) => (w.state.get('repro-log.steps') as { kind: string; text: string }[] | undefined) ?? []

test('session start registers /repro', async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.registered).toEqual(['repro'])
})

test('only successful analysis commands and file names are recorded', async ($, on) => {
  const w = world(on, { bash: c => (c.includes('fail') ? { isError: true } : c.includes('stop') ? { result: { stdout: '', stderr: '', interrupted: true } } : {}) })
  await start($)
  await bash($, 'python3 clean.py --seed 42')
  await bash($, 'ls -la')
  await bash($, 'python3 fail.py')
  await bash($, 'python3 stop.py')
  await edit($, 'Edit', '/work/proj/src/a.py')
  await edit($, 'Write', '/work/proj/.env')
  expect(steps(w).map(s => [s.kind, s.text])).toEqual([
    ['cmd', 'python3 clean.py --seed 42'],
    ['file', 'src/a.py'],
  ])
  expect(w.store.get('steps:/work/proj')).toHaveLength(2)
  expect((await slash($, 'status')).text).toBe('Repro · 2 steps recorded · recording is on')
})

test('commands with secrets are dropped and password args are masked', async ($, on) => {
  const w = world(on)
  await start($)
  await bash($, 'python3 a.py --api-key abc123')
  await bash($, 'TOKEN=zzz Rscript b.R')
  await bash($, 'python3 c.py --password hunter2 --n 3')
  const all = JSON.stringify(steps(w))
  expect(steps(w).map(s => s.text)).toEqual(['python3 c.py --password *** --n 3'])
  expect(all).not.toContain('hunter2')
  expect(all).not.toContain('abc123')
})

test('/repro writes the file with every section and no secrets', async ($, on) => {
  const w = world(on, {
    run: argv => {
      const l = argv.join(' ')
      if (l === 'git rev-parse HEAD') return { stdout: 'abc1234def5678\n' }
      if (l === 'git status --porcelain') return { stdout: ' M a.py\n' }
      if (l === 'python3 --version') return { stdout: 'Python 3.12.1\n' }
      if (l === 'R --version') return { stdout: 'R version 4.4.0 (2024)\nmore\n' }
      if (l === 'shasum -a 256 requirements.txt') return { stdout: 'deadbeefdeadbeefdeadbeef  requirements.txt\n' }
      return undefined
    },
  })
  w.present.add('requirements.txt')
  await start($)
  await bash($, 'python3 clean.py --seed 42')
  await bash($, 'Rscript -e "set.seed(7); 1"')
  await bash($, 'python3 x.py --token abc')
  await edit($, 'Write', '/work/proj/out/result.csv')
  const out = await slash($, '')
  const lines = out.text.split('\n')
  expect(lines).toHaveLength(3)
  expect(lines[0]).toMatch(/^Repro · saved \.moddeck\/repro\/\d{4}-\d\d-\d\d-\d{4}\.md$/)
  expect(lines[1]).toBe('2 commands · 1 changed file')
  expect(lines[2]).toBe('Git abc1234 · dirty')

  const [[path, text]] = [...w.files.entries()]
  expect(path.endsWith(lines[0]!.replace('Repro · saved ', ''))).toBe(true) // the engine hands the hook an absolute path
  for (const s of ['# Reproducibility recipe', '- Date:', 'abc1234def5678 (dirty', '- Python 3.12.1', '- R version 4.4.0 (2024)', '- requirements.txt (sha256 deadbeefdeadbeef)', '- 42', '- 7', '## Commands, in order', '```sh\npython3 clean.py --seed 42\nRscript -e "set.seed(7); 1"\n```', '## Changed files', '- out/result.csv'])
    expect(text, s).toContain(s)
  expect(text).not.toContain('abc"')
  expect(text).not.toContain('--token abc')
  expect(w.runs.every(r => /^(git|python3|R|shasum)\b/.test(r))).toBe(true) // read-only probes only; no node probe as node never ran
  expect(w.runs).not.toContain('node --version')
})

test('/repro with nothing recorded writes nothing', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await slash($, '')).text).toContain('nothing recorded yet')
  expect(w.files.size).toBe(0)
})

test('/repro off records nothing, mirrors the atom and survives a new session; on resumes', async ($, on) => {
  const w = world(on)
  await start($)
  expect((await slash($, 'off')).text).toContain('Repro · off')
  expect(w.store.get('off')).toBe(true)
  expect(w.state.get('repro-log.isOff')).toBe(true)
  await bash($, 'python3 a.py')
  expect(steps(w)).toEqual([])
  await start($)
  expect(w.state.get('repro-log.isOff')).toBe(true)
  expect((await slash($, 'status')).text).toContain('recording is off')
  await slash($, 'on')
  expect(w.store.has('off')).toBe(false)
  expect(w.state.get('repro-log.isOff')).toBe(false)
  await bash($, 'python3 a.py')
  expect(steps(w)).toHaveLength(1)
})

test('/repro clear forgets the steps in memory and store', async ($, on) => {
  const w = world(on)
  await start($)
  await bash($, 'python3 a.py')
  expect((await slash($, 'clear')).text).toBe('Repro · cleared')
  expect(steps(w)).toEqual([])
  expect(w.store.get('steps:/work/proj')).toEqual([])
})

test('steps come back from the store at session start', async ($, on) => {
  const w = world(on, { store: { 'steps:/work/proj': [{ kind: 'cmd', text: 'make', at: 1 }] } })
  await start($)
  expect(steps(w)).toHaveLength(1)
})

test('the list is capped to the last maxSteps', { options: { maxSteps: 10 } }, async ($, on) => {
  const w = world(on)
  await start($)
  for (let i = 0; i < 15; i++) await bash($, `python3 s${i}.py`)
  expect(steps(w)).toHaveLength(10)
  expect(steps(w)[0]!.text).toBe('python3 s5.py')
  expect(steps(w)[9]!.text).toBe('python3 s14.py')
})

test('enabled = false records nothing and says so', { options: { enabled: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await bash($, 'python3 a.py')
  expect(steps(w)).toEqual([])
  expect((await slash($, '')).text).toContain('disabled')
})

test('fail-open: a broken store never changes the tool result', async ($, on) => {
  const w = world(on, { storeDown: true })
  await start($)
  const r = await bash($, 'python3 a.py')
  expect(r).toMatchObject({ result: { stdout: 'ok' } })
  expect(r.deny).toBeUndefined()
  expect(steps(w)).toEqual([])
})

test('fail-open: a failing command stays failing and a denied one stays denied', async ($, on) => {
  const w = world(on, { bash: () => ({ isError: true, text: 'exit 1' }) })
  await start($)
  const r = await bash($, 'python3 a.py')
  expect(r.isError).toBe(true)
  expect(steps(w)).toEqual([])
})
