import { test, expect } from 'claude-code/testing'

import { classify } from '../hooks/classify'
import {
  expandGlob, findPreviewArgs, fmtBytes, measure, parseCleanDryRun, parseDu, parseNameStatus,
} from '../hooks/measure'
import type { Report, Run, RunResult } from '../hooks/measure'

const cfg = { maxListed: 40 }
const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const fail = (stderr: string, exitCode = 1): RunResult => ({ exitCode, stdout: '', stderr })

// A scripted runner. Every probe is recorded; an argv nobody scripted throws, which
// also proves the measurer asks nothing it was not meant to.
function fake(script: [RegExp, RunResult | ((argv: string[], cwd?: string) => RunResult)][]) {
  const seen: { argv: string[]; cwd?: string }[] = []
  const run: Run = async (argv, cwd) => {
    seen.push({ argv: [...argv], cwd })
    const line = argv.join(' ')
    for (const [re, res] of script) if (re.test(line)) return typeof res === 'function' ? res([...argv], cwd) : res
    throw new Error(`unscripted probe: ${line}`)
  }
  return { run, seen }
}

const only = (cmd: string, cwd = '/work') => classify(cmd, { cwd, home: '/home/sam' })[0]!
const rows = (r: Report) => r.groups.flatMap(g => g.rows)

test('parsers', () => {
  expect(fmtBytes(0)).toBe('0 B')
  expect(fmtBytes(1536)).toBe('1.5 KB')
  expect(fmtBytes(40 * 1024 * 1024)).toBe('40 MB')
  expect([...parseDu('12\t/a b\n1048576\t/c\nnonsense\n')]).toEqual([['/a b', 12], ['/c', 1048576]])
  expect(parseNameStatus('M\tsrc/a.R\nD\told.R\nR100\ta.R\tb.R\n')).toEqual(['M  src/a.R', 'D  old.R', 'R  a.R -> b.R'])
  expect(parseCleanDryRun('Would remove build/\nWould remove a.txt\nWould skip repository sub/\nnoise')).toEqual(['build', 'a.txt', 'sub'])
})

test('find preview swaps -delete / -exec rm for -print and never keeps anything executable', () => {
  expect(findPreviewArgs(['.', '-name', '*.o', '-delete'])!.argv).toEqual(['.', '-name', '*.o', '-print'])
  expect(findPreviewArgs(['/tmp', '-type', 'f', '-exec', 'rm', '{}', ';'])!.argv).toEqual(['/tmp', '-type', 'f', '-print'])
  expect(findPreviewArgs(['.', '-exec', 'rm', '-rf', '{}', '+'])!.argv).toEqual(['.', '-print'])
  const filter = findPreviewArgs(['.', '-exec', 'grep', '-q', 'x', '{}', ';', '-delete'])!
  expect(filter.argv).toEqual(['.', '-print'])
  expect(filter.note).toContain('-exec')
  for (const a of [['.', '-fprint', '/etc/passwd', '-delete'], ['.', '-fls', 'x']]) expect(findPreviewArgs(a)).toBeUndefined()
  for (const a of [['.', '-exec', 'sh', '-c', 'rm {}', ';'], ['.', '-okdir', 'rm', '{}', ';']])
    expect(findPreviewArgs(a)!.argv.some(x => /exec|ok|^rm$/.test(x))).toBe(false)
})

test('rm -rf of one directory: size, file count, biggest children, all by argv', async () => {
  const { run, seen } = fake([
    [/^find \/work\/build -maxdepth 0 -print$/, ok('/work/build\n')],
    [/^find \/work\/build -maxdepth 0 -type d -print$/, ok('/work/build\n')],
    [/^du -sk \/work\/build$/, ok('39100\t/work/build\n')],
    [/^find \/work\/build ! -type d -print$/, ok('/work/build/a.o\n/work/build/b.o\n/work/build/sub/c.o\n')],
    [/^find \/work\/build -mindepth 1 -maxdepth 1$/, ok('/work/build/a.o\n/work/build/sub\n')],
    [/^find \/work\/build\/a.o \/work\/build\/sub -maxdepth 0 -type d -print$/, ok('/work/build/sub\n')],
    [/^du -sk \/work\/build\/a.o \/work\/build\/sub$/, ok('100\t/work/build/a.o\n9000\t/work/build/sub\n')],
  ])
  const r = await measure(run, only('rm -rf build'), cfg)
  expect(r.unmeasured).toBeUndefined()
  expect(rows(r)[0]).toBe('build/ · 3 files, 38 MB')
  expect(r.groups[1]!.rows).toEqual(['sub/ · 8.8 MB', 'a.o · 100 KB'])
  expect(r.summary).toEqual(['1 item, 3 files, 38 MB'])
  // nothing a shell could evaluate: only find / du, with absolute paths
  expect(seen.every(s => ['find', 'du', 'git'].includes(s.argv[0]!))).toBe(true) // git: the read-only risk probes
})

test('listing is capped with +N more', async () => {
  const names = Array.from({ length: 12 }, (_, k) => `/work/f${k}.txt`)
  const { run } = fake([
    [/-maxdepth 0 -type d -print$/, ok('')],
    [/-maxdepth 0 -print$/, ok(names.join('\n'))],
    [/^du -sk/, ok(names.map(n => `4\t${n}`).join('\n'))],
  ])
  const f = only(`rm -rf ${names.join(' ')}`)
  const r = await measure(run, f, { maxListed: 5 })
  expect(r.groups[0]!.rows).toHaveLength(5)
  expect(r.groups[0]!.more).toBe(7)
  expect(r.summary[0]).toBe('12 items, 48 KB')
})

test('a missing target is reported as such, not as an error', async () => {
  const { run } = fake([[/maxdepth 0/, ok('')]])
  const r = await measure(run, only('rm -rf nothing-here'), cfg)
  expect(r.unmeasured).toBeUndefined()
  expect(rows(r)[0]).toContain('does not exist')
  expect(r.summary[0]).toContain('nothing exists')
})

test('a failing probe means "could not measure", never a pass', async () => {
  const run: Run = async () => {
    throw new Error('spawn du ENOENT')
  }
  for (const cmd of ['rm -rf build', 'git reset --hard', 'find . -delete', 'git push -f', 'git clean -fd', 'truncate -s0 f']) {
    const r = await measure(run, only(cmd), cfg)
    expect(r.unmeasured).toContain('ENOENT')
    expect(r.skip).toBeUndefined()
  }
})

test('unresolvable targets and xargs are named, not guessed', async () => {
  const { run, seen } = fake([])
  const r1 = await measure(run, only('cd "$D" && rm -rf out'), cfg)
  expect(r1.notes[0]).toContain('could not resolve out')
  const r2 = await measure(run, only('ls | xargs rm -rf'), cfg)
  expect(r2.unmeasured).toContain('stdin')
  expect(seen).toHaveLength(0)
})

test('glob targets are expanded with find -path at the glob depth; dot-files are skipped like the shell does', async () => {
  const { run, seen } = fake([[/^find \/work\/out -mindepth 1 -maxdepth 1 -path \/work\/out\/\*\.png$/, ok('/work/out/a.png\n/work/out/.hidden.png\n/work/out/b.png\n')]])
  const t = only('rm out/*.png').targets[0]!
  expect(await expandGlob(run, t)).toEqual(['/work/out/a.png', '/work/out/b.png'])
  expect(seen[0]!.argv).toContain('-path')
  const deep = fake([[/-mindepth 2 -maxdepth 2 -path \/work\/\*\/build/, ok('/work/x/build\n/work/.git/build\n')]])
  expect(await expandGlob(deep.run, only('rm -rf */build').targets[0]!)).toEqual(['/work/x/build'])
})

test('conditional redirect: empty or new file is dropped, non-empty is held', async () => {
  const none = fake([[/-size \+0c -print$/, ok('')]])
  expect((await measure(none.run, only('echo hi > new.txt'), cfg)).skip).toBe(true)
  const full = fake([
    [/-size \+0c -print$/, ok('/work/notes.txt\n')],
    [/-maxdepth 0 -print$/, ok('/work/notes.txt\n')],
    [/-maxdepth 0 -type d -print$/, ok('')],
    [/^du -sk/, ok('8\t/work/notes.txt\n')],
  ])
  const r = await measure(full.run, only('echo hi > notes.txt'), cfg)
  expect(r.skip).toBeUndefined()
  expect(rows(r)[0]).toBe('notes.txt · 8 KB')
  const broken: Run = async () => {
    throw new Error('boom')
  }
  expect((await measure(broken, only('echo hi > notes.txt'), cfg)).unmeasured).toBe('boom') // cannot tell: hold
})

test('mv -f / cp -f: only held when something would really be replaced', async () => {
  const none = fake([[/maxdepth 0/, ok('')]])
  expect((await measure(none.run, only('mv -f a b'), cfg)).skip).toBe(true)
  const some = fake([
    [/-type f -print$/, ok('/work/b\n')],
    [/-maxdepth 0 -print$/, ok('/work/b\n')],
    [/-maxdepth 0 -type d -print$/, ok('')],
    [/^du -sk/, ok('2\t/work/b\n')],
  ])
  const r = await measure(some.run, only('mv -f a b'), cfg)
  expect(r.skip).toBeUndefined()
  expect(rows(r)[0]).toContain('b · 2 KB')
})

test('find -delete is previewed with -print in its own directory', async () => {
  const { run, seen } = fake([
    [/^find \. -name \*\.o -print$/, ok('./a.o\n./sub/b.o\n')],
    [/^du -sk \/work\/a\.o \/work\/sub\/b\.o$/, ok('4\t/work/a.o\n8\t/work/sub/b.o\n')],
  ])
  const r = await measure(run, only('find . -name "*.o" -delete'), cfg)
  expect(rows(r)).toEqual(['a.o  4 KB', 'sub/b.o  8 KB'])
  expect(r.summary[0]).toBe('2 matches, 12 KB')
  expect(seen[0]!.cwd).toBe('/work')
  expect(seen.some(s => s.argv.includes('-delete') || s.argv.includes('-exec'))).toBe(false)
})

test('git reset --hard lists reverted files and dropped commits', async () => {
  const { run, seen } = fake([
    [/diff --name-status origin\/main$/, ok('M\tR/a.R\nD\tb.R\n')],
    [/diff --shortstat origin\/main$/, ok(' 2 files changed, 10 insertions(+), 3 deletions(-)\n')],
    [/log --oneline -n 41 origin\/main\.\.HEAD$/, ok('abc1234 wip\ndef5678 more wip\n')],
  ])
  const r = await measure(run, only('git reset --hard origin/main'), cfg)
  expect(r.groups[0]!.rows).toEqual(['M  R/a.R', 'D  b.R'])
  expect(r.groups[1]!.rows).toEqual(['abc1234 wip', 'def5678 more wip'])
  expect(r.summary[0]).toContain('2 files changed')
  expect(seen.every(s => s.argv[0] === 'git' && s.argv.includes('--no-optional-locks'))).toBe(true)
})

test('git refuses to be an option injector: odd refs are not measured', async () => {
  const { run, seen } = fake([])
  const r = await measure(run, only('git push --force origin "+--output=/tmp/x:main"'), cfg)
  expect(r.unmeasured).toContain('unusual ref')
  expect(seen).toHaveLength(0)
  await measure(run, only('git branch -D --output=/tmp/x'), cfg) // a dash word is a flag, never a branch name
  expect(seen).toHaveLength(0)
})

test('git checkout . / restore . show the unstaged changes that would go', async () => {
  const { run } = fake([
    [/diff --name-status -- \.$/, ok('M\ta.R\n')],
    [/diff --shortstat -- \.$/, ok(' 1 file changed, 1 insertion(+)\n')],
  ])
  const r = await measure(run, only('git checkout -- .'), cfg)
  expect(r.groups[0]!.rows).toEqual(['M  a.R'])
  expect((await measure(run, only('git restore .'), cfg)).groups[0]!.rows).toEqual(['M  a.R'])
})

test('git clean -fd is previewed with -n and the same -d/-x flags', async () => {
  const { run, seen } = fake([
    [/git --no-optional-locks --no-pager clean -n -d -x --$/, ok('Would remove tmp/\nWould remove x.log\n')],
    [/-maxdepth 0 -print$/, ok('/work/tmp\n/work/x.log\n')],
    [/-maxdepth 0 -type d -print$/, ok('/work/tmp\n')],
    [/^du -sk/, ok('10\t/work/tmp\n1\t/work/x.log\n')],
    [/^find \/work\/tmp ! -type d -print$/, ok('/work/tmp/a\n')],
  ])
  const r = await measure(run, only('git clean -fdx'), cfg)
  expect(rows(r)).toEqual(['tmp/ · 1 file, 10 KB', 'x.log · 1 KB'])
  expect(seen[0]!.argv).toContain('-n')
  expect(seen[0]!.argv).not.toContain('-f')
})

test('forced push shows what the remote would lose and what would be sent', async () => {
  const { run } = fake([
    [/log --oneline -n 41 HEAD\.\.origin\/main$/, ok('r1 remote work\n')],
    [/log --oneline -n 41 origin\/main\.\.HEAD$/, ok('l1 mine\nl2 mine too\n')],
  ])
  const r = await measure(run, only('git push --force origin main'), cfg)
  // refspec "main" means local main -> origin/main
  expect(r.unmeasured).toBeDefined() // `main..origin/main` was not scripted: the probe failed, so we say so
  const pair = fake([
    [/log --oneline -n 41 HEAD\.\.origin\/main$/, ok('r1 remote work\n')],
    [/log --oneline -n 41 origin\/main\.\.HEAD$/, ok('l1 mine\nl2 mine too\n')],
  ])
  const r2 = await measure(pair.run, only('git push --force origin HEAD:main'), cfg)
  expect(r2.groups[0]!.rows).toEqual(['r1 remote work'])
  expect(r2.groups[1]!.rows).toEqual(['l1 mine', 'l2 mine too'])
  expect(r2.summary[0]).toBe('1 remote commit lost, 2 commits sent')
  const up = fake([
    [/log --oneline -n 41 HEAD\.\.@\{u\}$/, ok('')],
    [/log --oneline -n 41 @\{u\}\.\.HEAD$/, ok('l1 mine\n')],
  ])
  expect((await measure(up.run, only('git push -f'), cfg)).summary[0]).toBe('0 remote commits lost, 1 commit sent')
})

test('git push --delete names the remote branch', async () => {
  const { run } = fake([[/log --oneline -n 5 origin\/old$/, ok('c3 last\nc2 before\n')]])
  const r = await measure(run, only('git push origin --delete old'), cfg)
  expect(r.groups[0]!.title).toContain('origin/old is deleted')
  expect(r.groups[0]!.rows).toHaveLength(2)
})

test('git branch -D lists commits only on that branch and how to undo', async () => {
  const { run } = fake([
    [/log --oneline -n 41 topic --not --exclude=topic --branches --tags --remotes$/, ok('t2 two\nt1 one\n')],
    [/rev-parse --short topic$/, ok('t2abcde\n')],
  ])
  const r = await measure(run, only('git branch -D topic'), cfg)
  expect(r.groups[0]!.rows).toEqual(['t2 two', 't1 one'])
  expect(r.notes).toContain('Undo: git branch topic t2abcde')
})

test('git stash drop / clear', async () => {
  const { run } = fake([
    [/stash show --stat stash@\{0\}$/, ok(' a.R | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n')],
    [/stash list$/, ok('stash@{0}: WIP on main\nstash@{1}: WIP on dev\n')],
  ])
  const d = await measure(run, only('git stash drop'), cfg)
  expect(d.groups[0]!.rows).toEqual([' a.R | 2 +-'])
  expect(d.summary[0]).toContain('1 file changed')
  const c = await measure(run, only('git stash clear'), cfg)
  expect(c.summary[0]).toBe('2 stashes')
})

test('SQL, mkfs, dd to a device, custom patterns: held with an honest "could not measure"', async () => {
  const { run, seen } = fake([])
  const sql = await measure(run, only('psql -c "DROP TABLE users"'), cfg)
  expect(sql.unmeasured).toContain('not inspected')
  expect(sql.groups[0]!.rows[0]).toContain('DROP TABLE users')
  expect(sql.action).toBeUndefined() // the dialog words it: "runs destructive SQL"
  expect((await measure(run, only('mkfs.ext4 /dev/sdb1'), cfg)).unmeasured).toBeDefined()
  const dd = await measure(run, only('dd if=a of=/dev/disk2'), cfg)
  expect(dd.unmeasured).toBeDefined()
  expect(dd.action).toBe('writes over /dev/disk2')
  expect(dd.notes[0]).toContain('Everything on the device is overwritten')
  const custom = classify('./deploy.sh --prod', { cwd: '/work', extraPatterns: [/deploy/] })[0]!
  expect((await measure(run, custom, cfg)).unmeasured).toContain('extra patterns')
  expect(seen).toHaveLength(0)
})

test('cargo clean measures ./target (or --target-dir)', async () => {
  const { run } = fake([
    [/^find \/work\/target -maxdepth 0 -print$/, ok('/work/target\n')],
    [/^find \/work\/target -maxdepth 0 -type d -print$/, ok('/work/target\n')],
    [/^du -sk \/work\/target$/, ok('2048\t/work/target\n')],
    [/^find \/work\/target ! -type d -print$/, ok('/work/target/x\n/work/target/y\n')],
    [/^find \/work\/target -mindepth 1 -maxdepth 1$/, ok('')],
    [/^du -sk$/, ok('')],
    [/^find -maxdepth 0 -type d -print$/, ok('')],
  ])
  const r = await measure(run, only('cargo clean'), cfg)
  expect(rows(r)[0]).toBe('target/ · 2 files, 2 MB')
  expect(r.notes.some(n => n.includes('workspace'))).toBe(true)
})

test('R: literal unlink targets are measured, computed ones are called out', async () => {
  const { run } = fake([
    [/maxdepth 0 -type d -print$/, ok('/work/out\n')],
    [/maxdepth 0 -print$/, ok('/work/out\n')],
    [/^du -sk \/work\/out$/, ok('64\t/work/out\n')],
    [/^find \/work\/out ! -type d -print$/, ok('/work/out/a\n')],
    [/^find \/work\/out -mindepth 1 -maxdepth 1$/, ok('')],
  ])
  const lit = await measure(run, only('Rscript -e \'unlink("out", recursive=TRUE)\''), cfg)
  expect(rows(lit)[0]).toBe('out/ · 1 file, 64 KB')
  const computed = await measure(run, only('Rscript -e \'unlink(file.path(d, "x"), recursive=TRUE)\''), cfg)
  expect(computed.notes.join(' ')).toContain('computed')
})
