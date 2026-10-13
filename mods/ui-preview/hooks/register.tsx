// ui-preview: runs the app in this project on 127.0.0.1 (a plumber API first; also `npm run dev`, Shiny for R, Shiny for
// Python, Streamlit) and shows it in a pane: plumber's routes, the child's last output lines, a headless-browser
// screenshot, and a button that drafts a review prompt in the prompt box.
// Nothing runs on load: only on a command or a button. The network is used only for http://127.0.0.1:N and
// http://localhost:N (enforced in `localFetch`). The person's own browser is never opened.
// FAIL OPEN: every hook here only answers its own command or draws its own pane; any error becomes a line of text,
// and no tool call, prompt or other plugin is ever touched.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, HttpResponse, ProcessSpawnChunk, ProcessSpawnResult, Register, RenderSurface } from 'claude-code'

import type { UiPreviewApp, UiPreviewStatus } from '../types'
import {
  DEFAULT_PORT,
  addOutput,
  argvFor,
  browserCandidates,
  classify,
  detect,
  isLocalUrl,
  localUrl,
  originOf,
  parseArgs,
  parseRoutes,
  relPathOf,
  reviewText,
  shotArgv,
  urlIn,
} from './lib'

type Dollar = EngineInterface

const COMMAND = 'ui-preview'
const PANE = 'ui-preview'
const TITLE = 'UI preview'
const POLL_MS = 1000
const WAIT_MS = 60_000
const PORT_TRIES = 20
const SHOT_MS = 45_000
const SHOWN_OUTPUT = 15
const SHOWN_ROUTES = 60

const status = atom({ plugin: 'ui-preview', key: 'status' } as const, 'stopped')
const url = atom({ plugin: 'ui-preview', key: 'url' } as const, '')
const app = atom({ plugin: 'ui-preview', key: 'app' } as const, null)
const lines = atom({ plugin: 'ui-preview', key: 'lines' } as const, [])
const routes = atom({ plugin: 'ui-preview', key: 'routes' } as const, [])
const shot = atom({ plugin: 'ui-preview', key: 'shot' } as const, null)
const note = atom({ plugin: 'ui-preview', key: 'note' } as const, '')

type Stream = AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> & { readonly result: Promise<ProcessSpawnResult> }

// The running child and its timers are not drawn state and die with the module (a reload kills the child), so module
// variables are the right place. `generation` tells a loop that has been replaced or stopped to end.
let child: { id: number; stream: Stream } | undefined
let generation = 0
let partial = ''
let pollTimer: { cancel: () => void } | undefined
let isPolling = false
let browser: Promise<string | undefined> | undefined

// ---------------------------------------------------------------- small pieces

const quiet = async (work: () => unknown): Promise<void> => {
  try {
    await work()
  } catch {
    /* fail-open */
  }
}

const say = ($: Dollar, text: string) => quiet(() => update($, note, () => text.slice(0, 300)))

/** The only door to the network: http://127.0.0.1:N or http://localhost:N, nothing else. */
async function localFetch($: Dollar, target: string): Promise<HttpResponse> {
  if (!isLocalUrl(target)) throw new Error(`ui-preview only fetches http://127.0.0.1 or http://localhost on a port, not ${target.slice(0, 80)}`)
  return $.http.fetch(target)
}

const answers = async ($: Dollar, target: string): Promise<boolean> => {
  try {
    await localFetch($, target)
    return true
  } catch {
    return false
  }
}

async function rootOf($: Dollar): Promise<string> {
  return (await $.session.cwd()).replace(/[\\/]+$/, '')
}

const sepOf = (root: string): string => (root.includes('\\') && !root.includes('/') ? '\\' : '/')
const isWindows = (root: string): boolean => /^[A-Za-z]:[\\/]/.test(root) || sepOf(root) === '\\'
const join = (root: string, rel: string): string => (rel === '' ? root : `${root}${sepOf(root)}${rel.split('/').join(sepOf(root))}`)

async function isPaneOpen($: Dollar): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE)
  } catch {
    return false
  }
}

async function openPane($: Dollar): Promise<void> {
  if (!(await isPaneOpen($))) await quiet(() => $.ui.open({ id: PANE, title: TITLE, columns: 64 }))
}

// ---------------------------------------------------------------- starting and stopping

async function findApp($: Dollar, root: string, file: string): Promise<UiPreviewApp | string> {
  if (file === '') {
    const found = await detect({
      list: async rel => (await $.fs.list(join(root, rel))).map(e => ({ name: e.name, kind: e.kind })),
      read: async rel => String(await $.fs.read(join(root, rel))),
    })
    return found ?? 'no app found: no plumber annotations (#* @get ...), no package.json "dev" script, no Shiny app.R or app.py, no Streamlit script. Name one: /ui-preview start <file>'
  }
  const rel = relPathOf(root, file)
  if (rel === undefined) return `"${file.slice(0, 80)}" is outside this project`
  let target = rel
  try {
    if ((await $.fs.stat(join(root, rel))).kind === 'dir') target = `${rel}/package.json`
  } catch {
    return `"${rel.slice(0, 80)}" was not found`
  }
  let text = ''
  try {
    text = String(await $.fs.read(join(root, target)))
  } catch {
    return `could not read "${target.slice(0, 80)}"`
  }
  return classify(target, text) ?? `"${target.slice(0, 80)}" is not a plumber, Shiny, Streamlit or npm-dev app`
}

/** The wanted port, or the next one that nobody answers on. */
async function freePort($: Dollar, wanted: number): Promise<number | undefined> {
  for (let port = wanted; port < wanted + PORT_TRIES && port <= 65535; port++) if (!(await answers($, localUrl(port)))) return port
  return undefined
}

async function start($: Dollar, file: string, port: number | undefined): Promise<string> {
  if (child !== undefined) return `ui-preview · already running at ${await read($, url)} · /ui-preview stop first`
  const root = await rootOf($)
  const found = await findApp($, root, file)
  if (typeof found === 'string') {
    await say($, found)
    return `ui-preview · ${found}`
  }
  const wanted = port ?? DEFAULT_PORT[found.kind]
  const free = await freePort($, wanted)
  if (free === undefined) return `ui-preview · ports ${wanted} to ${wanted + PORT_TRIES - 1} all answer already · pick one with --port`
  const { argv, cwd } = argvFor(found, free, isWindows(root) ? 'npm.cmd' : 'npm')
  const at = localUrl(free)
  await update($, app, () => found)
  await update($, url, () => at)
  await update($, status, () => 'starting')
  await update($, lines, () => [])
  await update($, routes, () => [])
  await say($, `started: ${argv[0]} ${argv.slice(1).join(' ')}`.slice(0, 300))
  partial = ''
  runChild($, argv, join(root, cwd))
  startPoll($)
  await openPane($)
  return `ui-preview · starting ${found.label} at ${at}${free !== wanted ? ` (port ${wanted} was taken)` : ''}`
}

/** Starts the child and reads it in a loop that outlives this dispatch; the loop's end is the child's. */
function runChild($: Dollar, argv: string[], cwd: string): void {
  const id = ++generation
  const stream = $.process.spawn({ argv, cwd }) as Stream
  child = { id, stream }
  void (async () => {
    let ending = ''
    try {
      for await (const chunk of stream) {
        if (generation !== id) break
        await onOutput($, chunk.text)
      }
      if (generation === id) {
        const r = await stream.result.catch(() => undefined)
        ending = r === undefined ? 'the app ended' : `the app ended (${r.signal ?? `exit ${r.code}`})`
      }
    } catch (error) {
      ending = `could not start ${argv[0]}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 160)}`
    } finally {
      if (generation === id) {
        child = undefined
        stopPoll()
        await quiet(() => update($, status, () => 'exited'))
        await say($, ending || 'the app ended')
      }
    }
  })()
}

async function onOutput($: Dollar, text: string): Promise<void> {
  const before = partial
  let kept: string[] = []
  await update($, lines, old => {
    const next = addOutput(old, before, text)
    kept = next.lines
    partial = next.partial
    return next.lines
  })
  // The URL the app itself prints wins over the one we asked for (a dev server that moved to another port).
  const printed = urlIn(`${before}${text}`) ?? kept.map(l => urlIn(l)).find(u => u !== undefined)
  const current = await read($, url)
  if (printed !== undefined && originOf(printed) !== originOf(current) && (await read($, status)) === 'starting') {
    await update($, url, () => printed)
  }
}

async function stop($: Dollar): Promise<string> {
  const was = child
  generation++
  child = undefined
  stopPoll()
  await update($, status, () => 'stopped')
  if (was === undefined) return 'ui-preview · nothing is running'
  // Ending the loop is what kills the child: return() closes the stream.
  await quiet(() => was.stream.return(undefined as never))
  await say($, 'stopped')
  return 'ui-preview · stopped'
}

// ---------------------------------------------------------------- waiting for it to answer

function startPoll($: Dollar): void {
  stopPoll()
  let ticks = 0
  pollTimer = $.clock.every(POLL_MS, () => {
    ticks++
    void pollOnce($, ticks * POLL_MS).catch(() => undefined)
  })
}

function stopPoll(): void {
  pollTimer?.cancel()
  pollTimer = undefined
  isPolling = false
}

async function pollOnce($: Dollar, waited: number): Promise<void> {
  if (isPolling || child === undefined) return
  isPolling = true
  try {
    const target = await read($, url)
    if (await answers($, target)) {
      stopPoll()
      await update($, status, () => 'running')
      await say($, `answering at ${target}`)
      await loadRoutes($)
      return
    }
    if (waited >= WAIT_MS) {
      stopPoll()
      await update($, status, () => 'silent')
      await say($, `no answer at ${target} after ${Math.round(WAIT_MS / 1000)} s; the output below may say why`)
    }
  } finally {
    isPolling = false
  }
}

async function loadRoutes($: Dollar): Promise<void> {
  const found = await read($, app)
  if (found?.kind !== 'plumber') return
  try {
    const r = await localFetch($, `${originOf(await read($, url))}/openapi.json`)
    if (!r.ok) return say($, `openapi.json answered ${r.status}`)
    const list = parseRoutes(r.text.length > 4_000_000 ? '' : r.text)
    await update($, routes, () => list)
  } catch {
    await say($, 'could not read openapi.json')
  }
}

// ---------------------------------------------------------------- screenshot and review

async function findBrowser($: Dollar): Promise<string | undefined> {
  const env = {
    localAppData: await $.env.get('LOCALAPPDATA').catch(() => undefined),
    programFiles: await $.env.get('ProgramFiles').catch(() => undefined),
    programFilesX86: await $.env.get('ProgramFiles(x86)').catch(() => undefined),
  }
  for (const c of browserCandidates(env)) {
    if (!c.isName) {
      if (await $.fs.exists(c.path).catch(() => false)) return c.path
      continue
    }
    const ok = await $.process
      .run([c.path, '--version'], { timeoutMs: 5000 })
      .then(r => r.exitCode === 0)
      .catch(() => false)
    if (ok) return c.path
  }
  return undefined
}

async function takeShot($: Dollar): Promise<string> {
  const target = await read($, url)
  if (child === undefined || target === '' || !isLocalUrl(target)) return 'ui-preview · start the app first (/ui-preview start)'
  browser ??= findBrowser($)
  const found = await browser
  if (found === undefined) {
    browser = undefined // look again next time: one may have been installed
    await say($, 'no Chrome, Chromium or Edge found for screenshots')
    return 'ui-preview · no Chrome, Chromium or Edge found for screenshots'
  }
  const root = await rootOf($)
  const dir = join(root, '.claude/ui-preview')
  const png = join(root, '.claude/ui-preview/shot.png')
  // Writing this creates the folder and keeps everything in it (shot, browser profile) out of git.
  await $.fs.write(join(root, '.claude/ui-preview/.gitignore'), '*\n')
  const before = await $.fs.stat(png).then(s => s.mtimeMs).catch(() => 0)
  // A plumber API with no @assets front end answers 404 at its root: its docs page is the useful picture then.
  let page = target
  if ((await read($, app))?.kind === 'plumber') {
    const rootAnswer = await localFetch($, target).catch(() => undefined)
    if (rootAnswer?.status === 404) page = `${originOf(target)}/__docs__/`
  }
  const argv = shotArgv(found, png, join(root, '.claude/ui-preview/chrome-profile'), page)
  try {
    await $.process.run(argv, { cwd: dir, timeoutMs: SHOT_MS })
  } catch (error) {
    const why = (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 120)
    await say($, `screenshot failed: ${why}`)
    return `ui-preview · screenshot failed: ${why}`
  }
  const after = await $.fs.stat(png).catch(() => undefined)
  if (after === undefined || after.kind !== 'file' || after.mtimeMs === before) {
    await say($, 'the browser ran but wrote no screenshot')
    return 'ui-preview · the browser ran but wrote no screenshot'
  }
  await update($, shot, () => ({ path: png, generation: Math.floor(after.mtimeMs) }))
  await say($, `screenshot saved: ${png}`)
  await openPane($)
  return `ui-preview · screenshot saved: ${png}`
}

async function review($: Dollar, surface?: RenderSurface): Promise<string> {
  const target = await read($, url)
  if (target === '') return 'ui-preview · start the app first'
  const text = reviewText(target, (await read($, shot))?.path)
  try {
    const filled = await $.prompt.fill({ text, mode: 'append' })
    if (filled.isFilled) {
      await say($, 'review draft is in the prompt box: edit it, then press Enter')
      return 'ui-preview · the review draft is in the prompt box'
    }
  } catch {
    // fall through to the clipboard
  }
  const copied = await $.ui.copy({ text, ...(surface === undefined ? {} : { surface }) }).catch(() => ({ isCopied: false as const }))
  const words = copied.isCopied ? 'prompt box busy: review draft copied to the clipboard' : 'could not place the review draft; it is below'
  await say($, words)
  return copied.isCopied ? `ui-preview · ${words}` : `ui-preview · ${words}\n${text}`
}

async function refresh($: Dollar): Promise<void> {
  const target = await read($, url)
  if (child === undefined || target === '') return
  if (await answers($, target)) {
    stopPoll()
    await update($, status, () => 'running')
    await loadRoutes($)
  }
}

async function statusText($: Dollar): Promise<string> {
  const s = shownStatus(await read($, status))
  const a = await read($, app)
  const u = await read($, url)
  const r = await read($, routes)
  const sh = await read($, shot)
  const n = await read($, note)
  const head = `ui-preview · ${s}${a === null ? '' : ` · ${a.label}`}${u === '' || s === 'stopped' ? '' : ` · ${u}`}`
  const out = [head]
  if (a?.kind === 'plumber' && r.length > 0) out.push(`${r.length} routes (see /ui-preview for the list)`)
  if (sh !== null) out.push(`screenshot: ${sh.path}`)
  if (n !== '') out.push(n)
  return out.join('\n')
}

/** A status the module no longer backs (a reload killed the child) reads as stopped. */
function shownStatus(s: UiPreviewStatus): UiPreviewStatus {
  return child === undefined && (s === 'starting' || s === 'running' || s === 'silent') ? 'stopped' : s
}

// ---------------------------------------------------------------- the hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await quiet(async () => {
      await update($, status, () => 'stopped')
      await update($, note, () => '')
    })
    await quiet(() =>
      $.command.register({
        name: COMMAND,
        description: 'Run this project’s app on 127.0.0.1 and show it in a pane: /ui-preview [start [file] [--port N] | stop | shot | status]',
        argumentHint: '[start [file] [--port N] | stop | shot | status]',
      }),
    )
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (child !== undefined) await quiet(() => stop($))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const p = parseArgs(e.args)
    switch (p.kind) {
      case 'open':
        await openPane($)
        return { text: await statusText($) }
      case 'status':
        return { text: await statusText($) }
      case 'start':
        if (p.error !== '') return { text: `ui-preview · ${p.error}` }
        return { text: await start($, p.file, p.port) }
      case 'stop':
        return { text: await stop($) }
      case 'shot':
        return { text: await takeShot($) }
      default:
        return { text: `ui-preview · unknown option "${p.word}"\nUse /ui-preview, or start [file] [--port N], stop, shot, status.` }
    }
  }).catch(() => ({ text: 'ui-preview · that did not work' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)
    const cut = (s: string) => (s.length > width ? `${s.slice(0, width - 1)}…` : s)
    const s = shownStatus(await read($, status))
    const a = await read($, app)
    const u = await read($, url)
    const r = await read($, routes)
    const sh = await read($, shot)
    const n = await read($, note)
    const out = await read($, lines)
    const isUp = s === 'starting' || s === 'running' || s === 'silent'
    const color = s === 'running' ? 'green' : s === 'exited' ? 'red' : s === 'silent' ? 'yellow' : undefined
    const press = (work: () => Promise<unknown>) => () => work().catch(() => say($, 'that did not work'))

    // The picture where the surface draws one (the terminal's Image: kitty or Ghostty show pixels, others its alt);
    // elsewhere the path.
    let picture = sh === null ? null : <Text dimColor>{cut(`screenshot: ${sh.path}`)}</Text>
    if (sh !== null && e.surface === 'terminal') {
      const { Image } = $.ui.resolve(e)
      const columns = Math.max(10, Math.min(width, 120))
      const rows = Math.max(4, Math.min(255, Math.round((columns * 800) / 1280 / 2)))
      picture = <Image key="shot" source={{ file: sh.path, format: 'png', generation: sh.generation }} columns={columns} rows={rows} alt={cut(`screenshot: ${sh.path}`)} />
    }

    return (
      <Box flexDirection="column">
        <Text bold {...(color === undefined ? {} : { color })}>
          {cut(`${s}${a === null ? '' : ` · ${a.label}`}`)}
        </Text>
        {u !== '' && isUp && <Text>{cut(u)}</Text>}
        <Box flexDirection="row" flexWrap="wrap">
          {isUp ? <Button key="stop" label="Stop" onPress={press(() => stop($))} /> : <Button key="start" label="Start" variant="primary" onPress={press(() => start($, '', undefined))} />}
          <Button key="shot" label="Screenshot" onPress={press(() => takeShot($))} />
          <Button key="review" label="Ask Claude to review" onPress={p => press(() => review($, p.surface))()} />
          <Button key="refresh" label="Refresh" onPress={press(() => refresh($))} />
        </Box>
        {n !== '' && <Text dimColor>{cut(n)}</Text>}
        {a?.kind === 'plumber' && (
          <Box flexDirection="column">
            <Text bold>{cut(`Routes${r.length > 0 ? ` (${r.length})` : ''} · root ${u === '' ? '-' : `${originOf(u)}/`} (serves the @assets front end, if any)`)}</Text>
            {r.length === 0 && <Text dimColor>{s === 'running' ? 'none read from /openapi.json' : 'listed once the API answers'}</Text>}
            {r.slice(0, SHOWN_ROUTES).map(route => (
              <Text wrap="truncate-end">{cut(`${route.method.padEnd(6)} ${route.path}${route.summary === '' ? '' : `  ${route.summary}`}`)}</Text>
            ))}
            {r.length > SHOWN_ROUTES && <Text dimColor>+{r.length - SHOWN_ROUTES} more</Text>}
            {u !== '' && <Text dimColor>{cut(`API docs: ${originOf(u)}/__docs__/`)}</Text>}
          </Box>
        )}
        {picture}
        {out.length > 0 && <Text bold>Output</Text>}
        {out.slice(-SHOWN_OUTPUT).map(line => (
          <Text dimColor wrap="truncate-end">{cut(line)}</Text>
        ))}
      </Box>
    )
  })
}
