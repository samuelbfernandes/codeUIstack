// The classifier: a PURE function from a shell command line to the list of risky
// simple commands in it. No `$`, no file access: whether a target really exists is
// the measurer's business. Anything it cannot see through (a variable as command
// name, nesting deeper than DEPTH_LIMIT) is reported rather than waved through.
import { lex } from './lex'
import type { Tok, Word } from './lex'

export type Kind =
  | 'rm' | 'find' | 'truncate' | 'shred' | 'dd' | 'mkfs' | 'redirect' | 'overwrite' | 'chmod'
  | 'git-clean' | 'git-reset' | 'git-discard' | 'git-push' | 'git-branch' | 'git-stash'
  | 'sql' | 'r' | 'cargo-clean' | 'custom' | 'opaque'

/** A path a command acts on. `path` is absolute and normalised; absent when `unresolved` says why. */
export type Target = { raw: string; path?: string; glob: boolean; unresolved?: string }

export type Finding = {
  kind: Kind
  reason: string // one line, shown under the command
  command: string // the simple command as the shell would see it
  cwd?: string // directory it runs in, undefined when a `cd` could not be followed
  args: string[] // words after the command name (after the git subcommand for git)
  targets: Target[]
  critical?: boolean // targets / or the home directory
  viaXargs?: boolean // the real operands arrive on stdin
  // Held only if the measurer finds the condition true (the classifier cannot stat files).
  conditional?: 'non-empty-file' | 'dest-exists'
}

export type ClassifyContext = {
  cwd?: string // the session's working directory
  home?: string // for `~`
  extraPatterns?: readonly RegExp[] // the user's own, tested against the whole command line
}

type State = { cwd: string | undefined }
type Ctx = ClassifyContext & { out: Finding[] }

const DEPTH_LIMIT = 6

export function classify(command: string, ctx: ClassifyContext = {}): Finding[] {
  const out: Finding[] = []
  scan(command, { cwd: ctx.cwd }, { ...ctx, out }, 0)
  for (const re of ctx.extraPatterns ?? [])
    if (re.test(command))
      out.push(finding('custom', `matches your extra pattern ${re}`, [], [], undefined, command))
  return out
}

// ---- paths ---------------------------------------------------------------------

export function normalize(path: string): string {
  const parts: string[] = []
  for (const p of path.split('/'))
    if (p === '..') parts.pop()
    else if (p !== '' && p !== '.') parts.push(p)
  return '/' + parts.join('/')
}

function target(w: Word, st: State, ctx: ClassifyContext): Target {
  const base = { raw: w.text, glob: w.glob }
  if (w.dynamic) return { ...base, unresolved: 'contains a variable or command substitution' }
  if (w.text === '') return { ...base, unresolved: 'empty path' }
  let t = w.text
  if (w.tilde) {
    if (t !== '~' && !t.startsWith('~/')) return { ...base, unresolved: 'another user\'s home' }
    if (!ctx.home) return { ...base, unresolved: 'home directory unknown' }
    t = ctx.home + t.slice(1)
  }
  if (!t.startsWith('/')) {
    if (!st.cwd) return { ...base, unresolved: 'relative path after a cd that could not be followed' }
    t = `${st.cwd}/${t}`
  }
  return { ...base, path: normalize(t) }
}

const isCritical = (t: Target, home?: string) =>
  /^(\/|~\/?|\$HOME\/?|\.|\.\/|\.\.|\.\.\/)\*?$/.test(t.raw) ||
  t.path === '/' || (home !== undefined && t.path === home) || t.raw === '/*'

// ---- argument helpers --------------------------------------------------------------

type Flags = { short: Set<string>; long: Set<string>; operands: Word[] }

// Options may appear anywhere before `--` (GNU permutes). `valued` lists short options
// that take a separate value word, `valuedLong` the long ones; their values are not operands.
function flags(args: Word[], valued = '', valuedLong: string[] = []): Flags {
  const f: Flags = { short: new Set(), long: new Set(), operands: [] }
  let ended = false
  for (let k = 0; k < args.length; k++) {
    const t = args[k]!.text
    if (ended || !t.startsWith('-') || t === '-') f.operands.push(args[k]!)
    else if (t === '--') ended = true
    else if (t.startsWith('--')) {
      const name = t.slice(2).split('=')[0]!
      f.long.add(name)
      if (!t.includes('=') && valuedLong.includes(name)) k++
    } else {
      for (let c = 1; c < t.length; c++) {
        f.short.add(t[c]!)
        if (valued.includes(t[c]!)) {
          if (c === t.length - 1) k++
          break
        }
      }
    }
  }
  return f
}

const base = (s: string) => s.slice(s.lastIndexOf('/') + 1)
const isAssignment = (w: Word) => /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(w.text)
const show = (w: Word) => (/[\s'"$;|&<>()]/.test(w.text) || w.text === '' ? JSON.stringify(w.text) : w.text)

function finding(
  kind: Kind, reason: string, words: Word[], targets: Target[], cwd: string | undefined,
  commandText?: string, extra: Partial<Finding> = {},
): Finding {
  return {
    kind, reason, command: commandText ?? words.map(show).join(' '), cwd,
    args: [], targets, ...extra,
  }
}

// ---- wrappers: sudo, env, time, xargs ... -------------------------------------------

// `valued`: short options of the wrapper that take a value; `positional`: operands to skip.
const WRAPPERS: Record<string, { valued: string; positional?: number }> = {
  sudo: { valued: 'ughpCDrtTUR' }, doas: { valued: 'uC' }, env: { valued: 'uCS' },
  time: { valued: 'fo' }, nice: { valued: 'n' }, ionice: { valued: 'cnpt' }, nohup: { valued: '' },
  command: { valued: '' }, builtin: { valued: '' }, exec: { valued: 'a' }, stdbuf: { valued: 'ioe' },
  setsid: { valued: '' }, caffeinate: { valued: 'tw' }, chronic: { valued: '' }, unbuffer: { valued: '' },
  timeout: { valued: 'sk', positional: 1 }, gtimeout: { valued: 'sk', positional: 1 },
  xargs: { valued: 'INPdaELsJRS' },
}
// Words that start a command in compound statements: `if x; then rm -rf y; fi`.
const RESERVED = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', 'function'])

function skipWrapperOptions(words: Word[], from: number, spec: { valued: string; positional?: number }): number {
  let i = from
  while (i < words.length) {
    const t = words[i]!.text
    if (t === '--') return i + 1 + (spec.positional ?? 0)
    if (isAssignment(words[i]!)) i++
    else if (t.startsWith('-') && t.length > 1) {
      if (!t.startsWith('--'))
        for (let c = 1; c < t.length; c++)
          if (spec.valued.includes(t[c]!)) {
            if (c === t.length - 1) i++
            break
          }
      i++
    } else break
  }
  return i + (spec.positional ?? 0)
}

type Unwrapped = { name: string; args: Word[]; viaXargs: boolean; dynamicName: boolean; words: Word[] }

function unwrap(all: Word[]): Unwrapped | undefined {
  let i = 0
  let viaXargs = false
  while (i < all.length) {
    const w = all[i]!
    if (isAssignment(w) || (!w.dynamic && RESERVED.has(w.text))) i++
    else if (w.dynamic)
      return { name: '', args: all.slice(i + 1), viaXargs, dynamicName: true, words: all.slice(i) }
    else {
      const name = base(w.text)
      const spec = WRAPPERS[name]
      if (!spec) return { name, args: all.slice(i + 1), viaXargs, dynamicName: false, words: all.slice(i) }
      if (name === 'xargs') viaXargs = true
      i = skipWrapperOptions(all, i + 1, spec)
    }
  }
  return undefined
}

// ---- the walk: lists, pipelines, subshells, cd -----------------------------------------

type Simple = {
  words: Word[]
  redirs: { op: string; fd?: string; target?: Word }[]
  heredocs: string[]
}
const emptyCmd = (): Simple => ({ words: [], redirs: [], heredocs: [] })

function scan(src: string, st: State, ctx: Ctx, depth: number): void {
  if (depth > DEPTH_LIMIT) {
    ctx.out.push(finding('opaque', 'nested too deeply to analyse', [], [], st.cwd, src.slice(0, 80)))
    return
  }
  walk(lex(src), st, ctx, depth)
}

function walk(toks: Tok[], st: State, ctx: Ctx, depth: number): void {
  let pipeline: Simple[] = []
  let cmd = emptyCmd()
  const endCmd = () => {
    if (cmd.words.length || cmd.redirs.length) pipeline.push(cmd)
    cmd = emptyCmd()
  }
  const endPipeline = () => {
    endCmd()
    if (pipeline.length) analyzePipeline(pipeline, st, ctx, depth)
    pipeline = []
  }
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!
    if (tk.t === 'word') cmd.words.push(tk.w)
    else if (tk.t === 'redir') {
      const next = toks[k + 1]
      const t = next?.t === 'word' ? next.w : undefined
      if (t) k++
      cmd.redirs.push({ op: tk.op, ...(tk.fd ? { fd: tk.fd } : {}), ...(t ? { target: t } : {}) })
      if (tk.body !== undefined) cmd.heredocs.push(tk.body)
      if (tk.op === '<<<' && t) cmd.heredocs.push(t.text)
    } else if (tk.op === '(') {
      const close = matchParen(toks, k)
      if (cmd.words.length === 0) {
        // A subshell: a `cd` inside it does not leak out.
        walk(toks.slice(k + 1, close), { ...st }, ctx, depth)
      }
      else endPipeline() // a function definition `f() { ... }`: its body is walked as ordinary commands
      k = close
    } else if (tk.op === ')') endPipeline() // `case x in a) ...`
    else if (tk.op === '|') endCmd()
    else endPipeline()
  }
  endPipeline()
}

function matchParen(toks: Tok[], open: number): number {
  let depth = 0
  for (let k = open; k < toks.length; k++) {
    const t = toks[k]!
    if (t.t === 'op' && t.op === '(') depth++
    else if (t.t === 'op' && t.op === ')' && --depth === 0) return k
  }
  return toks.length
}

const SQL_CLIENT = /^(psql|sqlite3?|mysql|mariadb|duckdb)$/

function analyzePipeline(cmds: Simple[], st: State, ctx: Ctx, depth: number): void {
  const single = cmds.length === 1
  // SQL fed through a pipe or heredoc belongs to the client at the end of the pipeline.
  const sqlText = cmds.some(c => SQL_CLIENT.test(unwrap(c.words)?.name ?? ''))
    ? cmds.flatMap(c => [...c.words.filter(w => !w.text.startsWith('--')).map(w => w.text), ...c.heredocs]).join(' ')
    : undefined
  for (const c of cmds) analyzeCommand(c, single ? st : { ...st }, ctx, depth, sqlText)
}

function analyzeCommand(c: Simple, st: State, ctx: Ctx, depth: number, sqlText?: string): void {
  for (const w of [...c.words, ...c.redirs.flatMap(r => (r.target ? [r.target] : []))])
    for (const sub of w.subs) scan(sub, { ...st }, ctx, depth + 1)
  clobbers(c, st, ctx)
  const u = unwrap(c.words)
  if (!u) return
  const text = u.words.map(show).join(' ')
  if (u.dynamicName) {
    const hot = u.args.some(a => /^-[a-zA-Z]*(rf|fr|Rf|fR)|^--recursive$/.test(a.text))
    if (hot)
      ctx.out.push(finding('opaque', 'the command name is a variable and the flags look like rm -rf', u.words, [], st.cwd, text))
    return
  }
  const here = { ...ctx, st, u, text, sqlText, depth }
  if (u.name === 'cd' || u.name === 'pushd') return cd(u.args, st, ctx)
  if (u.name === 'popd') return void (st.cwd = undefined)
  if (/^(ba|z|da|k|a)?sh$/.test(u.name)) return shellC(here)
  if (u.name === 'eval') return scan(u.args.map(a => a.text).join(' '), { ...st }, ctx, depth + 1)
  const hit = rules(here)
  if (hit) ctx.out.push(...hit)
}

function cd(args: Word[], st: State, ctx: ClassifyContext): void {
  const operands = flags(args).operands
  if (operands.length === 0) {
    st.cwd = ctx.home
    return
  }
  const t = target(operands[0]!, st, ctx)
  st.cwd = operands[0]!.text === '-' || t.glob ? undefined : t.path
}

type Here = Ctx & { st: State; u: Unwrapped; text: string; sqlText: string | undefined; depth: number }

// bash -c 'script', sh -lc "script"
function shellC(h: Here): void {
  const a = h.u.args
  const k = a.findIndex(w => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w.text))
  const script = k >= 0 ? a[k + 1] : undefined
  if (script) scan(script.text, { ...h.st }, h, h.depth + 1)
}

// `> file` and `&> file` truncate; `>>` appends. Whether the file exists is for the measurer.
function clobbers(c: Simple, st: State, ctx: Ctx): void {
  for (const r of c.redirs) {
    if (!['>', '>|', '&>'].includes(r.op) || !r.target) continue
    if (r.target.text.startsWith('/dev/')) continue
    const t = target(r.target, st, ctx)
    if (t.unresolved) continue // unknowable target: not held (documented limit)
    const text = [...c.words.map(show), r.op, show(r.target)].join(' ')
    ctx.out.push(finding('redirect', `${r.op} overwrites ${t.raw} if it already has content`, [], [t], st.cwd, text, {
      conditional: 'non-empty-file',
    }))
  }
}

// ---- the per-command rules ------------------------------------------------------------

function rules(h: Here): Finding[] | undefined {
  const { name, args } = h.u
  const one = (f: Finding | undefined) => (f ? [f] : undefined)
  const targets = (ws: Word[]) => ws.map(w => target(w, h.st, h))
  const mk = (kind: Kind, reason: string, ts: Word[], extra: Partial<Finding> = {}) => {
    const tt = targets(ts)
    return finding(kind, reason, h.u.words, tt, h.st.cwd, h.text, {
      args: args.map(a => a.text), critical: tt.some(t => isCritical(t, h.home)) || undefined,
      viaXargs: h.u.viaXargs || undefined, ...extra,
    })
  }

  switch (true) {
    case name === 'rm': {
      const f = flags(args)
      const recursive = f.short.has('r') || f.short.has('R') || f.long.has('recursive')
      const force = f.short.has('f') || f.long.has('force')
      const bulk = h.u.viaXargs || f.operands.some(o => o.glob)
      if (!recursive && !force && !bulk) return undefined // plain `rm file` is not held
      const why = recursive ? 'recursive delete (rm -r): not recoverable' : force ? 'forced delete (rm -f): not recoverable' : 'bulk delete by glob or xargs: not recoverable'
      return one(mk('rm', why, f.operands))
    }
    case name === 'find': return one(findRule(h, mk))
    case name === 'git': return gitRule(h, mk)
    case name === 'truncate': {
      const f = flags(args, 'sr', ['size', 'reference'])
      return one(mk('truncate', 'truncate cuts file contents', f.operands))
    }
    case name === 'shred': return one(mk('shred', 'shred overwrites file contents irrecoverably', flags(args, 'ns', ['iterations', 'size', 'random-source']).operands))
    case name === 'dd': {
      const of = args.find(a => a.text.startsWith('of='))
      if (!of) return undefined
      const path = of.text.slice(3)
      if (/^\/dev\/(null|zero|stdout|stderr|tty|fd\/\d+)$/.test(path)) return undefined
      return one(mk('dd', `dd writes over ${path}`, [{ ...of, text: path }]))
    }
    case /^(mkfs(\..+)?|mke2fs|newfs(_.+)?|mkswap|wipefs)$/.test(name):
      return one(mk('mkfs', `${name} destroys everything on the target device`, flags(args).operands.slice(-1)))
    case name === 'diskutil' && /^(erase|reformat|partitionDisk|zeroDisk|secureErase)/i.test(args[0]?.text ?? ''):
      return one(mk('mkfs', `diskutil ${args[0]!.text} destroys data on the target disk`, []))
    case /^(chmod|chown|chgrp)$/.test(name): {
      const f = flags(args)
      if (!f.long.has('recursive') && !f.short.has('R')) return undefined
      return one(mk('chmod', `${name} -R rewrites permissions or ownership of a whole tree`, f.long.has('reference') ? f.operands : f.operands.slice(1)))
    }
    case (name === 'mv' || name === 'cp'): {
      const f = flags(args, 't', ['target-directory'])
      if (!(f.short.has('f') || f.long.has('force')) || f.short.has('n') || f.long.has('no-clobber')) return undefined
      if (f.operands.length < 2) return undefined
      const dest = f.operands[f.operands.length - 1]!
      const srcs = f.operands.slice(0, -1)
      return one(mk('overwrite', `${name} -f replaces existing files without asking`, [dest], {
        conditional: 'dest-exists', args: srcs.map(s => s.text),
      }))
    }
    case name === 'cargo': {
      const sub = args.find(a => !a.text.startsWith('-') && !a.text.startsWith('+'))
      if (sub?.text !== 'clean') return undefined
      return one(mk('cargo-clean', 'cargo clean deletes the target/ directory (a full rebuild follows)', []))
    }
    case SQL_CLIENT.test(name): return one(sqlRule(h, mk))
    case name === 'R' || name === 'Rscript': return rRule(h, mk)
    default: return undefined
  }
}

type Mk = (kind: Kind, reason: string, ts: Word[], extra?: Partial<Finding>) => Finding

// find ... -delete / -exec rm
function findRule(h: Here, mk: Mk): Finding | undefined {
  const t = h.u.args.map(a => a.text)
  const del = t.includes('-delete')
  const exec = t.findIndex((x, k) => /^-(exec|execdir|ok|okdir)$/.test(x) && isRemover(t.slice(k + 1)))
  if (!del && exec < 0) return undefined
  return mk('find', del ? 'find -delete removes every match' : 'find -exec rm removes every match', [])
}

const isRemover = (rest: string[]) => {
  const c = base(rest[0] ?? '')
  return /^(rm|unlink|shred|rmdir)$/.test(c) || (/^(ba|z)?sh$/.test(c) && /\brm\b/.test(rest.slice(1).join(' ')))
}

const BROAD = /^(\.|\.\/|\*|:\/|:\/\.|:\/\*|:\(top\))$/

function gitRule(h: Here, mk: Mk): Finding[] | undefined {
  const a = h.u.args
  let i = 0
  let cwd = h.st.cwd
  while (i < a.length && a[i]!.text.startsWith('-')) {
    const t = a[i]!.text
    if (t === '-C' && a[i + 1]) {
      const r = target(a[i + 1]!, { cwd }, h)
      cwd = r.path
      i += 2
    } else i += ['-c', '--git-dir', '--work-tree', '--namespace'].includes(t) ? 2 : 1
  }
  const sub = a[i]?.text
  const rest = a.slice(i + 1)
  const f = flags(rest)
  const texts = rest.map(r => r.text)
  const make = (kind: Kind, reason: string, ts: Word[] = []) => {
    const m = mk(kind, reason, ts, { args: texts })
    return { ...m, cwd }
  }
  const cluster = (c: string) => f.short.has(c)

  switch (sub) {
    case 'clean':
      if (f.long.has('dry-run') || cluster('n') || cluster('i') || f.long.has('interactive')) return undefined
      return cluster('f') || f.long.has('force') ? [make('git-clean', 'git clean -f deletes untracked files: not recoverable')] : undefined
    case 'reset':
      return f.long.has('hard') ? [make('git-reset', 'git reset --hard discards uncommitted changes and moves the branch')] : undefined
    case 'checkout': {
      const afterDashes = texts.includes('--') ? texts.slice(texts.indexOf('--') + 1) : []
      const broad = afterDashes.some(x => BROAD.test(x)) || (afterDashes.length === 0 && f.operands.length === 1 && BROAD.test(f.operands[0]!.text))
      if (broad || cluster('f') || f.long.has('force'))
        return [make('git-discard', 'git checkout discards uncommitted changes to tracked files')]
      return undefined
    }
    case 'restore': {
      const staged = f.long.has('staged') || cluster('S')
      const worktree = !staged || cluster('W') || f.long.has('worktree')
      return worktree && f.operands.some(o => BROAD.test(o.text))
        ? [make('git-discard', 'git restore discards uncommitted changes to tracked files')] : undefined
    }
    case 'push': return pushRule(f, make)
    case 'branch': {
      const del = cluster('D') || ((cluster('d') || f.long.has('delete')) && (cluster('f') || f.long.has('force')))
      return del ? [make('git-branch', 'git branch -D deletes a branch even if unmerged')] : undefined
    }
    case 'stash': {
      const op = f.operands[0]?.text
      return op === 'drop' || op === 'clear' ? [make('git-stash', `git stash ${op} deletes stashed work`)] : undefined
    }
    default: return undefined
  }
}

function pushRule(f: Flags, make: (k: Kind, r: string, t?: Word[]) => Finding): Finding[] | undefined {
  const refspecs = f.operands.slice(1).map(o => o.text)
  const force = f.long.has('force') || f.long.has('force-with-lease') || f.short.has('f') || refspecs.some(r => r.startsWith('+'))
  const del = f.long.has('delete') || f.short.has('d') || refspecs.some(r => r.startsWith(':')) || f.long.has('mirror')
  if (!force && !del) return undefined
  return [make('git-push', del && !force ? 'git push --delete removes remote branches or tags' : 'a forced git push can overwrite commits on the remote')]
}

function sqlRule(h: Here, mk: Mk): Finding | undefined {
  const text = h.sqlText ?? ''
  const bad = destructiveSql(text)
  return bad.length ? mk('sql', `destructive SQL: ${bad.join('; ')}`, [], { args: bad }) : undefined
}

/** Statements in `sql` that drop, truncate, or delete without WHERE. Exported for tests. */
export function destructiveSql(sql: string): string[] {
  const found: string[] = []
  for (const stmt of sql.split(';')) {
    const s = stmt.replace(/--.*$/gm, ' ').replace(/\s+/g, ' ').trim()
    const m = /\b(DROP\s+\w+(\s+IF\s+EXISTS)?\s+\S+|TRUNCATE(\s+TABLE)?\s+\S+|DELETE\s+FROM\s+\S+)/i.exec(s)
    if (!m) continue
    if (/^DELETE\b/i.test(m[1]!) && /\bWHERE\b/i.test(s)) continue
    found.push(m[1]!.slice(0, 60))
  }
  return found
}

// R -e / Rscript -e: unlink(recursive=TRUE), file.remove, fs::dir_delete, system("rm ...")
function rRule(h: Here, mk: Mk): Finding[] | undefined {
  const a = h.u.args
  const code = a.flatMap((w, k) => (w.text === '-e' || w.text === '--expr' ? [a[k + 1]?.text ?? ''] : w.text.startsWith('--expr=') ? [w.text.slice(7)] : [])).join('\n')
  if (!code) return undefined
  const out: Finding[] = []
  for (const m of code.matchAll(/\b(system2?|shell)\s*\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g))
    scan(m[2]!.slice(1, -1), { ...h.st }, h, h.depth + 1)
  // Only a literal first argument (or c("a", "b")) can be named; anything computed is "could not measure".
  const calls = [...code.matchAll(/\b(?:unlink|file\.remove|dir_delete|file_delete)\s*\(\s*(?:c\(([^)]*)\)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))/g)]
  const risky = /\bunlink\s*\(.*recursive\s*=\s*(TRUE|T)\b/s.test(code) || /\b(file\.remove|dir_delete|file_delete)\s*\(/.test(code)
  if (!risky) return out.length ? out : undefined
  const lits = calls.flatMap(m => [...(m[1] ?? m[2]!).matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map(l => l[1] ?? l[2] ?? ''))
  const words: Word[] = lits.map(text => ({ text, glob: /[*?]/.test(text), dynamic: false, tilde: text.startsWith('~'), subs: [] }))
  out.push(mk('r', 'R code deletes files or directories (unlink / file.remove / dir_delete)', words, { args: [] }))
  return out
}

// ---- last-resort regex ------------------------------------------------------------------

/**
 * Trivially safe fallback for when the classifier itself throws: coarse on purpose,
 * it only has to say "this text looks destructive" so the hook can fail closed.
 */
export const FALLBACK_RISKY = new RegExp(
  [
    String.raw`\brm\s+(-\w*[rRf]|--(recursive|force))`,
    String.raw`\bfind\b.*(-delete|-exec\s+\S*rm\b)`,
    String.raw`\bgit\b.*\b(clean\s+-\w*f|reset\s+--hard|push\b.*(--force|--delete|\s-\w*f|\s\+)|branch\s+-D|stash\s+(drop|clear)|checkout\s+(--\s+)?\.|restore\s+\.)`,
    String.raw`\b(truncate|shred|mkfs\S*|newfs\S*)\b`, String.raw`\bdd\b.*\bof=`,
    String.raw`\b(chmod|chown|chgrp)\s+-\w*R`, String.raw`\bcargo\s+clean\b`,
    String.raw`\b(DROP\s+\w+|TRUNCATE|DELETE\s+FROM)\b`, String.raw`\bunlink\s*\(`,
    String.raw`(^|[^>&0-9])>\s*(?!\/dev\/)[^&>\s]`,
  ].join('|'), 'i',
)
