// Folder risk: for every DIRECTORY a held command would delete, overwrite or change recursively, answer in a few
// short rows: where the folder sits (repository root, folder inside a repository, outside any repository), what kind of
// content it holds (build output that can be regenerated, source, data that is hard to regenerate, likely secrets),
// how big it is and how recently something in it changed, what git could give back, and ONE closing row
// "Recoverable: Yes / Partly / No" that also sets the risk level.
//
// Everything is a heuristic from names and git state, and the wording says so. Probes are read-only argv arrays through
// `run` (find, du, git: nothing a shell could evaluate), bounded three ways: a probe timeout, a cap on how many files
// are classified ("sampled" is said when it bites), and a stop at the first tree walk that times out.
// Contract like the rest of the measurer: never throws; a scan that did not finish never reads as LOW.
import { GIT, statusEntries, wholeRepoFact } from './recover'
import type { RiskLevel } from './recover'
import type { Run, RunResult } from './measure'

export type Mode = 'delete' | 'modify' | 'overwrite' // what the command does to the folder
export type Recoverable = 'yes' | 'partly' | 'no' | 'unknown'
export type Row = [label: string, value: string]
export type FolderRisk = {
  path: string
  title: string // "data/ · High"
  level: RiskLevel
  rows: Row[] // [label, value] pairs, already worded; the last one is "Recoverable"
  headline: string // one short phrase for the overall impact line (no full stop)
  regenerable: boolean // true only when everything found is build/cache output by name
  onlyRepos?: boolean // a folder outside git that holds nothing but whole repositories (all of them safe)
  complete: boolean // false when the scan stopped early or failed: such a result never lowers a risk level
}
export type Known = { kb?: number; files?: number; filesLowerBound?: boolean }
export type FolderContext = {
  home?: string
  cwd?: string // the session's directory
  runCwd?: string // the directory the command runs in (after a `cd`)
  mode: Mode
  maxFolders?: number
  known?: Map<string, Known> // sizes and counts the caller already measured
  note?: string // e.g. cargo clean: the caller says this is build output
}

export const SAMPLE_CAP = 3000 // files classified at most; more is "sampled"
export const FOLDER_PROBE_MS = 8000
const SIZE_CAP = 240 // files sized with du, data and secrets first
const NESTED_CAP = 5
const BANDS: [number, string][] = [
  [15, 'within 15 minutes'], [60, 'within the hour'], [360, 'within 6 hours'],
  [1440, 'within a day'], [10080, 'within a week'], [43200, 'within 30 days'],
]
const LEVEL_WORD: Record<RiskLevel, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' }
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const lines = (s: string) => s.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l !== '')
const fmt = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, w: string, many = w + 's') => `${fmt(n)} ${n === 1 ? w : many}`
const inside = (child: string, parent: string) => child === parent || child.startsWith(parent === '/' ? '/' : parent + '/')
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const parentOf = (p: string) => (p.lastIndexOf('/') > 0 ? p.slice(0, p.lastIndexOf('/')) : '/')
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, (k + 1) * n))
export function kbText(kb: number): string {
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = kb
  let k = 0
  while (v >= 1024 && k < u.length - 1) (v /= 1024, k++)
  return `${+v.toFixed(v >= 10 || k === 0 ? 0 : 1)} ${u[k]}`
}
function duMap(out: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines(out)) {
    const hit = /^(\d+)\s+(.*)$/.exec(l)
    if (hit) m.set(hit[2]!, Number(hit[1]))
  }
  return m
}

// ---- names: what a folder or file probably is -------------------------------------------------

export type Cls = 'regen' | 'data' | 'secret' | 'source' | 'other'

/** Directory names that are build or cache output almost everywhere (pruned from the file listing, sized as a whole). */
export const REGEN_NAMES = [
  'node_modules', '__pycache__', '.venv', 'venv', '.cache', '.Rproj.user', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.tox', '.gradle', '.next', '.nuxt', '.ipynb_checkpoints', '.eggs', '.parcel-cache', '.sass-cache', '.Rcache',
  '*.Rcheck', '*.egg-info', 'target', 'build', 'dist', '_build', '_site', 'htmlcov',
]
// Build output only by convention: a folder called build or dist can also hold something somebody wrote.
const GENERIC = new Set(['target', 'build', 'dist', '_build', '_site', '.cache'])
const RENV_LIBRARY = '*/renv/library' // R package library managed by renv

const regenName = (name: string) => REGEN_NAMES.some(n => (n.startsWith('*') ? name.endsWith(n.slice(1)) : name === n))

/** Which part of the folder's own path makes all of it build output (its name or a specific parent), or undefined. */
export function regenContext(dir: string): string | undefined {
  const parts = dir.split('/').filter(Boolean)
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]!
    if (p === 'library' && parts[k - 1] === 'renv') return 'renv/library'
    if (regenName(p) && (k === parts.length - 1 || !GENERIC.has(p))) return p
  }
  return undefined
}

const DATA_EXT = new Set((
  'csv tsv rds rda rdata vcf bcf bam cram sam bai fam bed bim ped map gds bgen pgen pvar psam h5 hdf5 hdf parquet feather ' +
  'arrow xlsx xls ods fasta fa fna faa fastq fq gtf gff gff3 gz bz2 xz zst zip tar tgz 7z sqlite sqlite3 db ipynb tex bib ' +
  'docx doc odt pdf pptx key npy npz mat sav dta sas7bdat rdb rdx qs fst'
).split(' '))
const SOURCE_EXT = new Set((
  'r py rs js mjs ts tsx jsx c h cc cpp hpp java go sh bash zsh jl sql md rmd qmd rst toml yaml yml json cfg ini css html ' +
  'cmake lock txt nf smk pl rb'
).split(' '))
const SOURCE_NAMES = new Set(['makefile', 'dockerfile', 'license', 'readme', 'description', 'namespace', 'snakefile'])

/** Name-only guess for one file. Never reads the file. */
export function classifyName(name: string): Exclude<Cls, 'regen'> {
  const n = name.toLowerCase()
  if (n === '.env' || n.startsWith('.env.') || /\.(pem|key|p12|pfx|kdbx|keystore)$/.test(n)) return 'secret'
  if (['.netrc', '.npmrc', '.pypirc', '.renviron', 'credentials'].includes(n)) return 'secret'
  if (n.startsWith('id_') && !n.endsWith('.pub')) return 'secret'
  const ext = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : ''
  if (DATA_EXT.has(ext)) return 'data'
  if (SOURCE_EXT.has(ext) || SOURCE_NAMES.has(n)) return 'source'
  return 'other'
}

const CLASS_WORDS: Record<Exclude<Cls, 'regen'>, [string, string]> = {
  data: ['data file', 'data files'], secret: ['likely secret file', 'likely secret files'],
  source: ['source file', 'source files'], other: ['other file', 'other files'],
}

// ---- where the folder sits ----------------------------------------------------------------------

const SYNC = /(^|\/)(Dropbox[^/]*|OneDrive[^/]*|Google ?Drive[^/]*|GoogleDrive[^/]*|iCloud ?Drive[^/]*|Mobile Documents|com~apple~CloudDocs|pCloud ?Drive|Box Sync|Library\/CloudStorage)(\/|$)/i
const SYSTEM_TOP = /^\/(usr|etc|var|bin|sbin|lib|lib32|lib64|opt|boot|dev|proc|sys|run|root|home|Users|System|Library|Applications|Volumes|private|mnt|media|tmp)$/
const HOME_FOLDERS = /^(Desktop|Documents|Downloads|Pictures|Music|Movies|Videos|Library|Applications|Public)$/i

/** A hedged hint when the path looks like it lives in a synced folder, or in a folder iCloud may sync. */
export function syncHint(path: string, home?: string): string | undefined {
  const m = SYNC.exec(path)
  if (m) {
    const name = /^(Mobile Documents|com~apple~CloudDocs)$/i.test(m[2]!) ? 'iCloud Drive' : /^Library\/CloudStorage$/i.test(m[2]!) ? 'cloud storage' : m[2]!
    return `Looks synced (${name}): deletes may reach your other devices; its trash may keep a copy (not checked)`
  }
  if (home && parentOf(path) === home && /^(Desktop|Documents)$/i.test(base(path)))
    return 'Desktop and Documents may sync with iCloud (not checked): a delete could reach your other devices'
  return undefined
}

export type Critical = { reason: string; skipScan: boolean }

/** CRITICAL targets: root, home and its parents, top-level system folders, the usual home folders, the working directory or a parent of it. */
export function criticalReason(dir: string, ctx: { home?: string; cwd?: string; runCwd?: string }): Critical | undefined {
  const { home } = ctx
  if (dir === '/') return { reason: 'the filesystem root', skipScan: true }
  if (home && dir === home) return { reason: 'your home folder', skipScan: true }
  if (home && inside(home, dir)) return { reason: 'a parent of your home folder', skipScan: true }
  if (SYSTEM_TOP.test(dir)) return { reason: 'a top-level system folder', skipScan: true }
  if (home && parentOf(dir) === home && HOME_FOLDERS.test(base(dir))) return { reason: `your ${base(dir)} folder`, skipScan: false }
  for (const [where, label] of [[ctx.runCwd, 'the folder the command runs in'], [ctx.cwd, 'the current working directory']] as const) {
    if (where === undefined || !inside(where, dir)) continue
    return { reason: where === dir ? label : `a parent of ${label}`, skipScan: false }
  }
  return undefined
}

// ---- git view of one folder ---------------------------------------------------------------------

type Bucket = 'pushed' | 'local' | 'changed' | 'untracked' | 'ignored' | 'outside'
type PathSet = { exact: Set<string>; dirs: Set<string>; all: string[] } // dirs: collapsed directories, with a trailing '/'
type GitView = {
  root: string // the logical root: where git runs
  isRoot: boolean // the folder IS the repository root (its .git goes with it)
  noRemote: boolean
  changed: PathSet; untracked: PathSet; ignored: PathSet
  touched: PathSet // files in commits that no remote has
  unpushedCommits: number
  tracked: string[] // absolute paths
}

function pathSet(abs: string[]): PathSet {
  return { exact: new Set(abs.filter(p => !p.endsWith('/'))), dirs: new Set(abs.filter(p => p.endsWith('/'))), all: abs }
}
// `path` is listed, or lies below a collapsed directory that is listed
function covers(s: PathSet, path: string): boolean {
  if (s.exact.has(path)) return true
  for (let i = path.indexOf('/', 1); i > 0; i = path.indexOf('/', i + 1)) if (s.dirs.has(path.slice(0, i + 1))) return true
  return s.dirs.has(path + '/')
}
const hasBelow = (s: PathSet, dir: string) => s.all.some(e => e.startsWith(dir + '/'))

function bucketOf(path: string, isDir: boolean, g: GitView): Bucket {
  if (covers(g.changed, path) || (isDir && hasBelow(g.changed, path))) return 'changed'
  if (covers(g.untracked, path) || (isDir && hasBelow(g.untracked, path))) return 'untracked'
  if (covers(g.ignored, path) || (isDir && hasBelow(g.ignored, path))) return 'ignored'
  if (g.noRemote || covers(g.touched, path) || (isDir && hasBelow(g.touched, path))) return 'local'
  return 'pushed'
}

type Probe = (argv: string[], cwd?: string) => Promise<RunResult | undefined>

// null: the folder is not inside any repository
async function gitView(run: Run, dir: string): Promise<GitView | null> {
  const gitRun = (cwd: string, ...argv: string[]) => run([...GIT, ...argv], cwd)
  const top = await gitRun(dir, 'rev-parse', '--show-toplevel', '--show-prefix')
  if (top.exitCode !== 0) return null
  const [toplevel = '', prefix = ''] = top.stdout.split('\n').map(l => l.replace(/\r$/, ''))
  const rel = prefix.replace(/\/$/, '')
  // git reports the real path; keep the path the user typed so that every path below matches the listing
  const root = !rel ? dir : dir.endsWith('/' + rel) ? dir.slice(0, dir.length - rel.length - 1) : toplevel
  const spec = rel ? ['--', rel] : []
  const remotes = lines((await gitRun(root, 'remote')).stdout)
  const status = await gitRun(root, 'status', '--porcelain=v1', '-z', '--ignored', ...spec)
  if (status.exitCode !== 0) throw new Error(`git status failed: ${status.stderr.trim().split('\n')[0] || `exit ${status.exitCode}`}`)
  const ents = statusEntries(status.stdout).map(e => ({ xy: e.xy, abs: `${root}/${e.path}` }))
  const lost = (xy: string) => xy !== '??' && xy !== '!!' && !(xy === ' D' || xy === 'D ')
  const files = await gitRun(root, 'ls-files', '-z', ...spec)
  const unpushed = remotes.length
    ? await gitRun(root, '-c', 'core.quotepath=off', 'log', '--name-only', '--format=%x01%h', '-n', '300', 'HEAD', '--not', '--remotes', ...spec)
    : undefined
  const touched: string[] = []
  let commits = 0
  for (const l of lines(unpushed?.exitCode === 0 ? unpushed.stdout : '')) {
    if (l.startsWith('\x01')) commits++
    else touched.push(`${root}/${l}`)
  }
  return {
    root, isRoot: !rel, noRemote: remotes.length === 0,
    changed: pathSet(ents.filter(e => lost(e.xy)).map(e => e.abs)),
    untracked: pathSet(ents.filter(e => e.xy === '??').map(e => e.abs)),
    ignored: pathSet(ents.filter(e => e.xy === '!!').map(e => e.abs)),
    touched: pathSet(touched), unpushedCommits: commits,
    tracked: files.stdout.split('\0').filter(Boolean).map(p => `${root}/${p}`),
  }
}

// ---- the listing --------------------------------------------------------------------------------

/** `( -type d ( -name n1 -o -name n2 ... ) -prune )`: build/cache directories and .git directories are not entered. */
export function pruneExpr(): string[] {
  const names = REGEN_NAMES.flatMap((n, k) => [...(k ? ['-o'] : []), '-name', n])
  return ['(', '-type', 'd', '(', ...names, '-o', '-path', RENV_LIBRARY, '-o', '-name', '.git', ')', '-prune', ')']
}

type Entry = { path: string; dir: boolean; cls: Cls; bucket: Bucket; kb?: number }
type Scan = {
  dir: string; mode: Mode; git: GitView | null
  entries: Entry[]; sampled: boolean; listed: number
  gitDirs: string[] // .git directories found below the folder, other than its own
  nested: { root: string; text: string; atStake: boolean }[]; nestedMore: number
  totalKb?: number; files?: number; filesLowerBound?: boolean
  newest?: string; newestCount?: number; newestMins?: number
  links: number; crossesFs: boolean
  ctxRegen?: string; partial: boolean; whole?: { text: string; atStake: boolean }
}

async function scanFolder(light: Run, heavy: Probe, state: { slow: boolean }, dir: string, ctx: FolderContext): Promise<Scan> {
  const known = ctx.known?.get(dir)
  const git = await gitView(light, dir)
  // a build/ or dist/ that git tracks holds committed files: judge it by what is in it, not by its name
  const ctxRegen = git && git.tracked.length > 0 ? undefined : regenContext(dir)
  const expr = pruneExpr()
  const walk = (...tail: string[]) => ['find', dir, '-mindepth', '1', ...expr, ...tail]

  // build/cache and .git directories (not entered), then the other files, capped
  const prunedOut = await heavy(['find', dir, '-mindepth', '1', ...expr.slice(1, -1), '-print'])
  const prunedAll = lines(prunedOut?.stdout ?? '')
  const ownGit = `${dir}/.git`
  const gitDirs = prunedAll.filter(p => base(p) === '.git' && p !== ownGit)
  const prunedRegen = prunedAll.filter(p => base(p) !== '.git')
  const listRes = ctxRegen ? undefined : await heavy(walk('-o', '-type', 'f', '-print'))
  const listed = lines(listRes?.stdout ?? '')
  const sampled = listed.length > SAMPLE_CAP || !!listRes?.isStdoutTruncated
  const files = listed.slice(0, SAMPLE_CAP)

  const s: Scan = {
    dir, mode: ctx.mode, git, entries: [], sampled, listed: listed.length, gitDirs, nested: [], nestedMore: 0,
    totalKb: known?.kb, files: known?.files, filesLowerBound: known?.filesLowerBound,
    links: 0, crossesFs: false, ctxRegen, partial: false,
  }
  if (!ctxRegen && git?.isRoot) s.whole = await wholeRepoFact(light, git.root, git.noRemote)

  // nested repositories: their .git goes too; look at the first few
  const roots = gitDirs.map(p => p.slice(0, -5))
  s.nestedMore = Math.max(0, roots.length - NESTED_CAP)
  for (const root of roots.slice(0, NESTED_CAP)) s.nested.push({ root, ...(await nestedFact(light, root)) })
  const nestedIn = (p: string) => roots.some(r => p.startsWith(r + '/'))

  const where = (p: string, isDir: boolean): Bucket => (git ? bucketOf(p, isDir, git) : 'outside')
  for (const p of files)
    if (!nestedIn(p)) s.entries.push({ path: p, dir: false, cls: ctxRegen ? 'regen' : classifyName(base(p)), bucket: where(p, false) })
  for (const p of prunedRegen.filter(q => !nestedIn(q))) {
    const tracked = git?.tracked.some(t => t.startsWith(p + '/')) ?? false
    const cls: Cls = GENERIC.has(base(p)) && tracked ? 'source' : 'regen' // a committed dist/ or build/ is not just build output
    s.entries.push({ path: p, dir: true, cls, bucket: where(p, true) })
  }
  if (ctxRegen) s.entries.push({ path: dir, dir: true, cls: 'regen', bucket: where(dir, true) })

  // sizes: regenerable directories as a whole, data and secrets one by one, the folder in total
  await sizes(heavy, s, ctxRegen !== undefined)
  if (s.totalKb === undefined && !state.slow) s.totalKb = parseTotal(await heavy(['du', '-sk', dir]), dir)
  if (!ctxRegen && !state.slow) await recency(heavy, s, walk)
  if (!state.slow) s.links = lines((await heavy(walk('-o', '-type', 'l', '-print')))?.stdout ?? '').length
  if (!state.slow && s.totalKb !== undefined) {
    const one = parseTotal(await heavy(['du', '-skx', dir]), dir)
    s.crossesFs = one !== undefined && s.totalKb - one > Math.max(64, s.totalKb * 0.01)
  }
  s.partial = state.slow
  return s
}

const parseTotal = (r: RunResult | undefined, dir: string) => (r ? duMap(r.stdout).get(dir) : undefined)

async function sizes(heavy: Probe, s: Scan, regenOnly: boolean): Promise<void> {
  const dirs = s.entries.filter(e => e.dir && e.path !== s.dir)
  if (dirs.length) {
    const m = duMap((await heavy(['du', '-sk', ...dirs.slice(0, 40).map(e => e.path)]))?.stdout ?? '')
    for (const e of dirs) e.kb = m.get(e.path)
  }
  if (regenOnly) return
  const order: Cls[] = ['data', 'secret']
  const picked = s.entries.filter(e => !e.dir && order.includes(e.cls)).slice(0, SIZE_CAP)
  for (const part of chunks(picked, 60)) {
    const m = duMap((await heavy(['du', '-k', ...part.map(e => e.path)]))?.stdout ?? '')
    for (const e of part) e.kb = m.get(e.path)
  }
}

async function recency(heavy: Probe, s: Scan, walk: (...tail: string[]) => string[]): Promise<void> {
  for (const [mins, label] of BANDS) {
    const r = await heavy(walk('-o', '-type', 'f', '-mmin', `-${mins}`, '-print'))
    if (!r) return
    const n = lines(r.stdout).length
    if (n > 0) {
      s.newest = label
      s.newestCount = n
      s.newestMins = mins
      return
    }
  }
  s.newest = 'not edited in 30 days'
}

async function nestedFact(light: Run, root: string): Promise<{ text: string; atStake: boolean }> {
  try {
    const remote = await light([...GIT, 'remote'], root)
    const fact = await wholeRepoFact(light, root, lines(remote.stdout).length === 0)
    const st = await light([...GIT, 'status', '--porcelain=v1', '-z'], root)
    const dirty = statusEntries(st.stdout).length
    return { text: dirty ? `${fact.text}, ${plural(dirty, 'uncommitted path')}` : fact.text, atStake: fact.atStake || dirty > 0 }
  } catch (err) {
    return { text: `${root}/  state unknown (${clip((err as Error).message, 60)})`, atStake: true }
  }
}

// ---- the verdict --------------------------------------------------------------------------------

type Verdict = { level: RiskLevel; recoverable: Recoverable; because: string; headline: string; onlyRepos: boolean; gitLine?: string; stake: string[] }

function count<T>(a: T[], f: (x: T) => boolean) {
  return a.filter(f).length
}

function judge(s: Scan, crit: Critical | undefined): Verdict {
  const e = s.entries
  const real = e.filter(x => x.cls !== 'regen')
  const lostBy = (b: Bucket) => real.filter(x => x.bucket === b)
  const changed = lostBy('changed'), untracked = lostBy('untracked'), outside = lostBy('outside'), ignored = lostBy('ignored'), local = lostBy('local')
  const pushed = lostBy('pushed')
  const whole = !!s.git?.isRoot
  const nestedRisk = s.nested.some(n => n.atStake)
  const hard = [...changed, ...untracked, ...outside]
  const hardIgnored = ignored.filter(x => x.cls === 'data' || x.cls === 'secret')
  const softIgnored = ignored.filter(x => x.cls !== 'data' && x.cls !== 'secret')
  // committed but unpushed: restorable from .git while it stays, gone with it when the repository goes whole
  const localLost = whole ? local : []
  const machineOnly = whole ? [] : local
  const noRemote = !!s.git?.noRemote
  const onlyRepos = !s.git && s.entries.length === 0 && s.nested.length > 0 && s.nestedMore === 0 && !nestedRisk && !s.partial

  let level: RiskLevel = 'low'
  if (hard.length || hardIgnored.length || localLost.length || (whole && s.whole?.atStake) || nestedRisk) level = 'high'
  else if (machineOnly.length && !noRemote) level = 'high'
  else if (softIgnored.length || (s.sampled && !s.git)) level = 'medium'
  if (level === 'medium' && s.newestMins !== undefined && s.newestMins <= 1440) level = 'high' // recent edits: active work
  if (s.partial && level === 'low') level = 'unknown'
  if (s.mode === 'modify') level = s.partial ? 'unknown' : real.some(x => x.cls === 'secret') || nestedRisk ? 'medium' : 'low'
  if (crit) level = 'high'

  const lost = hard.length + hardIgnored.length + softIgnored.length + localLost.length
  const bits: string[] = []
  if (s.git) {
    const trackedOk = Math.max(0, s.git.tracked.length - count(s.git.tracked, t => covers(s.git!.changed, t) || covers(s.git!.touched, t)))
    if (trackedOk) bits.push(`${plural(trackedOk, 'file')} pushed`)
    if (s.git.unpushedCommits) bits.push(`${plural(s.git.unpushedCommits, 'commit')} not pushed`)
    else if (noRemote && s.git.tracked.length) bits.push('no remote')
    if (changed.length) bits.push(`${plural(changed.length, 'modified file')}`)
    if (untracked.length) bits.push(`${plural(untracked.length, 'untracked file')}`)
    if (ignored.length) bits.push(`${plural(ignored.length, 'ignored file')}`)
  } else if (outside.length) bits.push(`${plural(outside.length, 'file')}${s.sampled ? ' in the sample' : ''}, no git history`)

  let recoverable: Recoverable
  let because: string
  if (s.partial && !lost) (recoverable = 'unknown', because = 'the scan stopped early, so assume not')
  else if (!lost && !machineOnly.length) {
    recoverable = 'yes'
    because = real.length || s.git?.tracked.length ? 'everything except build output is pushed (as of your last fetch)'
      : s.entries.length ? 'only build output, which a rebuild recreates'
      : onlyRepos ? 'every repository inside is fully pushed' : 'the folder is empty'
  } else if (!lost) {
    recoverable = noRemote ? 'yes' : 'partly'
    because = noRemote ? 'git restore brings files back while .git stays; there is no remote copy' : `${plural(machineOnly.length, 'file')} committed but not pushed come back only from this .git`
  } else {
    recoverable = pushed.length || machineOnly.length ? 'partly' : 'no'
    const gone = [changed.length && 'modified files', untracked.length && 'untracked files', hard.length - changed.length - untracked.length > 0 && 'files outside git', ignored.length && 'ignored files', localLost.length && 'unpushed commits'].filter(Boolean)
    because = `${gone.join(', ')} cannot be restored${pushed.length ? '; pushed files can' : ''}`
  }
  if (recoverable === 'yes' && ((whole && s.whole?.atStake) || nestedRisk)) {
    recoverable = 'partly'
    because = 'commits on no remote, stashes or worktrees exist only in the .git that goes too'
  }
  if (s.mode === 'modify') {
    recoverable = s.partial ? 'unknown' : 'partly'
    because = 'contents stay; old permissions and owners are not recorded'
  }
  if (crit && s.mode !== 'modify') {
    recoverable = 'no'
    because = `${crit.reason} is targeted; assume everything is gone (backups such as Time Machine are not checked)`
  }

  const stake = real
    .filter(x => (x.bucket === 'changed' || x.bucket === 'untracked' || x.bucket === 'outside' || x.bucket === 'ignored' || (whole && x.bucket === 'local')) && (x.cls === 'data' || x.cls === 'secret' || x.bucket === 'changed'))
    .sort((a, b) => (b.kb ?? 0) - (a.kb ?? 0))
    .map(x => `${x.path.startsWith(s.dir + '/') ? x.path.slice(s.dir.length + 1) : x.path}${x.kb !== undefined ? ` (${kbText(x.kb)})` : ''}`)

  const headline = crit
    ? `${cap1(crit.reason)} is targeted`
    : level === 'low'
      ? s.entries.length && !real.length ? 'build output only (regenerable by name)' : onlyRepos ? 'only whole repositories, all fully pushed' : 'fully pushed (as of your last fetch)'
      : `${recoverable === 'no' ? 'not recoverable' : recoverable === 'partly' ? 'only partly recoverable' : 'see the folder details'}: ${because}`
  return { level, recoverable, because, headline, onlyRepos, gitLine: bits.length ? bits.join(' · ') : undefined, stake }
}

// ---- words --------------------------------------------------------------------------------------

function render(s: Scan, v: Verdict, crit: Critical | undefined, ctx: FolderContext): FolderRisk {
  const rows: Row[] = []
  const name = (p: string) => (p.startsWith(s.dir + '/') ? p.slice(s.dir.length + 1) : p)
  if (crit) rows.push(['Target', cap1(crit.reason)])

  // where it sits
  if (s.git?.isRoot) rows.push(['Where', 'Repository root · its history goes too'])
  else if (s.git) rows.push(['Where', `Inside repository ${clip(s.git.root, 60)}`])
  else rows.push(['Where', 'Outside git · no history, no remote'])
  if (s.git?.isRoot && s.whole?.atStake) rows.push(['Local only', s.whole.text.replace(/^.*?\/ {2}/, '')])
  if (s.nested.length)
    rows.push(['Includes', `${plural(s.nested.length + s.nestedMore, 'repository', 'repositories')}, .git too: ${s.nested.map(n => clip(n.text.replace(s.dir + '/', ''), 80)).join('; ')}${s.nestedMore ? `; +${s.nestedMore} more` : ''}`])

  // what kind of content
  const bits: string[] = []
  if (s.ctxRegen) bits.push(`all build output (${s.ctxRegen})`)
  for (const cls of ['data', 'secret', 'source', 'other'] as const) {
    const m = s.entries.filter(e => e.cls === cls && !e.dir)
    if (!m.length) continue
    const kb = sum(m.map(e => e.kb ?? 0))
    const sized = m.some(e => e.kb !== undefined) && (cls === 'data' || cls === 'secret')
    bits.push(`${plural(m.length, CLASS_WORDS[cls][0], CLASS_WORDS[cls][1])}${sized ? ` (${kbText(kb)}${m.some(e => e.kb === undefined) ? '+' : ''})` : ''}`)
  }
  const regen = s.entries.filter(e => e.cls === 'regen' && e.dir && e.path !== s.dir).sort((a, b) => (b.kb ?? 0) - (a.kb ?? 0))
  if (regen.length)
    bits.push(`build output: ${regen.slice(0, 3).map(e => `${name(e.path)}/${e.kb !== undefined ? ` ${kbText(e.kb)}` : ''}`).join(', ')}${regen.length > 3 ? `, +${regen.length - 3} more` : ''}`)
  const committedGeneric = s.entries.filter(e => e.dir && e.cls === 'source')
  if (committedGeneric.length) bits.push(`${committedGeneric.map(e => name(e.path) + '/').join(', ')} hold tracked files`)
  if (ctx.note) bits.push(ctx.note)
  if (s.sampled) bits.push(`sampled: first ${fmt(SAMPLE_CAP)} of ${fmt(s.listed)}${s.listed > SAMPLE_CAP ? '' : '+'} files`)
  rows.push(['Contains', bits.length ? bits.join(' · ') : s.nested.length ? 'only the repositories above' : 'nothing'])

  // size and recency
  const size = [s.totalKb !== undefined ? kbText(s.totalKb) : undefined, s.files !== undefined ? `${fmt(s.files)}${s.filesLowerBound ? '+' : ''} ${s.files === 1 && !s.filesLowerBound ? 'file' : 'files'}` : undefined].filter(Boolean) as string[]
  if (s.newest) size.push(s.newestMins === undefined ? s.newest : `last edit ${s.newest}`)
  if (s.newestMins !== undefined && s.newestMins <= 1440) size.push('likely active work')
  if (size.length) rows.push(['Size', size.join(' · ')])

  if (v.gitLine && s.mode !== 'modify') rows.push(['Git', v.gitLine])
  if (v.stake.length) rows.push(['At stake', `${v.stake.slice(0, 3).map(x => clip(x, 50)).join(', ')}${v.stake.length > 3 ? `, +${v.stake.length - 3} more` : ''}`])

  const hints: string[] = []
  if (s.partial) hints.push('Scan stopped early (slow disk or huge folder): figures are partial')
  const sync = syncHint(s.dir, ctx.home)
  if (sync) hints.push(sync)
  if (s.links > 0) hints.push(`${plural(s.links, 'symlink')} inside: only the links are removed, not their targets`)
  if (s.crossesFs) hints.push('Includes another filesystem (a mounted drive?): rm -r follows it unless run with --one-file-system')
  for (const h of hints.slice(0, 2)) rows.push(['Note', clip(h, 140)])
  rows.push(['Recoverable', `${cap1(v.recoverable)} · ${v.because}`])

  return {
    path: s.dir, title: `${dirLabel(s.dir, ctx)} · ${LEVEL_WORD[v.level]}`, level: v.level, rows, headline: v.headline,
    regenerable: s.entries.length > 0 && s.entries.every(e => e.cls === 'regen'), complete: !s.partial, onlyRepos: v.onlyRepos,
  }
}
const name2 = (p: string, root: string) => p.slice(root.length + 1)

// ---- symbolic links and unscanned folders -------------------------------------------------------

async function symlinkRisk(light: Run, dir: string, ctx: FolderContext, crit: Critical | undefined): Promise<FolderRisk> {
  const toDir = lines((await light(['find', '-L', dir, '-maxdepth', '0', '-type', 'd', '-print'])).stdout).length > 0
  const act: Record<Mode, string> = {
    delete: 'rm removes only the link. A trailing slash (link/) can reach the target, so check how it is written',
    modify: 'chmod -R changes the target of a link named on the command line; chown may change the link itself',
    overwrite: 'cp or mv -f replaces the link or writes through it; the target was not inspected',
  }
  const level: RiskLevel = ctx.mode === 'delete' && !crit ? 'low' : 'medium'
  const rows: Row[] = []
  if (crit) rows.push(['Target', cap1(crit.reason)])
  rows.push(['What', `Symbolic link ${toDir ? 'to a folder' : 'to a file (or broken)'} · the target was not inspected`])
  rows.push(['Effect', act[ctx.mode]])
  const sync = syncHint(dir, ctx.home)
  if (sync) rows.push(['Note', sync])
  rows.push(['Recoverable', ctx.mode === 'delete' ? 'Yes · only the link goes; the target keeps its content' : 'Unknown · the target was not inspected'])
  return { path: dir, title: `${dirLabel(dir, ctx)} (symlink) · ${LEVEL_WORD[level]}`, level, rows, headline: ctx.mode === 'delete' ? 'a symlink: only the link goes, not its target' : 'a symlink: its target was not inspected', regenerable: false, complete: ctx.mode === 'delete' }
}

const dirLabel = (dir: string, ctx: FolderContext) => (dir === '/' ? '/' : `${ctx.runCwd && dir.startsWith(ctx.runCwd + '/') ? name2(dir, ctx.runCwd) : dir}/`)

function unscanned(dir: string, crit: Critical | undefined, ctx: FolderContext, why: string): FolderRisk {
  const level: RiskLevel = crit ? 'high' : 'unknown'
  const rows: Row[] = []
  if (crit) rows.push(['Target', cap1(crit.reason)])
  rows.push(['Scan', `Skipped · ${why}`])
  const hint = syncHint(dir, ctx.home)
  if (hint) rows.push(['Note', hint])
  if (crit && ctx.mode === 'modify')
    rows.push(['Recoverable', `Partly · contents stay, but old permissions and owners are not recorded; changing them across ${crit.reason} can break ssh keys and system files`])
  else rows.push(['Recoverable', crit ? 'No · assume everything is gone (backups such as Time Machine are not checked)' : 'Unknown · nothing was inspected, so assume not'])
  return {
    path: dir, title: `${dirLabel(dir, ctx)} · ${LEVEL_WORD[level]}`, level, rows,
    headline: crit ? `${cap1(crit.reason)} is targeted` : why, regenerable: false, complete: false,
  }
}

// ---- entry point --------------------------------------------------------------------------------

/** Folder risk for up to `maxFolders` directories (CRITICAL ones first). Never throws. */
export async function assessFolders(run: Run, dirs: string[], ctx: FolderContext): Promise<{ folders: FolderRisk[]; skipped: number }> {
  const ordered = [...new Set(dirs)].map(d => ({ d, c: criticalReason(d, ctx) })).sort((a, b) => Number(!!b.c) - Number(!!a.c))
  const max = ctx.maxFolders ?? 3
  const folders: FolderRisk[] = []
  for (const { d, c } of ordered.slice(0, max)) folders.push(await assessOne(run, d, c, ctx))
  return { folders, skipped: Math.max(0, ordered.length - max) }
}

async function assessOne(run: Run, dir: string, crit: Critical | undefined, ctx: FolderContext): Promise<FolderRisk> {
  const state = { slow: false, failed: undefined as string | undefined }
  // light probes (git, type tests) throw to the caller; heavy ones (tree walks) stop the scan at the first timeout
  const light: Run = (argv, cwd) => run(argv, cwd, { timeoutMs: FOLDER_PROBE_MS })
  const heavy: Probe = async (argv, cwd) => {
    if (state.slow) return undefined
    try {
      return await run(argv, cwd, { timeoutMs: FOLDER_PROBE_MS })
    } catch (err) {
      state.slow = true
      state.failed = (err as Error).message || 'probe failed'
      return undefined
    }
  }
  try {
    const link = lines((await light(['find', dir, '-maxdepth', '0', '-type', 'l', '-print'])).stdout).length > 0
    if (link) return await symlinkRisk(light, dir, ctx, crit)
    if (crit?.skipScan) return unscanned(dir, crit, ctx, 'too broad to inspect')
    const s = await scanFolder(light, heavy, state, dir, ctx)
    return render(s, judge(s, crit), crit, ctx)
  } catch (err) {
    return unscanned(dir, crit, ctx, `could not scan (${clip((err as Error).message || 'probe failed', 100)})`)
  }
}
