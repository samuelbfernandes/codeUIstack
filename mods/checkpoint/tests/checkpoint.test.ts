import { test, expect } from 'claude-code/testing'

import { slash, typed, world } from './world'
import type { World } from './world'

const FILES = { 'a.txt': 'one', 'b.txt': 'two' }
const FORBIDDEN = /^(stash|reset|clean|checkout|switch|commit$|merge|rebase|rm|branch|add .*-f)/
const names = (w: World) => w.refNames()

/** Everything the person owns must be exactly as it was: branch, real index, stash list, and no forbidden command. */
function untouched(w: World) {
  expect(w.branch).toBe('main')
  expect(w.realIndex).toBe('INDEX-v1')
  expect(w.stashes).toEqual([])
  for (const c of w.git()) expect(c.join(' ')).not.toMatch(FORBIDDEN)
  for (const c of w.cmds.filter(c => c.argv[0] === 'git' && ['add', 'write-tree'].includes(c.argv[6]!))) expect(c.env?.GIT_INDEX_FILE).toBeTruthy()
}

test('creates a snapshot with a default name, untracked files included, and says how to go back', async ($, on) => {
  const w = world(on, { files: { ...FILES, 'new.txt': 'untracked' }, tracked: ['a.txt', 'b.txt'] })
  const out = await slash($, '')
  expect(names(w)).toHaveLength(1)
  const name = names(w)[0]!
  expect(name).toMatch(/^cp-\d{8}-\d{6}$/)
  expect(w.treeOf(name)).toEqual({ ...FILES, 'new.txt': 'untracked' })
  expect(w.commits.get(w.sha(name))!.parent).toBe(w.head) // parented on HEAD
  expect(out.text).toContain(`saved ${name}`)
  expect(out.text).toContain('3 files')
  expect(out.text).toContain(`/checkpoint restore ${name}`)
  expect(w.files.get('new.txt')).toBe('untracked') // working tree not changed
  untouched(w)
})

test('a named snapshot, a duplicate name and bad names', async ($, on) => {
  const w = world(on, { files: FILES })
  expect((await slash($, 'before-refactor')).text).toContain('saved before-refactor')
  expect((await slash($, 'before-refactor')).text).toContain('already exists')
  for (const bad of ['Upper', 'has_underscore', '-lead', 'trail-', 'auto-x', 'a'.repeat(61)]) {
    const r = await slash($, bad)
    expect(r.text, bad).toMatch(/lowercase|auto-|usage|\/checkpoint/i)
  }
  expect((await slash($, 'a b c')).text).toContain('/checkpoint [name]')
  expect(names(w)).toEqual(['before-refactor'])
  untouched(w)
})

test('two default-named snapshots in the same second do not collide', async ($, on) => {
  const w = world(on, { files: FILES })
  await slash($, '')
  await slash($, '')
  expect(names(w)).toHaveLength(2)
})

test('list: newest first with age and files changed vs now, at most 20', async ($, on) => {
  const w = world(on, { files: FILES })
  await slash($, 'first')
  await w.tick(2 * 3_600_000)
  w.files.set('a.txt', 'changed')
  await slash($, 'second')
  await w.tick(5 * 60_000)
  w.files.set('c.txt', 'new')
  const out = await slash($, 'list')
  const rows = out.text.split('\n')
  expect(rows[0]).toBe('Checkpoint · 2 saved')
  expect(rows[1]).toBe('second · 5m ago · 1 file changed')
  expect(rows[2]).toBe('first · 2h ago · 2 files changed')
  untouched(w)
})

test('list caps at 20 and counts the rest', async ($, on) => {
  const w = world(on, { files: FILES })
  for (let i = 0; i < 23; i++) {
    await slash($, `cp-${String(i).padStart(2, '0')}`)
    await w.tick(1000)
  }
  const out = await slash($, 'list')
  const rows = out.text.split('\n')
  expect(rows).toHaveLength(1 + 20 + 1)
  expect(rows[1]!.startsWith('cp-22')).toBe(true)
  expect(rows[21]).toBe('+3 older')
  expect(w.state.get('checkpoint.count')).toBe(23)
})

test('list with nothing saved', async ($, on) => {
  world(on, { files: FILES })
  expect((await slash($, 'list')).text).toContain('none saved')
})

test('diff: stat between the snapshot and the working tree, and unknown names', async ($, on) => {
  const w = world(on, { files: FILES })
  await slash($, 'snap')
  expect((await slash($, 'diff snap')).text).toContain('matches the working tree')
  w.files.set('a.txt', 'changed')
  const out = await slash($, 'diff snap')
  expect(out.text).toContain('snap to now')
  expect(out.text).toContain('a.txt')
  expect((await slash($, 'diff nope')).text).toBe('Checkpoint · no checkpoint named nope')
  expect((await slash($, 'diff')).text).toContain('which one')
  untouched(w)
})

/** A tree with 3 edited tracked files, 7 untracked extras, one deleted file, taken after a snapshot. */
async function messy($: any, w: World) {
  await slash($, 'good')
  w.files.set('a.txt', 'EDITED')
  w.files.set('b.txt', 'EDITED')
  for (let i = 0; i < 7; i++) w.files.set(`junk-${i}.txt`, 'x')
  w.files.delete('c.txt')
}

test('restore asks first, listing what would be lost: counts and the first 8 names, options in order', async ($, on) => {
  const w = world(on, { files: { ...FILES, 'c.txt': 'three' }, tracked: ['a.txt', 'b.txt', 'c.txt'] })
  await messy($, w)
  const before = new Map(w.files)
  await slash($, 'restore good')
  expect(w.asks).toHaveLength(1)
  const a = w.asks[0]!
  expect(a.options).toEqual(['Snapshot first, then restore', 'Restore', 'Cancel'])
  expect(a.header).toBe('Checkpoint')
  expect(a.question).toContain('Restore good')
  expect(a.question).toContain('9 files differ')
  expect(a.question).toContain('2 overwritten, 7 deleted')
  expect(a.question).toContain('+1 more') // 9 lost, 8 names shown
  expect(a.question).toContain('1 missing file would come back')
  expect(a.question.split('\n').filter(l => l.startsWith('  ') && !l.includes('+1')).length).toBe(8)
  expect(w.files).toEqual(before) // Cancel (the stub's answer) changed nothing
  untouched(w)
})

for (const answer of ['Cancel', 'REJECT', 'sure, go ahead'])
  test(`answer "${answer}" to the restore dialog changes nothing`, async ($, on) => {
    const w = world(on, { files: { ...FILES, 'c.txt': 'three' }, tracked: ['a.txt', 'b.txt', 'c.txt'], answer })
    await messy($, w)
    const files = new Map(w.files)
    const refs = names(w)
    const out = await slash($, 'restore good')
    expect(out.text).toContain('cancelled, nothing changed')
    expect(w.files).toEqual(files)
    expect(names(w)).toEqual(refs)
    expect(w.git().some(c => c[0] === 'restore')).toBe(false)
    expect(w.cmds.some(c => c.argv[0] === 'rm')).toBe(false)
    untouched(w)
  })

test('Snapshot first, then restore: makes before-restore-<time>, writes files back, removes only the listed untracked ones', async ($, on) => {
  const w = world(on, {
    files: { ...FILES, 'c.txt': 'three' },
    tracked: ['a.txt', 'b.txt', 'c.txt'],
    ignored: { 'node.log': 'ignored' },
    answer: 'Snapshot first, then restore',
  })
  await messy($, w)
  const messyFiles = Object.fromEntries(w.files)
  const out = await slash($, 'restore good')
  expect(Object.fromEntries(w.files)).toEqual({ ...FILES, 'c.txt': 'three' })
  expect(w.ignored.get('node.log')).toBe('ignored') // never in the dialog, never deleted
  const safety = names(w).find(n => n.startsWith('before-restore-'))!
  expect(safety).toMatch(/^before-restore-\d{8}-\d{6}$/)
  expect(w.treeOf(safety)).toEqual(messyFiles) // the copy holds what was there before
  expect(out.text).toContain(`copy saved as ${safety}`)
  expect(out.text).toContain('2 overwritten · 7 deleted · 1 brought back')
  expect(w.state.get('checkpoint.count')).toBe(2)
  const order = w.git().map(c => c[0])
  expect(order.lastIndexOf('update-ref')).toBeLessThan(order.indexOf('restore')) // the copy exists before anything is written
  untouched(w)
})

test('plain Restore makes no safety copy; tracked files absent from the snapshot are restored through git', async ($, on) => {
  const w = world(on, { files: FILES, answer: 'Restore' })
  await slash($, 'good')
  w.files.set('a.txt', 'EDITED')
  w.files.set('new-tracked.txt', 'n')
  w.tracked.add('new-tracked.txt')
  const out = await slash($, 'restore good')
  expect(names(w)).toEqual(['good'])
  expect(Object.fromEntries(w.files)).toEqual(FILES)
  expect(out.text).toContain('restored good')
  expect(w.cmds.some(c => c.argv[0] === 'rm')).toBe(false) // a tracked file goes through git restore, not rm
  untouched(w)
})

test('restore whose snapshot already matches says so and asks nothing', async ($, on) => {
  const w = world(on, { files: FILES, answer: 'Restore' })
  await slash($, 'good')
  const out = await slash($, 'restore good')
  expect(out.text).toContain('already matches')
  expect(w.asks).toHaveLength(0)
})

test('restore of an unknown name or without a name', async ($, on) => {
  const w = world(on, { files: FILES, answer: 'Restore' })
  expect((await slash($, 'restore nope')).text).toBe('Checkpoint · no checkpoint named nope')
  expect((await slash($, 'restore')).text).toContain('which one')
  expect(w.asks).toHaveLength(0)
})

test('a failed safety copy stops the restore', async ($, on) => {
  const w = world(on, { files: FILES, answer: 'Snapshot first, then restore' })
  await slash($, 'good')
  w.files.set('a.txt', 'EDITED')
  const files = new Map(w.files)
  // from now on writing a ref fails
  const refs = w.refs
  w.refs = new Proxy(refs, { get: (t, k) => (k === 'set' ? () => { throw new Error('read-only') } : (t as any)[k]?.bind?.(t) ?? (t as any)[k]) }) as never
  const out = await slash($, 'restore good')
  expect(out.text).toContain('could not save the snapshot')
  expect(out.text).toContain('nothing was lost')
  expect(w.git().some(c => c[0] === 'restore')).toBe(false)
  expect(w.files).toEqual(files)
})

test('drop: confirms first; Cancel and Esc keep it, Drop deletes only the ref', async ($, on) => {
  const w = world(on, { files: FILES })
  await slash($, 'keep')
  for (const a of ['Cancel', 'REJECT']) {
    w.answer = a
    expect((await slash($, 'drop keep')).text).toContain('cancelled')
    expect(names(w)).toEqual(['keep'])
  }
  w.answer = 'Drop'
  const out = await slash($, 'drop keep')
  expect(out.text).toBe('Checkpoint · dropped keep')
  expect(names(w)).toEqual([])
  expect(w.asks[0]!.options).toEqual(['Cancel', 'Drop'])
  expect(w.state.get('checkpoint.count')).toBe(0)
  expect((await slash($, 'drop keep')).text).toContain('no checkpoint named keep')
  untouched(w)
})

test('not a git repository: says so and does nothing', async ($, on) => {
  const w = world(on, { files: FILES, notRepo: true, answer: 'Restore' })
  for (const args of ['', 'x', 'list', 'diff x', 'restore x', 'drop x']) {
    expect((await slash($, args)).text, args).toBe('Checkpoint · this folder is not a git repository, nothing done')
  }
  expect(w.git().every(c => c[0] === 'rev-parse')).toBe(true)
  expect(w.asks).toHaveLength(0)
  expect(w.refs.size).toBe(0)
})

test('never touches the branch, index or stash across a whole session of use', async ($, on) => {
  const w = world(on, { files: FILES, answer: 'Snapshot first, then restore' })
  await slash($, 'one')
  w.files.set('a.txt', 'x')
  await slash($, 'two')
  await slash($, 'list')
  await slash($, 'diff one')
  await slash($, 'restore one')
  w.answer = 'Drop'
  await slash($, 'drop two')
  untouched(w)
  const verbs = new Set(w.git().map(c => c[0]))
  for (const v of verbs) expect(['rev-parse', 'add', 'write-tree', 'commit-tree', 'update-ref', 'for-each-ref', 'ls-tree', 'diff-tree', 'diff', 'ls-files', 'log', 'restore']).toContain(v)
})

test('count atom: set at session start and after changes', async ($, on) => {
  const w = world(on, { files: FILES })
  w.refs.set('refs/moddeck/checkpoints/old', w.head!)
  await $.session.start({ cwd: '/work', isInteractive: true } as never)
  expect(w.registered).toEqual(['checkpoint'])
  expect(w.state.get('checkpoint.count')).toBe(1)
  await slash($, 'new')
  expect(w.state.get('checkpoint.count')).toBe(2)
})

test('enabled=false: the command does nothing', { options: { enabled: false } }, async ($, on) => {
  const w = world(on, { files: FILES })
  expect((await slash($, '')).text).toContain('off')
  expect(w.cmds).toHaveLength(0)
})

// ------------------------------------------------------------ automatic snapshots

const flush = (w: World) => w.tick(400)

test('autoBeforePrompt off (default): a prompt makes no snapshot and runs no git', async ($, on) => {
  const w = world(on, { files: FILES })
  w.files.set('a.txt', 'changed')
  await typed($)
  await flush(w)
  expect(w.cmds).toHaveLength(0)
})

test('auto on: first prompt after changes snapshots as auto-<time>; an unchanged tree does not', { options: { autoBeforePrompt: true } }, async ($, on) => {
  const w = world(on, { files: FILES })
  await typed($)
  await flush(w)
  expect(names(w)).toEqual([]) // clean tree equals HEAD
  w.files.set('a.txt', 'changed')
  await typed($)
  await flush(w)
  expect(names(w)).toHaveLength(1)
  expect(names(w)[0]).toMatch(/^auto-\d{8}-\d{6}$/)
  await w.tick(5000)
  await typed($)
  await flush(w)
  expect(names(w)).toHaveLength(1) // same tree as the newest snapshot
  expect(w.state.get('checkpoint.count')).toBe(1)
  untouched(w)
})

test('auto: only the person\'s own first prompt of a turn', { options: { autoBeforePrompt: true } }, async ($, on) => {
  const w = world(on, { files: FILES })
  w.files.set('a.txt', 'changed')
  await $.prompt.submit({ text: 'x', wait: false, turnId: 't1', origin: { kind: 'composer' } } as never) // typed over a running turn
  await $.prompt.submit({ text: 'x', wait: false, origin: { kind: 'plugin', name: 'other' } } as never)
  await flush(w)
  expect(names(w)).toEqual([])
})

test('auto snapshots are capped at maxAuto; named ones are never deleted', { options: { autoBeforePrompt: true, maxAuto: 3 } }, async ($, on) => {
  const w = world(on, { files: FILES })
  await slash($, 'mine')
  await w.tick(1000)
  for (let i = 0; i < 6; i++) {
    w.files.set('a.txt', `v${i}`)
    await typed($)
    await flush(w)
    await w.tick(2000)
  }
  const autos = names(w).filter(n => n.startsWith('auto-'))
  expect(autos).toHaveLength(3)
  expect(names(w)).toContain('mine')
  // the newest three versions survive
  expect(autos.map(n => w.treeOf(n)['a.txt']).sort()).toEqual(['v3', 'v4', 'v5'])
  expect(w.state.get('checkpoint.count')).toBe(4)
  untouched(w)
})

test('fail-open: with git unavailable a prompt still goes through, auto never throws, a command gives one line', { options: { autoBeforePrompt: true } }, async ($, on) => {
  const w = world(on, { files: FILES, broken: true })
  w.files.set('a.txt', 'changed')
  const r = await typed($)
  await flush(w)
  expect(JSON.stringify(r)).toContain('go on')
  const out = await slash($, '')
  expect(out.text).toMatch(/not a git repository|did not work/)
  await $.session.start({ cwd: '/work', isInteractive: true } as never)
  expect(w.refs.size).toBe(0)
})

test('fail-open: a dead dialog is a cancel, never an error', async ($, on) => {
  const w = world(on, { files: FILES, answer: 'REJECT' })
  await slash($, 'good')
  w.files.set('a.txt', 'EDITED')
  const out = await slash($, 'restore good')
  expect(out.text).toContain('cancelled')
  expect(w.files.get('a.txt')).toBe('EDITED')
})
