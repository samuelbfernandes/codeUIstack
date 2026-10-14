import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Edit } from '../types'
import { MAX_EDITS, MAX_PRIOR_BYTES, editFromCall, fileCount, looksLikeShellWrite, stepIndex } from './edits'
import type { Prior } from './edits'
import { unifiedDiff } from './diff'

const PANE = 'edit-replay'

const edits = atom({ plugin: 'edit-replay', key: 'edits' } as const, [])
const turn = atom({ plugin: 'edit-replay', key: 'turn' } as const, 0)
const shellTurns = atom({ plugin: 'edit-replay', key: 'shellTurns' } as const, [])
const ready = atom({ plugin: 'edit-replay', key: 'ready' } as const, null)
const view = atom({ plugin: 'edit-replay', key: 'view' } as const, null)
const hintAt = atom({ plugin: 'edit-replay', key: 'hintAt' } as const, 0)

/** A turn that changed at least this many files earns the one-line hint. */
const HINT_MIN_FILES = 3
/** The hint shows at most once in this long. */
const HINT_GAP_MS = 10 * 60_000

type Scope = 'turn' | 'all'

/** What a Write is about to overwrite, read BEFORE the write. Never throws:
 *  a file we cannot read just means the diff has no "before" side. */
async function readPrior($: EngineInterface, path: unknown): Promise<Prior> {
  if (typeof path !== 'string' || path === '') return { created: false }
  try {
    if (!(await $.fs.exists(path))) return { created: true, text: '' }
    const stat = await $.fs.stat(path)
    if (stat.kind !== 'file') return { created: true, text: '' }
    if (stat.size > MAX_PRIOR_BYTES) return { created: false }
    return { created: false, text: await $.fs.read(path) }
  } catch {
    return { created: false }
  }
}

async function record($: EngineInterface, tool: string, input: Record<string, unknown>, prior?: Prior) {
  const entry = editFromCall(tool, input, prior)
  if (!entry) return
  const current = await read($, turn)
  await update($, edits, list =>
    [...list, { ...entry, id: (list[list.length - 1]?.id ?? 0) + 1, turn: current }].slice(-MAX_EDITS),
  )
}

/** The edits a view covers: one turn's, or all that are still held. */
function inView(all: readonly Edit[], v: { scope: Scope; turn: number }): Edit[] {
  return v.scope === 'all' ? [...all] : all.filter(x => x.turn === v.turn)
}

/** Points the view at the last turn that recorded edits (or the whole
 *  session) and opens the pane. Returns what the command says: a headline, then at most one detail line. */
async function openReplay($: EngineInterface, scope: Scope): Promise<string> {
  const all = await read($, edits)
  const lastTurn = all.reduce((t, x) => Math.max(t, x.turn), -1)
  const shown = inView(all, { scope, turn: lastTurn })
  if (shown.length === 0) {
    return "Replay · nothing to show yet\nOnly Claude's file edits are recorded."
  }
  await update($, view, () => ({ scope, turn: lastTurn, i: 0 }))
  const opened = await $.ui.open({ id: PANE, title: 'Replay', focus: true, closeOnEscape: true })
  if (!opened.isPlaced) return 'Replay · no room for the pane\nTry a wider terminal.'
  return `Replay · ${shown.length} edit${shown.length === 1 ? '' : 's'} in ${scope === 'all' ? 'this session' : 'the last turn'}`
}

/** One short toast after a turn that changed several files, rate-limited, and only where a person can see it. */
async function hintAfterTurn($: EngineInterface, files: number): Promise<void> {
  if (files < HINT_MIN_FILES) return
  if ((await $.session.surfaces()).length === 0) return // a plain `-p` run: nobody is looking
  const now = await $.clock.now()
  const last = await read($, hintAt)
  if (last !== 0 && now - last < HINT_GAP_MS) return
  await update($, hintAt, () => now)
  $.ui.toast(`${files} files changed · /replay to review`)
}

/** What the hooks below this one drew in the band. Only one tree can fill the band, so a mod that draws returns its row with this under it (never instead of it), and the other mods' rows stay visible. */
async function drawnBelow<E>(next: (e: E) => unknown, e: E): Promise<object | undefined> {
  try {
    const tree = await next(e)
    return tree !== null && typeof tree === 'object' ? tree : undefined
  } catch {
    return undefined
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'replay',
      description: 'Step through the file edits from the last turn',
      argumentHint: '[all]',
    })

    return next(e)
  })

  // A /clear ends the conversation the edits belong to.
  on('session.end', async ($, e, next) => {
    await update($, edits, () => [])
    await update($, shellTurns, () => [])
    await update($, ready, () => null)
    await update($, view, () => null)

    return next(e)
  }).catch(($, e, next) => next(e)) // observational: never get in the way of ending

  on('command.run', { command: 'replay' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg !== '' && arg !== 'all') return { text: 'Replay · /replay for the last turn, /replay all for the session' }

    return { text: await openReplay($, arg === 'all' ? 'all' : 'turn') }
  }).catch(() => ({ text: 'Replay · could not open' }))

  // Recording. Observational and fail-open: the call is never altered, denied
  // or delayed by a failure here; an error in this hook just means the edit is
  // not recorded. The previous content of a Write is read before `next`, since
  // afterwards it is gone.
  // (MultiEdit is matched too, for builds that have it; this one does not.)
  on('tool.call', { tool: /^(Edit|Write|MultiEdit|NotebookEdit)$/ }, async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const tool = String(e.tool)
    const prior = tool === 'Write' ? await readPrior($, input.file_path) : undefined
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true) {
      await record($, tool, input, prior).catch(() => {})
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Only remembers that a shell command looked like it wrote files, for the
  // pane's footer note. The command itself is never touched.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = (e as unknown as Record<string, unknown>).command
    if (ran.deny === undefined && typeof command === 'string' && looksLikeShellWrite(command)) {
      const current = await read($, turn)
      await update($, shellTurns, list => (list.includes(current) ? list : [...list, current].slice(-50))).catch(() => {})
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    await update($, turn, n => n + 1)
    await update($, ready, () => null)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const current = await read($, turn)
      const made = (await read($, edits)).filter(x => x.turn === current)
      await update($, ready, () => (made.length > 0 ? { turn: current, edits: made.length, files: fileCount(made) } : null))
      // Fail-open and observational: a hint that cannot be shown costs nothing and never touches the turn.
      if (options.turnHint !== false) await hintAfterTurn($, fileCount(made)).catch(() => {})
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The band goes away as soon as the next prompt is sent. The prompt itself passes on untouched, and any failure
  // here passes it on too (fail-open).
  on('prompt.submit', async ($, e, next) => {
    await update($, ready, () => null).catch(() => {})
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const info = await read($, ready)
    if (e.props.hasSurvey || info === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const s = (n: number) => (n === 1 ? '' : 's')
    // A Button's hotkey works while the band holds the keyboard (ctrl+x tab
    // or a click); a bare letter typed at the prompt is not routed to it.
    const row = (
      <Box key="replay-row" gap={1}>
        <Text>{`● ${info.edits} edit${s(info.edits)} in ${info.files} file${s(info.files)}`}</Text>
        <Button
          key="open"
          label="Replay"
          hotkey="r"
          onPress={async () => {
            $.ui.toast(await openReplay($, 'turn'))
          }}
        />
      </Box>
    )
    const below = await drawnBelow(next, e)
    return below === undefined ? row : <Box key="replay-band" flexDirection="column">{row}{below as never}</Box>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const v = await read($, view)
    if (v === null) return next(e)
    const list = inView(await read($, edits), v)
    const shell = await read($, shellTurns)
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const close = (
      <Button key="close" label="Close" hotkey="c" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
    )
    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>Replay</Text>
          <Text dimColor>Nothing left to show</Text>
          {close}
        </Box>
      )
    }

    const i = stepIndex(v.i, 0, list.length)
    const edit = list[i]!
    const diff = unifiedDiff(edit.changes)
    const hasShell = v.scope === 'all' ? shell.length > 0 : shell.includes(v.turn)
    const go = (delta: number) => update($, view, cur => (cur ? { ...cur, i: stepIndex(cur.i, delta, list.length) } : cur))
    const meta = [edit.tool, edit.created ? 'new file' : null, `+${diff.added} −${diff.removed}`, v.scope === 'all' ? 'session' : 'last turn']
    return (
      <Box flexDirection="column">
        <Text bold>{`Replay · ${i + 1} of ${list.length}`}</Text>
        <Text>{edit.path}</Text>
        <Text dimColor>{meta.filter(Boolean).join(' · ')}</Text>
        {edit.note !== undefined && <Text dimColor>{edit.note}</Text>}
        {edit.truncated === true && <Text dimColor>Long edit shortened</Text>}
        {diff.text === '' ? (
          <Text dimColor>No text change</Text>
        ) : (
          <Code source={diff.text} format="diff" path={edit.path} />
        )}
        <Box gap={1}>
          <Button key="prev" label="Prev" hotkey="p" dimColor={i === 0} onPress={() => go(-1)} />
          <Button key="next" label="Next" hotkey="n" variant="primary" dimColor={i === list.length - 1} onPress={() => go(1)} />
          {close}
        </Box>
        <Text dimColor>Line numbers are relative to the change</Text>
        {hasShell && (
          <Text dimColor>Shell edits are not replayed</Text>
        )}
      </Box>
    )
  })
}
