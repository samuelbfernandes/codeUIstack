import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow } from '../types'
import {
  addStep,
  applyTaskTool,
  bandText,
  busyBar,
  countTool,
  elapsedOf,
  emptyBar,
  endByStatus,
  endTurn,
  fillBar,
  fmtCost,
  fmtDuration,
  fmtTokens,
  fromModelUsage,
  helperText,
  indentOf,
  isStalled,
  isTaskTool,
  markRunning,
  parseOverrides,
  rowCost,
  rowFill,
  rowHasUsage,
  rowUsage,
  stallMsOf,
  summarize,
  taskText,
  toolsText,
  totalTokens,
  touch,
  treeLines,
  treeOrder,
} from './lib'
import type { Price } from './lib'

const PANE = 'agents-info'
const COMMAND = 'agents-info'
const STORE_HIDDEN = 'hidden'
/** Running helpers the band lists under its line (the pane has them all). */
const BAND_ROWS = 3

const agents = atom({ plugin: 'savvy-progress', key: 'agents' } as const, [])
const isHidden = atom({ plugin: 'savvy-progress', key: 'isHidden' } as const, null)
const tasks = atom({ plugin: 'savvy-progress', key: 'tasks' } as const, [])
const tick = atom({ plugin: 'savvy-progress', key: 'tick' } as const, 0)

type Prices = readonly Price[]
type Timer = { cancel: () => void }

// The once-a-second timer lives and dies with this module instance: a hot
// reload drops the engine's timers too, and the next agent event restarts it.
let timer: Timer | null = null

/** Never let bookkeeping break a hook that other plugins and the engine depend on (fail-open). */
async function safely(work: () => Promise<unknown>) {
  try {
    await work()
  } catch {
    /* a missed update only costs a stale row */
  }
}

async function change($: EngineInterface, id: string, init: Partial<AgentRow>, fn: (r: AgentRow) => AgentRow) {
  const now = await $.clock.now()
  await update($, agents, rows => touch(rows, id, init, now, fn))
}

/** Mirrors the engine's own agent list into our rows: ends the ones it says ended, fills missing names. */
async function sync($: EngineInterface) {
  const [list, now] = await Promise.all([$.agent.list(), $.clock.now()])
  await update($, agents, rows =>
    rows.map(r => {
      const info = list.find(a => a.id === r.id)
      if (info === undefined) return r
      const labelled = r.label === '' ? { ...r, label: info.description || info.name || info.type, type: r.type || info.type } : r
      const named = r.parentId === undefined && info.parentId ? { ...labelled, parentId: info.parentId } : labelled
      if (info.status === 'completed') return endByStatus(named, true, now)
      if (info.status === 'failed' || info.status === 'killed') return endByStatus(named, false, now)
      return named
    }),
  )
}

async function onTick($: EngineInterface, stallMs: number) {
  await safely(() => sync($))
  await safely(() => noteStalls($, stallMs))
  const rows = await read($, agents)
  await update($, tick, n => (n ?? 0) + 1)
  if (!rows.some(r => r.status === 'running')) {
    timer?.cancel()
    timer = null
  }
}

function ensureTimer($: EngineInterface, stallMs: number) {
  timer ??= $.clock.every(1000, () => void onTick($, stallMs))
}

/** Says once, in a toast, that a running helper has gone quiet; the pane row shows it and keeps its Stop button. */
async function noteStalls($: EngineInterface, stallMs: number) {
  if (stallMs <= 0) return
  const now = await $.clock.now()
  const quiet = (await read($, agents)).filter(r => isStalled(r, now, stallMs) && r.stallNoted !== true)
  if (quiet.length === 0) return
  await update($, agents, rows => rows.map(r => (quiet.some(q => q.id === r.id) ? { ...r, stallNoted: true } : r)))
  for (const r of quiet) {
    $.ui.toast(`${r.label || r.id.slice(0, 8)} looks stalled · no activity for ${fmtDuration(now - (r.lastAt ?? r.startedAt))} · Stop it in the Subagents pane`, { timeoutMs: 10_000 })
  }
}

async function setHidden($: EngineInterface, hidden: boolean) {
  await update($, isHidden, () => hidden)
  await safely(() => $.store.set(STORE_HIDDEN, hidden))
}

async function readHidden($: EngineInterface): Promise<boolean> {
  return (await read($, isHidden)) ?? (await $.store.get(STORE_HIDDEN)) === true
}

async function describeAgent($: EngineInterface, id: string, model: string): Promise<Partial<AgentRow>> {
  try {
    const info = (await $.agent.list()).find(a => a.id === id)
    return { label: info?.description || info?.name || info?.type || '', type: info?.type ?? '', model, parentId: info?.parentId }
  } catch {
    return { model }
  }
}

const glyph = (r: AgentRow, stalled: boolean) => (stalled ? '⚠' : r.status === 'running' ? '▶' : r.status === 'finished' ? '✓' : '✗')
const statusColor = (r: AgentRow, stalled: boolean) => (stalled ? 'warning' : r.status === 'failed' ? 'error' : r.status === 'finished' ? 'success' : undefined)

/** "claude-sonnet-4-5-20250929" -> "sonnet-4-5". */
const shortModel = (model: string) => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')

function barFor(r: AgentRow, width: number, now: number): string {
  if (r.status === 'finished') return fillBar(1, width) // done: full, whatever the context fill was
  const fill = rowFill(r) // failed or stopped: where it stopped
  if (fill !== null) return fillBar(fill, width)
  if (r.status === 'running' && !rowHasUsage(r)) return busyBar(width, Math.floor(elapsedOf(r, now) / 1000))
  return emptyBar(width)
}

function figures(r: AgentRow, now: number, overrides: Prices): string {
  const time = `${fmtDuration(elapsedOf(r, now))} · ${toolsText(r)}`
  if (!rowHasUsage(r)) return `no usage reported · ${time}`
  const fill = rowFill(r)
  const ctx = fill === null ? 'ctx n/a' : `ctx ${Math.round(fill * 100)}%`
  const cost = rowCost(r, overrides)
  const u = rowUsage(r)
  return `${ctx} · ${fmtTokens(totalTokens(u))} tok (out ${fmtTokens(u.output)}) · ${cost === null ? 'est. n/a' : fmtCost(cost)} · ${time}`
}

/**
 * The Stop button: asks the engine's own TaskStop tool to end this helper (the same call the model would
 * make; the permission rules still apply). The row turns "failed" by itself once the engine reports it killed.
 */
async function stopAgent($: EngineInterface, id: string, name: string) {
  try {
    await $.tool.call({ tool: 'TaskStop', task_id: id } as never)
    $.ui.toast(`Stopped ${name}`)
    await safely(() => sync($))
  } catch {
    $.ui.toast(`Could not stop ${name} · try /tasks`)
  }
}

const AGENTS_INFO_FAILED = '/agents-info could not run; see the debug log.'

/** What `/agents-info` does: toggle the pane; `band` toggles the line above the prompt, `tree` lists the helpers as a tree. */
async function runAgentsInfo($: EngineInterface, args: string): Promise<string> {
  if (args.trim() === 'band') {
    const hidden = await readHidden($)
    await setHidden($, !hidden)
    return hidden ? 'Subagent band shown.' : 'Subagent band hidden. /agents-info band shows it again.'
  }
  if (args.trim() === 'tree') {
    const lines = treeLines(await read($, agents), await $.clock.now())
    return lines.length === 0 ? 'No subagents have run in this session.' : lines.join('\n')
  }
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return 'Subagent pane closed.'
  }
  await $.ui.open({ id: PANE, title: 'Subagents' })
  return 'Subagent pane opened (token counts are real, costs are est.).'
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
  const overrides: Prices = parseOverrides(options.priceOverrides)
  const stallMs = stallMsOf(options.stallMinutes)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide the pane listing every subagent with tokens and est. cost (`band` toggles the line above the prompt, `tree` prints them nested)',
      argumentHint: '[band|tree]',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await runAgentsInfo($, e.args) })).catch(
    // Fail-open: a failing toggle just says so; nothing else depends on this command.
    () => ({ text: AGENTS_INFO_FAILED }),
  )

  // A subagent is born: this is where its description, type and model are known.
  // Fail-open: if the bookkeeping throws, the spawn goes on untouched.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId !== undefined) {
      const id = started.agentId
      const init = {
        label: e.description || e.name || e.subagentType,
        type: e.isTeammate ? 'teammate' : e.subagentType,
        model: started.model || e.model || e.parentModel,
        // Who started it: spawn events carry the id of the loop they happened in (absent for the main loop).
        parentId: e.parentAgentId,
      }
      await safely(async () => {
        await change($, id, init, r => ({
          ...r,
          label: init.label || r.label,
          type: init.type || r.type,
          model: init.model || r.model,
          ...(init.parentId ? { parentId: init.parentId } : {}),
        }))
        ensureTimer($, stallMs)
      })
    }
    return started
  }).catch(($, e, next) => next(e))

  // Every model request of a subagent: tokens arrive in the step's result.
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id === undefined) return yield* next(e)

    await safely(async () => {
      const now = await $.clock.now()
      const known = (await read($, agents)).some(r => r.id === id)
      const init: Partial<AgentRow> = known ? {} : await describeAgent($, id, e.model)
      await update($, agents, rows => touch(rows, id, init, now, r => markRunning(r.model === '' ? { ...r, model: e.model } : r, now)))
      ensureTimer($, stallMs)
    })

    const response = yield* next(e)

    const usage = response.usage
    if (usage !== null) {
      await safely(() => change($, id, {}, r => addStep(r, e.turnId, fromModelUsage(usage), usage.model)))
    }
    return response
  })

  // Tool counts per helper and Claude's own task list, both read from tool.call events after the tool ran.
  // A helper's tool call (agentId set) only bumps its counter; the main loop's task tools update the task bar.
  // Fail-open: it observes only, never refuses; all bookkeeping is in `safely`, so only a failing `next` can
  // throw, and then the handler replays what next settled to (nothing runs twice).
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    await safely(async () => {
      if (e.agentId !== undefined) {
        const id = e.agentId
        const at = await $.clock.now()
        await update($, agents, rows => countTool(rows, id, at))
      } else if (isTaskTool(e.tool)) {
        const result = (ran as { result?: unknown }).result
        await update($, tasks, items => applyTaskTool(items ?? [], e.tool, e, result))
      }
    })
    return ran
  }).catch(($, e, next) => next(e))

  // The subagent's run ended; its usage is the turn's total, replacing the steps' sum.
  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      await safely(async () => {
        const now = await $.clock.now()
        const total = e.usage === undefined ? null : fromModelUsage(e.usage)
        const model = e.usage?.model ?? ''
        await update($, agents, rows =>
          touch(rows, id, {}, now, r => ({ ...endTurn(r, e.reason === 'answer', e.durationMs, total, now), model: model || r.model })),
        )
      })
    }
    return next(e)
  })

  // --- the band above the prompt ------------------------------------------
  // Idle (nothing running): ONE line, e.g. "◈ ▰▰▰▱▱ 3/5 tasks · helpers: 3 done · 41.2k tok · est. $0.38 · 1m12s".
  // While helpers run: the same line, a progress row (helpers and tasks) and up to three running helpers.

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rows = await read($, agents)
    const todo = await read($, tasks)
    const hidden = await readHidden($)
    if (e.props.hasSurvey || hidden || (rows.length === 0 && todo.length === 0)) return next(e)

    await read($, tick)
    const now = await $.clock.now()
    const summary = summarize(rows, now, overrides)
    const isBusy = summary.running > 0
    const taskLine = taskText(todo)
    const tasksDone = todo.length > 0 && todo.every(t => t.status === 'completed')
    const { Box, Button, Text } = $.ui.resolve(e)

    const line = (
      <Box key={isBusy ? 'savvy-line' : 'savvy-band'}>
        <Text dimColor>◈ </Text>
        {!isBusy && taskLine !== '' && <Text color={tasksDone ? 'success' : undefined}>{taskLine} </Text>}
        {!isBusy && taskLine !== '' && rows.length > 0 && <Text dimColor>· </Text>}
        {rows.length > 0 && <Text color={summary.failed > 0 ? 'warning' : undefined}>{bandText(summary)} </Text>}
        {rows.length > 0 && (
          <Button key="details" plain onPress={() => void $.ui.open({ id: PANE, title: 'Subagents' })}>
            [details]
          </Button>
        )}
        <Text> </Text>
        <Button
          key="hide"
          plain
          onPress={async () => {
            await setHidden($, true)
            $.ui.toast('Subagent band hidden. /agents-info band shows it again.')
          }}
        >
          [hide]
        </Button>
      </Box>
    )
    const below = await drawnBelow(next, e)
    const under = below === undefined ? null : (below as never)
    if (!isBusy) return under === null ? line : <Box key="savvy-stack" flexDirection="column">{line}{under}</Box>

    const live = treeOrder(rows).filter(t => t.row.status === 'running')
    return (
      <Box key="savvy-band" flexDirection="column">
        {line}
        <Box key="savvy-progress">
          <Text>{'  '}{helperText(summary)}</Text>
          {taskLine !== '' && <Text dimColor>{'  ·  '}</Text>}
          {taskLine !== '' && <Text color={tasksDone ? 'success' : undefined}>{taskLine}</Text>}
        </Box>
        {live.slice(0, BAND_ROWS).map(({ row, depth }) => (
          <Text key={`live:${row.id}`} dimColor>
            {'  '}{indentOf(depth)}▶ {row.label || row.id.slice(0, 8)} · {fmtDuration(elapsedOf(row, now))} · {toolsText(row)}
          </Text>
        ))}
        {live.length > BAND_ROWS && <Text dimColor>{'  '}+{live.length - BAND_ROWS} more running</Text>}
        {under}
      </Box>
    )
  })

  // --- the pane ------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const rows = await read($, agents)
    const todo = await read($, tasks)
    await read($, tick)
    const now = await $.clock.now()
    const { Box, Text, Button } = $.ui.resolve(e)
    const summary = summarize(rows, now, overrides)
    const width = Math.max(6, Math.min(14, Math.floor((e.props.bodyColumns ?? 60) / 5)))
    const room = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 6) / 2))
    // A helper started by another helper sits under it; the main loop's helpers are the roots.
    const shown = treeOrder(rows)

    if (rows.length === 0 && todo.length === 0) return <Text dimColor>No subagents have run in this session.</Text>

    return (
      <Box flexDirection="column">
        {todo.length > 0 && <Text key="tasks">{taskText(todo)}</Text>}
        {rows.length === 0 && <Text dimColor>No subagents have run in this session.</Text>}
        {rows.length > 0 && (
          <Text bold key="summary">
            {summary.count} helper{summary.count === 1 ? '' : 's'} ({summary.running} running) · {fmtTokens(summary.tokens)} tok ·{' '}
            {summary.tokens === 0 ? 'no usage yet' : fmtCost(summary.cost, summary.unpriced > 0)} · {fmtDuration(summary.elapsedMs)}
          </Text>
        )}
        {shown.slice(0, room).map(({ row: r, depth }) => {
          const stalled = isStalled(r, now, stallMs)
          return (
          <Box key={`row:${r.id}`} flexDirection="column">
            <Box>
              <Text color={statusColor(r, stalled)}>
                {indentOf(depth)}
                {glyph(r, stalled)} {r.label || r.id.slice(0, 8)} <Text dimColor>({[r.type, shortModel(r.model)].filter(Boolean).join(', ')}) {stalled ? `stalled · no activity for ${fmtDuration(now - (r.lastAt ?? r.startedAt))}` : r.status}</Text>
              </Text>
              {r.status === 'running' && (
                <Button key={`stop:${r.id}`} label="Stop" variant="secondary" onPress={() => void stopAgent($, r.id, r.label || r.id.slice(0, 8))} />
              )}
            </Box>
            <Text dimColor={!rowHasUsage(r)}>
              {'  '}
              {depth > 0 ? '  '.repeat(Math.min(depth, 4)) : ''}
              {barFor(r, width, now)} {figures(r, now, overrides)}
            </Text>
          </Box>
          )
        })}
        {shown.length > room && <Text dimColor>+{shown.length - room} more (older)</Text>}
        {rows.length > 0 && <Text dimColor>est. = token counts x built-in price table; context bar = latest request vs an assumed window.</Text>}
      </Box>
    )
  })
}
