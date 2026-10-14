import { test, expect } from 'claude-code/testing'

import { classify } from '../hooks/classify'
import { dialogText, summaryLines } from '../hooks/format'
import {
  assessFolders, classifyName, criticalReason, pruneExpr, regenContext, SAMPLE_CAP, syncHint,
} from '../hooks/folder'
import type { FolderContext, FolderRisk, Row } from '../hooks/folder'
import { measure } from '../hooks/measure'
import type { Run, RunResult } from '../hooks/measure'
import { world } from './world'

// ---- a scripted file system: answers the exact probe shapes the folder scan issues ------------------------------------
// (tests/real-folder.integration.ts runs the same scenarios against real find, du and git.)

const ok = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const bad = (stderr = 'fatal'): RunResult => ({ exitCode: 128, stdout: '', stderr })
const Z = (...e: string[]) => e.join('\0') + (e.length ? '\0' : '')
const nl = (a: string[]) => a.map(x => x + '\n').join('')

type Git = {
  top: string; prefix?: string; remotes?: string[]; status?: string[]; tracked?: string[]
  unpushed?: { sha: string; files: string[] }[]; localCommits?: number; stashes?: number; worktrees?: number
}
type Model = {
  dirs?: string[] // directories (for `-type d` and `-L -type d` tests)
  symlinks?: string[] // the path itself is a symbolic link
  pruned?: string[] // build/cache and .git directories below the folder
  files?: string[] // everything else the walk finds
  innerLinks?: string[]
  changedWithin?: Record<number, string[]> // minutes -> files modified within that many minutes
  kb?: Record<string, number> // du -sk / du -k
  kbOneFs?: Record<string, number> // du -skx (smaller when another filesystem is inside)
  git?: Git // the repository around the folder
  nestedGit?: Record<string, Git> // repositories below it, keyed by their root
  failWalk?: boolean // a tree walk "times out"
}

function fs(m: Model) {
  const seen: { argv: string[]; cwd?: string; timeoutMs?: number }[] = []
  const gitFor = (cwd?: string): Git | undefined => m.nestedGit?.[cwd ?? ''] ?? m.git
  const run: Run = async (argv, cwd, opts) => {
    seen.push({ argv: [...argv], cwd, timeoutMs: opts?.timeoutMs })
    const [prog, ...a] = argv
    const line = argv.join(' ')
    if (prog === 'git') return gitAnswer(a, gitFor(cwd), line)
    if (prog === 'du') {
      const table = a.includes('-skx') ? { ...m.kb, ...m.kbOneFs } : m.kb ?? {}
      return ok(a.filter(x => !x.startsWith('-')).filter(p => table[p] !== undefined).map(p => `${table[p]}\t${p}`).join('\n') + '\n')
    }
    if (prog !== 'find') throw new Error(`unscripted program: ${line}`)
    const dir = a[0]!
    if (a.includes('-L')) return ok(m.dirs?.includes(a[1]!) ? a[1] + '\n' : '')
    if (a.includes('-maxdepth') && a[a.indexOf('-maxdepth') + 1] === '0') {
      const paths = a.filter(x => x.startsWith('/'))
      if (a.includes('l')) return ok(nl(paths.filter(p => m.symlinks?.includes(p))))
      if (a.includes('d')) return ok(nl(paths.filter(p => m.dirs?.includes(p))))
      return ok(nl(paths))
    }
    if (a.includes('-mindepth') && a.includes('-prune')) {
      if (m.failWalk) throw new Error('timed out')
      if (a.at(-1) === '-print' && a.at(-2) === '-prune') return ok(nl(m.pruned ?? []))
      if (a.includes('-mmin')) {
        const mins = Number(a[a.indexOf('-mmin') + 1]!.slice(1))
        return ok(nl(m.changedWithin?.[mins] ?? []))
      }
      if (a.includes('l')) return ok(nl(m.innerLinks ?? []))
      return { exitCode: 0, stdout: nl(m.files ?? []), stderr: '', isStdoutTruncated: false }
    }
    if (line.includes('! -type d -print')) return ok(nl(m.files ?? []))
    if (line.includes('-mindepth 1 -maxdepth 1')) return ok('')
    throw new Error(`unscripted probe: ${line} (dir ${dir})`)
  }
  return { run, seen }
}

function gitAnswer(a: string[], g: Git | undefined, line: string): RunResult {
  if (!g) return bad('fatal: not a git repository')
  const sub = a.filter(x => !x.startsWith('-') && !x.startsWith('core.')).find(x => /^(rev-parse|remote|status|ls-files|log|rev-list|stash|worktree)$/.test(x))
  switch (sub) {
    case 'rev-parse': return ok(`${g.top}\n${g.prefix ?? ''}\n`)
    case 'remote': return ok(nl(g.remotes ?? ['origin']))
    case 'status': return ok(Z(...(g.status ?? [])))
    case 'ls-files': return ok(Z(...(g.tracked ?? [])))
    case 'log': return ok((g.unpushed ?? []).map(c => `\x01${c.sha}\n${c.files.join('\n')}\n`).join(''))
    case 'rev-list': return ok(`${g.localCommits ?? 0}\n`)
    case 'stash': return ok(nl(Array.from({ length: g.stashes ?? 0 }, (_, k) => `stash@{${k}}: WIP`)))
    case 'worktree': return ok(nl(['/w abc [main]', ...Array.from({ length: g.worktrees ?? 0 }, (_, k) => `/wt${k} def [x]`)]))
    default: throw new Error(`unscripted git: ${line}`)
  }
}

const ctx = (o: Partial<FolderContext> = {}): FolderContext => ({ home: '/home/sam', cwd: '/home/sam/proj', runCwd: '/home/sam/proj', mode: 'delete', ...o })
const one = async (m: Model, dir: string, o: Partial<FolderContext> = {}): Promise<{ f: FolderRisk; seen: ReturnType<typeof fs>['seen'] }> => {
  const { run, seen } = fs(m)
  const res = await assessFolders(run, [dir], ctx(o))
  return { f: res.folders[0]!, seen }
}
const text = (f: FolderRisk) => [f.title, ...f.rows.map(([k, v]) => `${k} ${v}`)].join('\n')
const row = (f: FolderRisk, label: string) => f.rows.find(([k]) => k === label)?.[1]
const recoverable = (f: FolderRisk) => f.rows.at(-1)![1] // the value of the closing Recoverable row

// ---- pure helpers ---------------------------------------------------------------------------------------------------

test('classifyName: data, source, secrets, other', () => {
  for (const n of ['a.csv', 'x.tsv', 'fit.RDS', 'g.rda', 'h.RData', 'c.vcf', 'c.vcf.gz', 'a.bcf', 'a.bam', 'a.cram', 'p.fam', 'p.bed', 'p.bim', 'a.h5', 'a.hdf5', 'a.parquet', 'a.feather', 'a.xlsx', 'r.fasta', 'r.fastq', 'a.gz', 'a.zip', 'a.sqlite', 'a.db', 'n.ipynb', 'p.tex', 'p.bib', 'p.docx', 'p.pdf'])
    expect(classifyName(n), n).toBe('data')
  for (const n of ['main.rs', 'a.R', 'run.py', 'Makefile', 'README.md', 'Cargo.toml', 'config.yaml', 'notes.txt']) expect(classifyName(n), n).toBe('source')
  for (const n of ['.env', '.env.local', 'key.pem', 'id_rsa', 'id_ed25519', 'cert.p12', '.netrc', '.Renviron']) expect(classifyName(n), n).toBe('secret')
  expect(classifyName('id_rsa.pub')).toBe('other')
  expect(classifyName('weird.xyz')).toBe('other')
})

test('regenContext: build/cache names, specific parents, renv library; generic names only as the folder itself', () => {
  for (const d of ['/w/node_modules', '/w/target', '/w/build', '/w/dist', '/w/__pycache__', '/w/.venv', '/w/venv', '/w/.cache', '/w/renv/library', '/w/pkg.Rcheck', '/w/.Rproj.user', '/w/.pytest_cache', '/w/x.egg-info'])
    expect(regenContext(d), d).toBeDefined()
  expect(regenContext('/w/node_modules/lodash/lib')).toBe('node_modules') // inside a specific parent
  expect(regenContext('/w/build/docs')).toBeUndefined() // a generic parent does not make a subfolder build output
  expect(regenContext('/w/src')).toBeUndefined()
  expect(regenContext('/w/renv')).toBeUndefined()
})

test('criticalReason: root, home, parents of home, top-level, Desktop/Documents/Downloads, cwd and its parents', () => {
  const c = { home: '/home/sam', cwd: '/home/sam/proj/sub', runCwd: '/home/sam/proj/sub' }
  expect(criticalReason('/', c)).toEqual({ reason: 'the filesystem root', skipScan: true })
  expect(criticalReason('/home/sam', c)).toEqual({ reason: 'your home folder', skipScan: true })
  expect(criticalReason('/home', c)?.skipScan).toBe(true) // a parent of home
  expect(criticalReason('/usr', c)).toEqual({ reason: 'a top-level system folder', skipScan: true })
  expect(criticalReason('/work', c)).toBeUndefined() // an ordinary top-level folder is not on the list
  for (const n of ['Desktop', 'Documents', 'Downloads']) expect(criticalReason(`/home/sam/${n}`, c)).toEqual({ reason: `your ${n} folder`, skipScan: false })
  expect(criticalReason('/home/sam/proj/sub', c)).toEqual({ reason: 'the folder the command runs in', skipScan: false })
  expect(criticalReason('/home/sam/proj', c)).toEqual({ reason: 'a parent of the folder the command runs in', skipScan: false })
  expect(criticalReason('/home/sam/proj/other', c)).toBeUndefined()
  expect(criticalReason('/home/sam/proj/sub/deeper', c)).toBeUndefined() // below the working directory is the ordinary case
  expect(criticalReason('/home/sam/Documents/thesis', c)).toBeUndefined()
  expect(criticalReason('/srv/data', { home: undefined })).toBeUndefined()
})

test('syncHint: hedged wording for synced folders, iCloud Desktop/Documents; nothing for ordinary paths', () => {
  const cases: [string, string][] = [
    ['/Users/s/Library/Mobile Documents/com~apple~CloudDocs/thesis', 'iCloud Drive'],
    ['/Users/s/Dropbox/lab', 'Dropbox'], ['/Users/s/Library/CloudStorage/OneDrive-Uni/x', 'cloud storage'],
    ['/Users/s/OneDrive - Uni/x', 'OneDrive'], ['/Users/s/Google Drive/x', 'Google Drive'],
  ]
  for (const [p, name] of cases) {
    const h = syncHint(p, '/Users/s')!
    expect(h, p).toContain(name)
    expect(h).toContain('may reach your other devices')
    expect(h).toContain('may keep a copy')
    expect(h).toContain('not checked') // hedged: nothing is claimed
    expect(h).not.toContain('\n')
  }
  expect(syncHint('/Users/s/Documents', '/Users/s')).toContain('iCloud')
  expect(syncHint('/Users/s/Documents/thesis', '/Users/s')).toBeUndefined()
  expect(syncHint('/Users/s/proj', '/Users/s')).toBeUndefined()
})

test('pruneExpr prunes build/cache and .git directories and carries nothing executable', () => {
  const e = pruneExpr()
  expect(e).toContain('-prune')
  expect(e).toContain('node_modules')
  expect(e).toContain('.git')
  expect(e).toContain('*.Rcheck')
  expect(e.some(x => /^-(exec|execdir|ok|okdir|delete|fprint)/.test(x))).toBe(false)
  expect(e.filter(x => x === '(').length).toBe(e.filter(x => x === ')').length)
})

// ---- scenarios --------------------------------------------------------------------------------------------------------

test('repository root with local-only work: HIGH, says whole history, stashes and unpushed commits are at stake', async () => {
  const { f, seen } = await one({
    dirs: ['/w'],
    git: { top: '/w', remotes: ['origin'], status: [], tracked: ['/w/a.R', '/w/b.R'].map(p => p.slice(3)), unpushed: [{ sha: 'abc1234', files: ['b.R'] }], localCommits: 2, stashes: 1 },
    pruned: ['/w/.git'], files: ['/w/a.R', '/w/b.R'], kb: { '/w': 300 }, changedWithin: {},
  }, '/w', { cwd: '/elsewhere', runCwd: '/elsewhere' })
  expect(f.level).toBe('high')
  expect(f.complete).toBe(true)
  const t = text(f)
  expect(f.title).toBe('/w/ · High')
  expect(row(f, 'Where')).toBe('Repository root · its history goes too')
  expect(row(f, 'Local only')).toBe('2 commits on no remote, 1 stash')
  expect(row(f, 'Git')).toBe('1 file pushed · 1 commit not pushed')
  expect(recoverable(f)).toBe('Partly · unpushed commits cannot be restored; pushed files can')
  expect(seen.every(s => ['git', 'find', 'du'].includes(s.argv[0]!))).toBe(true)
})

test('a clean, fully pushed repository root is LOW (a fresh clone brings it back)', async () => {
  const { f } = await one({
    dirs: ['/w'], git: { top: '/w', status: [], tracked: ['a.R', 'b.R'] }, pruned: ['/w/.git'], files: ['/w/a.R', '/w/b.R'], kb: { '/w': 80 },
  }, '/w', { cwd: '/elsewhere', runCwd: '/elsewhere' })
  expect(f.level).toBe('low')
  expect(f.headline).toContain('fully pushed')
  expect(recoverable(f)).toBe('Yes · everything except build output is pushed (as of your last fetch)')
  expect(row(f, 'Local only')).toBeUndefined() // nothing local-only: no row
})

test('a repository with only a stash (nothing else lost) is still not "yes": the stash goes with .git', async () => {
  const { f } = await one({
    dirs: ['/w'], git: { top: '/w', status: [], tracked: ['a.R'], stashes: 1 }, pruned: ['/w/.git'], files: ['/w/a.R'], kb: { '/w': 80 },
  }, '/w', { cwd: '/elsewhere', runCwd: '/elsewhere' })
  expect(f.level).toBe('high')
  expect(row(f, 'Local only')).toBe('0 commits on no remote, 1 stash')
  expect(recoverable(f)).toContain('Partly · commits on no remote, stashes or worktrees exist only in the .git that goes too')
})

test('build output folder: LOW, "looks like build output", the tree is not even walked', async () => {
  const { f, seen } = await one({
    dirs: ['/w/node_modules'], git: { top: '/w', prefix: 'node_modules/', status: ['!! node_modules/'], tracked: [] },
    kb: { '/w/node_modules': 130_000 },
  }, '/w/node_modules', { cwd: '/w', runCwd: '/w', known: new Map([['/w/node_modules', { kb: 130_000, files: 21_040 }]]) })
  expect(f.level).toBe('low')
  expect(f.regenerable).toBe(true)
  expect(f.headline).toBe('build output only (regenerable by name)')
  const t = text(f)
  expect(t).toContain('all build output (node_modules)')
  expect(t).toContain('127 MB · 21,040 files')
  expect(recoverable(f)).toBe('Yes · only build output, which a rebuild recreates')
  expect(seen.some(s => s.argv.includes('-type') && s.argv.includes('f') && s.argv.includes('-print'))).toBe(false) // no file listing
})

test('build output inside a project: regenerable directories are named with their size, source stays separate', async () => {
  const { f } = await one({
    dirs: ['/w/pkg'],
    git: { top: '/w', prefix: 'pkg/', status: ['!! pkg/__pycache__/', '!! pkg/.Rproj.user/'], tracked: ['pkg/a.R', 'pkg/b.R'] },
    pruned: ['/w/pkg/__pycache__', '/w/pkg/.Rproj.user'], files: ['/w/pkg/a.R', '/w/pkg/b.R'],
    kb: { '/w/pkg': 700, '/w/pkg/__pycache__': 500, '/w/pkg/.Rproj.user': 100 },
  }, '/w/pkg', { cwd: '/w', runCwd: '/w' })
  expect(f.level).toBe('low')
  expect(f.regenerable).toBe(false) // there is also source
  expect(row(f, 'Contains')).toBe('2 source files · build output: __pycache__/ 500 KB, .Rproj.user/ 100 KB')
})

test('a build/ that git tracks is judged by what is in it, not by its name', async () => {
  const dirty = await one({
    dirs: ['/w/build'], git: { top: '/w', prefix: 'build/', status: [' M build/run.sh'], tracked: ['build/run.sh', 'build/Makefile'] },
    files: ['/w/build/run.sh', '/w/build/Makefile'], kb: { '/w/build': 8 },
  }, '/w/build', { cwd: '/w', runCwd: '/w' })
  expect(dirty.f.level).toBe('high')
  expect(dirty.f.regenerable).toBe(false)
  expect(text(dirty.f)).toContain('2 source files')
  expect(row(dirty.f, 'Git')).toContain('1 modified file')
  const clean = await one({
    dirs: ['/w/build'], git: { top: '/w', prefix: 'build/', status: [], tracked: ['build/run.sh'] }, files: ['/w/build/run.sh'], kb: { '/w/build': 4 },
  }, '/w/build', { cwd: '/w', runCwd: '/w' })
  expect(clean.f.level).toBe('low')
  expect(clean.f.headline).toContain('fully pushed')
})

test('data folder with untracked files: HIGH, counts and sizes per class, the big files named, recent change flagged', async () => {
  const { f } = await one({
    dirs: ['/w/data'],
    git: { top: '/w', prefix: 'data/', status: ['?? data/'], tracked: [] },
    files: ['/w/data/raw.csv', '/w/data/fit.rds', '/w/data/notes.txt', '/w/data/.env'],
    kb: { '/w/data': 217_000, '/w/data/raw.csv': 212_000, '/w/data/fit.rds': 4_000, '/w/data/.env': 4 },
    changedWithin: { 360: ['/w/data/raw.csv'] },
  }, '/w/data', { cwd: '/w', runCwd: '/w', known: new Map([['/w/data', { kb: 217_000, files: 4 }]]) })
  expect(f.level).toBe('high')
  const t = text(f)
  expect(row(f, 'Where')).toBe('Inside repository /w')
  expect(row(f, 'Contains')).toBe('2 data files (211 MB) · 1 likely secret file (4 KB) · 1 source file')
  expect(row(f, 'Size')).toBe('212 MB · 4 files · last edit within 6 hours · likely active work')
  expect(row(f, 'Git')).toBe('4 untracked files')
  expect(row(f, 'At stake')).toBe('raw.csv (207 MB), fit.rds (3.9 MB), .env (4 KB)')
  expect(recoverable(f)).toBe('No · untracked files cannot be restored')
  expect(f.rows.map(([k]) => k)).toEqual(['Where', 'Contains', 'Size', 'Git', 'At stake', 'Recoverable'])
})

test('modified, untracked and ignored data: partly recoverable when part of the folder is pushed', async () => {
  const { f } = await one({
    dirs: ['/w/results'],
    git: { top: '/w', prefix: 'results/', status: [' M results/a.csv', '?? results/b.csv', '!! results/c.rds'], tracked: ['results/a.csv', 'results/old.csv'] },
    files: ['/w/results/a.csv', '/w/results/b.csv', '/w/results/c.rds', '/w/results/old.csv'],
    kb: { '/w/results': 100 },
  }, '/w/results', { cwd: '/w', runCwd: '/w' })
  expect(f.level).toBe('high')
  expect(row(f, 'Git')).toBe('1 file pushed · 1 modified file · 1 untracked file · 1 ignored file')
  expect(recoverable(f)).toBe('Partly · modified files, untracked files, ignored files cannot be restored; pushed files can')
})

test('a fully pushed tracked folder is LOW with "Recoverable: yes"', async () => {
  const { f } = await one({
    dirs: ['/w/src'], git: { top: '/w', prefix: 'src/', status: [], tracked: ['src/a.R', 'src/b.R', 'src/c.py'] },
    files: ['/w/src/a.R', '/w/src/b.R', '/w/src/c.py'], kb: { '/w/src': 12 }, changedWithin: { 43200: ['/w/src/a.R'] },
  }, '/w/src', { cwd: '/w', runCwd: '/w' })
  expect(f.level).toBe('low')
  expect(f.headline).toContain('fully pushed')
  const t = text(f)
  expect(t).toContain('3 source files')
  expect(row(f, 'Git')).toBe('3 files pushed')
  expect(row(f, 'Size')).toBe('12 KB · last edit within 30 days')
  expect(t).not.toContain('active work') // an old change is not "active work"
  expect(recoverable(f).startsWith('Yes')).toBe(true)
})

test('a repository without a remote: a subfolder is LOW (git restore while .git stays), the root is HIGH', async () => {
  const g: Git = { top: '/w', remotes: [], status: [], tracked: ['src/a.R'] }
  const sub = await one({ dirs: ['/w/src'], git: { ...g, prefix: 'src/' }, files: ['/w/src/a.R'], kb: { '/w/src': 4 } }, '/w/src', { cwd: '/w', runCwd: '/w' })
  expect(sub.f.level).toBe('low')
  expect(row(sub.f, 'Git')).toBe('1 file pushed · no remote')
  expect(recoverable(sub.f)).toBe('Yes · git restore brings files back while .git stays; there is no remote copy')
  const root = await one({ dirs: ['/w'], git: g, pruned: ['/w/.git'], files: ['/w/src/a.R'], kb: { '/w': 40 } }, '/w', { cwd: '/x', runCwd: '/x' })
  expect(root.f.level).toBe('high')
})

test('outside any repository: HIGH, nothing to restore from; build output alone is still LOW', async () => {
  const data = await one({ dirs: ['/srv/lab'], files: ['/srv/lab/a.vcf.gz', '/srv/lab/b.bam'], kb: { '/srv/lab': 9000, '/srv/lab/a.vcf.gz': 4000, '/srv/lab/b.bam': 5000 } }, '/srv/lab', { cwd: '/w', runCwd: '/w' })
  expect(data.f.level).toBe('high')
  expect(row(data.f, 'Where')).toBe('Outside git · no history, no remote')
  expect(text(data.f)).toContain('2 data files (8.8 MB)')
  expect(recoverable(data.f)).toBe('No · files outside git cannot be restored')
  const build = await one({ dirs: ['/srv/lab/build'], kb: { '/srv/lab/build': 900 } }, '/srv/lab/build', { cwd: '/w', runCwd: '/w' })
  expect(build.f.level).toBe('low')
  expect(build.f.headline).toBe('build output only (regenerable by name)')
})

test('CRITICAL: home and root are flagged and not walked; cwd and parents are flagged and still described', async () => {
  const home = await one({ dirs: ['/home/sam'] }, '/home/sam')
  expect(home.f.level).toBe('high')
  expect(home.f.rows[0]).toEqual(['Target', 'Your home folder'])
  expect(row(home.f, 'Scan')).toBe('Skipped · too broad to inspect')
  expect(home.seen.length).toBe(1) // only the symlink test
  expect(recoverable(home.f)).toMatch(/^No · /)
  expect(recoverable(home.f)).toContain('Time Machine')
  const root = await one({ dirs: ['/'] }, '/')
  expect(root.f.rows[0]).toEqual(['Target', 'The filesystem root'])
  expect(root.f.title).toBe('/ · High')

  const cwd = await one({
    dirs: ['/home/sam/proj'], git: { top: '/home/sam/proj', status: [], tracked: ['a.R'] }, pruned: ['/home/sam/proj/.git'],
    files: ['/home/sam/proj/a.R'], kb: { '/home/sam/proj': 50 },
  }, '/home/sam/proj')
  expect(cwd.f.level).toBe('high') // even though everything is pushed
  expect(cwd.f.rows[0]).toEqual(['Target', 'The folder the command runs in'])
  expect(row(cwd.f, 'Where')).toContain('Repository root')
  const par = await one({ dirs: ['/home/sam/proj'], files: [], kb: { '/home/sam/proj': 50 } }, '/home/sam/proj', { cwd: '/home/sam/proj/sub', runCwd: '/home/sam/proj/sub' })
  expect(par.f.rows[0]).toEqual(['Target', 'A parent of the folder the command runs in'])
  const docs = await one({ dirs: ['/home/sam/Documents'], files: ['/home/sam/Documents/a.docx'], kb: { '/home/sam/Documents': 8 } }, '/home/sam/Documents')
  expect(docs.f.rows[0]).toEqual(['Target', 'Your Documents folder'])
  expect(text(docs.f)).toContain('may sync with iCloud')
})

test('synced path: a hedged hint, never a claim', async () => {
  const { f } = await one({ dirs: ['/Users/s/Dropbox/thesis'], files: ['/Users/s/Dropbox/thesis/c1.tex'], kb: { '/Users/s/Dropbox/thesis': 8 } }, '/Users/s/Dropbox/thesis', { home: '/Users/s', cwd: '/w', runCwd: '/w' })
  const hint = row(f, 'Note')!
  expect(hint).toBe('Looks synced (Dropbox): deletes may reach your other devices; its trash may keep a copy (not checked)')
  expect(f.level).toBe('high') // the hint informs, the data decides
})

test('a symbolic link as the target: rm acts on the link, not the target; nothing is walked', async () => {
  const del = await one({ symlinks: ['/w/datalink'], dirs: ['/w/real'] }, '/w/datalink', { cwd: '/w', runCwd: '/w' })
  expect(del.f.level).toBe('low')
  expect(del.f.title).toBe('datalink/ (symlink) · Low')
  expect(row(del.f, 'Effect')).toContain('rm removes only the link')
  expect(text(del.f)).toContain('trailing slash')
  expect(recoverable(del.f)).toContain('Yes · only the link goes')
  expect(del.seen.some(s => s.argv.includes('-prune'))).toBe(false)
  const chmod = await one({ symlinks: ['/w/datalink'] }, '/w/datalink', { cwd: '/w', runCwd: '/w', mode: 'modify' })
  expect(chmod.f.level).toBe('medium')
  expect(text(chmod.f)).toContain('chmod -R changes the target of a link named on the command line')
  const crit = await one({ symlinks: ['/home/sam/Documents'] }, '/home/sam/Documents', { cwd: '/w', runCwd: '/w' })
  expect(crit.f.level).toBe('medium') // CRITICAL name, but only the link goes
  expect(crit.f.rows[0]![0]).toBe('Target')
})

test('symlinks inside a folder are counted; "rm removes the links, not what they point to"', async () => {
  const { f } = await one({ dirs: ['/srv/x'], files: ['/srv/x/a.R'], innerLinks: ['/srv/x/l1', '/srv/x/l2'], kb: { '/srv/x': 8 } }, '/srv/x', { cwd: '/w', runCwd: '/w' })
  expect(row(f, 'Note')).toBe('2 symlinks inside: only the links are removed, not their targets')
})

test('another filesystem inside (du -x is smaller): hinted', async () => {
  const { f } = await one({ dirs: ['/srv/x'], files: ['/srv/x/a.R'], kb: { '/srv/x': 500_000 }, kbOneFs: { '/srv/x': 1_000 } }, '/srv/x', { cwd: '/w', runCwd: '/w' })
  expect(row(f, 'Note')).toContain('another filesystem')
  expect(row(f, 'Note')).toContain('--one-file-system')
  const same = await one({ dirs: ['/srv/x'], files: ['/srv/x/a.R'], kb: { '/srv/x': 500 } }, '/srv/x', { cwd: '/w', runCwd: '/w' })
  expect(row(same.f, 'Note')).toBeUndefined()
})

test('nested repositories inside a plain folder: listed, and local-only work in them makes it HIGH', async () => {
  const safe = await one({
    dirs: ['/srv/all'], pruned: ['/srv/all/r1/.git'], files: ['/srv/all/r1/a.R'], kb: { '/srv/all': 100 },
    nestedGit: { '/srv/all/r1': { top: '/srv/all/r1', status: [], tracked: ['a.R'] } },
  }, '/srv/all', { cwd: '/w', runCwd: '/w' })
  expect(safe.f.level).toBe('low')
  expect(safe.f.onlyRepos).toBe(true)
  expect(row(safe.f, 'Includes')).toContain('1 repository, .git too: r1/')
  const risky = await one({
    dirs: ['/srv/all'], pruned: ['/srv/all/r1/.git'], files: ['/srv/all/r1/a.R'], kb: { '/srv/all': 100 },
    nestedGit: { '/srv/all/r1': { top: '/srv/all/r1', status: ['?? new.R'], tracked: ['a.R'], localCommits: 3 } },
  }, '/srv/all', { cwd: '/w', runCwd: '/w' })
  expect(risky.f.level).toBe('high')
  expect(text(risky.f)).toContain('3 commits on no remote')
  expect(text(risky.f)).toContain('1 uncommitted path')
})

test('the sampling cap: only the first files are classified and it says "sampled"', async () => {
  const files = Array.from({ length: SAMPLE_CAP + 50 }, (_, k) => `/srv/big/d${k % 30}/f${k}.txt`)
  const out = await one({ dirs: ['/srv/big'], files, kb: { '/srv/big': 12_000 } }, '/srv/big', { cwd: '/w', runCwd: '/w', known: new Map([['/srv/big', { kb: 12_000, files: files.length }]]) })
  const t = text(out.f)
  expect(t).toContain(`${SAMPLE_CAP.toLocaleString('en-US')} source files · sampled: first 3,000 of 3,050 files`)
  expect(t).toContain('files in the sample, no git history')
  expect(out.f.level).toBe('high')

  // sampled but entirely tracked and pushed: git knows everything, so LOW stands
  const tracked = files.map(p => p.slice('/srv/'.length))
  const pushed = await one({
    dirs: ['/srv/big'], git: { top: '/srv', prefix: 'big/', status: [], tracked }, files, kb: { '/srv/big': 12_000 },
  }, '/srv/big', { cwd: '/w', runCwd: '/w' })
  expect(pushed.f.level).toBe('low')
  expect(text(pushed.f)).toContain('sampled')

  // below the cap nothing says "sampled"
  const small = await one({ dirs: ['/srv/s'], files: files.slice(0, 5), kb: { '/srv/s': 5 } }, '/srv/s', { cwd: '/w', runCwd: '/w' })
  expect(text(small.f)).not.toContain('sampled')
})

test('a tree walk that times out: partial, never LOW, says so', async () => {
  const { f } = await one({ dirs: ['/srv/huge'], failWalk: true, kb: { '/srv/huge': 9_000_000 } }, '/srv/huge', { cwd: '/w', runCwd: '/w' })
  expect(f.complete).toBe(false)
  expect(f.level).toBe('unknown')
  expect(f.rows.some(([k, v]) => k === 'Note' && v.includes('Scan stopped early'))).toBe(true)
  expect(recoverable(f)).toMatch(/^Unknown · /)
})

test('git failing inside the scan: the folder is "not scanned", level unknown (never LOW)', async () => {
  const { run } = fs({ dirs: ['/w/x'], git: { top: '/w', prefix: 'x/' } })
  const broken: Run = async (argv, cwd, opts) => (argv.includes('status') ? bad('fatal: index file corrupt') : run(argv, cwd, opts))
  const res = await assessFolders(broken, ['/w/x'], ctx())
  expect(res.folders[0]!.level).toBe('unknown')
  expect(res.folders[0]!.complete).toBe(false)
  expect(text(res.folders[0]!)).toContain('index file corrupt')
  const dead = await assessFolders(async () => { throw new Error('spawn failed') }, ['/w/x'], ctx())
  expect(dead.folders[0]!.level).toBe('unknown')
})

test('probes are bounded and read-only: only find/du/git argv, a timeout on every one, nothing executable', async () => {
  const { seen } = await one({
    dirs: ['/w/data'], git: { top: '/w', prefix: 'data/', status: ['?? data/'], tracked: [] }, files: ['/w/data/a.csv'], kb: { '/w/data': 4 },
  }, '/w/data', { cwd: '/w', runCwd: '/w' })
  expect(seen.length).toBeGreaterThan(6)
  for (const s of seen) {
    expect(['find', 'du', 'git']).toContain(s.argv[0])
    expect(s.timeoutMs, s.argv.join(' ')).toBe(8000)
    expect(s.argv.some(a => /^-(exec|execdir|ok|okdir|delete|fprint|fls)/.test(a))).toBe(false)
  }
  expect(seen.filter(s => s.argv[0] === 'git').every(s => s.argv.includes('--literal-pathspecs') && s.argv.includes('--no-optional-locks'))).toBe(true)
})

test('only a few folders are assessed per command; the rest is counted', async () => {
  const dirs = ['/w/a', '/w/b', '/w/c', '/w/d', '/w/e']
  const m: Model = { dirs, files: [], kb: Object.fromEntries(dirs.map(d => [d, 1])) }
  const { run } = fs(m)
  const res = await assessFolders(run, dirs, ctx({ cwd: '/x', runCwd: '/x' }))
  expect(res.folders).toHaveLength(3)
  expect(res.skipped).toBe(2)
  // CRITICAL ones are not the ones dropped
  const crit = await assessFolders(run, ['/w/a', '/w/b', '/w/c', '/w/d', '/home/sam'], ctx({ cwd: '/x', runCwd: '/x' }))
  expect(crit.folders[0]!.rows[0]).toEqual(['Target', 'Your home folder'])
})

test('chmod -R mode: contents stay; LOW, MEDIUM when likely secrets are inside; recoverability is "partly"', async () => {
  const plain = await one({ dirs: ['/w/src'], git: { top: '/w', prefix: 'src/', status: [], tracked: ['src/a.R'] }, files: ['/w/src/a.R'], kb: { '/w/src': 4 } }, '/w/src', { cwd: '/w', runCwd: '/w', mode: 'modify' })
  expect(plain.f.level).toBe('low')
  expect(recoverable(plain.f)).toBe('Partly · contents stay; old permissions and owners are not recorded')
  expect(row(plain.f, 'Git')).toBeUndefined() // not a delete: no "gone" lines
  const secrets = await one({ dirs: ['/w/cfg'], files: ['/w/cfg/.env', '/w/cfg/id_rsa'], kb: { '/w/cfg': 8 } }, '/w/cfg', { cwd: '/w', runCwd: '/w', mode: 'modify' })
  expect(secrets.f.level).toBe('medium')
})

test('chmod -R on a CRITICAL folder: HIGH, but still "contents stay", not "gone"', async () => {
  const home = await one({ dirs: ['/home/sam'] }, '/home/sam', { mode: 'modify' })
  expect(home.f.level).toBe('high')
  expect(home.f.rows[0]).toEqual(['Target', 'Your home folder'])
  expect(recoverable(home.f)).toContain('Partly · contents stay')
  expect(recoverable(home.f)).not.toContain('gone')
  const cwd = await one({ dirs: ['/w/p'], files: ['/w/p/a.R'], kb: { '/w/p': 4 } }, '/w/p', { cwd: '/w/p', runCwd: '/w/p', mode: 'modify' })
  expect(cwd.f.level).toBe('high')
  expect(recoverable(cwd.f)).toContain('Partly · contents stay')
})

// ---- through measure(): merged into the RISK line, shown in the dialog and the refusal --------------------------------

const only = (cmd: string, cwd = '/w') => classify(cmd, { cwd, home: '/home/sam' })[0]!

// The measurer's own probes (existence, size, counts, the loss check) plus the folder probes, for one directory /w/<name>.
function project(name: string, m: Model, status: string[], tracked: string[]) {
  const dir = `/w/${name}`
  const model: Model = { dirs: [dir], git: { top: '/w', prefix: `${name}/`, status, tracked }, kb: { [dir]: 100, ...m.kb }, ...m }
  const inner = fs(model)
  const run: Run = async (argv, cwd, opts) => {
    const line = argv.join(' ')
    if (line === `find ${dir} -maxdepth 0 -print`) return ok(dir + '\n')
    if (line === `find ${dir} ! -type d -print`) return ok(nl(model.files ?? []))
    if (line === `find ${dir} -mindepth 1 -maxdepth 1`) return ok('')
    if (/ -name \.git -prune -print$/.test(line) && argv.includes('-maxdepth')) return ok('') // recover.ts: nested repositories
    if (/^find \S+ -maxdepth 0 -type d -print$/.test(line) && argv[1] !== dir) return ok('')
    if (argv[0] === 'git' && argv.includes('--show-toplevel') && !argv.includes('--show-prefix')) return ok('/w\n')
    return inner.run(argv, cwd, opts)
  }
  return { run, seen: inner.seen }
}

test('rm -rf of a build folder: the folder verdict lowers the MEDIUM "ignored files" level to LOW', async () => {
  const { run } = project('build', { files: ['/w/build/a.o', '/w/build/b.o'] }, ['!! build/'], [])
  const rep = await measure(run, only('rm -rf build'), { maxListed: 40, home: '/home/sam', cwd: '/w' })
  expect(rep.unmeasured).toBeUndefined()
  expect(rep.folders).toHaveLength(1)
  expect(rep.risk?.level).toBe('low')
  expect(rep.risk?.headline).toBe('build output only (regenerable by name)')
  expect(summaryLines([rep]).join('\n')).toContain('build/ · Low · Recoverable: Yes')
})

test('rm -rf of a data folder: headline first, then the folder rows, then at most a short list', async () => {
  const { run } = project('data', { files: ['/w/data/raw.csv', '/w/data/b.csv'], kb: { '/w/data/raw.csv': 80_000, '/w/data/b.csv': 4 } }, ['?? data/'], [])
  const rep = await measure(run, only('rm -rf data'), { maxListed: 40, home: '/home/sam', cwd: '/w' })
  expect(rep.risk?.level).toBe('high')
  const t = dialogText('rm -rf data', [rep], 0, '/w')
  const lines = t.split('\n')
  expect(lines[0]).toBe('🔴 High risk · deletes data/')
  expect(lines[1]).toBe('rm -rf data')
  expect(lines[2]).toBe('')
  expect(t).toContain('Recoverable  No · untracked files cannot be restored')
  expect(t).toContain('At stake     raw.csv (78 MB), b.csv (4 KB)')
  expect(t).not.toContain('Runs in') // the command runs in the session directory
  expect(t).not.toContain('Untracked, never committed') // the folder rows already say it
  expect(t.trimEnd().endsWith('Run this command?')).toBe(true)
  expect(lines.filter(l => /^[A-Z][a-z ]+  /.test(l)).length).toBeLessThanOrEqual(7)
  const refusal = summaryLines([rep]).join('\n')
  expect(refusal).toContain('data/ · High · Recoverable: No')
})

test('chmod -R: the folder block provides the impact (the file-level check does not apply)', async () => {
  const { run } = project('src', { files: ['/w/src/a.R'] }, [], ['src/a.R'])
  const rep = await measure(run, only('chmod -R 755 src'), { maxListed: 40, home: '/home/sam', cwd: '/w' })
  expect(rep.risk?.level).toBe('low')
  const t = dialogText('chmod -R 755 src', [rep], 0, '/w')
  expect(t.split('\n')[0]).toBe('🟢 Low risk · changes permissions of src/')
  expect(t).toContain('old permissions and owners are not recorded')
})

test('if the folder scan fails, the listing and the file-level risk stand and a note says why', async () => {
  const { run } = project('data', { files: [] }, ['?? data/'], [])
  const flaky: Run = async (argv, cwd, opts) => {
    if (argv[0] === 'git' && argv.includes('--show-prefix')) throw new Error('git went away')
    return run(argv, cwd, opts)
  }
  const rep = await measure(flaky, only('rm -rf data'), { maxListed: 40, home: '/home/sam', cwd: '/w' })
  expect(rep.unmeasured).toBeUndefined()
  expect(rep.risk?.level).toBe('high') // from the file-level check
  expect(rep.folders?.[0]?.level).toBe('unknown')
  expect(text(rep.folders![0]!)).toContain('git went away')
})

test('find -delete: matched directories get a folder verdict; cp -rf over an existing folder is held with one', async () => {
  const dirs = ['/w/dist']
  const model: Model = { dirs, git: { top: '/w', prefix: 'dist/', status: ['!! dist/'], tracked: [] }, kb: { '/w/dist': 40 }, files: [] }
  const inner = fs(model)
  const run: Run = async (argv, cwd, opts) => {
    const line = argv.join(' ')
    if (line === 'find . -name dist -type d -print') return ok('./dist\n')
    if (/^du -sk \/w\/dist$/.test(line)) return ok('40\t/w/dist\n')
    if (/^find \/w\/dist -maxdepth 0 -type d -print$/.test(line)) return ok('/w/dist\n')
    if (/ -name \.git -prune -print$/.test(line) && argv.includes('-maxdepth')) return ok('')
    if (argv[0] === 'git' && argv.includes('--show-toplevel') && !argv.includes('--show-prefix')) return ok('/w\n')
    return inner.run(argv, cwd, opts)
  }
  const rep = await measure(run, only('find . -name dist -type d -delete'), { maxListed: 40, home: '/home/sam', cwd: '/w' })
  expect(rep.folders?.[0]?.title).toBe('dist/ · Low')

  const cp = fs({ dirs: ['/dest', '/dest/src', '/w/src'], git: { top: '/w', prefix: 'src/', status: [], tracked: ['src/a.R'] }, files: ['/dest/src/a.R'], kb: { '/dest/src': 4 } })
  const run2: Run = async (argv, cwd, opts) => {
    const line = argv.join(' ')
    if (/^find \/dest \/dest\/src -maxdepth 0 -type f -print$/.test(line)) return ok('')
    if (/^find \/w\/src -maxdepth 0 -type d -print$/.test(line)) return ok('/w/src\n')
    if (/^find \/dest\/src -maxdepth 0 -type d -print$/.test(line)) return ok('/dest/src\n')
    if (/^find \/dest -maxdepth 0 -type d -print$/.test(line)) return ok('/dest\n')
    if (/^find \/dest\/src -maxdepth 0 -print$/.test(line)) return ok('/dest/src\n')
    if (/^du -sk \/dest\/src$/.test(line)) return ok('4\t/dest/src\n')
    if (/^find \/dest\/src ! -type d -print$/.test(line)) return ok('/dest/src/a.R\n')
    if (/ -name \.git -prune -print$/.test(line) && argv.includes('-maxdepth')) return ok('')
    if (argv[0] === 'git' && argv.includes('--show-toplevel') && !argv.includes('--show-prefix')) return bad('fatal: not a git repository')
    if (argv[0] === 'git') return bad('fatal: not a git repository')
    return cp.run(argv, cwd, opts)
  }
  const over = await measure(run2, only('cp -rf /w/src /dest'), { maxListed: 40, home: '/home/sam', cwd: '/w' })
  expect(over.skip).toBeUndefined()
  expect(over.groups[0]!.title).toBe('Overwrites or merges into')
  expect(over.folders?.[0]?.path).toBe('/dest/src')
  // and when dest/src does not exist, nothing is held
  const none = await measure(async (argv, cwd, opts) => (/^find \/dest\/src -maxdepth 0 -type d -print$/.test(argv.join(' ')) ? ok('') : run2(argv, cwd, opts)), only('cp -rf /w/src /dest'), { maxListed: 40 })
  expect(none.skip).toBe(true)
})

test('a very long listing never clips away the closing question', () => {
  const rep = {
    finding: only('rm -rf data'), groups: [{ title: 'Deletes', rows: Array.from({ length: 200 }, (_, k) => `file-${k}-${'x'.repeat(150)}`), more: 0 }],
    folders: [{ path: '/w/data', title: 'data/ · High', level: 'high' as const, rows: [['Where', 'x'.padEnd(900, 'y')], ['Recoverable', 'No · x']] as Row[], headline: 'h', regenerable: false, complete: true }],
    summary: [], notes: [],
  }
  const t = dialogText('rm -rf data', [rep], 0)
  expect(t.length).toBeLessThanOrEqual(6000)
  expect(t.trimEnd().endsWith('Run this command?')).toBe(true)
  expect(t).toContain('+195 more') // a list shows a few rows, not all 200
})

test('a scanned folder hides the child listing; an unscanned one keeps it', () => {
  const kids = { title: 'Largest inside data/', rows: ['raw.csv · 80 KB', 'b.csv · 4 KB'], more: 0, extra: true }
  const scanned: FolderRisk = { path: '/w/data', title: 'data/ · High', level: 'high', rows: [['Where', 'x'], ['Size', '84 KB'], ['Recoverable', 'No · x']], headline: 'h', regenerable: false, complete: true }
  const unscanned: FolderRisk = { ...scanned, rows: [['Scan', 'Skipped · too broad to inspect'], ['Recoverable', 'Unknown · x']] }
  const base = { finding: only('rm -rf data'), groups: [kids], summary: [], notes: [] }
  expect(dialogText('rm -rf data', [{ ...base, folders: [scanned] }], 0, '/w')).not.toContain('Largest inside')
  expect(dialogText('rm -rf data', [{ ...base, folders: [unscanned] }], 0, '/w')).toContain('raw.csv · 80 KB')
})

test('no dialog shouts: no ALL-CAPS words for critical, symlink, data, chmod and unscanned folders', async () => {
  const outs = [
    await one({ dirs: ['/home/sam'] }, '/home/sam'),
    await one({ dirs: ['/'] }, '/'),
    await one({ symlinks: ['/w/datalink'] }, '/w/datalink', { cwd: '/w', runCwd: '/w' }),
    await one({ dirs: ['/w/data'], git: { top: '/w', prefix: 'data/', status: ['?? data/'], tracked: [] }, files: ['/w/data/a.csv'], kb: { '/w/data': 9 } }, '/w/data', { cwd: '/w', runCwd: '/w' }),
    await one({ dirs: ['/w/src'], files: ['/w/src/a.R'], kb: { '/w/src': 4 } }, '/w/src', { cwd: '/w', runCwd: '/w', mode: 'modify' }),
    await one({ dirs: ['/srv/huge'], failWalk: true, kb: { '/srv/huge': 9_000_000 } }, '/srv/huge', { cwd: '/w', runCwd: '/w' }),
  ]
  for (const { f } of outs) {
    const rep = { finding: only('rm -rf x'), groups: [], folders: [f], risk: { level: f.level, headline: f.headline }, summary: [], notes: [] }
    const t = dialogText('rm -rf x', [rep], 0, '/w')
    expect(t, f.title).not.toMatch(/\b[A-Z]{4,}\b/)
    expect(t.split('\n')[0]).toMatch(/^(🔴|🟠|🟢) (High|Medium|Low|Unknown) risk · /)
    expect(t.trimEnd().endsWith('Run this command?')).toBe(true)
  }
})

// ---- through the hook ------------------------------------------------------------------------------------------------

for (const surfaces of [['terminal'], ['desktop']] as const)
test(`the dialog on ${surfaces[0]} shows the folder rows and still opens on Cancel`, async ($, on) => {
  const probe = (argv: string[], cwd?: string) => {
    const line = argv.join(' ')
    if (/^find \/work\/data -maxdepth 0 (-type d )?-print$/.test(line)) return { stdout: '/work/data\n' }
    if (/^find .* -maxdepth 0 -type [ld] -print$/.test(line) && !line.includes('/work/data')) return { stdout: '' }
    if (/^find \/work\/data -maxdepth 0 -type l -print$/.test(line)) return { stdout: '' }
    if (/^du -sk \/work\/data$/.test(line)) return { stdout: '100\t/work/data\n' }
    if (/^find \/work\/data ! -type d -print$/.test(line)) return { stdout: '/work/data/a.csv\n' }
    if (/^find \/work\/data -mindepth 1 -maxdepth 1$/.test(line)) return { stdout: '' }
    if (/-maxdepth 6 -name \.git/.test(line)) return { stdout: '' }
    if (argv[0] === 'git' && argv.includes('--show-toplevel')) return argv.includes('--show-prefix') ? { stdout: '/work\ndata/\n' } : { stdout: '/work\n' }
    if (argv[0] === 'git' && argv.includes('remote')) return { stdout: 'origin\n' }
    if (argv[0] === 'git' && argv.includes('status')) return { stdout: '?? data/\0' }
    if (argv[0] === 'git' && argv.includes('ls-files')) return { stdout: '' }
    if (argv[0] === 'git' && argv.includes('log')) return { stdout: '' }
    if (argv[0] === 'find' && argv.includes('-prune') && argv.at(-1) === '-print' && argv.at(-2) === '-prune') return { stdout: '' }
    if (argv[0] === 'find' && argv.includes('-prune') && argv.includes('-mmin')) return { stdout: argv.includes('-15') ? '/work/data/a.csv\n' : '' }
    if (argv[0] === 'find' && argv.includes('-prune') && argv.includes('l')) return { stdout: '' }
    if (argv[0] === 'find' && argv.includes('-prune')) return { stdout: '/work/data/a.csv\n' }
    if (argv[0] === 'du' && argv.includes('-k')) return { stdout: '88\t/work/data/a.csv\n' }
    if (argv[0] === 'du' && argv.includes('-skx')) return { stdout: '100\t/work/data\n' }
    void cwd
    return undefined
  }
  const w = world(on, { answer: 'Cancel', probe, surfaces: [...surfaces] })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf data' })
  const q = w.asks[0]!.question
  expect(q.split('\n')[0]).toBe('🔴 High risk · deletes data/')
  expect(q).toContain('Contains     1 data file (88 KB)')
  expect(q).toContain('Recoverable  No')
  expect(q).toContain('Estimated from file names and your last fetch.')
  expect(q.trimEnd().endsWith('Run this command?')).toBe(true)
  expect(w.asks[0]!.options).toEqual(['Cancel', 'Proceed'])
  expect(r.deny).toContain('data/ · High · Recoverable: No')
  expect(r.deny!.split('\n')[0]).toBe('Blocked by command-guard (cancelled in the dialog). Not run: rm -rf data')
  expect(w.ran).toEqual([])
})

test('Windows: the hold is unchanged: no probe at all, no Folder risk block', async ($, on) => {
  const w = world(on, { answer: 'Cancel', cwd: 'C:/Users/sam/proj' })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.probes).toHaveLength(0)
  expect(w.asks[0]!.question).toContain('Nothing can be listed on Windows')
  expect(w.asks[0]!.question).not.toContain('Recoverable')
  expect(r.deny).toBeDefined()
  expect(r.deny).not.toContain('Recoverable')
})

for (const command of ['chmod -R 777 C:/Users/sam/proj', 'find . -name "*.o" -delete', 'cp -rf a b'])
test(`Windows: "${command}" runs no probe and shows no folder rows`, async ($, on) => {
  const w = world(on, { answer: 'Cancel', cwd: 'C:/Users/sam/proj' })
  await $.tool.call({ tool: 'Bash', command })
  expect(w.probes).toHaveLength(0)
  for (const a of w.asks) expect(a.question).not.toContain('Recoverable')
})
