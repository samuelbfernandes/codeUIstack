// Pure helpers: which test command a project uses, the tail of its output, small formatters.

export type Probe = {
  exists: (relPath: string) => Promise<boolean>
  read: (relPath: string) => Promise<string>
}

export type TestCommand = {
  /** The program and its arguments, run with no shell (except an override, which runs through `sh -c`). */
  argv: string[]
  /** What the person sees: "pytest", "npm test", or the override text. */
  label: string
  /** Where it came from: 'detected', 'setting' or 'project'. */
  source: 'detected' | 'setting' | 'project'
}

export const TAIL_LINES = 40
const TAIL_CHARS = 4000

async function safe<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

/** A package.json whose "test" script is a real one (not npm's "no test specified" placeholder). */
export function hasNpmTest(packageJson: string): boolean {
  try {
    const script = (JSON.parse(packageJson) as { scripts?: Record<string, unknown> }).scripts?.test
    return typeof script === 'string' && script.trim() !== '' && !/no test specified/i.test(script)
  } catch {
    return false
  }
}

/** The command an override text stands for. */
export const fromText = (text: string, source: 'setting' | 'project'): TestCommand => ({
  argv: ['sh', '-c', text],
  label: text,
  source,
})

/** Looks at the project root and names its test command, or undefined when none is recognised. */
export async function detect(p: Probe): Promise<TestCommand | undefined> {
  const has = (f: string) => safe(() => p.exists(f), false)
  const pythonProject =
    (await has('pytest.ini')) ||
    (await has('pyproject.toml')) ||
    ((await has('tests')) && ((await has('setup.py')) || (await has('setup.cfg')) || (await has('requirements.txt'))))
  if (pythonProject) return { argv: ['python3', '-m', 'pytest', '-q'], label: 'pytest', source: 'detected' }
  if (await has('package.json')) {
    if (hasNpmTest(await safe(() => p.read('package.json'), ''))) return { argv: ['npm', 'test'], label: 'npm test', source: 'detected' }
  }
  if (await has('Cargo.toml')) return { argv: ['cargo', 'test'], label: 'cargo test', source: 'detected' }
  if (await has('DESCRIPTION')) return { argv: ['Rscript', '-e', 'devtools::test()'], label: "Rscript -e 'devtools::test()'", source: 'detected' }
  if (await has('go.mod')) return { argv: ['go', 'test', './...'], label: 'go test ./...', source: 'detected' }
  return undefined
}

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

/** The last lines of the output (stdout then stderr), without colour codes, never more than a few thousand characters. */
export function tailOf(stdout: string, stderr: string, lines: number = TAIL_LINES): string {
  const all = `${stdout}\n${stderr}`.replace(ANSI, '').replace(/\r/g, '').split('\n')
  while (all.length > 0 && all[all.length - 1]!.trim() === '') all.pop()
  let text = all.slice(-lines).join('\n').replace(/^\n+/, '')
  if (text.length > TAIL_CHARS) text = `…${text.slice(-TAIL_CHARS)}`
  return text
}

/** "12s", or "3m 05s" for a long run. */
export function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export const timeoutOf = (value: unknown): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 120
  return Math.min(600, Math.max(5, Math.round(n)))
}

export type Parsed =
  | { kind: 'on' | 'off' | 'run' | 'status' | 'help' }
  | { kind: 'command'; text: string }
  | { kind: 'unknown'; word: string }

export function parseArgs(args: string): Parsed {
  const t = args.trim()
  if (t === '') return { kind: 'status' }
  const [word = '', ...rest] = t.split(/\s+/)
  const w = word.toLowerCase()
  if (w === 'on' || w === 'off' || w === 'run' || w === 'status' || w === 'help') return { kind: w }
  if (w === 'command') return { kind: 'command', text: rest.join(' ').trim() }
  return { kind: 'unknown', word }
}

/** A short plain reason from the error a failed run rejected with. */
export function whyOf(error: unknown, timeoutMs: number): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/time/i.test(text)) return `timed out after ${fmtSeconds(timeoutMs)}`
  return text.split('\n')[0]!.slice(0, 120).trim() || 'it did not start'
}
