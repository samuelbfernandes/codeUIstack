// checkpoint: safety snapshots of the working tree (untracked files included) kept as refs under
// refs/moddeck/checkpoints/<name>. Built with git plumbing only:
//   temporary index (GIT_INDEX_FILE) -> add -A -> write-tree -> commit-tree -> update-ref
// so the person's branch, real index and stash list are never touched. Restore is the one destructive command:
// it first shows what would be lost and asks. Nothing here ever runs stash, reset, clean or checkout.
import { gitIn } from './git'
import type { Git, Run } from './git'

export const REF_PREFIX = 'refs/moddeck/checkpoints/'
export const MAX_LISTED = 20
export const MAX_NAMES = 8
const MARK = 'includes-untracked'
const AUTO = 'auto-'
const IDENT = {
  GIT_AUTHOR_NAME: 'moddeck checkpoint',
  GIT_AUTHOR_EMAIL: 'checkpoint@moddeck.invalid',
  GIT_COMMITTER_NAME: 'moddeck checkpoint',
  GIT_COMMITTER_EMAIL: 'checkpoint@moddeck.invalid',
}
const WORDS = new Set(['list', 'diff', 'restore', 'drop'])

export type Deps = {
  run: Run
  cwd: string | undefined
  /** Milliseconds since the epoch. */
  now: () => number
  /** Asks the person; rejects (Esc, no screen) read as a cancel. */
  ask: (text: string, options: string[], header: string) => Promise<string>
  /** Whether there is a screen to ask on. */
  canAsk: () => Promise<boolean>
}

export type Checkpoint = { name: string; sha: string; at: number }

const NOT_REPO = 'Checkpoint · this folder is not a git repository, nothing done'
const FAILED = 'Checkpoint · that did not work, nothing was changed'
const HEADER = 'Checkpoint'

class Failure extends Error {}
const fail = (what: string, r?: { stderr: string }): never => {
  const why = r?.stderr.split('\n').find(l => l.trim() !== '')?.trim().slice(0, 120)
  throw new Failure(why ? `${what} (${why})` : what)
}

export const isValidName = (name: string): boolean => /^[a-z0-9][a-z0-9-]{0,59}$/.test(name) && !name.endsWith('-') && !WORDS.has(name)

const two = (n: number) => String(n).padStart(2, '0')
/** YYYYmmdd-HHMMSS in local time. */
export function stamp(ms: number): string {
  const t = new Date(ms)
  return `${t.getFullYear()}${two(t.getMonth() + 1)}${two(t.getDate())}-${two(t.getHours())}${two(t.getMinutes())}${two(t.getSeconds())}`
}

export function age(ms: number, atSec: number): string {
  const s = Math.max(0, Math.round(ms / 1000 - atSec))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const nonEmpty = (s: string) => s.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l !== '')

type Repo = { g: Git; root: string; gitDir: string }

async function repoOf(d: Deps): Promise<Repo | undefined> {
  const g = gitIn(d.run, d.cwd)
  const top = await g(['rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0 || top.stdout.trim() === '') return undefined
  const root = top.stdout.trim()
  const gd = await gitIn(d.run, root)(['rev-parse', '--absolute-git-dir'])
  if (gd.exitCode !== 0 || gd.stdout.trim() === '') return undefined
  return { g: gitIn(d.run, root), root, gitDir: gd.stdout.trim() }
}

/** Tree of the whole working tree (untracked files too, ignored ones not), built in a temporary index. */
async function workTree(r: Repo): Promise<string> {
  const idx = `${r.gitDir.replace(/[\\/]$/, '')}/moddeck-checkpoint.index`
  const env = { GIT_INDEX_FILE: idx }
  const add = await r.g(['add', '-A'], { env })
  if (add.exitCode !== 0) fail('could not read the working tree', add)
  const tree = await r.g(['write-tree'], { env })
  if (tree.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(tree.stdout.trim())) fail('could not read the working tree', tree)
  return tree.stdout.trim()
}

export async function listRefs(g: Git): Promise<Checkpoint[]> {
  const r = await g(['for-each-ref', '--sort=-refname', '--format=%(refname)%09%(objectname)%09%(committerdate:unix)', REF_PREFIX])
  if (r.exitCode !== 0) return []
  const rows: Checkpoint[] = []
  for (const line of nonEmpty(r.stdout)) {
    const [ref = '', sha = '', at = ''] = line.split('\t')
    if (ref.startsWith(REF_PREFIX) && sha) rows.push({ name: ref.slice(REF_PREFIX.length), sha, at: Number(at) || 0 })
  }
  return rows.sort((a, b) => b.at - a.at)
}

export const countOf = async (d: Deps): Promise<number | undefined> => {
  const repo = await repoOf(d)
  return repo ? (await listRefs(repo.g)).length : undefined
}

/** A commit holding `tree`, parented on HEAD when there is one, saved under `name`. */
async function save(r: Repo, tree: string, name: string): Promise<void> {
  const head = await r.g(['rev-parse', '-q', '--verify', 'HEAD'])
  const parent = head.exitCode === 0 && head.stdout.trim() !== '' ? ['-p', head.stdout.trim()] : []
  const c = await r.g(['commit-tree', tree, ...parent, '-m', `moddeck checkpoint ${name}\n\n${MARK}`], { env: IDENT })
  const sha = c.stdout.trim()
  if (c.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) fail('could not save the snapshot', c)
  const u = await r.g(['update-ref', `${REF_PREFIX}${name}`, sha])
  if (u.exitCode !== 0) fail('could not save the snapshot', u)
}

const uniqueName = async (r: Repo, base: string): Promise<string> => {
  const have = new Set((await listRefs(r.g)).map(c => c.name))
  let name = base
  for (let n = 2; have.has(name); n++) name = `${base}-${n}`
  return name
}

async function treeFiles(r: Repo, tree: string): Promise<number> {
  const t = await r.g(['ls-tree', '-r', '--name-only', '-z', tree])
  return t.exitCode === 0 ? t.stdout.split('\0').filter(Boolean).length : 0
}

// ---------------------------------------------------------------- commands

async function create(r: Repo, d: Deps, wanted: string | undefined): Promise<string> {
  let name = wanted
  if (name === undefined) name = await uniqueName(r, `cp-${stamp(d.now())}`)
  else if ((await listRefs(r.g)).some(c => c.name === name)) return `Checkpoint · "${name}" already exists · pick another name or /checkpoint drop ${name}`
  const tree = await workTree(r)
  await save(r, tree, name)
  return `Checkpoint · saved ${name} · ${plural(await treeFiles(r, tree), 'file')} · /checkpoint restore ${name} to go back`
}

async function list(r: Repo, d: Deps): Promise<string> {
  const all = await listRefs(r.g)
  if (all.length === 0) return 'Checkpoint · none saved · /checkpoint saves one'
  let now: string | undefined
  try {
    now = await workTree(r)
  } catch {
    now = undefined // counts are then left out
  }
  const rows: string[] = []
  for (const c of all.slice(0, MAX_LISTED)) {
    let changed = ''
    if (now !== undefined) {
      const diff = await r.g(['diff-tree', '-r', '--name-only', '-z', '--no-renames', c.sha, now])
      changed = diff.exitCode === 0 ? ` · ${plural(diff.stdout.split('\0').filter(Boolean).length, 'file')} changed` : ''
    }
    rows.push(`${c.name} · ${age(d.now(), c.at)}${changed}`)
  }
  const more = all.length > MAX_LISTED ? [`+${all.length - MAX_LISTED} older`] : []
  return [`Checkpoint · ${all.length} saved`, ...rows, ...more].join('\n')
}

async function find(r: Repo, name: string): Promise<string | undefined> {
  const v = await r.g(['rev-parse', '-q', '--verify', `${REF_PREFIX}${name}^{commit}`])
  return v.exitCode === 0 && v.stdout.trim() !== '' ? v.stdout.trim() : undefined
}

async function showDiff(r: Repo, name: string): Promise<string> {
  const sha = await find(r, name)
  if (!sha) return `Checkpoint · no checkpoint named ${name}`
  const now = await workTree(r)
  const diff = await r.g(['diff', '--stat', '--no-renames', sha, now])
  if (diff.exitCode !== 0) fail('could not compare', diff)
  const rows = nonEmpty(diff.stdout)
  if (rows.length === 0) return `Checkpoint · ${name} matches the working tree now`
  const shown = rows.length > 30 ? [...rows.slice(0, 29), `… ${rows.length - 29} more lines`, rows[rows.length - 1]!] : rows
  return [`Checkpoint · ${name} to now`, ...shown].join('\n')
}

type Change = { status: string; path: string }
const parseChanges = (out: string): Change[] => {
  const parts = out.split('\0')
  const rows: Change[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) rows.push({ status: parts[i]!.charAt(0), path: parts[i + 1]! })
  return rows
}

const safeRel = (p: string) => p !== '' && !/^([\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes('..')
const looksWindows = (root: string) => /^[A-Za-z]:[\\/]/.test(root) || root.includes('\\')

async function removeFile(d: Deps, r: Repo, rel: string): Promise<boolean> {
  if (!safeRel(rel)) return false
  const argv = looksWindows(r.root) ? ['cmd', '/c', 'del', '/f', '/q', rel.replace(/\//g, '\\')] : ['rm', '-f', '--', rel]
  try {
    return (await d.run(argv, { cwd: r.root, timeoutMs: 20_000 })).exitCode === 0
  } catch {
    return false
  }
}

async function restore(r: Repo, d: Deps, name: string): Promise<string> {
  const sha = await find(r, name)
  if (!sha) return `Checkpoint · no checkpoint named ${name}`
  const now = await workTree(r)
  const diff = await r.g(['diff-tree', '-r', '-z', '--name-status', '--no-renames', sha, now])
  if (diff.exitCode !== 0) fail('could not compare', diff)
  const changes = parseChanges(diff.stdout)
  if (changes.length === 0) return `Checkpoint · ${name} already matches the working tree, nothing to restore`

  const tracked = new Set((await r.g(['ls-files', '-z'])).stdout.split('\0').filter(Boolean))
  const msg = await r.g(['log', '-1', '--format=%B', sha])
  const hasUntracked = msg.stdout.includes(MARK)

  const overwrite = changes.filter(c => c.status !== 'A' && c.status !== 'D').map(c => c.path)
  const bringBack = changes.filter(c => c.status === 'D').map(c => c.path)
  const added = changes.filter(c => c.status === 'A')
  const dropTracked = added.filter(c => tracked.has(c.path)).map(c => c.path)
  const dropUntracked = hasUntracked ? added.filter(c => !tracked.has(c.path)).map(c => c.path) : []
  const lost = [...overwrite, ...dropTracked, ...dropUntracked]
  const restoreList = [...overwrite, ...bringBack, ...dropTracked]

  const at = (await listRefs(r.g)).find(c => c.name === name)
  const shown = lost.slice(0, MAX_NAMES).map(p => `  ${p.replace(/[\r\n]/g, ' ')}`)
  const text = [
    `Restore ${name}${at ? ` (${age(d.now(), at.at)})` : ''}?`,
    lost.length === 0
      ? 'Nothing would be overwritten or deleted.'
      : `${plural(lost.length, 'file')} differ from it and would be lost: ${overwrite.length} overwritten, ${dropTracked.length + dropUntracked.length} deleted.`,
    ...shown,
    ...(lost.length > MAX_NAMES ? [`  +${lost.length - MAX_NAMES} more`] : []),
    ...(bringBack.length ? [`${plural(bringBack.length, 'missing file')} would come back.`] : []),
    'Your branch, index and stash are not touched.',
  ].join('\n')

  if (!(await d.canAsk())) return 'Checkpoint · no screen to ask on, nothing changed'
  const FIRST = 'Snapshot first, then restore'
  let answer = 'Cancel'
  try {
    answer = await d.ask(text, [FIRST, 'Restore', 'Cancel'], HEADER)
  } catch {
    answer = 'Cancel' // Esc or no one to ask
  }
  if (answer !== FIRST && answer !== 'Restore') return 'Checkpoint · cancelled, nothing changed'

  let before = ''
  if (answer === FIRST) {
    before = await uniqueName(r, `before-restore-${stamp(d.now())}`)
    await save(r, now, before) // a failure here stops everything: nothing is restored without its safety copy
  }
  if (restoreList.length > 0) {
    const res = await r.g(['restore', `--source=${sha}`, '--worktree', '--pathspec-from-file=-', '--pathspec-file-nul'], { stdin: restoreList.join('\0') + '\0' })
    if (res.exitCode !== 0) fail('the restore did not finish, nothing more was changed', res)
  }
  let gone = 0
  for (const p of dropUntracked) if (await removeFile(d, r, p)) gone++
  const kept = before ? ` · copy saved as ${before}` : ''
  return `Checkpoint · restored ${name} · ${overwrite.length} overwritten · ${dropTracked.length + gone} deleted · ${bringBack.length} brought back${kept}`
}

async function drop(r: Repo, d: Deps, name: string): Promise<string> {
  const sha = await find(r, name)
  if (!sha) return `Checkpoint · no checkpoint named ${name}`
  if (!(await d.canAsk())) return 'Checkpoint · no screen to ask on, nothing changed'
  let answer = 'Cancel'
  try {
    answer = await d.ask(`Drop checkpoint ${name}?\nIt cannot be brought back.`, ['Cancel', 'Drop'], HEADER)
  } catch {
    answer = 'Cancel'
  }
  if (answer !== 'Drop') return 'Checkpoint · cancelled, nothing changed'
  const res = await r.g(['update-ref', '-d', `${REF_PREFIX}${name}`])
  if (res.exitCode !== 0) fail('could not drop it', res)
  return `Checkpoint · dropped ${name}`
}

const USAGE = 'Checkpoint · /checkpoint [name] · list · diff <name> · restore <name> · drop <name>'

export type Outcome = { text: string; count?: number }

/** The whole `/checkpoint` command. Never throws: any failure is one plain line. */
export async function runCommand(d: Deps, args: string): Promise<Outcome> {
  try {
    const words = args.trim().split(/\s+/).filter(Boolean)
    const sub = words[0]
    const arg = words[1]
    if (words.length > 2) return { text: USAGE }
    const named = sub !== undefined && WORDS.has(sub)
    if (named && sub !== 'list' && arg === undefined) return { text: `Checkpoint · which one? /checkpoint ${sub} <name>` }
    if (sub === 'list' && arg !== undefined) return { text: USAGE }
    if (!named && words.length > 1) return { text: USAGE }
    if (!named && sub !== undefined && !isValidName(sub)) return { text: 'Checkpoint · a name uses lowercase letters, digits and hyphens only (up to 60), and not list, diff, restore or drop' }
    if (!named && sub?.startsWith(AUTO)) return { text: 'Checkpoint · names starting auto- are kept for automatic snapshots' }
    if (arg !== undefined && named && !/^[a-z0-9-]+$/.test(arg)) return { text: `Checkpoint · no checkpoint named ${arg.slice(0, 40)}` }

    const r = await repoOf(d)
    if (!r) return { text: NOT_REPO }
    let text: string
    if (sub === 'list') text = await list(r, d)
    else if (sub === 'diff') text = await showDiff(r, arg!)
    else if (sub === 'restore') text = await restore(r, d, arg!)
    else if (sub === 'drop') text = await drop(r, d, arg!)
    else text = await create(r, d, sub)
    return { text, count: (await listRefs(r.g)).length }
  } catch (error) {
    return { text: error instanceof Failure ? `Checkpoint · ${error.message} · nothing was lost` : FAILED }
  }
}

/**
 * The automatic snapshot at a prompt: only when the working tree differs from HEAD and from the newest
 * snapshot, then the oldest automatic ones beyond `maxAuto` are deleted. Never throws.
 */
export async function autoSnapshot(d: Deps, maxAuto: number): Promise<number | undefined> {
  try {
    const r = await repoOf(d)
    if (!r) return undefined
    const have = await listRefs(r.g)
    const tree = await workTree(r)
    const head = await r.g(['rev-parse', '-q', '--verify', 'HEAD^{tree}'])
    const newest = have[0] ? await r.g(['rev-parse', '-q', '--verify', `${have[0].sha}^{tree}`]) : undefined
    const same = tree === head.stdout.trim() || (newest !== undefined && tree === newest.stdout.trim())
    if (!same) await save(r, tree, await uniqueName(r, `${AUTO}${stamp(d.now())}`))
    const autos = (await listRefs(r.g)).filter(c => c.name.startsWith(AUTO))
    for (const old of autos.slice(Math.max(1, maxAuto))) await r.g(['update-ref', '-d', `${REF_PREFIX}${old.name}`])
    return (await listRefs(r.g)).length
  } catch {
    return undefined
  }
}

export const count = async (d: Deps): Promise<number> => {
  try {
    return (await countOf(d)) ?? 0
  } catch {
    return 0
  }
}
