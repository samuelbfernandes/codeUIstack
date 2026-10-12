// Finds a real `git push` in a Bash command line. A small quote-aware lexer, not a shell:
// it splits on ; && || | & newline and parentheses, so `echo "git push"`, `xgit push`,
// `git pushall` and `git stash push` are not pushes, while `cd x && git push`,
// `git -C "C:/x y" push origin main` and `SKIP_THEORY_REVIEW=1 git push` are.
// Not seen (honest limit): `bash -c "git push"`, aliases, scripts that push.

export type Push = {
  dir: string | undefined // directory the push runs in, from `cd` / `git -C`; undefined = the session's
  skipEnv: boolean // the command itself sets SKIP_THEORY_REVIEW=1
}

const SEPARATORS = new Set([';', '&', '|', '(', ')', '\n', '\r'])

/** Words per simple command. Quotes group, a backslash escapes only space and quotes (Windows paths keep theirs). */
export function segments(command: string): string[][] {
  const out: string[][] = []
  let words: string[] = []
  let word = ''
  let isWord = false
  let quote: '"' | "'" | undefined
  const endWord = () => {
    if (isWord) words.push(word)
    word = ''
    isWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length) out.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      if (c === quote) quote = undefined
      else if (c === '\\' && quote === '"' && (command[i + 1] === '"' || command[i + 1] === '\\')) word += command[++i]
      else word += c
    } else if (c === '"' || c === "'") {
      quote = c
      isWord = true
    } else if (c === '\\' && /[ "']/.test(command[i + 1] ?? '')) {
      word += command[++i]
      isWord = true
    } else if (SEPARATORS.has(c)) endSegment()
    else if (c === ' ' || c === '\t') endWord()
    else {
      word += c
      isWord = true
    }
  }
  endSegment()
  return out
}

const ABSOLUTE = /^([A-Za-z]:)?[\\/]/
const UNKNOWN_DIR = /^[~-]|[$`%]/ // `~`, `-`, variables: cannot be resolved without a shell

/** Joins two path pieces with forward slashes; an absolute `rel` replaces `base`. */
export function joinPath(base: string | undefined, rel: string): string {
  const r = rel.replace(/\\/g, '/')
  if (base === undefined || ABSOLUTE.test(rel)) return r
  return `${base.replace(/\/+$/, '')}/${r}`
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const KEYWORDS = new Set(['{', '}', '!', 'then', 'do', 'else', 'time', 'command', 'exec'])
const GIT_PROGRAM = /(^|[\\/])git(\.exe)?$/i
const GLOBAL_WITH_VALUE = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])
const PUSH_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

type Parsed = { push: boolean; dir: string | undefined; skipEnv: boolean; lost: boolean }

function isSkipAssign(word: string) {
  return word === 'SKIP_THEORY_REVIEW=1'
}

/** Leading `VAR=x`, `env [-i] VAR=x`, `time`, `command`: returns the index of the program and whether the skip variable was set. */
function programAt(words: string[]): { at: number; skipEnv: boolean } {
  let at = 0
  let skipEnv = false
  for (;;) {
    const w = words[at]
    if (w === undefined) break
    if (ASSIGN.test(w)) skipEnv ||= isSkipAssign(w)
    else if (w === 'env' || KEYWORDS.has(w)) {
      // `env` takes options and assignments before the program
      while (w === 'env' && words[at + 1] !== undefined && (words[at + 1]!.startsWith('-') || ASSIGN.test(words[at + 1]!))) {
        at++
        skipEnv ||= isSkipAssign(words[at]!)
      }
    } else break
    at++
  }
  return { at, skipEnv }
}

/** One simple command, given the directory earlier `cd`s left us in. */
function parseSegment(words: string[], dir: string | undefined, lost: boolean): Parsed {
  const none = (d = dir, l = lost): Parsed => ({ push: false, dir: d, skipEnv: false, lost: l })
  const { at, skipEnv } = programAt(words)
  const program = words[at]
  if (program === undefined) return none()
  if (program === 'cd' || program === 'pushd') {
    const target = words.slice(at + 1).find(w => !w.startsWith('-') || w === '-')
    if (target === undefined) return none()
    return UNKNOWN_DIR.test(target) ? none(dir, true) : none(joinPath(dir, target))
  }
  if (!GIT_PROGRAM.test(program)) return none()

  let d = dir
  let i = at + 1
  for (; i < words.length; i++) {
    const w = words[i]!
    if (w === '-C') {
      const target = words[++i]
      if (target === undefined) return none()
      if (UNKNOWN_DIR.test(target)) return none(dir, true)
      d = joinPath(d, target)
    } else if (GLOBAL_WITH_VALUE.has(w)) i++
    else if (!w.startsWith('-')) break
  }
  if (words[i] !== 'push') return none()
  return pushArgs(words.slice(i + 1), d, skipEnv, lost)
}

/** The arguments after `push`: dry runs and deletions are not pushes of new work. */
function pushArgs(args: string[], dir: string | undefined, skipEnv: boolean, lost: boolean): Parsed {
  const not = (): Parsed => ({ push: false, dir, skipEnv, lost })
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--dry-run' || a === '--delete') return not()
    if (PUSH_WITH_VALUE.has(a)) i++
    else if (/^-[A-Za-z]+$/.test(a) && /[nd]/.test(a)) return not() // -n dry run, -d delete, in a cluster
    else if (!a.startsWith('-') && a.startsWith(':') && a.length > 1) return not() // :branch deletes it
  }
  return { push: true, dir, skipEnv, lost }
}

/** The first real, reviewable `git push` in the command line, or undefined. */
export function findPush(command: string): Push | undefined {
  let dir: string | undefined
  let lost = false
  for (const words of segments(command)) {
    const p = parseSegment(words, dir, lost)
    dir = p.dir
    lost = p.lost
    if (p.push) return lost ? undefined : { dir: p.dir, skipEnv: p.skipEnv }
  }
  return undefined
}
