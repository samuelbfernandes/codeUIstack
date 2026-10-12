// The measurer: READ-ONLY look at what a classified command would hit. Every probe
// is an argv run through `run` (= $.process.run, no shell), so nothing the model
// wrote is ever evaluated. The one place user text reaches an argv is a path or a ref,
// and those are absolute paths or validated against REF before use.
//
// Contract: `measure` never throws and never says "fine". When a probe fails it sets
// `unmeasured` and the caller holds the command anyway (fail closed on measuring).
import type { Finding, Target } from './classify'
import { normalize } from './classify'
import { assessFolders } from './folder'
import type { FolderRisk, Known, Mode } from './folder'
import { assessLoss } from './recover'
import type { Risk } from './recover'

export type RunResult = { exitCode: number; stdout: string; stderr: string; isStdoutTruncated?: boolean }
export type Run = (argv: readonly string[], cwd?: string, opts?: { timeoutMs?: number }) => Promise<RunResult>
// home and cwd are only for the folder-risk wording (CRITICAL: home, working directory, its parents); both optional
export type Config = { maxListed: number; home?: string; cwd?: string }

// subset: the rows only repeat names the plain listing shows; extra: left out of the dialog when a folder summary is shown
export type Group = { title: string; rows: string[]; more: number; subset?: boolean; extra?: boolean }
export type Report = {
  finding: Finding
  groups: Group[]
  risk?: Risk // what could not be got back: uncommitted, untracked, unpushed, outside git
  riskGroups?: Group[] // the rows behind `risk`, shown BEFORE the plain listing
  folders?: FolderRisk[] // per directory: what it is, what is in it, what could be got back
  summary: string[] // totals
  action?: string // what the command does, lower case, for the headline: "deletes data/"
  items?: number // how many existing targets a path command names
  notes: string[] // caveats that do not stop the hold
  unmeasured?: string // set when the blast radius could not be established
  skip?: boolean // a conditional finding whose condition is false: nothing to hold
}

// ---- formatting and parsing (pure, exported for tests) --------------------------------

export const fmtInt = (n: number) => n.toLocaleString('en-US')
export function fmtBytes(bytes: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let k = 0
  while (v >= 1024 && k < u.length - 1) (v /= 1024, k++)
  return `${k === 0 ? v : +v.toFixed(v >= 10 ? 0 : 1)} ${u[k]}`
}
export const fmtKb = (kb: number) => fmtBytes(kb * 1024)
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const lines = (s: string) => s.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l !== '')
const plural = (n: number, w: string, many = w + 's') => `${fmtInt(n)} ${n === 1 ? w : many}`

/** `du -sk` output: "<kb>\t<path>" per line. */
export function parseDu(out: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines(out)) {
    const hit = /^(\d+)\s+(.*)$/.exec(l)
    if (hit) m.set(hit[2]!, Number(hit[1]))
  }
  return m
}

/** `git diff --name-status` output to display rows ("M  path", "R  old -> new"). */
export function parseNameStatus(out: string): string[] {
  return lines(out).map(l => {
    const [st, ...paths] = l.split('\t')
    return `${(st ?? '?').slice(0, 1)}  ${paths.join(' -> ')}`
  })
}

/** `git clean -n` output: "Would remove <path>" per line. */
export function parseCleanDryRun(out: string): string[] {
  return lines(out).flatMap(l => {
    const m = /^Would (?:remove|skip repository) (.*)$/.exec(l)
    return m ? [m[1]!.replace(/\/$/, '')] : []
  })
}

const cap = (title: string, rows: string[], max: number, flags: { subset?: boolean; extra?: boolean } = {}): Group => ({
  title, rows: rows.slice(0, max), more: Math.max(0, rows.length - max), ...flags,
})

function short(path: string, cwd?: string): string {
  if (cwd && path.startsWith(cwd + '/')) return path.slice(cwd.length + 1)
  return path
}

const REF = /^[A-Za-z0-9_@][A-Za-z0-9_.\-/@{}^~]*$/ // never starts with "-": a ref cannot become an option
const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, k) => a.slice(k * n, (k + 1) * n))

// ---- probes on paths ------------------------------------------------------------------

const empty = (): Omit<Report, 'finding'> => ({ groups: [], summary: [], notes: [] })

async function duMany(run: Run, paths: string[]): Promise<Map<string, number>> {
  const all = new Map<string, number>()
  for (const part of chunks(paths, 60))
    for (const [p, kb] of parseDu((await run(['du', '-sk', ...part])).stdout)) all.set(p, kb)
  return all
}

async function present(run: Run, paths: string[], extra: string[] = []): Promise<Set<string>> {
  const found = new Set<string>()
  for (const part of chunks(paths, 60))
    for (const l of lines((await run(['find', ...part, '-maxdepth', '0', ...extra, '-print'])).stdout)) found.add(l)
  return found
}

/** Expand a glob target with `find -path` at exactly the glob's depth (no shell involved). */
export async function expandGlob(run: Run, t: Target): Promise<string[]> {
  const parts = t.path!.split('/').filter(Boolean)
  const g = parts.findIndex(p => /[*?[]/.test(p))
  const baseParts = parts.slice(0, g)
  const rest = parts.slice(g)
  const base = '/' + baseParts.join('/')
  const esc = (s: string) => s.replace(/[\\*?[]/g, c => '\\' + c)
  const pattern = `${base === '/' ? '' : esc(base)}/${rest.join('/')}`
  const res = await run(['find', base, '-mindepth', String(rest.length), '-maxdepth', String(rest.length), '-path', pattern])
  return lines(res.stdout).filter(p => {
    // Shell globs skip dot-files unless the pattern component itself starts with a dot.
    const comps = p.split('/').filter(Boolean).slice(baseParts.length)
    return comps.every((c, k) => !c.startsWith('.') || (rest[k] ?? '').startsWith('.'))
  })
}

// folders: how the command treats a directory (default: it deletes it); false: no folder assessment
const VERBS: Record<string, [string, string]> = { // verb -> [headline form, list title]
  delete: ['deletes', 'Deletes'], empty: ['empties', 'Empties'], 'overwrite and destroy': ['shreds', 'Shreds'],
  'change recursively': ['changes permissions of', 'Changes'], 'delete (untracked)': ['deletes', 'Deletes untracked'],
  overwrite: ['overwrites', 'Overwrites'], 'overwrite or merge into': ['overwrites', 'Overwrites or merges into'],
}
type PathOpts = { verb: string; expandSingleDir: boolean; cap: number; risk?: boolean; folders?: Mode | false; canLower?: boolean }

// Rows for a set of targets: kind, size, file count; for one directory also its biggest children.
async function describePaths(run: Run, f: Finding, targets: Target[], o: PathOpts, cfg: Config): Promise<Omit<Report, 'finding'>> {
  const r = empty()
  const paths: string[] = []
  for (const t of targets) {
    if (!t.path) r.notes.push(`could not resolve ${t.raw}: ${t.unresolved}`)
    else if (t.glob) {
      const hits = await expandGlob(run, t)
      if (hits.length === 0) r.notes.push(`${t.raw} matches nothing right now`)
      paths.push(...hits)
    } else paths.push(t.path)
  }
  const uniq = [...new Set(paths)].slice(0, o.cap)
  if (paths.length > uniq.length) r.notes.push(`checked the first ${fmtInt(uniq.length)} of ${fmtInt(paths.length)} paths`)
  if (uniq.length === 0) return r

  const exists = await present(run, uniq)
  const live = uniq.filter(p => exists.has(p))
  const dirs = await present(run, live, ['-type', 'd'])
  const sizes = await duMany(run, live)
  const counts = await countFiles(run, [...dirs], r)
  const links = o.folders === false ? new Set<string>() : await linksAmong(run, live, dirs)
  const truncated = r.notes.some(n => n.startsWith('file counts are lower bounds'))
  const rows = uniq.map(p => {
    if (!exists.has(p)) return `${short(p, f.cwd)} · does not exist`
    const kb = sizes.get(p)
    const bits: string[] = links.has(p) ? ['symlink'] : []
    if (counts?.has(p)) bits.push(plural(counts.get(p)!, 'file'))
    if (kb !== undefined) bits.push(fmtKb(kb))
    return `${short(p, f.cwd)}${dirs.has(p) ? '/' : ''}${bits.length ? ` · ${bits.join(', ')}` : ''}`
  })
  const [verbForm, title] = VERBS[o.verb] ?? [o.verb + 's', cap1(o.verb)]
  r.groups.push(cap(title, rows, cfg.maxListed))
  r.items = live.length
  if (live.length === 1) r.action = `${verbForm} ${short(live[0]!, f.cwd)}${dirs.has(live[0]!) ? '/' : ''}`
  else if (live.length > 1) r.action = `${verbForm} ${plural(live.length, dirs.size === live.length ? 'folder' : dirs.size === 0 ? 'file' : 'item')}`
  const totalKb = [...sizes.values()].reduce((a, b) => a + b, 0)
  const totalFiles = counts && dirs.size > 0 ? [...counts.values()].reduce((a, b) => a + b, 0) : undefined
  r.summary.push(
    live.length === 0
      ? 'nothing exists at that path right now'
      : [plural(live.length, 'item'), totalFiles !== undefined ? plural(totalFiles, 'file') : undefined, fmtKb(totalKb)]
          .filter(Boolean).join(', '),
  )
  if (o.expandSingleDir && live.length === 1 && dirs.has(live[0]!)) await children(run, live[0]!, f, r, cfg)
  // removing a symlink removes only the link: it is not "a file outside git" whose content is lost
  const atRisk = o.folders === 'delete' || o.folders === undefined ? live.filter(p => !links.has(p)) : live
  if (o.risk !== false && atRisk.length > 0) await addRisk(run, atRisk, r, cfg)
  if (o.folders !== false && live.length > 0) {
    const known = new Map<string, Known>([...dirs].map(d => [d, { kb: sizes.get(d), files: counts?.get(d), filesLowerBound: truncated }]))
    await addFolders(run, f, r, live, dirs, links, { mode: o.folders ?? 'delete', canLower: o.canLower !== false, known }, cfg)
  }
  return r
}

// Symbolic links among the paths (find -type l does not follow them). Best effort: a failed probe means "none seen".
async function linksAmong(run: Run, live: string[], dirs: Set<string>): Promise<Set<string>> {
  try {
    return await present(run, live.filter(p => !dirs.has(p)), ['-type', 'l'])
  } catch {
    return new Set()
  }
}

// Folder risk for the directories (and symlinks) among the targets, merged into the overall RISK line. An add-on to the
// listing: if it fails the listing and the file-level risk stand, and a note says so.
async function addFolders(
  run: Run, f: Finding, r: Omit<Report, 'finding'>, live: string[], dirs: Set<string> | undefined, linkSet: Set<string> | undefined,
  o: { mode: Mode; canLower: boolean; known?: Map<string, Known> }, cfg: Config,
): Promise<void> {
  try {
    const dirSet = dirs ?? (await present(run, live, ['-type', 'd']))
    const links = linkSet ?? (await present(run, live.filter(p => !dirSet.has(p)), ['-type', 'l']))
    const cands = [...dirSet, ...links]
    if (cands.length === 0) return
    const res = await assessFolders(run, cands, { home: cfg.home, cwd: cfg.cwd, runCwd: f.cwd, mode: o.mode, known: o.known })
    r.folders = res.folders
    if (res.skipped > 0) r.notes.push(`folder details for ${res.folders.length} of ${res.folders.length + res.skipped} folders`)
    mergeFolderRisk(r, res.folders, o.canLower && res.skipped === 0 && cands.length === live.length)
  } catch (err) {
    r.notes.push(`folder details unavailable: ${(err as Error).message || 'probe failed'}`)
  }
}

const LEVEL_RANK: Record<string, number> = { low: 0, medium: 1, high: 3 }

/** The folder verdict can raise the overall level; it can lower MEDIUM to LOW only when it saw every target completely. */
function mergeFolderRisk(r: Omit<Report, 'finding'>, folders: FolderRisk[], mayLower: boolean): void {
  const worst = folders.reduce((a, b) => ((LEVEL_RANK[b.level] ?? -1) > (LEVEL_RANK[a.level] ?? -1) ? b : a))
  const cur = r.risk
  if (!cur) {
    r.risk = { level: worst.level, headline: worst.headline }
    return
  }
  if ((worst.level === 'high' && cur.level !== 'high') || (worst.level === 'medium' && cur.level === 'low'))
    r.risk = { level: worst.level, headline: [worst.headline, cur.headline].filter(Boolean).join('; ') }
  else if (mayLower && cur.level === 'medium' && folders.every(x => x.level === 'low' && x.complete))
    r.risk = { level: 'low', headline: worst.headline }
  // a plain folder holding nothing but safe repositories is "outside any repository" to the file-level check
  else if (mayLower && cur.level === 'high' && folders.every(x => x.level === 'low' && x.complete && x.onlyRepos))
    r.risk = { level: 'low', headline: worst.headline }
}

// Attach the data-loss assessment. assessLoss never throws; a failed probe yields level 'unknown'.
async function addRisk(run: Run, live: string[], r: Omit<Report, 'finding'>, cfg: Config): Promise<void> {
  const a = await assessLoss(run, live, cfg)
  r.risk = a.risk
  r.riskGroups = a.groups
  r.notes.push(...a.notes)
}

// One find over all dirs: every non-directory under them, attributed to its dir by prefix.
async function countFiles(run: Run, dirs: string[], r: Omit<Report, 'finding'>): Promise<Map<string, number> | undefined> {
  if (dirs.length === 0) return new Map()
  try {
    const res = await run(['find', ...dirs, '!', '-type', 'd', '-print'])
    const counts = new Map<string, number>(dirs.map(d => [d, 0]))
    for (const l of lines(res.stdout)) for (const d of dirs) if (l.startsWith(d + '/')) counts.set(d, counts.get(d)! + 1)
    if (res.isStdoutTruncated) r.notes.push('file counts are lower bounds (listing truncated)')
    return counts
  } catch (err) {
    r.notes.push(`file count unavailable: ${(err as Error).message}`)
    return undefined
  }
}

async function children(run: Run, dir: string, f: Finding, r: Omit<Report, 'finding'>, cfg: Config): Promise<void> {
  try {
    const kids = lines((await run(['find', dir, '-mindepth', '1', '-maxdepth', '1'])).stdout).slice(0, 500)
    const dirs = await present(run, kids, ['-type', 'd'])
    const sizes = await duMany(run, kids)
    const rows = kids
      .map(k => ({ k, kb: sizes.get(k) ?? 0 }))
      .sort((a, b) => b.kb - a.kb)
      .map(({ k, kb }) => `${short(k, dir)}${dirs.has(k) ? '/' : ''} · ${fmtKb(kb)}`)
    if (rows.length) r.groups.push(cap(`Largest inside ${short(dir, f.cwd)}/`, rows, cfg.maxListed, { extra: true }))
  } catch (err) {
    r.notes.push(`could not list the contents: ${(err as Error).message}`)
  }
}

// ---- per-kind measurement ---------------------------------------------------------------

const pos = (args: string[]) => {
  const dd = args.indexOf('--')
  return (dd < 0 ? args : args.slice(0, dd)).filter(a => !a.startsWith('-')).concat(dd < 0 ? [] : args.slice(dd + 1))
}

async function git(run: Run, cwd: string | undefined, ...argv: string[]): Promise<string> {
  const res = await run(['git', '--no-optional-locks', '--no-pager', ...argv], cwd)
  if (res.exitCode !== 0) throw new Error(`git ${argv[0]} failed: ${res.stderr.trim().split('\n')[0] || `exit ${res.exitCode}`}`)
  return res.stdout
}

export async function measure(run: Run, f: Finding, cfg: Config): Promise<Report> {
  try {
    return { finding: f, ...(await dispatch(run, f, cfg)) }
  } catch (err) {
    return { finding: f, groups: [], summary: [], notes: [], unmeasured: (err as Error).message || 'probe failed' }
  }
}

async function dispatch(run: Run, f: Finding, cfg: Config): Promise<Omit<Report, 'finding'>> {
  const dp = (verb: string, targets = f.targets, expandSingleDir = true) =>
    describePaths(run, f, targets, { verb, expandSingleDir, cap: 500 }, cfg)
  switch (f.kind) {
    case 'rm': {
      if (f.viaXargs || f.targets.length === 0)
        return { ...empty(), unmeasured: 'the paths arrive on stdin (xargs) or are not named' }
      return dp('delete')
    }
    case 'truncate': return dp('empty', f.targets, false)
    case 'shred': return dp('overwrite and destroy', f.targets, false)
    case 'chmod': return describePaths(run, f, f.targets, { verb: 'change recursively', expandSingleDir: true, cap: 500, risk: false, folders: 'modify' }, cfg)
    case 'r': {
      const r = await dp('delete')
      if (f.targets.length === 0) r.notes.push('the paths in the R code are computed: could not name them')
      return r
    }
    case 'cargo-clean': return cargoClean(run, f, cfg)
    case 'redirect': return redirect(run, f, cfg)
    case 'overwrite': return overwrite(run, f, cfg)
    case 'dd': return dd(run, f, cfg)
    case 'mkfs': return { ...empty(), unmeasured: 'a device is erased; its contents are not inspected' }
    case 'find': return findRule(run, f, cfg)
    case 'git-clean': return gitClean(run, f, cfg)
    case 'git-reset': return gitReset(run, f, cfg)
    case 'git-discard': return gitDiscard(run, f, cfg)
    case 'git-push': return gitPush(run, f, cfg)
    case 'git-branch': return gitBranch(run, f, cfg)
    case 'git-stash': return gitStash(run, f, cfg)
    case 'sql': return { ...empty(), groups: [{ title: 'Statements', rows: f.args, more: 0 }], unmeasured: 'database contents are not inspected' }
    case 'custom': return { ...empty(), action: 'matches your extra pattern', unmeasured: 'nothing measured for your extra patterns' }
    case 'opaque': return { ...empty(), unmeasured: f.reason }
  }
}

async function cargoClean(run: Run, f: Finding, cfg: Config) {
  const a = f.args
  const flag = (n: string) => { const k = a.indexOf(n); return k >= 0 ? a[k + 1] : a.find(x => x.startsWith(n + '='))?.slice(n.length + 1) }
  const dir = flag('--target-dir')
  const manifest = flag('--manifest-path')
  const abs = (p: string) => (p.startsWith('/') ? normalize(p) : f.cwd ? normalize(`${f.cwd}/${p}`) : undefined)
  const where = dir ? abs(dir) : manifest ? abs(manifest.replace(/[^/]*$/, '') + 'target') : f.cwd ? `${f.cwd}/target` : undefined
  if (!where) return { ...empty(), unmeasured: 'the working directory is not known' }
  const r = await describePaths(run, f, [{ raw: where, path: where, glob: false }], { verb: 'delete', expandSingleDir: true, cap: 1, risk: false }, cfg)
  r.notes.push('cargo may clean the workspace\'s target/ or CARGO_TARGET_DIR instead')
  return r
}

async function redirect(run: Run, f: Finding, cfg: Config) {
  const p = f.targets[0]!.path!
  // find -L <p> -maxdepth 0 -type f -size +0c : prints p only for a non-empty regular file.
  const hit = lines((await run(['find', '-L', p, '-maxdepth', '0', '-type', 'f', '-size', '+0c', '-print'])).stdout)
  if (hit.length === 0) return { ...empty(), skip: true }
  return describePaths(run, f, f.targets, { verb: 'overwrite', expandSingleDir: false, cap: 1 }, cfg)
}

async function overwrite(run: Run, f: Finding, cfg: Config) {
  const dest = f.targets[0]!.path!
  const cands = [dest, ...f.args.map(s => `${dest}/${s.slice(s.lastIndexOf('/') + 1)}`)]
  const hits = [...(await present(run, cands, ['-type', 'f']))]
  if (hits.length === 0) {
    const dirs = await overwrittenDirs(run, f, dest)
    if (dirs.length === 0) return { ...empty(), skip: true }
    const targets = dirs.map(p => ({ raw: p, path: p, glob: false }))
    return describePaths(run, f, targets, { verb: 'overwrite or merge into', expandSingleDir: false, cap: 100, folders: 'overwrite', canLower: false }, cfg)
  }
  const targets = hits.map(p => ({ raw: p, path: p, glob: false }))
  return describePaths(run, f, targets, { verb: 'overwrite', expandSingleDir: false, cap: 100 }, cfg)
}

// `cp -rf src dest` / `mv -f src dest` where dest is a folder that already holds a folder named like src: its files are replaced.
async function overwrittenDirs(run: Run, f: Finding, dest: string): Promise<string[]> {
  const abs = f.args.filter(a => !/[*?[$`~]/.test(a)).map(a => (a.startsWith('/') ? normalize(a) : f.cwd ? normalize(`${f.cwd}/${a}`) : '')).filter(Boolean)
  if (abs.length === 0 || (await present(run, [dest], ['-type', 'd'])).size === 0) return []
  const srcDirs = await present(run, abs, ['-type', 'd'])
  const inDest = [...srcDirs].map(p => `${dest}/${p.slice(p.lastIndexOf('/') + 1)}`)
  return inDest.length ? [...(await present(run, inDest, ['-type', 'd']))] : []
}

async function dd(run: Run, f: Finding, cfg: Config) {
  const t = f.targets[0]!
  if (t.path?.startsWith('/dev/'))
    return { ...empty(), action: `writes over ${t.path}`, notes: ['Everything on the device is overwritten'], unmeasured: 'device contents are not inspected' }
  return describePaths(run, f, f.targets, { verb: 'overwrite', expandSingleDir: false, cap: 1 }, cfg)
}

// find ... -delete / -exec rm  ->  the same find with the destructive part swapped for -print.
export function findPreviewArgs(args: string[]): { argv: string[]; note?: string } | undefined {
  const out: string[] = []
  let note: string | undefined
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!
    if (/^-(fprint0?|fprintf|fls)$/.test(t)) return undefined // would write a file
    if (t === '-delete') out.push('-print')
    else if (/^-(exec|execdir|ok|okdir)$/.test(t)) {
      let j = i + 1
      while (j < args.length && args[j] !== ';' && args[j] !== '+') j++
      const cmd = (args[i + 1] ?? '').slice((args[i + 1] ?? '').lastIndexOf('/') + 1)
      if (/^(rm|unlink|shred|rmdir|sh|bash|zsh)$/.test(cmd)) out.push('-print')
      else note = 'an -exec filter was left out, so the list may include extra paths'
      i = j
    } else out.push(t)
  }
  return { argv: out, ...(note ? { note } : {}) }
}

async function findRule(run: Run, f: Finding, cfg: Config) {
  if (f.args.some(a => /[$`]/.test(a))) return { ...empty(), unmeasured: 'the find arguments contain shell expansions' }
  const prev = findPreviewArgs(f.args)
  if (!prev) return { ...empty(), unmeasured: 'the find writes files itself (-fprint/-fls): not previewed' }
  const res = await run(['find', ...prev.argv], f.cwd)
  const abs = (p: string) => (p.startsWith('/') ? p : f.cwd ? normalize(`${f.cwd}/${p}`) : p)
  const found = lines(res.stdout).map(abs)
  const r = empty()
  if (prev.note) r.notes.push(prev.note)
  if (res.exitCode !== 0 && found.length === 0) throw new Error(`find failed: ${res.stderr.trim().split('\n')[0] || `exit ${res.exitCode}`}`)
  if (res.isStdoutTruncated) r.notes.push('match list truncated: counts are lower bounds')
  const sized = found.slice(0, 300)
  const sizes = await duMany(run, sized)
  const rows = sized.map(p => `${short(p, f.cwd)}  ${fmtKb(sizes.get(p) ?? 0)}`).concat(found.slice(300).map(p => short(p, f.cwd)))
  r.groups.push(cap('Deletes', rows, cfg.maxListed))
  r.action = `deletes ${plural(found.length, 'match', 'matches')}`
  const kb = [...sizes.values()].reduce((a, b) => a + b, 0)
  r.summary.push(`${plural(found.length, 'match', 'matches')}, ${fmtKb(kb)}${found.length > sized.length ? ' (first 300 sized)' : ''}`)
  if (found.length > 0) await addRisk(run, found.slice(0, 500), r, cfg)
  if (found.length > 0) {
    // a match that is a directory is deleted with everything in it (find -delete only when it is empty by then)
    const matched = found.slice(0, 500)
    await addFolders(run, f, r, matched, undefined, undefined, { mode: 'delete', canLower: true }, cfg)
  }
  return r
}

// ---- git ------------------------------------------------------------------------------------

async function gitClean(run: Run, f: Finding, cfg: Config) {
  const a = f.args
  const letters = new Set(a.filter(x => /^-[^-]/.test(x)).flatMap(x => [...x.slice(1)]))
  const probe = ['clean', '-n', ...['d', 'x', 'X'].filter(l => letters.has(l)).map(l => '-' + l)]
  const paths: string[] = []
  let afterDashes = false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    if (afterDashes) paths.push(x)
    else if (x === '--') afterDashes = true
    else if (x === '-e' || x === '--exclude') probe.push('-e', a[++i] ?? '')
    else if (x.startsWith('--exclude=')) probe.push(x)
    else if (!x.startsWith('-')) paths.push(x)
  }
  const out = await git(run, f.cwd, ...probe, '--', ...paths)
  const rel = parseCleanDryRun(out)
  if (!f.cwd) throw new Error('the working directory is not known')
  const targets = rel.map(p => ({ raw: p, path: normalize(`${f.cwd}/${p}`), glob: false }))
  if (targets.length === 0) return { ...empty(), notes: ['git clean -n finds nothing to remove right now'] }
  const r = await describePaths(run, f, targets, { verb: 'delete (untracked)', expandSingleDir: false, cap: 300, canLower: false }, cfg)
  r.action = `deletes ${plural(targets.length, 'untracked path')}`
  if (!letters.has('x') && !letters.has('X')) r.notes.push('Ignored files are kept (no -x)')
  r.risk = { level: 'high', headline: `${plural(targets.length, 'untracked path')} never committed, gone for good${letters.has('x') || letters.has('X') ? ' (includes ignored files)' : ''}` }
  return r
}

async function gitReset(run: Run, f: Finding, cfg: Config) {
  const ref = pos(f.args).find(a => REF.test(a)) ?? 'HEAD'
  if (!REF.test(ref)) throw new Error(`unusual ref "${ref}"`)
  const files = parseNameStatus(await git(run, f.cwd, 'diff', '--name-status', ref))
  const stat = (await git(run, f.cwd, 'diff', '--shortstat', ref)).trim()
  const lost = lines(await git(run, f.cwd, 'log', '--oneline', '-n', String(cfg.maxListed + 1), `${ref}..HEAD`))
  const r = empty()
  r.groups.push(cap('Changes lost', files, cfg.maxListed))
  if (lost.length) r.groups.push(cap('Commits leaving the branch', lost, cfg.maxListed))
  r.action = `discards uncommitted changes${files.length ? ` in ${plural(files.length, 'file')}` : ''}`
  r.summary.push(stat || 'no uncommitted changes to tracked files')
  r.notes.push('Untracked files are not touched')
  r.risk = files.length
    ? { level: 'high', headline: `uncommitted changes to ${plural(files.length, 'tracked file')}, gone for good (not in the reflog)` }
    : lost.length ? { level: 'medium', headline: 'commits leave the branch; git reflog can bring them back' }
    : { level: 'low', headline: 'nothing uncommitted to lose' }
  return r
}

async function gitDiscard(run: Run, f: Finding, cfg: Config) {
  const a = f.args
  const dd = a.indexOf('--')
  const before = (dd < 0 ? a : a.slice(0, dd)).filter(x => !x.startsWith('-'))
  const after = dd < 0 ? [] : a.slice(dd + 1)
  const source = a.find(x => x.startsWith('--source='))?.slice(9)
  const tree = source ?? (dd >= 0 ? before.find(x => REF.test(x)) : undefined)
  if (tree !== undefined && !REF.test(tree)) throw new Error(`unusual ref "${tree}"`)
  const paths = after.length ? after : dd < 0 ? before : []
  const spec = ['--name-status', ...(tree ? [tree] : paths.length ? [] : ['HEAD']), '--', ...(paths.length ? paths : ['.'])]
  const files = parseNameStatus(await git(run, f.cwd, 'diff', ...spec))
  const stat = (await git(run, f.cwd, 'diff', '--shortstat', ...spec.filter(s => s !== '--name-status'))).trim()
  const r = empty()
  r.groups.push(cap('Changes lost', files, cfg.maxListed))
  r.action = `discards uncommitted changes${files.length ? ` in ${plural(files.length, 'file')}` : ''}`
  r.summary.push(stat || 'no uncommitted changes to tracked files here')
  r.notes.push('Untracked files are not touched')
  r.risk = files.length
    ? { level: 'high', headline: `uncommitted changes to ${plural(files.length, 'tracked file')}, gone for good` }
    : { level: 'low', headline: 'nothing uncommitted to lose here' }
  return r
}

async function gitPush(run: Run, f: Finding, cfg: Config) {
  const a = f.args
  if (a.some(x => ['--all', '--mirror', '--tags'].includes(x))) throw new Error('pushes every ref: cannot enumerate')
  const operands = pos(a)
  const remote = operands[0]
  const specs = operands.slice(1)
  const pairs = specs.length
    ? specs.map(s => {
        const body = s.replace(/^\+/, '')
        const [src, dst] = body.includes(':') ? [body.split(':')[0]!, body.split(':').slice(1).join(':')] : [body, body]
        return { src, dst: dst.replace(/^refs\/heads\//, '') }
      })
    : [{ src: 'HEAD', dst: '' }]
  const deleting = a.includes('--delete') || a.includes('-d')
  const r = empty()
  for (const p of pairs) {
    const src = deleting && p.src === p.dst ? '' : p.src
    const dstRef = p.dst === '' || !remote ? '@{u}' : `${remote}/${p.dst}`
    for (const ref of [src, dstRef]) if (ref !== '' && !REF.test(ref)) throw new Error(`unusual ref "${ref}"`)
    if (src === '') {
      const tip = lines(await git(run, f.cwd, 'log', '--oneline', '-n', '5', dstRef))
      r.groups.push(cap(`${dstRef} is deleted; latest commits`, tip, cfg.maxListed))
      r.action = `deletes ${dstRef} on the remote`
      continue
    }
    const over = lines(await git(run, f.cwd, 'log', '--oneline', '-n', String(cfg.maxListed + 1), `${src}..${dstRef}`))
    const sent = lines(await git(run, f.cwd, 'log', '--oneline', '-n', String(cfg.maxListed + 1), `${dstRef}..${src}`))
    r.groups.push(cap(`Overwritten on ${dstRef}`, over, cfg.maxListed))
    r.groups.push(cap(`Sent from ${src}`, sent, cfg.maxListed))
    r.action ??= `force-pushes over ${dstRef}`
    r.summary.push(`${plural(over.length, 'remote commit')} lost, ${plural(sent.length, 'commit')} sent`)
    if (over.length) r.risk = { level: 'high', headline: `${plural(over.length, 'remote commit')} overwritten for anyone who has not pulled them` }
  }
  r.notes.push('Remote state is as of your last fetch')
  return r
}

async function gitBranch(run: Run, f: Finding, cfg: Config) {
  const r = empty()
  for (const b of pos(f.args)) {
    if (!REF.test(b)) throw new Error(`unusual branch name "${b}"`)
    const only = lines(await git(run, f.cwd, 'log', '--oneline', '-n', String(cfg.maxListed + 1), b, '--not', `--exclude=${b}`, '--branches', '--tags', '--remotes'))
    const tip = (await git(run, f.cwd, 'rev-parse', '--short', b)).trim()
    r.groups.push(cap(
      only.length ? `Only on ${b}` : `${b}: every commit is also elsewhere`, only, cfg.maxListed,
    ))
    r.notes.push(`Undo: git branch ${b} ${tip}`)
    r.action = `deletes branch ${pos(f.args).join(', ')}`
    if (only.length) r.risk = { level: 'high', headline: `${plural(only.length, 'commit')} on ${b} exist on no other branch, tag or remote` }
  }
  return r
}

async function gitStash(run: Run, f: Finding, cfg: Config) {
  const op = f.args[0]
  const r = empty()
  if (op === 'clear') {
    const all = lines(await git(run, f.cwd, 'stash', 'list'))
    r.groups.push(cap('Stashes deleted', all, cfg.maxListed))
    r.action = 'deletes all stashes'
    r.summary.push(plural(all.length, 'stash', 'stashes'))
    r.risk = { level: 'high', headline: `${plural(all.length, 'stash', 'stashes')} of uncommitted work exist nowhere else` }
    return r
  }
  const ref = f.args.slice(1).find(x => !x.startsWith('-')) ?? 'stash@{0}'
  if (!/^stash@\{\d+\}$/.test(ref)) throw new Error(`unusual stash ref "${ref}"`)
  const stat = lines(await git(run, f.cwd, 'stash', 'show', '--stat', ref))
  r.groups.push(cap(`${ref} holds`, stat.slice(0, -1), cfg.maxListed))
  r.action = `deletes ${ref}`
  r.summary.push(stat.at(-1)?.trim() ?? ref)
  r.notes.push('git fsck --unreachable can still find a dropped stash until gc runs')
  r.risk = { level: 'high', headline: 'stashed work exists nowhere else' }
  return r
}

export async function measureAll(run: Run, findings: Finding[], cfg: Config, max = 6): Promise<{ reports: Report[]; unlisted: number }> {
  const reports: Report[] = []
  for (const f of findings.slice(0, max)) {
    const rep = await measure(run, f, cfg)
    if (!rep.skip) reports.push(rep)
  }
  return { reports, unlisted: Math.max(0, findings.length - max) }
}
