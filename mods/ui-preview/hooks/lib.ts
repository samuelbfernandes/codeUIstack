// Pure helpers: which app a project holds, the argv that starts it, the localhost-only rule, the child's output,
// plumber's routes, the browser candidates and the review draft. Nothing here touches `$`.

import type { UiPreviewApp, UiPreviewKind, UiPreviewRoute } from '../types'

export type { UiPreviewApp, UiPreviewKind, UiPreviewRoute }

/** What detection may look at: names in a folder (relative to the project root, '' for the root) and a file's text. */
export type Probe = {
  list: (relDir: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other' }[]>
  read: (relPath: string) => Promise<string>
}

export const DEFAULT_PORT: Record<UiPreviewKind, number> = { plumber: 8000, npm: 5173, 'shiny-r': 8000, 'shiny-py': 8000, streamlit: 8000 }
export const KIND_LABEL: Record<UiPreviewKind, string> = {
  plumber: 'plumber API',
  npm: 'npm run dev',
  'shiny-r': 'Shiny for R',
  'shiny-py': 'Shiny for Python',
  streamlit: 'Streamlit',
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'renv', '.venv', 'venv', 'dist', 'build', '__pycache__', '.Rproj.user', 'target'])
const JS_DIRS = ['', 'frontend', 'client', 'web', 'ui', 'app']
const MAX_FILES = 400

const PLUMBER_TAG = /^[ \t]*#\*[ \t]*@(get|post|put|delete|patch|assets|plumber)\b/m
const PLUMBER_CALL = /\bplumb(er)?\s*(::|\()|\bpr\s*\(/
const SHINY_R = /\bshinyApp\b|\bshiny::/
const SHINY_PY = /^[ \t]*(from[ \t]+shiny\b|import[ \t]+shiny\b)/m
const STREAMLIT = /^[ \t]*(import[ \t]+streamlit\b|from[ \t]+streamlit\b)/m

const baseName = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
const dirName = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '')
const extOf = (rel: string): string => {
  const name = baseName(rel)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

async function safe<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

/** Files at the root and one folder down (vendored and hidden folders skipped), at most MAX_FILES, as 'dir/name'. */
async function filesOf(p: Probe): Promise<string[]> {
  const root = await safe(() => p.list(''), [])
  const out = root.filter(e => e.kind === 'file').map(e => e.name)
  const dirs = root.filter(e => e.kind === 'dir' && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')).map(e => e.name).sort()
  for (const d of dirs) {
    if (out.length >= MAX_FILES) break
    const inner = await safe(() => p.list(d), [])
    for (const e of inner) if (e.kind === 'file') out.push(`${d}/${e.name}`)
  }
  return out.slice(0, MAX_FILES)
}

/** Root files before deeper ones, the preferred names first in that order, then the rest by name. */
function ranked(files: string[], preferred: string[]): string[] {
  const score = (f: string) => {
    const i = preferred.indexOf(baseName(f))
    return (f.includes('/') ? 1000 : 0) + (i < 0 ? 100 : i)
  }
  return [...files].sort((a, b) => score(a) - score(b) || a.localeCompare(b))
}

export const isPlumberText = (rel: string, text: string): boolean =>
  PLUMBER_TAG.test(text) || (baseName(rel) === 'entrypoint.R' && PLUMBER_CALL.test(text))

/** The app in a project: plumber, then an npm dev script, Shiny for R, Shiny for Python, Streamlit. First match wins. */
export async function detect(p: Probe): Promise<UiPreviewApp | undefined> {
  const files = await filesOf(p)
  const text = (f: string) => safe(() => p.read(f), '')

  const rFiles = ranked(files.filter(f => extOf(f) === 'r'), ['entrypoint.R', 'plumber.R', 'api.R'])
  for (const f of rFiles) if (isPlumberText(f, await text(f))) return appOf('plumber', f)

  for (const d of JS_DIRS) {
    const pkg = d === '' ? 'package.json' : `${d}/package.json`
    if (files.includes(pkg) && hasDevScript(await text(pkg))) return appOf('npm', pkg)
  }

  for (const f of ranked(files.filter(f => baseName(f) === 'app.R'), [])) if (SHINY_R.test(await text(f))) return appOf('shiny-r', f)

  const py = files.filter(f => extOf(f) === 'py')
  for (const f of ranked(py.filter(f => baseName(f) === 'app.py'), [])) if (SHINY_PY.test(await text(f))) return appOf('shiny-py', f)
  for (const f of ranked(py, ['streamlit_app.py', 'app.py', 'main.py', 'Home.py'])) if (STREAMLIT.test(await text(f))) return appOf('streamlit', f)
  return undefined
}

/** What a file the person named is, from its name and text; undefined when it is none of the five. */
export function classify(rel: string, text: string): UiPreviewApp | undefined {
  if (baseName(rel) === 'package.json') return hasDevScript(text) ? appOf('npm', rel) : undefined
  const ext = extOf(rel)
  if (ext === 'r') {
    if (isPlumberText(rel, text)) return appOf('plumber', rel)
    if (SHINY_R.test(text)) return appOf('shiny-r', rel)
  }
  if (ext === 'py') {
    if (SHINY_PY.test(text)) return appOf('shiny-py', rel)
    if (STREAMLIT.test(text)) return appOf('streamlit', rel)
  }
  return undefined
}

export const appOf = (kind: UiPreviewKind, file: string): UiPreviewApp => ({ kind, file, dir: dirName(file), label: `${KIND_LABEL[kind]} · ${file}` })

export function hasDevScript(packageJson: string): boolean {
  try {
    const dev = (JSON.parse(packageJson) as { scripts?: Record<string, unknown> }).scripts?.dev
    return typeof dev === 'string' && dev.trim() !== ''
  } catch {
    return false
  }
}

/** A path for R code inside single quotes: forward slashes, quotes and backslashes escaped. */
export const rString = (path: string): string => path.replace(/\\/g, '/').replace(/'/g, "\\'")

/**
 * The program and arguments that start the app, run with no shell from the project root (npm: from its folder).
 * `npm` is the program name to use for npm (`npm.cmd` on Windows).
 */
export function argvFor(app: UiPreviewApp, port: number, npm = 'npm'): { argv: string[]; cwd: string } {
  const p = String(port)
  switch (app.kind) {
    case 'plumber': {
      const plumb = baseName(app.file) === 'entrypoint.R' ? `plumber::plumb(dir = '${rString(app.dir || '.')}')` : `plumber::plumb('${rString(app.file)}')`
      return { argv: ['Rscript', '-e', `pr <- ${plumb}; plumber::pr_run(pr, host = '127.0.0.1', port = ${p})`], cwd: '' }
    }
    case 'npm':
      return { argv: [npm, 'run', 'dev', '--', '--host', '127.0.0.1', '--port', p], cwd: app.dir }
    case 'shiny-r': {
      const target = baseName(app.file) === 'app.R' ? app.dir || '.' : app.file
      return { argv: ['Rscript', '-e', `shiny::runApp('${rString(target)}', host = '127.0.0.1', port = ${p}, launch.browser = FALSE)`], cwd: '' }
    }
    case 'shiny-py':
      return { argv: ['shiny', 'run', '--host', '127.0.0.1', '--port', p, app.file], cwd: '' }
    case 'streamlit':
      return { argv: ['streamlit', 'run', app.file, '--server.headless', 'true', '--server.address', '127.0.0.1', '--server.port', p], cwd: '' }
  }
}

// ---------------------------------------------------------------- the localhost-only rule

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):(\d{1,5})(\/[^\s#]*)?$/

/** True only for http://127.0.0.1:N or http://localhost:N (any path); never https, another host, or no port. */
export function isLocalUrl(url: string): boolean {
  const m = LOCAL.exec(url)
  if (m === null) return false
  const port = Number(m[2])
  return port >= 1 && port <= 65535
}

/** The `http://host:port` part of a local URL. */
export const originOf = (url: string): string => {
  const m = LOCAL.exec(url)
  return m === null ? url : `http://${m[1]}:${m[2]}`
}

export const localUrl = (port: number): string => `http://127.0.0.1:${port}`

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g
const URL_IN_TEXT = /http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}(?:\/[^\s'"<>)\]]*)?/

/** The first local URL a line of output names, without a trailing slash; undefined when none. */
export function urlIn(text: string): string | undefined {
  const m = URL_IN_TEXT.exec(text.replace(ANSI, ''))
  if (m === null) return undefined
  const url = m[0].replace(/[.,;:]+$/, '').replace(/\/+$/, '')
  return isLocalUrl(url) ? url : undefined
}

// ---------------------------------------------------------------- the child's output

export const MAX_LINES = 60
const MAX_LINE_CHARS = 300

const KEYED = /\b(token|access[_-]?token|password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|auth)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;]+)/gi
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi
const SHAPED = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})/g

/** One output line as shown: colour codes gone, secret-looking values replaced by ***, cut to a few hundred characters. */
export function scrub(line: string): string {
  const clean = line
    .replace(ANSI, '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(KEYED, (_m, k: string, sep: string) => `${k}${sep}***`)
    .replace(BEARER, (_m, k: string) => `${k} ***`)
    .replace(SHAPED, '***')
  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS)}…` : clean
}

/**
 * Adds a piece of output to the kept lines: complete lines are scrubbed and kept (the last MAX_LINES), the
 * unfinished end waits in `partial` (bounded) for the next piece.
 */
export function addOutput(lines: readonly string[], partial: string, text: string): { lines: string[]; partial: string } {
  const all = (partial + text).replace(/\r\n?/g, '\n').split('\n')
  const rest = all.pop() ?? ''
  const added = all.map(scrub).filter(l => l.trim() !== '')
  return { lines: [...lines, ...added].slice(-MAX_LINES), partial: rest.slice(-4000) }
}

// ---------------------------------------------------------------- plumber's routes

const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']
export const MAX_ROUTES = 200

/** Method, path and summary of each operation in an OpenAPI document (plumber's /openapi.json), at most MAX_ROUTES. */
export function parseRoutes(json: string): UiPreviewRoute[] {
  let doc: unknown
  try {
    doc = JSON.parse(json)
  } catch {
    return []
  }
  const paths = (doc as { paths?: unknown } | null)?.paths
  if (paths === null || typeof paths !== 'object') return []
  const out: UiPreviewRoute[] = []
  for (const [path, ops] of Object.entries(paths as Record<string, unknown>)) {
    if (ops === null || typeof ops !== 'object') continue
    for (const method of METHODS) {
      const op = (ops as Record<string, unknown>)[method]
      if (op === undefined || op === null || typeof op !== 'object') continue
      const raw = (op as { summary?: unknown; description?: unknown }).summary ?? (op as { description?: unknown }).description
      const summary = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 100) : ''
      out.push({ method: method.toUpperCase(), path: path.slice(0, 200), summary })
      if (out.length >= MAX_ROUTES) return out
    }
  }
  return out
}

// ---------------------------------------------------------------- commands

export type Parsed =
  | { kind: 'open' | 'stop' | 'shot' | 'status' }
  | { kind: 'start'; file: string; port: number | undefined; error: string }
  | { kind: 'unknown'; word: string }

/** `/ui-preview [start [file] [--port N] | stop | shot | status]`. */
export function parseArgs(args: string): Parsed {
  const words = args.trim().split(/\s+/).filter(w => w !== '')
  const head = (words[0] ?? '').toLowerCase()
  if (head === '') return { kind: 'open' }
  if (head === 'stop' || head === 'shot' || head === 'status') return { kind: head }
  if (head !== 'start') return { kind: 'unknown', word: head.slice(0, 30) }
  let file = ''
  let port: number | undefined
  let error = ''
  for (let i = 1; i < words.length; i++) {
    const w = words[i]!
    const eq = /^--port=(.*)$/.exec(w)
    const value = eq !== null ? eq[1] : w === '--port' ? words[++i] : undefined
    if (eq !== null || w === '--port') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 1024 || n > 65535) error = 'the port must be a whole number from 1024 to 65535'
      else port = n
    } else if (file === '') file = w
    else error = `one file only (got "${w.slice(0, 40)}")`
  }
  return { kind: 'start', file, port, error }
}

/** A path the person typed, relative to the root with forward slashes; undefined when it leaves the root. */
export function relPathOf(root: string, typed: string): string | undefined {
  let p = typed.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (p.startsWith(`${r}/`)) p = p.slice(r.length + 1)
  else if (/^([A-Za-z]:)?\//.test(p)) return undefined
  p = p.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  if (p === '' || p.split('/').some(part => part === '..')) return undefined
  return p
}

// ---------------------------------------------------------------- the browser for screenshots

export type BrowserEnv = { localAppData?: string; programFiles?: string; programFilesX86?: string }

/**
 * Where a Chrome, Chromium or Edge may be, in the order tried: absolute paths (checked to exist) and names on PATH
 * (probed with --version). The person's real browser is never opened: the screenshot runs headless with a profile
 * of its own.
 */
export function browserCandidates(env: BrowserEnv): { path: string; isName: boolean }[] {
  const pf = env.programFiles ?? 'C:\\Program Files'
  const pf86 = env.programFilesX86 ?? 'C:\\Program Files (x86)'
  const abs = (path: string) => ({ path, isName: false })
  const name = (path: string) => ({ path, isName: true })
  return [
    abs('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    abs('/Applications/Chromium.app/Contents/MacOS/Chromium'),
    name('google-chrome'),
    name('chromium'),
    name('chromium-browser'),
    abs(`${pf}\\Google\\Chrome\\Application\\chrome.exe`),
    abs(`${pf86}\\Google\\Chrome\\Application\\chrome.exe`),
    ...(env.localAppData ? [abs(`${env.localAppData}\\Google\\Chrome\\Application\\chrome.exe`)] : []),
    abs(`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`),
    abs(`${pf}\\Microsoft\\Edge\\Application\\msedge.exe`),
  ]
}

export function shotArgv(browser: string, png: string, profile: string, url: string): string[] {
  return [
    browser,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1280,800',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--screenshot=${png}`,
    url,
  ]
}

export function reviewText(url: string, png: string | undefined): string {
  const shot = png === undefined ? 'No screenshot yet.' : `Screenshot: ${png}.`
  return `Review the running app at ${url}. ${shot} Check layout, spacing, contrast and broken requests; if the chrome-devtools MCP is connected, open the page with it and read the console and network errors.`
}
