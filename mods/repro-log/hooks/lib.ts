import type { Step } from '../types'

export const DEFAULT_PROGRAMS =
  'python,python3,Rscript,R CMD,jupyter nbconvert,quarto,snakemake,make,dvc,pytest,node,cargo run,julia,uv run'

/** The programs setting as lists of words, one list per program. */
export function programsOf(raw: unknown): string[][] {
  const text = typeof raw === 'string' && raw.trim() !== '' ? raw : DEFAULT_PROGRAMS
  return text
    .split(',')
    .map(p => p.trim().split(/\s+/).filter(Boolean))
    .filter(p => p.length > 0)
}

export function maxStepsOf(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 200
  return Math.min(1000, Math.max(10, n))
}

/** Splits a shell line into the simple commands it runs (by ; && || | and newlines). */
function segments(command: string): string[] {
  return command.split(/&&|\|\||[;|\n]/).map(s => s.trim()).filter(Boolean)
}

/** The words of one segment after env assignments (A=1) and sudo/time/nohup, with the program's path stripped. */
function words(segment: string): string[] {
  const w = segment.split(/\s+/).filter(Boolean)
  while (w.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!) || /^(sudo|time|nohup|exec)$/.test(w[0]!))) w.shift()
  if (w.length > 0) w[0] = w[0]!.replace(/^.*\//, '')
  return w
}

/** True when some simple command of the line starts with one of the programs. */
export function isAnalysis(command: string, programs: string[][]): boolean {
  return segments(command).some(seg => {
    const w = words(seg)
    return programs.some(p => p.every((word, i) => w[i] === word))
  })
}

const SECRET = /KEY|TOKEN|SECRET|password\s*=|bearer\s|bearer$|sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|xox[abp]-[A-Za-z0-9-]{10,}|:\/\/[^\s/:@]+:[^\s/@]+@|-----BEGIN/i
const SECRET_FILE = /(^|\/)(\.env(\..*)?|id_[a-z0-9]+|.*\.(pem|key|p12|pfx)|credentials(\.json)?|\.netrc|\.npmrc|\.pypirc)$/i

/** True when the text looks like it carries a credential: such a command is never recorded. */
export function looksSecret(text: string): boolean {
  return SECRET.test(text)
}

export function isSecretFile(path: string): boolean {
  return SECRET_FILE.test(path) || /KEY|TOKEN|SECRET/i.test(path.replace(/^.*\//, ''))
}

/** `--password x`, `--passwd=x`, `--pwd x`, `--pass x` become `--password ***`. */
export function maskArgs(command: string): string {
  return command.replace(/(--(?:password|passwd|pwd|pass))(?:=|\s+)(?:"[^"]*"|'[^']*'|\S+)/gi, '$1 ***')
}

const MAX_COMMAND = 2000

/** What to keep for a command: the masked text, or undefined when it must not be recorded. */
export function cleanCommand(command: string): string | undefined {
  const masked = maskArgs(command.trim())
  if (masked === '' || looksSecret(masked)) return undefined
  return masked.length > MAX_COMMAND ? `${masked.slice(0, MAX_COMMAND)} # (cut)` : masked
}

/** Appends a step and keeps the last `max`. */
export function addStep(list: readonly Step[], step: Step, max: number): Step[] {
  return [...list, step].slice(-max)
}

/** Literal numeric seeds in the recorded commands, in order of first sight. */
export function seedsOf(commands: readonly string[]): string[] {
  const rx = [
    /--seed[=\s]+(\d+)/g,
    /(?:^|\s)-seed[=\s]+(\d+)/g,
    /set\.seed\(\s*(\d+)\s*\)/g,
    /(?:np\.random\.seed|random\.seed|torch\.manual_seed)\(\s*(\d+)\s*\)/g,
    /random_state\s*=\s*(\d+)/g,
  ]
  const seen: string[] = []
  for (const c of commands) {
    for (const r of rx) {
      for (const m of c.matchAll(r)) if (!seen.includes(m[1]!)) seen.push(m[1]!)
    }
  }
  return seen
}

/** Which version commands are worth running for the commands recorded. */
export function runtimesFor(commands: readonly string[]): ('python3' | 'R' | 'node')[] {
  const out: ('python3' | 'R' | 'node')[] = []
  const add = (r: 'python3' | 'R' | 'node') => out.includes(r) || out.push(r)
  for (const c of commands) {
    for (const seg of segments(c)) {
      const p = words(seg)[0] ?? ''
      if (/^(python|python3|pytest|jupyter|snakemake|dvc|uv)$/.test(p)) add('python3')
      else if (/^(R|Rscript|quarto)$/.test(p)) add('R')
      else if (/^(node|npm|npx)$/.test(p)) add('node')
    }
  }
  return out
}

export const MANIFESTS = [
  'requirements.txt', 'pyproject.toml', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'environment.yml',
  'renv.lock', 'DESCRIPTION', 'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'Cargo.toml', 'Cargo.lock', 'Snakefile', 'dvc.lock', 'Makefile', '_quarto.yml',
]

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-10-12-1405 (local time). */
export function stamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** A path made relative to the project directory when it is under it. */
export function relPath(path: string, cwd: string): string {
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`
  return cwd !== '' && path.startsWith(base) ? path.slice(base.length) : path
}

export type Recipe = {
  at: number
  commit: string
  isDirty: boolean | undefined
  versions: string[]
  manifests: { name: string; sha: string }[]
  seeds: string[]
  commands: string[]
  files: string[]
}

export function renderRecipe(r: Recipe): string {
  const L: string[] = []
  L.push('# Reproducibility recipe', '')
  L.push(`- Date: ${new Date(r.at).toISOString()}`)
  L.push(`- Git commit: ${r.commit === '' ? 'none found' : r.commit}${r.commit !== '' && r.isDirty !== undefined ? (r.isDirty ? ' (dirty: uncommitted changes)' : ' (clean)') : ''}`)
  L.push('', '## Versions', '')
  L.push(...(r.versions.length > 0 ? r.versions.map(v => `- ${v}`) : ['- none of python3, R or node were used']))
  L.push('', '## Package files', '')
  L.push(...(r.manifests.length > 0 ? r.manifests.map(m => `- ${m.name}${m.sha !== '' ? ` (sha256 ${m.sha.slice(0, 16)})` : ''}`) : ['- none found']))
  L.push('', '## Random seeds seen', '')
  L.push(...(r.seeds.length > 0 ? r.seeds.map(s => `- ${s}`) : ['- none seen in the commands']))
  L.push('', '## Commands, in order', '', '```sh', ...r.commands, '```')
  L.push('', '## Changed files', '')
  L.push(...(r.files.length > 0 ? r.files.map(f => `- ${f}`) : ['- none']))
  L.push('', '_Commands that looked like they carried a secret were left out, and password arguments are masked._', '')
  return L.join('\n')
}
