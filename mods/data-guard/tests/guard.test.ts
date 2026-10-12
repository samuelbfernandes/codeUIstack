import { expect, test } from 'claude-code/testing'

import { dirtyNotebook, cleanNotebook, world } from './world'
import type { Repo } from './world'

const MB = 1024 * 1024
const bash = ($: any, command: string) => $.tool.call({ tool: 'Bash', command })
const slash = ($: any, args: string) => $.command.run({ command: 'data-guard', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
const everything = (w: ReturnType<typeof world>, r?: { deny?: string }) => JSON.stringify([w.asks, w.logs, w.toasts, r?.deny])

const staged = (...paths: string[]): Repo['staged'] => paths.map(path => ({ status: 'A', path }))

test('a clean commit passes silently: no question, no log', async ($, on) => {
  const w = world(on, { repo: { staged: staged('src/model.R', 'README.md'), files: { 'src/model.R': 'x <- 1\n', 'README.md': '# hi\n' } } })
  const r = await bash($, 'git commit -m "model"')
  expect(w.ran).toEqual(['git commit -m "model"'])
  expect(r.deny).toBeUndefined()
  expect(w.asks).toHaveLength(0)
  expect(w.logs).toHaveLength(0)
})

test('commands that are not git commit or add are never inspected', async ($, on) => {
  const w = world(on)
  for (const c of ['ls -la', 'git status', 'git log --oneline', 'echo "git commit"', 'git push']) await bash($, c)
  expect(w.argvs).toHaveLength(0)
  expect(w.asks).toHaveLength(0)
})

test('only read-only git runs, with short timeouts', async ($, on) => {
  const w = world(on, { repo: { staged: staged('big.bin'), sizes: { 'big.bin': 9 * MB } } })
  await bash($, 'git commit -m x')
  expect(w.argvs.length).toBeGreaterThan(0)
  for (const a of w.argvs) expect(['rev-parse', 'diff', 'status', 'check-attr', 'check-ignore', 'cat-file', 'show']).toContain(a[1])
  for (const i of w.inits) expect(i.timeoutMs ?? 99999).toBeLessThanOrEqual(10_000)
})

test('large file: asked with name and size, Hold it is first and denies, nothing runs', async ($, on) => {
  const w = world(on, { answer: 'Hold it', repo: { staged: staged('out/model.rds'), sizes: { 'out/model.rds': 12 * MB } } })
  const r = await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.options).toEqual(['Hold it', 'Commit anyway', 'Fix it'])
  expect(w.asks[0]!.header).toBe('Data guard')
  expect(w.asks[0]!.question).toContain('out/model.rds 12 MB')
  expect(w.asks[0]!.question.trimEnd().endsWith('?')).toBe(true)
  expect(r.deny).toContain('held')
  expect(w.ran).toEqual([])
})

test('a file under the limit is fine', async ($, on) => {
  const w = world(on, { repo: { staged: staged('notes.txt'), sizes: { 'notes.txt': 3 * MB } } })
  await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(0)
})

test('maxFileMb moves the limit', { options: { maxFileMb: 1 } }, async ($, on) => {
  const w = world(on, { repo: { staged: staged('notes.txt'), sizes: { 'notes.txt': 3 * MB } } })
  await bash($, 'git commit -m x')
  expect(w.asks[0]!.question).toContain('over 1 MB')
})

test('Commit anyway lets the command run', async ($, on) => {
  const w = world(on, { answer: 'Commit anyway', repo: { staged: staged('a.bin'), sizes: { 'a.bin': 8 * MB } } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git commit -m x'])
})

test('Fix it denies with what to do', async ($, on) => {
  const w = world(on, { answer: 'Fix it', repo: { staged: staged('d.csv'), files: { 'd.csv': 'a,b\n1,2\n' } } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toContain('fix it first')
  expect(r.deny).toContain('git lfs')
  expect(w.ran).toEqual([])
})

test('Esc or a dismissed dialog holds', async ($, on) => {
  const w = world(on, { answer: 'REJECT', repo: { staged: staged('a.rds') } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toBeDefined()
  expect(w.ran).toEqual([])
})

test('free text typed under Other holds', async ($, on) => {
  const w = world(on, { answer: 'sure, go ahead', repo: { staged: staged('a.rds') } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toBeDefined()
  expect(w.ran).toEqual([])
})

test('no surface to ask on holds', async ($, on) => {
  const w = world(on, { surfaces: [], repo: { staged: staged('a.rds') } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toBeDefined()
  expect(w.asks).toHaveLength(0)
})

test('data files by extension are flagged; unflagged ones are not', async ($, on) => {
  const exts = ['csv', 'tsv', 'parquet', 'feather', 'rds', 'RData', 'h5', 'hdf5', 'xlsx', 'xls', 'sav', 'dta', 'sqlite', 'db', 'pkl', 'npy', 'npz', 'zip', 'gz']
  const files = exts.map(e => `d/f.${e}`)
  const w = world(on, { repo: { staged: staged(...files, 'a.R', 'notes.md', 'csv') } })
  await bash($, 'git commit -m x')
  const q = w.asks[0]!.question
  expect(q).toContain('Data files')
  expect(q).toContain('+15 more') // the first four are listed
  expect(q).not.toContain('a.R')
})

test('data files covered by git lfs or by .gitignore are not flagged', async ($, on) => {
  const w = world(on, { repo: { staged: staged('a.parquet', 'b.csv'), files: { 'b.csv': 'x\n1\n' }, lfs: ['a.parquet'], ignored: ['b.csv'] } })
  await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(0)
})

test('an lfs file is not "large" either', async ($, on) => {
  const w = world(on, { repo: { staged: staged('a.parquet'), sizes: { 'a.parquet': 50 * MB }, lfs: ['a.parquet'] } })
  await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(0)
})

test('personal-looking column names are flagged, and only the names are shown', async ($, on) => {
  const csv = 'id,Email,date_of_birth,first_name,Last Name,age,filename,name,ip_address\nu1,alice@example.org,1990-01-01,Alice,Smith,31,x.txt,Bob,10.0.0.7\n'
  const w = world(on, { answer: 'Hold it', repo: { staged: staged('pts.csv'), files: { 'pts.csv': csv } } })
  const r = await bash($, 'git commit -m x')
  const q = w.asks[0]!.question
  expect(q).toContain('Personal-looking columns in pts.csv')
  for (const n of ['Email', 'date_of_birth', 'first_name', 'Last Name', 'ip_address']) expect(q).toContain(n)
  expect(q).not.toMatch(/\bage\b|filename/)
  const all = everything(w, r)
  for (const value of ['alice@example.org', '1990-01-01', 'Alice', 'Smith', '10.0.0.7', 'Bob']) expect(all).not.toContain(value)
})

test('checkColumns off: the columns are not read', { options: { checkColumns: false } }, async ($, on) => {
  const w = world(on, { repo: { staged: staged('p.csv'), files: { 'p.csv': 'email,id\n' } } })
  await bash($, 'git commit -m x')
  expect(w.asks[0]!.question).not.toContain('Personal-looking')
  expect(w.argvs.some(a => a[1] === 'show')).toBe(false)
})

test('checkNotebooks off: notebooks pass', { options: { checkNotebooks: false } }, async ($, on) => {
  const w = world(on, { repo: { staged: staged('a.ipynb'), files: { 'a.ipynb': dirtyNotebook() } } })
  await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(0)
})

test('enabled=false: nothing is inspected and /data-guard on cannot override it', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { repo: { staged: staged('a.rds') } })
  await bash($, 'git commit -m x')
  expect(w.argvs).toHaveLength(0)
  expect((await slash($, 'on')).text).toContain('disabled')
})

test('a tsv header is read too, and a csv without personal names adds nothing', async ($, on) => {
  const w = world(on, { repo: { staged: staged('a.tsv', 'b.csv'), files: { 'a.tsv': 'id\tssn\tmrn\n1\t123-45-6789\t9\n', 'b.csv': 'id,score\n1,2\n' } } })
  await bash($, 'git commit -m x')
  const q = w.asks[0]!.question
  expect(q).toContain('columns in a.tsv: ssn, mrn')
  expect(q).not.toContain('columns in b.csv')
  expect(everything(w)).not.toContain('123-45-6789')
})

test('notebooks with outputs are flagged and offer Strip outputs; clean ones pass', async ($, on) => {
  let w = world(on, { repo: { staged: staged('a.ipynb'), files: { 'a.ipynb': dirtyNotebook() } } })
  await bash($, 'git commit -m x')
  expect(w.asks[0]!.options).toEqual(['Hold it', 'Commit anyway', 'Fix it', 'Strip outputs'])
  expect(w.asks[0]!.question).toContain('Notebooks with outputs: a.ipynb')
  expect(everything(w)).not.toContain('SECRETVALUE')
})

test('a clean notebook passes silently', async ($, on) => {
  const w = world(on, { repo: { staged: staged('a.ipynb'), files: { 'a.ipynb': cleanNotebook() } } })
  await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(0)
})

test('Strip outputs rewrites the file (indent 1, trailing newline), git adds it, then the command runs', async ($, on) => {
  const w = world(on, { answer: 'Strip outputs', repo: { staged: staged('nb/a.ipynb'), files: { 'nb/a.ipynb': dirtyNotebook() } } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git commit -m x'])
  const out = w.writes.get('nb/a.ipynb')!
  expect(out.endsWith('}\n')).toBe(true)
  expect(out).not.toContain('SECRETVALUE')
  const nb = JSON.parse(out)
  expect(nb.cells[1].outputs).toEqual([])
  expect(nb.cells[1].execution_count).toBeNull()
  expect(nb.cells[1].source).toEqual(['print(1)'])
  expect(nb.cells[0].cell_type).toBe('markdown')
  expect(out).toBe(`${JSON.stringify(nb, null, 1)}\n`)
  expect(out).toContain('\n "cells"') // one space of indent
  expect(w.added).toEqual([['nb/a.ipynb']])
  expect(w.state.get('data-guard.tally')).toMatchObject({ stripped: 1 })
})

test('Strip outputs with other findings strips, then still holds the command', async ($, on) => {
  const w = world(on, { answer: 'Strip outputs', repo: { staged: staged('a.ipynb', 'big.rds'), files: { 'a.ipynb': dirtyNotebook() }, sizes: { 'big.rds': 20 * MB } } })
  const r = await bash($, 'git commit -m x')
  expect(w.writes.has('a.ipynb')).toBe(true)
  expect(r.deny).toContain('still in it')
  expect(w.ran).toEqual([])
})

test('a working file that is not a notebook cannot be stripped: held, nothing written', async ($, on) => {
  const w = world(on, { answer: 'Strip outputs', brokenWorkFile: '{"cells": [{"outputs": [1]', repo: { staged: staged('a.ipynb'), blobs: { 'a.ipynb': dirtyNotebook() } } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toContain('could not strip')
  expect(w.writes.size).toBe(0)
  expect(w.ran).toEqual([])
})

test('git add -A looks at git status: untracked and modified files', async ($, on) => {
  const w = world(on, {
    answer: 'Hold it',
    repo: { status: [{ x: '?', y: '?', path: 'raw/data.csv' }, { x: ' ', y: 'M', path: 'src/a.R' }, { x: 'M', y: ' ', path: 'already.xlsx' }], files: { 'raw/data.csv': 'a,b\n1,2\n', 'src/a.R': '1' } },
  })
  const r = await bash($, 'git add -A')
  expect(w.asks[0]!.question).toContain('raw/data.csv')
  expect(w.asks[0]!.question).not.toContain('already.xlsx') // staged already, unchanged since
  expect(w.asks[0]!.question).toContain('git add?')
  expect(r.deny).toBeDefined()
  expect(w.ran).toEqual([])
})

const NAMED = {
  status: [{ x: '?', y: '?', path: 'data/raw.csv' }, { x: '?', y: '?', path: 'other/big.rds' }],
  files: { 'data/raw.csv': 'a\n1\n', 'other/big.rds': 'x' },
  sizes: { 'other/big.rds': 30 * MB },
}

test('git add of a path with nothing to flag passes', async ($, on) => {
  const w = world(on, { repo: NAMED })
  await bash($, 'git add src/')
  expect(w.asks).toHaveLength(0)
})

test('git add names a path: only what it names is looked at', async ($, on) => {
  const w = world(on, { repo: NAMED })
  await bash($, 'git add data/ && git status')
  expect(w.asks[0]!.question).toContain('data/raw.csv')
  expect(w.asks[0]!.question).not.toContain('big.rds')
})

test('git add from a subfolder resolves names against the repo root, and globs work', async ($, on) => {
  const w = world(on, { repo: { prefix: 'analysis/', status: [{ x: '?', y: '?', path: 'analysis/x.csv' }, { x: '?', y: '?', path: 'x.csv' }], files: { 'analysis/x.csv': 'a\n', 'x.csv': 'a\n' } } })
  await bash($, 'git add "*.csv"')
  expect(w.asks[0]!.question).toContain('analysis/x.csv')
  expect(w.asks[0]!.question).not.toMatch(/ x\.csv/)
})

test('git add -u skips untracked files', async ($, on) => {
  const w = world(on, { repo: { status: [{ x: '?', y: '?', path: 'new.csv' }], files: { 'new.csv': 'a\n' } } })
  await bash($, 'git add -u')
  expect(w.asks).toHaveLength(0)
})

test('git commit -am also looks at modified tracked files', async ($, on) => {
  const w = world(on, { repo: { unstaged: [{ status: 'M', path: 'results.rds' }], files: { 'results.rds': 'x' } } })
  await bash($, 'git commit -am "update"')
  expect(w.asks[0]!.question).toContain('results.rds')
})

test('git commit -m does not look at unstaged files', async ($, on) => {
  const w = world(on, { repo: { unstaged: [{ status: 'M', path: 'results.rds' }], files: { 'results.rds': 'x' } } })
  await bash($, 'git commit -m "update"')
  expect(w.asks).toHaveLength(0)
})

test('a chained add and commit is inspected as one', async ($, on) => {
  const w = world(on, { repo: { status: [{ x: '?', y: '?', path: 'a.sav' }], files: { 'a.sav': 'x' } } })
  await bash($, 'git add a.sav && git commit -m "x"')
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('git commit?')
})

test('off in the store: the command goes straight through, nothing inspected', async ($, on) => {
  const w = world(on, { store: { off: true }, repo: { staged: staged('a.rds') } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git commit -m x'])
  expect(w.argvs).toHaveLength(0)
  expect(w.asks).toHaveLength(0)
})

test('/data-guard off and on persist and mirror into the atom; status shows settings and counts', async ($, on) => {
  const w = world(on, { answer: 'Hold it', repo: { staged: staged('a.rds') } })
  expect((await slash($, 'off')).text).toContain('Data guard · off')
  expect(w.store.get('off')).toBe(true)
  expect(w.state.get('data-guard.isOff')).toBe(true)
  await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(0)
  expect((await slash($, 'on')).text).toContain('Data guard · on')
  expect(w.store.has('off')).toBe(false)
  expect(w.state.get('data-guard.isOff')).toBe(false)
  await bash($, 'git commit -m x')
  expect(w.asks).toHaveLength(1)
  const s = (await slash($, 'status')).text
  expect(s).toContain('Large file limit 5 MB')
  expect(s).toContain('1 checked · 1 asked · 1 held')
  expect((await slash($, '')).text).toBe(s)
  expect((await slash($, 'maybe')).text).toContain('not an option')
})

test('session.start registers the command and loads the stored switch into the atom', async ($, on) => {
  const w = world(on, { store: { off: true } })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true } as never)
  expect(w.registered).toEqual(['data-guard'])
  expect(w.state.get('data-guard.isOff')).toBe(true)
})

test('FAIL OPEN: a process that throws lets the command through untouched', async ($, on) => {
  const w = world(on, { failProcess: true, repo: { staged: staged('a.rds') } })
  const r = await bash($, 'git commit -m x')
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git commit -m x'])
  expect(w.asks).toHaveLength(0)
})

test('FAIL OPEN: not a git folder (git exits non-zero) passes', async ($, on) => {
  const w = world(on, { notGit: true })
  const r = await bash($, 'git add -A')
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git add -A'])
})

test('contents never leave: not in the question, log, toast, deny or any argv', async ($, on) => {
  const csv = 'email,id\nsecret.person@example.org,7\n'
  const w = world(on, { answer: 'Fix it', repo: { staged: staged('p.csv', 'n.ipynb'), files: { 'p.csv': csv, 'n.ipynb': dirtyNotebook() } } })
  const r = await bash($, 'git commit -m x')
  const all = everything(w, r) + JSON.stringify(w.argvs)
  expect(all).not.toContain('secret.person')
  expect(all).not.toContain('SECRETVALUE')
})
