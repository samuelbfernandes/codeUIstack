// format-on-edit: after a successful Edit, Write or MultiEdit, formats just that file with the project's own formatter
// (Air for R, Ruff for Python, Prettier or Biome for JS/TS/CSS/HTML/JSON/Vue when the project already uses one), and
// tells the model in a note beside the result to read the file again, so its next Edit is not made on stale text.
// Off until `/format-on-edit on`. Never changes the call itself.
// FAIL OPEN: any error (no formatter, a timeout, a store or file problem) leaves the tool result exactly as it came back.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { WHERE, isSkipped, isWindowsPath, labelOf, langOf, noteFor, parseArgs, relInside, sepOf, stepsFor, versionLine, webFormatter } from './lib'
import type { Step, ToolName } from './lib'

type Dollar = EngineInterface
type Cfg = { lint: boolean }

const COMMAND = 'format-on-edit'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
const RUN_MS = 20_000
const PROBE_MS = 5_000

/** True while off (it ships off). The persisted switch is `$.store` 'on'. */
const isOff = atom({ plugin: 'format-on-edit', key: 'isOff' } as const, true)
const formatted = atom({ plugin: 'format-on-edit', key: 'formatted' } as const, 0)

// Probe results for this module's life (a session; a reload probes again): program -> its version line, or undefined
// when it would not start. Not drawn, so a module variable is the right place.
let probes = new Map<string, Promise<string | undefined>>()

function probe($: Dollar, bin: string): Promise<string | undefined> {
  let found = probes.get(bin)
  if (found === undefined) {
    found = $.process
      .run([bin, '--version'], { timeoutMs: PROBE_MS })
      // It started: that is enough (127 is a shell's "not found", kept for safety).
      .then(r => (r.exitCode === 127 ? undefined : versionLine(r.stdout || r.stderr) || 'found'))
      .catch(() => undefined)
    probes.set(bin, found)
  }
  return found
}

async function isOn($: Dollar): Promise<boolean> {
  try {
    return (await $.store.get('on')) === true
  } catch {
    return false
  }
}

const join = (root: string, ...parts: string[]): string => [root.replace(/[\\/]+$/, ''), ...parts].join(sepOf(root))

/** The project's own copy in node_modules/.bin when there is one, else the bare name (found on PATH). */
async function localBin($: Dollar, root: string, name: 'prettier' | 'biome'): Promise<string> {
  const names = isWindowsPath(root) ? [`${name}.cmd`, name] : [name]
  for (const n of names) {
    const path = join(root, 'node_modules', '.bin', n)
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return name
}

async function projectWeb($: Dollar, root: string): Promise<'prettier' | 'biome' | undefined> {
  const names = (await $.fs.list(root)).map(entry => entry.name)
  const pkg = names.includes('package.json') ? await $.fs.read(join(root, 'package.json')).catch(() => '') : ''
  return webFormatter(names, String(pkg))
}

const readText = async ($: Dollar, path: string): Promise<string | undefined> => {
  try {
    return String(await $.fs.read(path))
  } catch {
    return undefined
  }
}

/** Formats the file when it should be; answers the note for the model when its content changed, else undefined. */
async function formatAfter($: Dollar, cfg: Cfg, filePath: unknown): Promise<string | undefined> {
  if (typeof filePath !== 'string' || filePath === '') return undefined
  const lang = langOf(filePath)
  if (lang === undefined || !(await isOn($))) return undefined

  const cwd = await $.session.cwd()
  const root = (await $.fs.stat(cwd, { resolve: true })).realPath ?? cwd
  const stat = await $.fs.stat(filePath, { resolve: true })
  if (stat.kind !== 'file' || stat.realPath === undefined) return undefined
  const rel = relInside(root, stat.realPath)
  if (rel === undefined || isSkipped(rel)) return undefined // outside the session's folder, or in a vendored one

  const web = lang === 'web' ? await projectWeb($, root) : undefined
  if (lang === 'web' && web === undefined) return undefined // the project formats no JS: leave it alone
  const bins: Partial<Record<ToolName, string>> = web === undefined ? {} : { [web]: await localBin($, root, web) }
  const steps = stepsFor(lang, stat.realPath, cfg.lint, bins, web)

  let text = await readText($, stat.realPath)
  if (text === undefined) return undefined // unreadable or over 4 MiB: not ours to touch
  const changed: Step[] = []
  for (const step of steps) {
    if ((await probe($, step.bin)) === undefined) continue
    const ran = await $.process.run(step.argv, { cwd: root, timeoutMs: RUN_MS }).catch(() => undefined)
    if (ran === undefined) continue
    const after = await readText($, stat.realPath)
    if (after !== undefined && after !== text) {
      changed.push(step)
      text = after
    }
  }
  if (changed.length === 0) return undefined
  await update($, formatted, n => n + 1).catch(() => undefined)
  return noteFor(labelOf(changed), filePath)
}

async function status($: Dollar, cfg: Cfg): Promise<string> {
  const on = await isOn($)
  const count = await read($, formatted).catch(() => 0)
  const lines = [
    `format-on-edit · ${on ? 'on' : 'off (type /format-on-edit on)'}`,
    `lint fixes: ${cfg.lint ? 'on' : 'off (the lint setting)'} · files reformatted this session: ${count}`,
  ]
  const tell = async (tool: ToolName, bin: string, note = '') => {
    const v = await probe($, bin)
    lines.push(v === undefined ? `${tool}: not found · get it from ${WHERE[tool]}${note}` : `${tool}: found (${v})${note}`)
  }
  await tell('air', 'air', ' · R')
  await tell('ruff', 'ruff', ' · Python')
  await tell('jarl', 'jarl', cfg.lint ? ' · R lint' : ' · R lint, used only with the lint setting on')
  let root = ''
  try {
    const cwd = await $.session.cwd()
    root = (await $.fs.stat(cwd, { resolve: true })).realPath ?? cwd
  } catch {
    root = ''
  }
  const web = root === '' ? undefined : await projectWeb($, root).catch(() => undefined)
  if (web === undefined) lines.push('JS/TS/CSS/HTML: left alone (no Prettier config and no biome.json in this project)')
  else await tell(web, await localBin($, root, web), ' · this project uses it')
  return lines.join('\n')
}

async function flip($: Dollar, to: boolean): Promise<string> {
  try {
    if (to) await $.store.set('on', true)
    else await $.store.delete('on')
    await update($, isOff, () => !to)
  } catch {
    return 'format-on-edit · that did not work, nothing changed'
  }
  return to ? 'format-on-edit · on · each file Claude edits is formatted with the project formatter' : 'format-on-edit · off'
}

export const register: Register = (on, options) => {
  const cfg: Cfg = { lint: options.lint === true }

  on('session.start', async ($, e, next) => {
    probes = new Map()
    try {
      const stored = (await $.store.get('on')) === true
      await update($, isOff, () => !stored)
    } catch {
      // the switch then reads as off
    }
    try {
      await $.command.register({
        name: COMMAND,
        description: 'Format each file Claude edits with the project formatter: /format-on-edit on | off | status',
        argumentHint: 'on | off | status',
      })
    } catch {
      // fail-open: without the command the mod is simply quiet
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const p = parseArgs(e.args)
    if (p.kind === 'on') return { text: await flip($, true) }
    if (p.kind === 'off') return { text: await flip($, false) }
    if (p.kind === 'status') return { text: await status($, cfg) }
    return { text: `format-on-edit · unknown option "${p.kind === 'unknown' ? p.word : ''}"\nUse /format-on-edit on, off or status.` }
  }).catch(() => ({ text: 'format-on-edit · could not read its own state' }))

  // Runs the tool first and never changes the call; only adds a note beside a successful result.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (!EDIT_TOOLS.has(String(e.tool)) || ran.deny !== undefined || ran.isError === true) return ran
    try {
      const note = await formatAfter($, cfg, (e as unknown as Record<string, unknown>).file_path)
      if (note === undefined) return ran
      return { ...ran, context: [...(ran.context ?? []), note] } as typeof ran
    } catch {
      return ran
    }
  }).catch(($, e, next) => next(e))
}
