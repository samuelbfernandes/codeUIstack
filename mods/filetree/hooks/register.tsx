import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { FiletreeTouch } from '../types'
import {
  ancestorsOf,
  dirHeat,
  hasPendingEdits,
  ignoreSet,
  isCommitCommand,
  isShimmering,
  markCommitted,
  mayChangeFiles,
  parseStatus,
  pathsOfCall,
  relativeKey,
  scanTree,
  touch,
  visibleRows,
} from './model'

const PANE = 'filetree'
const TITLE = 'Filetree'
const SHIMMER_TICK_MS = 500
const POLL_MS = 5000
const RESCAN_GAP_MS = 3000
const MIN_COLUMNS = 40
const HINT = 'Side panel · use /tui fullscreen'
const FAILED = 'Filetree · could not read this folder'
/** Surfaces that dock a pane beside the transcript; the others (a phone, an editor panel) are left alone. */
const PANE_SURFACES = new Set(['terminal', 'desktop'])

const tree = atom({ plugin: 'filetree', key: 'tree' } as const, null)
const touched = atom({ plugin: 'filetree', key: 'touched' } as const, {})
const expanded = atom({ plugin: 'filetree', key: 'expanded' } as const, {})
const tick = atom({ plugin: 'filetree', key: 'tick' } as const, 0)
// The one automatic open: 'new' until it is tried, 'checking' until the pane's first drawing says whether it docked,
// then 'done' for the rest of the session. It never goes back, so a pane the person closes is not opened again.
const autoOpen = atom({ plugin: 'filetree', key: 'autoOpen' } as const, 'new')

type Dollar = EngineInterface
type Heat = 'edit' | 'read' | 'done'

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

function settingsOf(options: PluginOptions) {
  const extra = options.extraIgnore
  const ignore = ignoreSet(typeof extra === 'string' ? extra : '')

  return {
    maxDepth: number(options.maxDepth, 4),
    maxEntries: number(options.maxEntries, 400),
    ignore,
    isAutoOpen: options.autoOpen !== false,
  }
}

/** The colors of a touched file; a shimmering one alternates two styles with the tick's parity. */
function styleOf(entry: FiletreeTouch | undefined, now: number, phase: number) {
  if (entry === undefined) return {}
  if (entry.isCommitted) return { color: 'green' }
  const color = entry.kind === 'edit' ? 'yellow' : 'cyan'
  if (!isShimmering(entry, now)) return { color }

  return phase === 0 ? { color, bold: true } : { color, dimColor: true }
}

function markerOf(entry: FiletreeTouch | undefined): string {
  if (entry === undefined) return '  '
  if (entry.isCommitted) return '✓ '

  return entry.kind === 'edit' ? '● ' : '○ '
}

const HEAT_COLOR: Record<Heat, string> = { edit: 'yellow', read: 'cyan', done: 'green' }

// Timer handles and the scan clock are not drawn state, and a reload drops the timers with the module, so
// module variables are the right place. A function that takes `$` is declared here at the top, as the engine reads it.
let settings = settingsOf({})
let tickTimer: { cancel: () => void } | undefined
let pollTimer: { cancel: () => void } | undefined
let lastScanAt = -Infinity

async function isPaneOpen($: Dollar): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function rescan($: Dollar): Promise<void> {
  lastScanAt = await $.clock.now()
  const cwd = await $.session.cwd()
  const scanned = await scanTree(path => $.fs.list(path), cwd, settings)
  await update($, tree, () => scanned)
}

/** Runs the work in a timer's own dispatch, so a tool's result is never held up by it. */
function defer($: Dollar, work: () => Promise<void>): void {
  $.clock.after(1, () => {
    work().catch(() => undefined)
  })
}

/** What `/filetree` does: close the pane, or scan and open it.
 * The text is a headline and at most one dim detail line. */
async function toggleTree($: Dollar, isFullscreen: boolean): Promise<string> {
  await update($, autoOpen, () => 'done') // the person has taken over: never open it for them after this
  if (await isPaneOpen($)) {
    await $.ui.close({ id: PANE })

    return 'Filetree · closed'
  }
  await rescan($)
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 44 })
  if (hasPendingEdits(await read($, touched))) ensurePoll($)
  if (!opened.isPlaced) return 'Filetree · waiting for room\nTry /tui fullscreen, or a wider window.'

  return isFullscreen === false ? 'Filetree · open\nThe side panel needs /tui fullscreen.' : 'Filetree · open'
}

/**
 * The automatic open, once per session, from a timer so session start never waits for it. Unasked, the engine
 * places a pane only where the surface has room (144 terminal columns); where it does not, the pane is closed
 * again so it cannot pop up later when the window is widened. Whether the layout docks it (fullscreen) is only
 * known when the pane is first drawn: see `settleAutoOpen`. Nothing is scanned until it is known to be docked.
 */
async function autoOpenTree($: Dollar): Promise<void> {
  if ((await read($, autoOpen)) !== 'new') return
  await update($, autoOpen, () => 'done')
  if (await isPaneOpen($)) return
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 44 })
  if (opened.isPlaced) await update($, autoOpen, () => 'checking')
  else await $.ui.close({ id: PANE })
}

/**
 * First drawing of the automatically opened pane: keep it only if it is docked, else close it quietly. A drawing may
 * not write state, so it only asks (from a timer) and this runs in the timer's own dispatch; a second ask finds 'done'.
 */
async function settleAutoOpen($: Dollar, placement: 'dock' | 'inline'): Promise<void> {
  if ((await read($, autoOpen)) !== 'checking') return
  await update($, autoOpen, () => 'done')
  if (placement === 'dock') await rescan($)
  else await $.ui.close({ id: PANE })
}

// ---- shimmer: a 500 ms tick that exists only while a touched file is still shimmering -------------------------

function ensureTick($: Dollar): void {
  if (tickTimer !== undefined) return
  tickTimer = $.clock.every(SHIMMER_TICK_MS, () => {
    onTick($).catch(() => undefined)
  })
}

async function onTick($: Dollar): Promise<void> {
  const now = await $.clock.now()
  // Always bump the counter: the tick that finds nothing left to shimmer is the redraw that settles the styles.
  await update($, tick, count => count + 1)
  const map = await read($, touched)
  if (Object.values(map).some(entry => isShimmering(entry, now))) return
  tickTimer?.cancel()
  tickTimer = undefined
}

// ---- commits: `git status` after a commit, and a slow poll while the pane is open ----------------------------

function ensurePoll($: Dollar): void {
  if (pollTimer !== undefined) return
  pollTimer = $.clock.every(POLL_MS, () => {
    onPoll($).catch(() => undefined)
  })
}

async function onPoll($: Dollar): Promise<void> {
  const isUseful = (await isPaneOpen($)) && hasPendingEdits(await read($, touched))
  if (!isUseful) {
    pollTimer?.cancel()
    pollTimer = undefined

    return
  }
  await refreshGit($)
}

/** Marks edited files that `git status` no longer lists. Read-only git; `--no-optional-locks` keeps even its index refresh from writing. */
async function refreshGit($: Dollar): Promise<void> {
  const git = ['git', '--no-optional-locks']
  const prefix = await $.process.run([...git, 'rev-parse', '--show-prefix'], { timeoutMs: 10000 })
  if (prefix.exitCode !== 0) return
  const status = await $.process.run([...git, 'status', '--porcelain', '-z'], { timeoutMs: 10000 })
  if (status.exitCode !== 0) return
  const isModified = parseStatus(status.stdout, prefix.stdout.trim())
  await update($, touched, map => markCommitted(map, isModified))
}

async function noteCall($: Dollar, tool: string, input: Record<string, unknown>, result: unknown): Promise<void> {
  const cwd = await $.session.cwd()
  const { kind, paths } = pathsOfCall(tool, input, result)
  const keys = paths.flatMap(path => relativeKey(cwd, path, settings.ignore) ?? [])
  if (keys.length > 0) await markTouched($, keys, kind)

  if (tool === 'Bash' && isCommitCommand(String(input.command ?? ''))) defer($, () => refreshGit($))
  if (mayChangeFiles(tool) && (await isPaneOpen($))) {
    const now = await $.clock.now()
    if (now - lastScanAt >= RESCAN_GAP_MS) defer($, () => rescan($))
  }
}

async function markTouched($: Dollar, keys: string[], kind: FiletreeTouch['kind']): Promise<void> {
  const now = await $.clock.now()
  await update($, touched, map => keys.reduce((acc, key) => touch(acc, key, kind, now), map))
  // Open the folders above a touched file so the light is visible, once; the person may collapse them again.
  const parents = keys.flatMap(ancestorsOf)
  await update($, expanded, map => ({ ...map, ...Object.fromEntries(parents.map(dir => [dir, true])) }))
  ensureTick($)
  if (kind === 'edit' && (await isPaneOpen($))) ensurePoll($)
}

export const register: Register = (on, options) => {
  settings = settingsOf(options)

  // ---- the commands ---------------------------------------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'filetree', description: 'Show or hide the file tree beside the chat' })
    // Only where a person is at a surface that docks panes; anywhere else this does nothing, silently.
    if (settings.isAutoOpen && e.isInteractive && e.surface !== null && PANE_SURFACES.has(e.surface)) {
      defer($, () => autoOpenTree($))
    }

    return next(e)
  })

  on('command.run', { command: 'filetree' }, async ($, e) => ({ text: await toggleTree($, e.presentation.isFullscreen) })).catch(
    () => ({ text: FAILED }),
  )

  // ---- following Claude's tools ---------------------------------------------------------------------------------

  // Fail open: this hook only watches. If it throws, the tool runs and its result reaches the model untouched.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      // A display problem must never surface as a skipped-hook notice in the middle of the work.
      await noteCall($, String(e.tool), e as unknown as Record<string, unknown>, ran.result).catch(() => undefined)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // ---- the pane -------------------------------------------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    if ((await read($, autoOpen)) === 'checking') defer($, () => settleAutoOpen($, e.props.placement))
    const isInline = e.props.placement === 'inline' || e.viewport?.isFullscreen === false
    if (e.surface === 'terminal' && isInline) return <Text dimColor>{HINT}</Text>
    if (e.props.bodyColumns < MIN_COLUMNS) return <Text dimColor>Too narrow · widen the pane</Text>

    const scanned = await read($, tree)
    const marks = await read($, touched)
    const open = await read($, expanded)
    const phase = (await read($, tick)) % 2
    const now = await $.clock.now()
    const heat = dirHeat(marks)
    const toggle = (dir: string) => () => update($, expanded, map => ({ ...map, [dir]: map[dir] !== true }))

    if (scanned === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No tree yet</Text>
          <Button key="refresh" label="Refresh" onPress={() => rescan($)} />
        </Box>
      )
    }

    const rows = visibleRows(scanned, open).map(row => {
      const pad = '  '.repeat(row.depth)
      if (row.type === 'more') return <Text dimColor>{pad}+{row.count} more</Text>
      if (row.type === 'unscanned') return <Text dimColor>{pad}not scanned</Text>
      if (row.type === 'file') {
        const entry = marks[row.path]

        return (
          <Text {...styleOf(entry, now, phase)} wrap="truncate-end">
            {pad}{markerOf(entry)}{row.name}
          </Text>
        )
      }
      const isOpen = open[row.path] === true
      const dirHeatOfRow = isOpen ? undefined : heat[row.path]

      return (
        <Button key={`dir:${row.path}`} plain onPress={toggle(row.path)}>
          {pad}{isOpen ? '▾ ' : '▸ '}{row.name}/
          {dirHeatOfRow !== undefined && <Text color={HEAT_COLOR[dirHeatOfRow]}> {'•'}</Text>}
        </Button>
      )
    })

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{scanned.root.split('/').pop() || '/'}/ </Text>
          <Button key="refresh" label="Refresh" onPress={() => rescan($)} />
        </Box>
        {rows}
        {scanned.more > 0 && <Text dimColor>+{scanned.more} more</Text>}
        {scanned.isCapped && scanned.more === 0 && <Text dimColor>+ more</Text>}
        <Text dimColor>{'●'} edited · {'○'} read · {'✓'} committed</Text>
      </Box>
    )
  })
}
