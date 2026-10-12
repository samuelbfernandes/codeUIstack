import { test, expect } from 'claude-code/testing'

import { classify } from '../hooks/classify'
import { dialogText, summaryLines } from '../hooks/format'
import { measure } from '../hooks/measure'
import type { Run, RunResult } from '../hooks/measure'
import { assessLoss, parseStatusZ, statusEntries } from '../hooks/recover'

const cfg = { maxListed: 40 }
const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const bad = (stderr = 'boom', exitCode = 128): RunResult => ({ exitCode, stdout: '', stderr })
const Z = (...e: string[]) => e.join('\0') + '\0'

// Scripted runner: first matching rule wins; an unscripted probe throws (and must be caught by assessLoss).
function fake(rules: [RegExp, RunResult][]) {
  const seen: { argv: string[]; cwd?: string }[] = []
  const run: Run = async (argv, cwd) => {
    seen.push({ argv: [...argv], cwd })
    const line = argv.join(' ')
    for (const [re, res] of rules) if (re.test(line)) return res
    throw new Error(`unscripted probe: ${line}`)
  }
  return { run, seen }
}

// A repository at /w with a remote; paths under it. `status` is the porcelain -z text.
const repo = (status: string, o: { tracked?: number; unpushed?: string; remotes?: string } = {}) => [
  [/-type d -print$/, ok('')],
  [/rev-parse --show-toplevel$/, ok('/w\n')],
  [/ -name \.git -prune/, ok('')],
  [/ remote$/, ok(o.remotes ?? 'origin\n')],
  [/ status --porcelain=v1 -z --ignored/, ok(status)],
  [/ ls-files -z/, ok(Array.from({ length: o.tracked ?? 3 }, (_, k) => `f${k}`).join('\0') + '\0')],
  [/ log --format=%h %s/, ok(o.unpushed ?? '')],
] as [RegExp, RunResult][]

test('parseStatusZ: classes, renames, and entries that are already gone', () => {
  const p = parseStatusZ(Z(' M R/a.R', 'M  R/b.R', 'MM R/c.R', 'A  R/new.R', '?? data/raw.csv', '!! build/', 'R  new.R', 'old.R', ' D gone.R', 'D  staged-gone.R', 'UU clash.R'))
  expect(p.changed).toEqual(['modified  R/a.R', 'staged  R/b.R', 'staged+modified  R/c.R', 'new (staged)  R/new.R', 'renamed (staged)  new.R', 'CONFLICT  clash.R'])
  expect(p.untracked).toEqual(['data/raw.csv'])
  expect(p.ignored).toEqual(['build/'])
  expect(parseStatusZ('')).toEqual({ changed: [], untracked: [], ignored: [] })
})

test('uncommitted + untracked + ignored work is flagged HIGH and listed', async () => {
  const { run } = fake([
    [/^find \/w\/build ! -type d -print$/, ok('/w/build/a.o\n/w/build/b.o\n')], // before the generic "-type d" rule
    ...repo(Z(' M R/a.R', '?? R/c.R', '!! build/')),
  ])
  const a = await assessLoss(run, ['/w/R/a.R', '/w/R/c.R', '/w/build'], cfg)
  expect(a.risk.level).toBe('high')
  expect(a.risk.headline).toContain('1 file with uncommitted changes')
  expect(a.risk.headline).toContain('1 untracked path')
  expect(a.risk.headline).toContain('1 git-ignored path')
  const titles = a.groups.map(g => g.title).join('|')
  expect(titles).toContain('Uncommitted changes (gone for good)')
  expect(titles).toContain('Untracked, never committed')
  expect(a.groups.find(g => g.title.startsWith('Git-ignored'))!.rows).toEqual(['build/  (2 files)'])
})

test('unpushed commits are listed; a clean pushed file is LOW', async () => {
  const unpushed = fake(repo('', { unpushed: '3d1b282 local only\n' }))
  const u = await assessLoss(unpushed.run, ['/w/R/d.R'], cfg)
  expect(u.risk.level).toBe('high')
  expect(u.groups[0]!.title).toContain('Committed, not pushed')
  expect(u.groups[0]!.rows).toEqual(['3d1b282 local only'])

  const clean = fake(repo(''))
  const c = await assessLoss(clean.run, ['/w/README.md'], cfg)
  expect(c.risk.level).toBe('low')
  expect(c.risk.headline).toContain('pushed (as of your last fetch)')
  expect(c.groups).toEqual([])
})

test('a repository with no remote: committed is local-only, and no commit-by-commit "unpushed" noise', async () => {
  const { run, seen } = fake(repo('', { remotes: '' }))
  const a = await assessLoss(run, ['/w/a.R'], cfg)
  expect(a.risk.level).toBe('low')
  expect(a.risk.headline).toContain('no remote')
  expect(a.notes.join()).toContain('No remote')
  expect(seen.some(s => s.argv.includes('log'))).toBe(false)
})

test('files outside any git repository are gone for good', async () => {
  const { run } = fake([
    [/-type d -print$/, ok('')],
    [/rev-parse --show-toplevel$/, bad('fatal: not a git repository')],
    [/ -name \.git -prune/, ok('')],
  ])
  const a = await assessLoss(run, ['/tmp/scratch/z.txt'], cfg)
  expect(a.risk.level).toBe('high')
  expect(a.groups[0]!.title).toContain('Outside git')
  expect(a.groups[0]!.rows).toEqual(['/tmp/scratch/z.txt'])
})

test('deleting a whole repository counts local-only commits and stashes', async () => {
  const { run } = fake([
    [/find \/w -maxdepth 0 -type d -print$/, ok('/w\n')],
    [/rev-parse --show-toplevel$/, ok('/w\n')],
    [/ -name \.git -prune/, ok('/w/.git\n')],
    [/ remote$/, ok('origin\n')],
    [/ status --porcelain=v1/, ok('')],
    [/ ls-files -z/, ok('a\0b\0')],
    [/ log --format/, ok('')],
    [/rev-list --count/, ok('4\n')],
    [/ stash list$/, ok('stash@{0}: WIP on main\nstash@{1}: WIP on dev\n')],
    [/ worktree list$/, ok('/w abc [main]\n')],
  ])
  const a = await assessLoss(run, ['/w'], cfg)
  expect(a.risk.level).toBe('high')
  expect(a.groups[0]!.title).toContain('Whole repositories inside')
  expect(a.groups[0]!.rows[0]).toContain('4 commits on no remote')
  expect(a.groups[0]!.rows[0]).toContain('2 stashes')
})

test('a failed probe never reads as safe: level unknown and a note', async () => {
  const { run } = fake([[/-type d -print$/, ok('')], [/rev-parse/, ok('/w\n')], [/ -name \.git/, ok('')], [/ remote$/, ok('origin\n')], [/ status /, bad('fatal: index file corrupt')]])
  const a = await assessLoss(run, ['/w/x'], cfg)
  expect(a.risk.level).toBe('unknown')
  expect(a.risk.headline).toContain('assume nothing is recoverable')
  expect(a.notes.join()).toContain('index file corrupt')
  // and a totally broken runner:
  const broken = await assessLoss(async () => { throw new Error('spawn failed') }, ['/w/x'], cfg)
  expect(broken.risk.level).toBe('unknown')
})

test('probes are read-only git/find argv with literal pathspecs; paths with glob characters stay literal', async () => {
  const { run, seen } = fake(repo(Z('?? we ird[1].txt')))
  await assessLoss(run, ['/w/we ird[1].txt'], cfg)
  const gits = seen.filter(s => s.argv[0] === 'git')
  expect(gits.length).toBeGreaterThan(0)
  for (const g of gits) {
    expect(g.argv).toContain('--literal-pathspecs')
    expect(g.argv.some(a => /^(add|commit|reset|clean|checkout|rm|push|stash)$/.test(a) && a !== 'stash')).toBe(false)
  }
  expect(seen.every(s => ['git', 'find'].includes(s.argv[0]!))).toBe(true)
})

test('rm -rf: the confirmation text leads with the RISK line, and the refusal the model reads carries it', async () => {
  const rules = [
    [/^find \/w\/R -maxdepth 0 -print$/, ok('/w/R\n')],
    [/^find \/w\/R -maxdepth 0 -type d -print$/, ok('/w/R\n')],
    [/^du -sk \/w\/R$/, ok('12\t/w/R\n')],
    [/^find \/w\/R ! -type d -print$/, ok('/w/R/a.R\n')],
    [/^find \/w\/R -mindepth 1 -maxdepth 1$/, ok('/w/R/a.R\n')],
    [/^find \/w\/R\/a.R -maxdepth 0 -type d -print$/, ok('')],
    [/^du -sk \/w\/R\/a.R$/, ok('4\t/w/R/a.R\n')],
    ...repo(Z(' M R/a.R')).filter(([re]) => !/-type d -print\$/.test(re.source)),
  ] as [RegExp, RunResult][]
  const { run } = fake(rules)
  const f = classify('rm -rf R', { cwd: '/w', home: '/home/sam' })
  const rep = await measure(run, f[0]!, cfg)
  expect(rep.risk?.level).toBe('high')
  const text = dialogText('rm -rf R', [rep], 0, '/w')
  const at = (s: string) => text.indexOf(s)
  expect(text.split('\n')[0]).toBe('🔴 High risk · deletes R/') // the level and the action come first
  expect(at('modified  R/a.R')).toBeGreaterThan(-1)
  expect(at('modified  R/a.R')).toBeLessThan(at('Deletes')) // the data-loss facts come before the file list
  expect(summaryLines([rep]).join('\n')).toContain('🔴 High risk · deletes R/')
})

test('git clean and git reset --hard state what is lost forever', async () => {
  const r = fake([
    [/ clean -n -d --/, ok('Would remove notes.txt\n')],
    [/-maxdepth 0 -print$/, ok('/w/notes.txt\n')],
    [/-maxdepth 0 -type d -print$/, ok('')],
    [/^du -sk/, ok('4\t/w/notes.txt\n')],
    [/^find .* ! -type d/, ok('')],
    ...repo('', {}).filter(([re]) => !/-type d -print\$/.test(re.source)),
  ])
  const clean = await measure(r.run, classify('git clean -fd', { cwd: '/w', home: '/home/sam' })[0]!, cfg)
  expect(clean.risk?.headline).toContain('never committed')

  const reset = fake([
    [/ diff --name-status HEAD/, ok('M\tR/a.R\nM\tR/b.R\n')],
    [/ diff --shortstat HEAD/, ok(' 2 files changed, 9 insertions(+)\n')],
    [/ log --oneline/, ok('')],
  ])
  const rep = await measure(reset.run, classify('git reset --hard', { cwd: '/w', home: '/home/sam' })[0]!, cfg)
  expect(rep.risk?.level).toBe('high')
  expect(rep.risk?.headline).toContain('2 tracked files')
})

test('statusEntries: raw letters and paths, renames keep the new path only', () => {
  expect(statusEntries(Z(' M a.R', '?? b.R', 'R  new.R', 'old.R', '!! build/'))).toEqual([
    { xy: ' M', path: 'a.R' }, { xy: '??', path: 'b.R' }, { xy: 'R ', path: 'new.R' }, { xy: '!!', path: 'build/' },
  ])
})

// A whole repository is a hard loss only when something in it exists nowhere else.
const wholeRepo = (o: { local?: string; stash?: string; wt?: string; remotes?: string }) => fake([
  [/find \/w -maxdepth 0 -type d -print$/, ok('/w\n')],
  [/rev-parse --show-toplevel$/, ok('/w\n')],
  [/ -name \.git -prune/, ok('/w/.git\n')],
  [/ remote$/, ok(o.remotes ?? 'origin\n')],
  [/ status --porcelain=v1/, ok('')],
  [/ ls-files -z/, ok('a\0b\0')],
  [/ log --format/, ok('')],
  [/rev-list --count/, ok(o.local ?? '0\n')],
  [/ stash list$/, ok(o.stash ?? '')],
  [/ worktree list$/, ok(o.wt ?? '/w abc [main]\n')],
])

test('a clean whole repository with every commit pushed, no stash and no worktree is LOW; any one of those makes it HIGH', async () => {
  const clean = await assessLoss(wholeRepo({}).run, ['/w'], cfg)
  expect(clean.risk.level).toBe('low')
  expect(clean.risk.headline).toContain('no local-only commits or stashes')
  expect(clean.groups[0]!.title).toContain('Whole repositories inside') // still named
  for (const o of [{ local: '1\n' }, { stash: 'stash@{0}: WIP\n' }, { wt: '/w abc [main]\n/wt def [x]\n' }, { remotes: '' }]) {
    const a = await assessLoss(wholeRepo(o).run, ['/w'], cfg)
    expect(a.risk.level, JSON.stringify(o)).toBe('high')
  }
})
