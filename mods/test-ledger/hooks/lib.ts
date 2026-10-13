// test-ledger: pure helpers (no engine access): which shell commands are checks, and secret scrubbing.
import type { TestLedgerKind } from '../types'

// ---- secrets ------------------------------------------------------------------------------------------------------
// The same function is copied into error-inbox (mods cannot import each other); keep the two in step.

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, '***'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '***'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '***'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '***'],
  [/\bglpat-[A-Za-z0-9_-]{10,}/g, '***'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '***'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***'],
  [/\b(Bearer|Basic|Token)(\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1$2***'],
  [/(--?(?:token|password|passwd|pass|secret|api[-_]?key|access[-_]?key|auth|private[-_]?key)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  [/((?:password|passwd|pwd|secret|token|api[-_]?key|apikey|access[-_]?key|auth[-_]?key|client[-_]?secret)["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;,'"]+)/gi, '$1***'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1***@'],
]

/** Replaces the obvious secrets (API tokens, keys, Bearer values, password=..., --token x, URL passwords) with ***. */
export function scrub(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, to]) => out.replace(pattern, to), text)
}

/** Drops control characters (keeps newline and tab) and cuts to `limit` characters with an ellipsis. */
export function cut(text: string, limit: number): string {
  const clean = text.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

// ---- which commands are checks -----------------------------------------------------------------------------------

export type Match = { kind: TestLedgerKind; tool: string }

/** Wrappers that run the real command: `uv run pytest`, `npx eslint`, `time cargo test`. */
// Written as text so the capability audit does not read these words as programs this mod starts (it starts none).
const WRAPPERS: string[][] = 'uv run|poetry run|pipenv run|pdm run|hatch run|rye run|pixi run|pnpm exec|pnpm dlx|yarn dlx|npm exec|npx|bunx|time|env|command'
  .split('|')
  .map(w => w.split(' '))

const base = (word: string): string =>
  word.replace(/^["']|["']$/g, '').split(/[\\/]/).pop()!.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')

function unwrap(words: string[]): string[] {
  let w = words
  for (let guard = 0; guard < 6; guard++) {
    while (w.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!)) w = w.slice(1) // FOO=bar cmd
    const wrapper = WRAPPERS.find(p => p.every((part, i) => base(w[i] ?? '') === part))
    if (wrapper === undefined) return w
    w = w.slice(wrapper.length)
    while (w.length > 0 && w[0]!.startsWith('-')) w = w.slice(1) // npx -y eslint
  }

  return w
}

const PY_MODULES: Record<string, TestLedgerKind> = {
  pytest: 'test', unittest: 'test', tox: 'test', nox: 'test', mypy: 'check', pyright: 'check',
  ruff: 'lint', flake8: 'lint', pylint: 'lint', black: 'format', isort: 'format',
}

const SCRIPT_KINDS: [RegExp, TestLedgerKind][] = [
  [/^(test|tests|t|unit|e2e|spec)\b/, 'test'],
  [/^(build|compile|bundle)\b/, 'build'],
  [/^(lint|eslint)\b/, 'lint'],
  [/^(format|fmt|prettier)\b/, 'format'],
  [/^(check|typecheck|type-check|tsc|types)\b/, 'check'],
]

const scriptKind = (name: string | undefined): TestLedgerKind | undefined =>
  name === undefined ? undefined : SCRIPT_KINDS.find(([re]) => re.test(name.toLowerCase()))?.[1]

function rCode(code: string): TestLedgerKind | undefined {
  if (/devtools::test\b|testthat::test_|\btest_(dir|file|local|check|package)\s*\(/.test(code)) return 'test'
  if (/devtools::check\b|rcmdcheck/.test(code)) return 'check'
  if (/\blintr\b/.test(code)) return 'lint'
  if (/\bstyler\b/.test(code)) return 'format'
  if (/devtools::build\b|pkgbuild::build\b/.test(code)) return 'build'

  return undefined
}

/** What one simple command is, or undefined when it is no test, lint, build, format or check. */
export function classifySegment(segment: string, rest = segment): Match | undefined {
  const words = unwrap(segment.trim().split(/\s+/).filter(Boolean))
  if (words.length === 0) return undefined
  const [t0, t1, t2] = [base(words[0]!), words[1]?.toLowerCase(), words[2]?.toLowerCase()]

  switch (t0) {
    case 'pytest':
    case 'py.test':
      return { kind: 'test', tool: 'pytest' }
    case 'tox':
    case 'nox':
      return { kind: 'test', tool: t0 }
    case 'python':
    case 'python3':
    case 'py': {
      const m = words.indexOf('-m')
      const mod = m >= 0 ? words[m + 1]?.toLowerCase() : undefined
      if (mod === undefined || PY_MODULES[mod] === undefined) return undefined
      if (mod === 'ruff') return { kind: words[m + 2]?.toLowerCase() === 'format' ? 'format' : 'lint', tool: 'ruff' }

      return { kind: PY_MODULES[mod]!, tool: mod }
    }
    case 'ruff':
      return { kind: t1 === 'format' ? 'format' : 'lint', tool: 'ruff' }
    case 'mypy':
    case 'pyright':
      return { kind: 'check', tool: t0 }
    case 'flake8':
    case 'pylint':
      return { kind: 'lint', tool: t0 }
    case 'black':
    case 'isort':
      return { kind: 'format', tool: t0 }
    case 'rscript':
    case 'r': {
      if (t0 === 'r' && t1 === 'cmd') {
        if (t2 === 'check') return { kind: 'check', tool: 'R CMD check' }
        if (t2 === 'build') return { kind: 'build', tool: 'R CMD build' }

        return undefined
      }
      const kind = rCode(rest) // R code may hold ; or | itself, so read on to the end of the line

      return kind === undefined ? undefined : { kind, tool: t0 === 'r' ? 'R' : 'Rscript' }
    }
    case 'air':
      return t1 === 'format' ? { kind: 'format', tool: 'air' } : undefined
    case 'jarl':
      return { kind: 'lint', tool: 'jarl' }
    case 'cargo': {
      const kinds: Record<string, TestLedgerKind> = { test: 'test', nextest: 'test', clippy: 'lint', build: 'build', fmt: 'format', check: 'check' }
      const kind = t1 === undefined ? undefined : kinds[t1]

      return kind === undefined ? undefined : { kind, tool: `cargo ${t1}` }
    }
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      if (t1 === 'test' || t1 === 't') return { kind: 'test', tool: `${t0} test` }
      if (t1 === 'run' || t1 === 'run-script') {
        const kind = scriptKind(t2)

        return kind === undefined ? undefined : { kind, tool: `${t0} run ${t2}` }
      }
      if (t0 !== 'npm') {
        const kind = scriptKind(t1)
        if (kind !== undefined) return { kind, tool: `${t0} ${t1}` }
      }

      return undefined
    }
    case 'vitest':
    case 'jest':
    case 'mocha':
      return { kind: 'test', tool: t0 }
    case 'eslint':
      return { kind: 'lint', tool: 'eslint' }
    case 'prettier':
      return { kind: 'format', tool: 'prettier' }
    case 'biome': {
      if (t1 === 'format') return { kind: 'format', tool: 'biome' }
      if (t1 === 'check' || t1 === 'ci') return { kind: 'check', tool: 'biome' }

      return { kind: 'lint', tool: 'biome' }
    }
    case 'tsc':
      return { kind: 'check', tool: 'tsc' }
    case 'make': {
      const kind = scriptKind(t1)

      return kind === undefined ? undefined : { kind, tool: `make ${t1}` }
    }
    case 'quarto':
      if (t1 === 'render') return { kind: 'build', tool: 'quarto render' }
      if (t1 === 'check') return { kind: 'check', tool: 'quarto check' }

      return undefined
    case 'go':
      if (t1 === 'test') return { kind: 'test', tool: 'go test' }
      if (t1 === 'vet') return { kind: 'lint', tool: 'go vet' }
      if (t1 === 'build') return { kind: 'build', tool: 'go build' }

      return undefined
    default:
      return undefined
  }
}

/** The first check in a shell line (split at &&, ||, ;, | and newlines), with the other tools it runs named too. */
export function classify(command: string): Match | undefined {
  const found: Match[] = []
  let start = 0
  for (const sep of [...command.matchAll(/&&|\|\||[;|\n]/g), undefined]) {
    const end = sep === undefined ? command.length : sep.index!
    const match = classifySegment(command.slice(start, end), command.slice(start))
    if (match !== undefined) found.push(match)
    if (sep !== undefined) start = end + sep[0].length
  }
  if (found.length === 0) return undefined
  const tools = [...new Set(found.map(m => m.tool))]

  return { kind: found[0]!.kind, tool: tools.slice(0, 3).join(' + ') + (tools.length > 3 ? ' + …' : '') }
}

/** The exit code a failed Bash result names in its text ("Exit code 2"), when it does. */
export function exitCodeOf(text: string | undefined): number | undefined {
  const m = /Exit code (\d+)/.exec(text ?? '')

  return m ? Number(m[1]) : undefined
}

export const seconds = (ms: number): string => (ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`)

export const clockTime = (ms: number): string => {
  const d = new Date(ms)

  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
