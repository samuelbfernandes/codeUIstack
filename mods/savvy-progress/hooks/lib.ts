import type { AgentRow, TaskItem, TaskStatus, Usage } from '../types'

// ---------------------------------------------------------------------------
// Prices: the ONE place cost numbers live. USD per million tokens.
// Matched as a substring of the lower-cased model id, first hit wins, so the
// specific (older, dearer) entries come before the family fallbacks. These are
// list prices as I know them; new models fall into their family's row. The
// result is always shown as "est.", and userConfig `priceOverrides` wins.
// ---------------------------------------------------------------------------
export type Price = { match: readonly string[]; in: number; out: number; cacheRead: number; cacheWrite: number }

export const PRICES: readonly Price[] = [
  { match: ['opus-4-1', 'opus-4-0', 'opus-4-2025', '3-opus', 'opus-3'], in: 15, out: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  { match: ['opus'], in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  { match: ['sonnet'], in: 3, out: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  { match: ['3-haiku', 'haiku-3-2'], in: 0.25, out: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
  { match: ['3-5-haiku', 'haiku-3-5'], in: 0.8, out: 4, cacheRead: 0.08, cacheWrite: 1 },
  { match: ['haiku'], in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
]

/** Context window assumed per model; the API does not report it per agent. */
export const DEFAULT_WINDOW = 200_000
export const LONG_WINDOW = 1_000_000

const MAX_ROWS = 60

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  }
}

/** The engine's ModelUsage (API spelling) as this mod's Usage. */
export function fromModelUsage(u: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}): Usage {
  return {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens,
    cacheWrite: u.cache_creation_input_tokens,
  }
}

export const totalTokens = (u: Usage): number => u.input + u.output + u.cacheRead + u.cacheWrite
const hasUsage = (u: Usage): boolean => totalTokens(u) > 0

// --- price overrides -------------------------------------------------------

/** "sonnet=3/15, opus=5/25/0.5/6.25" -> table rows; malformed entries are skipped. */
export function parseOverrides(text: unknown): Price[] {
  if (typeof text !== 'string') return []
  const out: Price[] = []
  for (const part of text.split(',')) {
    const [name, nums] = part.split('=')
    const key = name?.trim().toLowerCase()
    const n = (nums ?? '').split('/').map(s => Number(s.trim()))
    const [inp, outp] = n
    if (!key || n.some(x => !Number.isFinite(x) || x < 0) || inp === undefined || outp === undefined) continue
    out.push({ match: [key], in: inp, out: outp, cacheRead: n[2] ?? inp * 0.1, cacheWrite: n[3] ?? inp * 1.25 })
  }
  return out
}

export function priceFor(model: string, overrides: readonly Price[] = []): Price | null {
  const id = model.toLowerCase()
  if (id === '') return null
  const hit = (p: Price) => p.match.some(m => id.includes(m))
  return overrides.find(hit) ?? PRICES.find(hit) ?? null
}

export function costOf(u: Usage, p: Price): number {
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6
}

// --- per-row figures -------------------------------------------------------

export const rowUsage = (r: AgentRow): Usage => addUsage(r.done, r.cur)

/** Estimated USD, or null when the agent reported no usage or its model has no price. */
export function rowCost(r: AgentRow, overrides: readonly Price[]): number | null {
  const u = rowUsage(r)
  const price = priceFor(r.model, overrides)
  return hasUsage(u) && price !== null ? costOf(u, price) : null
}

export const rowHasUsage = (r: AgentRow): boolean => hasUsage(rowUsage(r))

export function contextWindow(model: string): number {
  return /\[1m\]|-1m\b/i.test(model) ? LONG_WINDOW : DEFAULT_WINDOW
}

/** Context fill 0..1 from the latest request, or null when nothing was reported. */
export function rowFill(r: AgentRow): number | null {
  return r.fill === null ? null : Math.min(1, r.fill / contextWindow(r.model))
}

export function elapsedOf(r: AgentRow, now: number): number {
  return r.busyMs + (r.since === null ? 0 : Math.max(0, now - r.since))
}

// --- summary ---------------------------------------------------------------

export type Summary = {
  count: number
  running: number
  finished: number
  failed: number
  tokens: number
  cost: number
  /** Agents with tokens but no price: the cost is then a lower bound. */
  unpriced: number
  elapsedMs: number
}

export function summarize(rows: readonly AgentRow[], now: number, overrides: readonly Price[]): Summary {
  let cost = 0
  let unpriced = 0
  let tokens = 0
  for (const r of rows) {
    tokens += totalTokens(rowUsage(r))
    const c = rowCost(r, overrides)
    if (c !== null) cost += c
    else if (rowHasUsage(r)) unpriced += 1
  }
  const running = rows.filter(r => r.status === 'running').length
  const first = Math.min(...rows.map(r => r.startedAt))
  const last = running > 0 ? now : Math.max(...rows.map(r => r.endedAt ?? now))
  return {
    count: rows.length,
    running,
    finished: rows.filter(r => r.status === 'finished').length,
    failed: rows.filter(r => r.status === 'failed').length,
    tokens,
    cost,
    unpriced,
    elapsedMs: rows.length === 0 ? 0 : Math.max(0, last - first),
  }
}

// --- formatting ------------------------------------------------------------

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1).replace(/\.?0+$/, '')}k`
  return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
}

export function fmtCost(usd: number, isLowerBound = false): string {
  const body = usd > 0 && usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)
  return `est. $${body}${isLowerBound ? '+' : ''}`
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

/** The band's one line, e.g. "helpers: 2 running, 3 done · 41.2k tok · est. $0.38 · 1m12s". */
export function bandText(s: Summary): string {
  const parts = [
    s.running > 0 ? `${s.running} running` : '',
    s.finished > 0 ? `${s.finished} done` : '',
    s.failed > 0 ? `${s.failed} failed` : '',
  ].filter(Boolean)
  const cost = s.tokens === 0 ? 'no usage yet' : s.cost === 0 && s.unpriced > 0 ? 'est. n/a' : fmtCost(s.cost, s.unpriced > 0)
  return `helpers: ${parts.join(', ')} · ${fmtTokens(s.tokens)} tok · ${cost} · ${fmtDuration(s.elapsedMs)}`
}

/** A filled bar for a known context fill. */
export function fillBar(fill: number, width: number): string {
  const n = Math.round(Math.max(0, Math.min(1, fill)) * width)
  return '█'.repeat(n) + '░'.repeat(width - n)
}

/** A moving block for an agent whose fill is unknown; `seconds` is its elapsed time. */
export function busyBar(width: number, seconds: number): string {
  const block = Math.min(3, width)
  const span = Math.max(1, width - block)
  const at = seconds % (2 * span)
  const start = at <= span ? at : 2 * span - at
  return '░'.repeat(start) + '▓'.repeat(block) + '░'.repeat(width - block - start)
}

export function emptyBar(width: number): string {
  return '░'.repeat(width)
}

// --- row updates (pure: $.state's update may run them twice) ---------------

export function newRow(id: string, init: Partial<AgentRow>, now: number): AgentRow {
  return {
    id,
    label: init.label ?? '',
    type: init.type ?? '',
    model: init.model ?? '',
    status: 'running',
    startedAt: now,
    endedAt: null,
    busyMs: 0,
    since: now,
    done: emptyUsage(),
    cur: emptyUsage(),
    curTurn: '',
    fill: null,
    steps: 0,
    ...(init.parentId ? { parentId: init.parentId } : {}),
    tools: 0,
    lastAt: now,
  }
}

/** Counts one tool call of the agent's own loop. Unknown agents are not created here (forks carry ids no list names). */
export function countTool(rows: readonly AgentRow[], id: string, now: number): AgentRow[] {
  return rows.map(r => (r.id === id ? { ...r, tools: (r.tools ?? 0) + 1, lastAt: now, stallNoted: false } : r))
}

/** How long a running helper may say nothing before it counts as stalled (the `stallMinutes` setting; 0 turns it off). */
export const DEFAULT_STALL_MINUTES = 5

export function stallMsOf(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_STALL_MINUTES
  return Math.min(24 * 60, Math.max(0, n)) * 60_000
}

/** A running helper that has reported nothing for `stallMs` (0 = never). The engine's own status is not consulted: this is only silence. */
export function isStalled(r: AgentRow, now: number, stallMs: number): boolean {
  return stallMs > 0 && r.status === 'running' && now - (r.lastAt ?? r.startedAt) >= stallMs
}

/** Applies `fn` to the row `id`, creating it from `init` first when unknown; drops old rows past the cap. */
export function touch(
  rows: readonly AgentRow[],
  id: string,
  init: Partial<AgentRow>,
  now: number,
  fn: (r: AgentRow) => AgentRow,
): AgentRow[] {
  const found = rows.some(r => r.id === id)
  const stamp = (r: AgentRow): AgentRow => ({ ...r, lastAt: now, stallNoted: false })
  const next = found ? rows.map(r => (r.id === id ? stamp(fn(r)) : r)) : [...rows, stamp(fn(newRow(id, init, now)))]
  if (next.length <= MAX_ROWS) return next
  const drop = next.findIndex(r => r.status !== 'running' && r.id !== id)
  return drop < 0 ? next : next.filter((_, i) => i !== drop)
}

/** The agent is (again) working: a new turn started or its first request went out. */
export function markRunning(r: AgentRow, now: number): AgentRow {
  return r.status === 'running' && r.since !== null ? r : { ...r, status: 'running', since: now, endedAt: null }
}

/** One finished request: its tokens join the running turn, its input side is the context in use. */
export function addStep(r: AgentRow, turnId: string, usage: Usage, model: string): AgentRow {
  const carried = r.curTurn === turnId || r.curTurn === '' ? r : { ...r, done: addUsage(r.done, r.cur), cur: emptyUsage() }
  return {
    ...carried,
    curTurn: turnId,
    cur: addUsage(carried.cur, usage),
    fill: usage.input + usage.cacheRead + usage.cacheWrite,
    steps: carried.steps + 1,
    model: model || carried.model,
  }
}

/** A turn ended. The turn's own total (when given) replaces the steps' sum, so nothing counts twice. */
export function endTurn(r: AgentRow, ok: boolean, durationMs: number, total: Usage | null, now: number): AgentRow {
  return {
    ...r,
    status: ok ? 'finished' : 'failed',
    done: addUsage(r.done, total ?? r.cur),
    cur: emptyUsage(),
    curTurn: '',
    busyMs: r.busyMs + durationMs,
    since: null,
    endedAt: now,
  }
}

/** The engine says the agent ended without a turn.complete we saw (killed, failed). */
export function endByStatus(r: AgentRow, ok: boolean, now: number): AgentRow {
  if (r.status !== 'running') return r
  return { ...r, status: ok ? 'finished' : 'failed', busyMs: elapsedOf(r, now), since: null, endedAt: now }
}

// --- progress bars -----------------------------------------------------------

/** "▰▰▰▱▱" for done/total; one cell per item up to 10 cells, so 3/5 reads as three of five. */
export function progressBar(done: number, total: number): string {
  const width = Math.max(1, Math.min(10, total))
  const n = total <= 0 ? 0 : Math.round((Math.min(done, total) / total) * width)
  return '▰'.repeat(n) + '▱'.repeat(width - n)
}

export function taskCounts(items: readonly TaskItem[]): { done: number; total: number; active: number } {
  return {
    done: items.filter(t => t.status === 'completed').length,
    total: items.length,
    active: items.filter(t => t.status === 'in_progress').length,
  }
}

/** "▰▰▰▱▱ 3/5 tasks", or '' when Claude has no task list. */
export function taskText(items: readonly TaskItem[]): string {
  const { done, total } = taskCounts(items)
  return total === 0 ? '' : `${progressBar(done, total)} ${done}/${total} tasks`
}

/** "▰▱▱ 1/3 helpers": helpers that ended (done or failed) of all seen. */
export function helperText(s: Summary): string {
  return `${progressBar(s.finished + s.failed, s.count)} ${s.finished + s.failed}/${s.count} helpers`
}

// --- Claude's task list, from its task tools ---------------------------------
// Sources (all main-loop tool.call events): TodoWrite carries the whole list (result.newTodos); TaskCreate's
// result gives the new id; TaskUpdate's input gives id + new status; TaskList's result is a full snapshot.
// Inputs are read defensively: a shape this does not know leaves the list as it was.

const MAX_TASKS = 200
const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const asStatus = (v: unknown): TaskStatus | undefined => (typeof v === 'string' && STATUSES.includes(v) ? (v as TaskStatus) : undefined)
const asText = (v: unknown): string => (typeof v === 'string' ? v : '')

/** True for the tools applyTaskTool understands. */
export const isTaskTool = (tool: string): boolean => /^(TodoWrite|TaskCreate|TaskUpdate|TaskList)$/.test(tool)

export function applyTaskTool(items: readonly TaskItem[], tool: string, input: unknown, result: unknown): TaskItem[] {
  const inp = isRecord(input) ? input : {}
  const res = isRecord(result) ? result : {}
  const cap = (list: TaskItem[]) => list.slice(-MAX_TASKS)

  if (tool === 'TodoWrite') {
    const list = Array.isArray(res.newTodos) ? res.newTodos : inp.todos
    if (!Array.isArray(list)) return [...items]
    return cap(
      list.flatMap((t, i): TaskItem[] => {
        const status = isRecord(t) ? asStatus(t.status) : undefined
        return isRecord(t) && status !== undefined ? [{ id: `todo:${i}`, subject: asText(t.content), status }] : []
      }),
    )
  }

  if (tool === 'TaskList') {
    if (!Array.isArray(res.tasks)) return [...items]
    return cap(
      res.tasks.flatMap((t): TaskItem[] => {
        const status = isRecord(t) ? asStatus(t.status) : undefined
        return isRecord(t) && typeof t.id === 'string' && status !== undefined ? [{ id: t.id, subject: asText(t.subject), status }] : []
      }),
    )
  }

  if (tool === 'TaskCreate') {
    const task = isRecord(res.task) ? res.task : undefined
    if (task === undefined || typeof task.id !== 'string' || items.some(t => t.id === task.id)) return [...items]
    return cap([...items, { id: task.id, subject: asText(task.subject) || asText(inp.subject), status: 'pending' }])
  }

  if (tool === 'TaskUpdate') {
    const id = typeof inp.taskId === 'string' ? inp.taskId : ''
    if (id === '' || res.success === false) return [...items]
    if (inp.status === 'deleted') return items.filter(t => t.id !== id)
    const status = asStatus(inp.status)
    const subject = asText(inp.subject)
    if (!items.some(t => t.id === id)) {
      // A task made before this mod was watching: count it, so the total stays right.
      return status === undefined ? [...items] : cap([...items, { id, subject: subject || `task ${id}`, status }])
    }
    return items.map(t => (t.id === id ? { ...t, status: status ?? t.status, subject: subject || t.subject } : t))
  }

  return [...items]
}

// --- subagent tree -------------------------------------------------------------

export type TreeRow = { row: AgentRow; depth: number }

/**
 * Rows as a tree: an agent started by another agent sits right under its parent (`parentId`, from agent.spawn's
 * parentAgentId or the engine's agent list). Roots are the agents the main loop started or whose parent is not
 * tracked: running first, then newest; children keep start order. Safe against a parent loop.
 */
export function treeOrder(rows: readonly AgentRow[]): TreeRow[] {
  const known = new Set(rows.map(r => r.id))
  const kids = (id: string) => rows.filter(r => r.parentId === id && r.id !== id).sort((a, b) => a.startedAt - b.startedAt)
  const roots = rows
    .filter(r => r.parentId === undefined || !known.has(r.parentId) || r.parentId === r.id)
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt)
  const out: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (row: AgentRow, depth: number) => {
    if (seen.has(row.id)) return
    seen.add(row.id)
    out.push({ row, depth })
    for (const child of kids(row.id)) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  // Agents that only point at each other (a loop) have no root: list them flat rather than lose them.
  for (const r of rows) walk(r, 0)
  return out
}

/** The tree marker: nothing for a root, an indented "└ " for a nested agent (capped so a deep tree stays narrow). */
export const indentOf = (depth: number): string => (depth === 0 ? '' : `${'  '.repeat(Math.min(depth, 4) - 1)}└ `)

export const toolsText = (r: AgentRow): string => `${r.tools ?? 0} tool${(r.tools ?? 0) === 1 ? '' : 's'}`

/** One line per agent for `/agents-info tree`: marker, status glyph, name, elapsed, tool count. */
export function treeLines(rows: readonly AgentRow[], now: number): string[] {
  return treeOrder(rows).map(({ row, depth }) => {
    const glyph = row.status === 'running' ? '▶' : row.status === 'finished' ? '✓' : '✗'
    return `${indentOf(depth)}${glyph} ${row.label || row.id.slice(0, 8)} · ${row.status} · ${fmtDuration(elapsedOf(row, now))} · ${toolsText(row)}`
  })
}
