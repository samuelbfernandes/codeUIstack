// Pure helpers: reading a git command, the file lists git prints, and the checks. Nothing here touches the engine,
// and nothing returns a file's content: only names, paths and counts.

export const DATA_EXTENSIONS = [
  'csv', 'tsv', 'parquet', 'feather', 'rds', 'rdata', 'h5', 'hdf5', 'xlsx', 'xls', 'sav', 'dta', 'sqlite', 'db', 'pkl', 'npy', 'npz', 'zip', 'gz',
] as const

const DATA_SET = new Set<string>(DATA_EXTENSIONS)

export const extOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}
export const isDataLike = (path: string): boolean => DATA_SET.has(extOf(path))
export const isNotebook = (path: string): boolean => extOf(path) === 'ipynb'
export const isTable = (path: string): boolean => extOf(path) === 'csv' || extOf(path) === 'tsv'

// ---- the command ---------------------------------------------------------------------------------------------------

export type AddSpec = { isAll: boolean; isTrackedOnly: boolean; paths: string[] }
export type GitPlan = { commit: { isAll: boolean } | undefined; adds: AddSpec[] }

/** Splits on unquoted && || ; | & and newlines, then into words (quotes removed). Best effort, never throws. */
export function segments(command: string): string[][] {
  const out: string[][] = []
  let words: string[] = []
  let cur = ''
  let has = false
  let quote = ''
  const endWord = () => {
    if (has) words.push(cur)
    cur = ''
    has = false
  }
  const endSeg = () => {
    endWord()
    if (words.length) out.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      if (c === quote) quote = ''
      else if (c === '\\' && quote === '"' && i + 1 < command.length) cur += command[++i]
      else cur += c
    } else if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (c === '\\' && i + 1 < command.length) {
      cur += command[++i]
      has = true
    } else if (c === ';' || c === '|' || c === '&' || c === '\n' || c === '(' || c === ')') endSeg()
    else if (c === ' ' || c === '\t') endWord()
    else {
      cur += c
      has = true
    }
  }
  endSeg()
  return out
}

const GLOBAL_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'])

/** Finds the `git commit` and `git add` parts of a command line. */
export function planOf(command: string): GitPlan {
  const plan: GitPlan = { commit: undefined, adds: [] }
  for (const words of segments(command)) {
    let i = 0
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!) || words[i] === 'env' || words[i] === 'command')) i++
    const bin = words[i]
    if (bin !== 'git' && !(bin ?? '').endsWith('/git')) continue
    i++
    while (i < words.length && words[i]!.startsWith('-')) i += GLOBAL_WITH_ARG.has(words[i]!) ? 2 : 1
    const sub = words[i]
    const rest = words.slice(i + 1)
    if (sub === 'commit') {
      const isAll = rest.some(w => w === '--all' || (/^-[A-Za-z]+$/.test(w) && /^-[^mFCcStu]*a/.test(w)))
      plan.commit = { isAll: (plan.commit?.isAll ?? false) || isAll }
    } else if (sub === 'add') {
      let isAll = false
      let isTrackedOnly = false
      let skip = false
      let afterDashes = false
      const paths: string[] = []
      for (const w of rest) {
        if (afterDashes) paths.push(w)
        else if (w === '--') afterDashes = true
        else if (w === '-A' || w === '--all') isAll = true
        else if (w === '-u' || w === '--update') isTrackedOnly = true
        else if (w === '-n' || w === '--dry-run' || w === '-p' || w === '--patch' || w === '-i' || w === '--interactive' || w === '-e' || w === '--edit') skip = true
        else if (!w.startsWith('-')) paths.push(w)
      }
      if (!skip) plan.adds.push({ isAll, isTrackedOnly, paths })
    }
  }
  return plan
}

// ---- what git prints -----------------------------------------------------------------------------------------------

export type Entry = { status: string; path: string }

/** `git diff --name-status -z`: `M\0path\0`, renames and copies `R100\0old\0new\0`. Deleted files are dropped. */
export function parseNameStatus(out: string): Entry[] {
  const parts = out.split('\0')
  const res: Entry[] = []
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++] ?? ''
    if (status === '') continue
    const two = status[0] === 'R' || status[0] === 'C'
    const path = two ? (i++, parts[i++]) : parts[i++]
    if (path && status[0] !== 'D') res.push({ status: status[0]!, path })
  }
  return res
}

/** `git status --porcelain -z`: `XY path\0`, a rename adds `orig\0`. Deleted files are dropped. */
export function parsePorcelain(out: string): { x: string; y: string; path: string }[] {
  const parts = out.split('\0')
  const res: { x: string; y: string; path: string }[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    if (p.length < 4) continue
    const x = p[0]!
    const y = p[1]!
    if (x === 'R' || x === 'C') i++
    if (x !== 'D' && y !== 'D') res.push({ x, y, path: p.slice(3) })
  }
  return res
}

const clean = (p: string): string => {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const globToRe = (g: string): RegExp =>
  new RegExp(
    '^' +
      g
        .replace(/[.+^${}()|\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
        .replace(/\u0000/g, '.*') +
      '$',
  )

/** Does `git add <spec>`, run from `prefix` (the folder under the repo root, `sub/` or ''), name this repo-relative path? */
export function addNames(spec: string, prefix: string, path: string): boolean {
  const joined = clean(spec.startsWith(':') ? spec.replace(/^:(\([^)]*\)|[!^/]*)/, '') : `${prefix}/${spec}`)
  if (joined === '') return true
  if (/[*?[]/.test(joined)) return globToRe(joined).test(path) || globToRe(`${joined}/**`).test(path)
  return path === joined || path.startsWith(`${joined}/`)
}

// ---- checks --------------------------------------------------------------------------------------------------------

const PERSONAL: RegExp[] = [
  /(^|_)e_?mail($|_)/, /(^|_)ssn($|_)/, /(^|_)dob($|_)/, /birth/, /(^|_)phone($|_)/, /(^|_)telephone($|_)/, /address/, /patient/, /(^|_)mrn($|_)/,
  /(^|_)(first|last|sur|full|given|family|middle)_?name($|_)/, /(^|_)surname($|_)/, /^(firstname|lastname|fullname)$/,
]

const normalise = (c: string): string =>
  c
    .replace(/^﻿/, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** The column names in a table's first line that look like personal data (as written, cut to 30 characters). */
export function personalColumns(firstLine: string): string[] {
  const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','
  const hits: string[] = []
  for (const raw of firstLine.replace(/\r$/, '').split(sep)) {
    const n = normalise(raw)
    if (n !== '' && PERSONAL.some(re => re.test(n))) hits.push(raw.replace(/^﻿/, '').trim().replace(/^["']+|["']+$/g, '').slice(0, 30))
  }
  return hits
}

/** The first line of a text, and nothing else of it. */
export const firstLineOf = (text: string): string => {
  const i = text.indexOf('\n')
  return (i < 0 ? text : text.slice(0, i)).slice(0, 4000)
}

type Cell = { cell_type?: string; outputs?: unknown; execution_count?: unknown }
type Notebook = { cells?: Cell[] }

const parseNb = (text: string): Notebook | undefined => {
  try {
    const nb = JSON.parse(text) as unknown
    return nb && typeof nb === 'object' && Array.isArray((nb as Notebook).cells) ? (nb as Notebook) : undefined
  } catch {
    return undefined
  }
}

/** True when a code cell holds an output or an execution count. A text that is not a notebook is false. */
export function notebookHasOutputs(text: string): boolean {
  const nb = parseNb(text)
  return !!nb?.cells?.some(c => c && typeof c === 'object' && ((Array.isArray(c.outputs) && c.outputs.length > 0) || (c.execution_count !== undefined && c.execution_count !== null)))
}

/** The notebook without outputs and execution counts, as nbformat writes it (indent 1, trailing newline); undefined when it is not one. */
export function stripNotebook(text: string): string | undefined {
  const nb = parseNb(text)
  if (!nb) return undefined
  for (const c of nb.cells!) {
    if (!c || typeof c !== 'object' || c.cell_type !== 'code') continue
    c.outputs = []
    c.execution_count = null
  }
  return `${JSON.stringify(nb, null, 1)}\n`
}

// ---- the question --------------------------------------------------------------------------------------------------

export type Findings = {
  large: { path: string; bytes: number }[]
  data: string[]
  columns: { path: string; names: string[] }[]
  notebooks: string[]
}

export const hasAny = (f: Findings): boolean => f.large.length + f.data.length + f.columns.length + f.notebooks.length > 0

const MB = 1024 * 1024
export const mbText = (bytes: number): string => `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`
const list = (items: string[], max = 4): string => (items.length <= max ? items.join(', ') : `${items.slice(0, max).join(', ')} +${items.length - max} more`)

export function questionText(f: Findings, verb: string, maxMb: number): string {
  const lines = ['Data guard found something in what is about to be saved:']
  if (f.large.length) lines.push(`• Large (over ${maxMb} MB): ${list(f.large.map(l => `${l.path} ${mbText(l.bytes)}`))}`)
  if (f.data.length) lines.push(`• Data files, not ignored or in LFS: ${list(f.data)}`)
  for (const c of f.columns.slice(0, 3)) lines.push(`• Personal-looking columns in ${c.path}: ${list(c.names, 5)}`)
  if (f.columns.length > 3) lines.push(`• Personal-looking columns in ${f.columns.length - 3} more files`)
  if (f.notebooks.length) lines.push(`• Notebooks with outputs: ${list(f.notebooks)}`)
  lines.push('', `Run this ${verb}?`)
  return lines.join('\n')
}

export const fixText = (f: Findings): string => {
  const steps: string[] = []
  if (f.large.length || f.data.length) steps.push('unstage them (git restore --staged <file>) and add them to .gitignore, or track them with git lfs')
  if (f.columns.length) steps.push('remove or anonymise the personal columns')
  if (f.notebooks.length) steps.push('clear the notebook outputs (or choose Strip outputs next time)')
  return `Not run: the person chose to fix it first. Suggested: ${steps.join('; ')}.`
}
