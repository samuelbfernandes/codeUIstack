import type { FsEntry } from 'claude-code'

import type { FiletreeDir, FiletreeTouch, FiletreeTree } from '../types'

export const DEFAULT_IGNORE = ['.git', 'node_modules', 'target', 'renv', '.Rproj.user', '__pycache__', '.venv', 'dist', 'build']

/** How long a touched file shimmers before it settles to its steady style. */
export const SHIMMER_MS = 6000
/** Most touched paths kept; the oldest go first. */
const MAX_TOUCHED = 500
/** Most paths one Grep or Glob result may light up. */
const MAX_SEARCH_PATHS = 50

export type ScanOptions = { maxDepth: number; maxEntries: number; ignore: ReadonlySet<string> }
export type Row =
  | { type: 'dir' | 'file'; path: string; name: string; depth: number }
  | { type: 'more' | 'unscanned'; path: string; name: string; depth: number; count: number }

// ---- ignore list -------------------------------------------------------------------------------------------------

export function ignoreSet(extra: string): Set<string> {
  const names = extra.split(',').map(name => name.trim()).filter(name => name !== '')

  return new Set([...DEFAULT_IGNORE, ...names])
}

/** True when any segment of a cwd-relative path is an ignored name (so it can never be in the tree). */
export function isIgnoredPath(rel: string, ignore: ReadonlySet<string>): boolean {
  return rel.split('/').some(part => ignore.has(part))
}

// ---- scanning ----------------------------------------------------------------------------------------------------

function byKindThenName(a: FsEntry, b: FsEntry): number {
  const rank = (entry: FsEntry) => (entry.kind === 'dir' ? 0 : 1)

  return rank(a) - rank(b) || a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

/**
 * Breadth-first scan, so the shallow entries win when the cap bites. A directory at `maxDepth` is shown but not
 * listed; entries past `maxEntries` are only counted. A symbolic link is a plain entry and is never followed.
 */
export async function scanTree(
  list: (absPath: string) => Promise<FsEntry[]>,
  root: string,
  options: ScanOptions,
): Promise<FiletreeTree> {
  const dirs: Record<string, FiletreeDir> = {}
  const queue: string[] = ['']
  let count = 0
  let more = 0
  let isCapped = false

  for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
    if (count >= options.maxEntries) {
      isCapped = true
      dirs[rel] = { entries: [], more: 0, isScanned: false }
      continue
    }
    const found = await list(rel === '' ? root : `${root}/${rel}`).catch((): FsEntry[] => [])
    const kept = found.filter(entry => !options.ignore.has(entry.name)).sort(byKindThenName)
    const taken = kept.slice(0, options.maxEntries - count)
    const entries = taken.map(entry => ({
      name: entry.name,
      path: rel === '' ? entry.name : `${rel}/${entry.name}`,
      isDir: entry.kind === 'dir',
    }))
    dirs[rel] = { entries, more: kept.length - taken.length, isScanned: true }
    count += taken.length
    more += kept.length - taken.length
    for (const entry of entries) {
      if (!entry.isDir) continue
      const level = entry.path.split('/').length
      if (level < options.maxDepth) queue.push(entry.path)
      else dirs[entry.path] = { entries: [], more: 0, isScanned: false }
    }
  }

  return { root, dirs, more, isCapped }
}

/** The rows the pane draws, depth first: a directory's children only while it is expanded. */
export function visibleRows(tree: FiletreeTree, expanded: Readonly<Record<string, boolean>>): Row[] {
  const rows: Row[] = []
  const walk = (dir: string, depth: number) => {
    const info = tree.dirs[dir]
    if (info === undefined) return
    for (const entry of info.entries) {
      rows.push({ type: entry.isDir ? 'dir' : 'file', path: entry.path, name: entry.name, depth })
      if (!entry.isDir || expanded[entry.path] !== true) continue
      const child = tree.dirs[entry.path]
      if (child !== undefined && !child.isScanned) {
        rows.push({ type: 'unscanned', path: entry.path, name: 'not scanned', depth: depth + 1, count: 0 })
      }
      walk(entry.path, depth + 1)
    }
    if (info.more > 0) rows.push({ type: 'more', path: dir, name: 'more', depth, count: info.more })
  }
  walk('', 0)

  return rows
}

// ---- touched files -----------------------------------------------------------------------------------------------

/**
 * Turns an absolute (or cwd-relative) path into the tree's key, or undefined when it lies outside the directory or
 * inside an ignored folder.
 */
export function relativeKey(cwd: string, path: string, ignore: ReadonlySet<string>): string | undefined {
  const base = cwd.replace(/\/+$/, '')
  const rel = path.startsWith('/') ? (path.startsWith(`${base}/`) ? path.slice(base.length + 1) : undefined) : path.replace(/^(\.\/)+/, '')
  if (rel === undefined || rel === '' || rel.startsWith('../') || isIgnoredPath(rel, ignore)) return undefined

  return rel
}

/** A read never un-commits an edit; an edit always does. A path ever edited stays an edit. */
export function touch(
  map: Readonly<Record<string, FiletreeTouch>>,
  rel: string,
  kind: FiletreeTouch['kind'],
  now: number,
): Record<string, FiletreeTouch> {
  const prev = map[rel]
  const isEdit = kind === 'edit'
  const next: FiletreeTouch = {
    kind: isEdit || prev?.kind === 'edit' ? 'edit' : 'read',
    at: now,
    isCommitted: !isEdit && prev?.isCommitted === true,
  }
  const merged = { ...map, [rel]: next }
  const keys = Object.keys(merged)
  if (keys.length <= MAX_TOUCHED) return merged
  const oldest = keys.sort((a, b) => (merged[a]?.at ?? 0) - (merged[b]?.at ?? 0)).slice(0, keys.length - MAX_TOUCHED)
  for (const key of oldest) delete merged[key]

  return merged
}

export function isShimmering(entry: FiletreeTouch, now: number): boolean {
  return !entry.isCommitted && now - entry.at < SHIMMER_MS
}

/** Edited files not yet seen committed: the only ones a git poll can change. */
export function hasPendingEdits(map: Readonly<Record<string, FiletreeTouch>>): boolean {
  return Object.values(map).some(entry => entry.kind === 'edit' && !entry.isCommitted)
}

export function markCommitted(
  map: Readonly<Record<string, FiletreeTouch>>,
  isModified: (rel: string) => boolean,
): Record<string, FiletreeTouch> {
  const next = { ...map }
  for (const [rel, entry] of Object.entries(map)) {
    if (entry.kind === 'edit' && !entry.isCommitted && !isModified(rel)) next[rel] = { ...entry, isCommitted: true }
  }

  return next
}

/** What a collapsed directory shows for the files below it: an uncommitted edit, else a read, else only commits. */
export function dirHeat(map: Readonly<Record<string, FiletreeTouch>>): Record<string, 'edit' | 'read' | 'done'> {
  const rank = { done: 0, read: 1, edit: 2 } as const
  const heat: Record<string, 'edit' | 'read' | 'done'> = {}
  for (const [rel, entry] of Object.entries(map)) {
    const level = entry.isCommitted ? 'done' : entry.kind
    const parts = rel.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const prev = heat[dir]
      if (prev === undefined || rank[level] > rank[prev]) heat[dir] = level
    }
  }

  return heat
}

/** Every ancestor directory of a path, shallowest first: what a touch expands so the file is visible. */
export function ancestorsOf(rel: string): string[] {
  const parts = rel.split('/').slice(0, -1)

  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

// ---- tool calls --------------------------------------------------------------------------------------------------

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])

/** Edits and Bash may create files, so the tree is scanned again after them. */
export function mayChangeFiles(tool: string): boolean {
  return EDIT_TOOLS.has(tool) || tool === 'Bash'
}

/** The paths one finished tool call used, as the tool spelled them. Other tools give none. */
export function pathsOfCall(tool: string, input: Readonly<Record<string, unknown>>, result: unknown): { kind: FiletreeTouch['kind']; paths: string[] } {
  const str = (value: unknown) => (typeof value === 'string' && value !== '' ? [value] : [])
  if (tool === 'Read') return { kind: 'read', paths: str(input.file_path) }
  if (tool === 'NotebookEdit') return { kind: 'edit', paths: str(input.notebook_path) }
  if (EDIT_TOOLS.has(tool)) return { kind: 'edit', paths: str(input.file_path) }
  if (SEARCH_TOOLS.has(tool)) {
    const names = (result as { filenames?: unknown } | undefined)?.filenames

    return { kind: 'read', paths: Array.isArray(names) ? names.flatMap(str).slice(0, MAX_SEARCH_PATHS) : [] }
  }

  return { kind: 'read', paths: [] }
}

/** `git commit` anywhere in a Bash command, also with options before the verb (`git -C dir commit`). */
export function isCommitCommand(command: string): boolean {
  return /\bgit\b[^;&|\n]*\bcommit\b/.test(command)
}

// ---- git status --------------------------------------------------------------------------------------------------

/**
 * Reads `git status --porcelain -z` output. Paths are repository-root relative, so `prefix` (what
 * `git rev-parse --show-prefix` says, '' at the root) is cut off; an entry ending in '/' is an untracked
 * directory and stands for everything below it.
 */
export function parseStatus(stdout: string, prefix: string): (rel: string) => boolean {
  const files = new Set<string>()
  const dirs: string[] = []
  const add = (path: string) => {
    const isDir = path.endsWith('/')
    // An untracked directory at or above the working directory covers all of it.
    if (isDir && prefix.startsWith(path)) dirs.push('')
    else if (!path.startsWith(prefix)) return
    else if (isDir) dirs.push(path.slice(prefix.length))
    else files.add(path.slice(prefix.length))
  }
  const entries = stdout.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? ''
    if (entry.length < 4) continue
    add(entry.slice(3))
    // A rename or copy is followed by its origin as an entry of its own.
    if (/[RC]/.test(entry.slice(0, 2))) add(entries[++i] ?? '')
  }

  return rel => files.has(rel) || dirs.some(dir => rel.startsWith(dir))
}
