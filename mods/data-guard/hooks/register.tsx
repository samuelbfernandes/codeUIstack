// data-guard: asks before a `git commit` or `git add` takes in the wrong things for a data project.
//
// WHAT IT LOOKS AT (git only, read-only, short timeouts): the files that would be committed, from
// `git diff --cached`, and for `git add` the files it names, from `git status`. It flags large files, data files that are
// neither ignored nor in git lfs, csv/tsv first lines with personal-looking column NAMES, and notebooks with outputs.
//
// NEVER LOGS OR STORES CONTENTS. Paths, counts and column names are all that is ever shown. File text is read only to
// look at a first line or the JSON shape of a notebook and is dropped at once.
//
// FAIL OPEN: any error or timeout (a git that is missing, a process that throws, a hook outrunning its budget) lets the
// command through untouched. The only refusal is the person's own answer: Hold it, Fix it, or Esc.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DataGuardTally } from '../types'
import {
  fixText,
  firstLineOf,
  hasAny,
  isDataLike,
  isNotebook,
  isTable,
  notebookHasOutputs,
  parseNameStatus,
  parsePorcelain,
  personalColumns,
  planOf,
  questionText,
  addNames,
  stripNotebook,
} from './detect'
import type { Findings, GitPlan } from './detect'

type Dollar = EngineInterface
type Cfg = { isEnabled: boolean; maxMb: number; checkNotebooks: boolean; checkColumns: boolean }

const COMMAND = 'data-guard'
const MB = 1024 * 1024
const READ_LIMIT = 4 * MB
const GIT_TIMEOUT_MS = 8000
const MAX_CANDIDATES = 3000
const MAX_STATS = 500
const MAX_READS = 30

const COMMIT = 'Commit anyway'
const FIX = 'Fix it'
const HOLD = 'Hold it'
const STRIP = 'Strip outputs'

const isOffAtom = atom({ plugin: 'data-guard', key: 'isOff' } as const, false)
const EMPTY: DataGuardTally = { checked: 0, asked: 0, held: 0, stripped: 0 }
const tallyAtom = atom({ plugin: 'data-guard', key: 'tally' } as const, EMPTY)

const num = (v: unknown, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

const readConfig = (o: Record<string, unknown>): Cfg => ({
  isEnabled: o.enabled !== false,
  maxMb: num(o.maxFileMb, 5, 0.1, 1000),
  checkNotebooks: o.checkNotebooks !== false,
  checkColumns: o.checkColumns !== false,
})

async function safe<T>(f: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}

async function isOff($: Dollar): Promise<boolean> {
  return (await safe(() => $.store.get('off'))) === true
}

async function setSwitch($: Dollar, off: boolean): Promise<void> {
  if (off) await $.store.set('off', true)
  else await $.store.delete('off')
  await update($, isOffAtom, () => off)
}

const bump = (k: keyof DataGuardTally, by = 1) => (t: DataGuardTally): DataGuardTally => ({ ...t, [k]: t[k] + by })
const count = ($: Dollar, k: keyof DataGuardTally, by = 1) => safe(() => update($, tallyAtom, bump(k, by)))

// ---- looking ------------------------------------------------------------------------------------------------------

type Source = 'index' | 'tree'
type Seen = { findings: Findings; notebookPaths: string[]; top: string }

/** Read-only look at what the plan would put in a commit. Throws on a broken engine call (the caller fails open). */
async function inspect($: Dollar, plan: GitPlan, cfg: Cfg): Promise<Seen | undefined> {
  const git = async (argv: string[], top: string | undefined, stdin?: string) => {
    const r = await $.process.run(['git', ...argv], { ...(top === undefined ? {} : { cwd: top }), timeoutMs: GIT_TIMEOUT_MS, ...(stdin === undefined ? {} : { stdin }) })
    return r.exitCode === 0 && !r.isStdoutTruncated ? r.stdout : undefined
  }

  const where = await git(['rev-parse', '--show-toplevel', '--show-prefix'], undefined)
  if (where === undefined) return undefined // not a git folder
  const [topLine = '', prefixLine = ''] = where.split('\n')
  const top = topLine.trim()
  const prefix = prefixLine.trim().replace(/\/$/, '')
  if (top === '') return undefined

  const cand = new Map<string, Source>()
  if (plan.commit) {
    for (const f of parseNameStatus((await git(['diff', '--cached', '--name-status', '-z'], top)) ?? '')) cand.set(f.path, 'index')
    if (plan.commit.isAll) for (const f of parseNameStatus((await git(['diff', '--name-status', '-z'], top)) ?? '')) cand.set(f.path, 'tree')
  }
  if (plan.adds.length) {
    const status = parsePorcelain((await git(['status', '--porcelain', '-z', '--untracked-files=all'], top)) ?? '')
    for (const s of status) {
      const isNew = s.x === '?'
      if (!isNew && s.y === ' ') continue // already staged and unchanged since
      for (const a of plan.adds) {
        const wanted = a.paths.length === 0 ? a.isAll || a.isTrackedOnly : a.paths.some(p => addNames(p, prefix, s.path))
        if (wanted && !(a.isTrackedOnly && !a.isAll && isNew)) {
          cand.set(s.path, 'tree')
          break
        }
      }
    }
  }
  const paths = [...cand.keys()].filter(p => !p.includes('\n')).slice(0, MAX_CANDIDATES)
  const findings: Findings = { large: [], data: [], columns: [], notebooks: [] }
  if (paths.length === 0) return { findings, notebookPaths: [], top }

  // git lfs and .gitignore coverage, best effort: a failure here only means "not covered".
  const lfs = new Set<string>()
  const attr = await safe(() => git(['check-attr', 'filter', '--stdin', '-z'], top, paths.join('\0')))
  if (attr) {
    const f = attr.split('\0')
    for (let i = 0; i + 2 < f.length; i += 3) if (f[i + 2] === 'lfs') lfs.add(f[i]!)
  }
  const ignored = new Set<string>()
  const ign = await safe(() => $.process.run(['git', 'check-ignore', '--stdin', '-z'], { cwd: top, timeoutMs: GIT_TIMEOUT_MS, stdin: paths.join('\0') }))
  if (ign && ign.exitCode === 0) for (const p of ign.stdout.split('\0')) if (p) ignored.add(p)

  // sizes: the index' blob for staged files, the working file for the rest
  const size = new Map<string, number>()
  const inIndex = paths.filter(p => cand.get(p) === 'index').slice(0, MAX_STATS)
  if (inIndex.length) {
    const out = await git(['cat-file', '--batch-check'], top, inIndex.map(p => `:${p}`).join('\n') + '\n')
    const lines = (out ?? '').split('\n')
    inIndex.forEach((p, i) => {
      const m = /^[0-9a-f]+ blob (\d+)$/.exec(lines[i] ?? '')
      if (m) size.set(p, Number(m[1]))
    })
  }
  for (const p of paths.filter(p => cand.get(p) === 'tree').slice(0, MAX_STATS)) {
    const st = await safe(() => $.fs.stat(`${top}/${p}`))
    if (st && st.kind === 'file') size.set(p, st.size)
  }

  const limit = cfg.maxMb * MB
  for (const p of paths) {
    const bytes = size.get(p)
    const isLfs = lfs.has(p)
    if (bytes !== undefined && bytes > limit && !isLfs) findings.large.push({ path: p, bytes })
    if (isDataLike(p) && !isLfs && !ignored.has(p)) findings.data.push(p)
  }

  // contents: only ever a first line or the shape of a notebook; nothing is kept
  const body = async (p: string): Promise<string | undefined> => {
    const bytes = size.get(p)
    if (bytes === undefined || bytes > READ_LIMIT) return undefined
    return cand.get(p) === 'index' ? git(['show', `:${p}`], top) : safe(() => $.fs.read(`${top}/${p}`))
  }
  const notebookPaths: string[] = []
  if (cfg.checkColumns) {
    for (const p of paths.filter(p => isTable(p) && !lfs.has(p)).slice(0, MAX_READS)) {
      const text = await body(p)
      const names = text === undefined ? [] : personalColumns(firstLineOf(text))
      if (names.length) findings.columns.push({ path: p, names })
    }
  }
  if (cfg.checkNotebooks) {
    for (const p of paths.filter(isNotebook).slice(0, MAX_READS)) {
      const text = await body(p)
      if (text !== undefined && notebookHasOutputs(text)) notebookPaths.push(p)
    }
    findings.notebooks = notebookPaths
  }
  return { findings, notebookPaths, top }
}

// ---- asking -------------------------------------------------------------------------------------------------------

async function ask($: Dollar, text: string, hasNotebooks: boolean): Promise<string> {
  const surfaces = await safe(() => $.session.surfaces())
  if (surfaces !== undefined && surfaces.length === 0) return HOLD // nobody to ask
  try {
    // Hold it first: it is the option the dialog opens on, so Enter and Esc both mean no.
    return await $.ui.ask(text, { options: hasNotebooks ? [HOLD, COMMIT, FIX, STRIP] : [HOLD, COMMIT, FIX], header: 'Data guard' })
  } catch {
    return HOLD
  }
}

/** Rewrites the notebooks without outputs and stages them. Returns the paths that could not be done. */
async function strip($: Dollar, top: string, paths: string[]): Promise<string[]> {
  const failed: string[] = []
  const done: string[] = []
  for (const p of paths) {
    const text = await safe(() => $.fs.read(`${top}/${p}`))
    const out = typeof text === 'string' ? stripNotebook(text) : undefined
    if (out === undefined) {
      failed.push(p)
      continue
    }
    if (out !== text) await $.fs.write(`${top}/${p}`, out)
    done.push(p)
  }
  if (done.length) {
    const r = await $.process.run(['git', 'add', '--', ...done], { cwd: top, timeoutMs: GIT_TIMEOUT_MS })
    if (r.exitCode !== 0) failed.push(...done)
  }
  return failed
}

const deny = (why: string) => ({ deny: why }) as never

// ---- the command --------------------------------------------------------------------------------------------------

const WORDS = new Set(['', 'status', 'on', 'off'])

async function runCommand($: Dollar, cfg: Cfg, args: string): Promise<string> {
  const word = args.trim().toLowerCase().replace(/\.$/, '')
  if (!WORDS.has(word)) return `Data guard · "${args.trim().slice(0, 30)}" is not an option · use /data-guard on, off or status`
  if (word === 'on' || word === 'off') {
    if (!cfg.isEnabled) return 'Data guard · disabled by the enabled setting (change it in /config)'
    try {
      await setSwitch($, word === 'off')
    } catch {
      return 'Data guard · that did not work, nothing changed'
    }
  }
  const off = !cfg.isEnabled || (await isOff($))
  const t = await safe(() => read($, tallyAtom))
  return [
    `Data guard · ${off ? 'off' : 'on'}${cfg.isEnabled ? '' : ' (enabled setting is false)'}`,
    `Large file limit ${cfg.maxMb} MB · notebooks ${cfg.checkNotebooks ? 'checked' : 'not checked'} · columns ${cfg.checkColumns ? 'checked' : 'not checked'}`,
    `This session: ${t?.checked ?? 0} checked · ${t?.asked ?? 0} asked · ${t?.held ?? 0} held · ${t?.stripped ?? 0} notebooks stripped`,
  ].join('\n')
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    const stored = (await safe(() => $.store.get('off'))) === true
    await safe(() => update($, isOffAtom, () => stored))
    await safe(() =>
      $.command.register({ name: COMMAND, description: 'Ask before committing large, data or personal-looking files: /data-guard [on|off|status]', argumentHint: '[on|off|status]' }),
    )
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await runCommand($, cfg, e.args) })).catch(() => ({ text: 'Data guard · could not read its own state' }))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!cfg.isEnabled || (await isOff($))) return next(e)
    const plan = planOf(e.command)
    if (!plan.commit && plan.adds.length === 0) return next(e)
    await count($, 'checked')

    const seen = await inspect($, plan, cfg)
    if (!seen || !hasAny(seen.findings)) return next(e)

    const f = seen.findings
    await count($, 'asked')
    const verb = plan.commit ? 'git commit' : 'git add'
    const answer = await ask($, questionText(f, verb, cfg.maxMb), seen.notebookPaths.length > 0)

    if (answer === COMMIT) return next(e)
    if (answer === STRIP && seen.notebookPaths.length > 0) {
      const failed = await strip($, seen.top, seen.notebookPaths)
      if (failed.length) {
        await count($, 'held')
        return deny(`Not run: could not strip ${failed.length} notebook(s): ${failed.slice(0, 3).join(', ')}.`)
      }
      await count($, 'stripped', seen.notebookPaths.length)
      if (f.large.length + f.data.length + f.columns.length === 0) return next(e)
      await count($, 'held')
      return deny('Notebook outputs were stripped and staged. Not run: large, data or personal-looking files are still in it. Fix those or run the command again and choose Commit anyway.')
    }
    await count($, 'held')
    if (answer === FIX) return deny(fixText(f))
    return deny('Not run: held by the person in the Data guard dialog. Nothing was committed or staged.')
  }).catch(($, e, next) => next(e)) // FAIL OPEN: a guard that breaks must not wedge git
}

