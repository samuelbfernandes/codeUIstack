// Pure helpers: which formatter a file gets, the argv of each step, where a file lies, and the command's words.

export type Lang = 'r' | 'python' | 'web'
/** A program format-on-edit may run, by its short name. */
export type ToolName = 'air' | 'ruff' | 'jarl' | 'prettier' | 'biome'

/** One program run on the file: `tool` names it for probing and the note, `argv` is what runs (no shell). */
export type Step = { tool: ToolName; bin: string; argv: string[] }

const WEB = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'html', 'vue', 'json'])

/** Folders whose files are never formatted, wherever they are in the path. */
export const SKIP_DIRS = new Set(['node_modules', '.git', 'renv', '.venv', 'dist', 'build'])

export const WHERE: Record<ToolName, string> = {
  air: 'posit-dev.github.io/air',
  ruff: 'docs.astral.sh/ruff',
  jarl: 'github.com/etiennebacher/jarl',
  prettier: "the project's own devDependencies (package.json)",
  biome: "the project's own devDependencies (package.json)",
}

export function extOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

export function langOf(path: string): Lang | undefined {
  const ext = extOf(path)
  if (ext === 'r') return 'r'
  if (ext === 'py' || ext === 'pyi') return 'python'
  if (WEB.has(ext)) return 'web'
  return undefined
}

/** The separator a root path is spelled with: `\` for a Windows path with no `/`, else `/`. */
export const sepOf = (root: string): string => (root.includes('\\') && !root.includes('/') ? '\\' : '/')

/** Whether a root looks like a Windows path (a drive letter or backslashes). */
export const isWindowsPath = (root: string): boolean => /^[A-Za-z]:[\\/]/.test(root) || sepOf(root) === '\\'

/** The file's path below `root`, or undefined when it is not strictly inside. Both are resolved real paths. */
export function relInside(root: string, real: string): string | undefined {
  const trimmed = root.replace(/[\\/]+$/, '')
  if (trimmed === '') return undefined
  const sep = sepOf(trimmed)
  if (!real.startsWith(trimmed + sep)) return undefined
  const rel = real.slice(trimmed.length + 1)
  return rel === '' ? undefined : rel
}

/** True when any folder on the path below the root is one never formatted. */
export function isSkipped(rel: string): boolean {
  const parts = rel.split(/[\\/]+/)
  return parts.slice(0, -1).some(part => SKIP_DIRS.has(part))
}

/** Prettier when the project has a Prettier config, else Biome when it has biome.json(c), else nothing. */
export function webFormatter(rootNames: readonly string[], packageJson: string): 'prettier' | 'biome' | undefined {
  const hasPrettierFile = rootNames.some(name => /^\.prettierrc(\..+)?$/.test(name) || /^prettier\.config\.[a-z]+$/.test(name))
  let hasPrettierKey = false
  try {
    const parsed = JSON.parse(packageJson) as Record<string, unknown>
    hasPrettierKey = parsed !== null && typeof parsed === 'object' && parsed.prettier !== undefined
  } catch {
    hasPrettierKey = false
  }
  if (hasPrettierFile || hasPrettierKey) return 'prettier'
  if (rootNames.includes('biome.json') || rootNames.includes('biome.jsonc')) return 'biome'
  return undefined
}

/** The steps for one file: lint fixes first (when asked), then the formatter. `bins` maps a tool to the program to start. */
export function stepsFor(lang: Lang, file: string, lint: boolean, bins: Partial<Record<ToolName, string>>, web?: 'prettier' | 'biome'): Step[] {
  const step = (tool: ToolName, args: string[]): Step => {
    const bin = bins[tool] ?? tool
    return { tool, bin, argv: [bin, ...args] }
  }
  if (lang === 'r') return [...(lint ? [step('jarl', ['check', file, '--fix'])] : []), step('air', ['format', file])]
  if (lang === 'python') return [...(lint ? [step('ruff', ['check', '--fix', file])] : []), step('ruff', ['format', file])]
  if (web === 'prettier') return [step('prettier', ['--write', file])]
  if (web === 'biome') return [step('biome', ['format', '--write', file])]
  return []
}

/** The words for the steps that changed the file: "air", "jarl and air", "ruff". */
export function labelOf(steps: readonly Step[]): string {
  const names = [...new Set(steps.map(s => s.tool))]
  return names.length <= 1 ? (names[0] ?? 'the formatter') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export const noteFor = (label: string, file: string): string =>
  `format-on-edit: ${label} reformatted ${file}. Read it again before editing it.`

export type Parsed = { kind: 'on' | 'off' | 'status' } | { kind: 'unknown'; word: string }

export function parseArgs(args: string): Parsed {
  const w = (args.trim().split(/\s+/)[0] ?? '').toLowerCase()
  if (w === '' || w === 'status') return { kind: 'status' }
  if (w === 'on' || w === 'off') return { kind: w }
  return { kind: 'unknown', word: w.slice(0, 30) }
}

/** The first line of a version output, kept short. */
export const versionLine = (out: string): string => (out.split(/\r?\n/).find(l => l.trim() !== '') ?? '').trim().slice(0, 60)
