// The Session box: pure builders from plain data to rows of coloured parts, and the two layouts. No engine access, so every
// figure the engine does not give is simply a missing field here and its row, or part, is not drawn (never a zero).
import { PACE_MIN_PERCENT, WINDOW_MS, fmtDuration, fmtTokens, paceOf, parseTime } from './pace'
import type { Pace } from './pace'
import { isDirty } from './gitinfo'
import type { GitInfo } from './gitinfo'

export type RowId = 'model' | 'mode' | 'context' | 'usage' | 'cost' | 'cache' | 'git' | 'backup' | 'tokens' | 'activity' | 'environment'
export const ROW_IDS: readonly RowId[] = ['model', 'mode', 'context', 'usage', 'cost', 'cache', 'git', 'backup', 'tokens', 'activity', 'environment']
export const DEFAULT_ROWS = ROW_IDS.join(',')
export type Layout = 'expanded' | 'compact'

/** A coloured piece of a line; colours are theme keys (`success`, `warning`, `error`, `inactive`). */
export type Part = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Row = { id: RowId; parts: Part[]; /** Own lines under the row, in both layouts. */ extra?: Part[][] }

export type ToolRun = { id: string; name: string; target?: string; state: 'running' | 'done' | 'error' }
export type Activity = { runs: ToolRun[]; skills: string[]; mcp: Record<string, number>; compactions: number }
export const EMPTY_ACTIVITY: Activity = { runs: [], skills: [], mcp: {}, compactions: 0 }
export type TokenTotals = { input: number; output: number; cacheRead: number; cacheWrite: number; tokensPerSecond?: number }
export type EnvCounts = { claudeMd?: number; rules?: number; mcp?: number; hooks?: number; plugins?: number }

export type Snapshot = {
  now: number
  model?: string
  provider?: string
  effort?: string | number
  /** suggest-model's advice when the effort level does not fit the last task (`medium would do`), else absent. */
  effortAdvice?: string
  /** The configured permission mode (`default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`). */
  permissionMode?: string
  /** When the newest commit or checkpoint was made (ms); null = none; absent = not read. */
  backupAt?: number | null
  startedAt?: number
  context?: { tokens?: number; window?: number; percent?: number }
  /** The biggest categories of the window, only held while it is nearly full. */
  breakdown?: { name: string; tokens: number }[]
  rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: number
  ledger?: { today?: number; week?: number | null }
  cache?: { expiresAt?: number | null; hitRate?: number | null }
  git?: GitInfo | null
  tokens?: TokenTotals | null
  activity?: Activity | null
  env?: EnvCounts | null
}

export type BoxSettings = { sevenDayAt: number; toolsMaxVisible: number; pushWarn: number; envThreshold: number; width: number }
export const DEFAULT_BOX: BoxSettings = { sevenDayAt: 80, toolsMaxVisible: 4, pushWarn: 5, envThreshold: 0, width: 34 }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const sep = (text = ' · '): Part => ({ text, dim: true })

/** Context and usage colours: green below 70%, yellow from 70%, red from 85%. */
export const levelColor = (percent: number): string => (percent >= 85 ? 'error' : percent >= 70 ? 'warning' : 'success')

export function bar(percent: number, width: number): string {
  const w = Math.max(1, Math.floor(width))
  const p = Math.max(0, Math.min(100, percent))
  let filled = Math.round((p / 100) * w)
  if (p > 0 && filled === 0) filled = 1
  return '▰'.repeat(filled) + '▱'.repeat(w - filled)
}

const dollars = (usd: number): string => `$${usd.toFixed(2)}`
const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The cloud or gateway the model is reached through, from the documented environment: undefined for the default API. */
export function providerOf(i: { bedrock?: string; vertex?: string; foundry?: string; baseUrl?: string }): string | undefined {
  const on = (v: string | undefined) => v !== undefined && v.trim() !== '' && !/^(0|false|no|off)$/i.test(v.trim())
  if (on(i.bedrock)) return 'Bedrock'
  if (on(i.vertex)) return 'Vertex'
  if (on(i.foundry)) return 'Foundry'
  const url = i.baseUrl?.trim()
  if (!url) return undefined
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    host = url.replace(/^[a-z]+:\/\//i, '').split('/')[0] ?? ''
  }
  return host === '' || host === 'api.anthropic.com' ? undefined : host
}

/** The last few tool calls as groups: finished calls of one tool merge (`Read ×3`), a running call keeps its own group and target. */
export function groupRuns(runs: readonly ToolRun[], max: number): { state: ToolRun['state']; name: string; count: number; target?: string }[] {
  const groups: { state: ToolRun['state']; name: string; count: number; target?: string }[] = []
  for (const r of runs) {
    if (r.state !== 'running') {
      const at = groups.findIndex(g => g.state === r.state && g.name === r.name)
      if (at !== -1) {
        const [g] = groups.splice(at, 1)
        groups.push({ ...g!, count: g!.count + 1 })
        continue
      }
    }
    groups.push({ state: r.state, name: r.name, count: 1, target: r.target })
  }
  return groups.slice(-Math.max(1, max))
}

const RUN_MARK: Record<ToolRun['state'], { icon: string; color: string }> = {
  done: { icon: '✓', color: 'success' },
  error: { icon: '✗', color: 'error' },
  running: { icon: '◐', color: 'warning' },
}

function modelRow(s: Snapshot): Row | undefined {
  const parts: Part[] = []
  if (s.model) parts.push({ text: s.model, bold: true })
  if (s.provider) parts.push(sep(), { text: s.provider, dim: true })
  if (s.effort !== undefined && s.effort !== '') parts.push(sep(), { text: String(s.effort), dim: s.effortAdvice === undefined, color: s.effortAdvice === undefined ? undefined : 'warning' })
  if (s.effortAdvice) parts.push({ text: ` ⚠ ${s.effortAdvice}`, color: 'warning' })
  if (isNum(s.startedAt) && s.now >= s.startedAt) parts.push(...(parts.length > 0 ? [sep()] : []), { text: fmtDuration(s.now - s.startedAt), dim: true })
  return parts.length > 0 ? { id: 'model', parts } : undefined
}

const MODE_LABEL: Record<string, { text: string; color?: string; dim?: boolean }> = {
  default: { text: 'asks before edits', dim: true },
  acceptEdits: { text: 'accepts edits', color: 'warning' },
  plan: { text: 'plan mode', color: 'success' },
  auto: { text: 'auto mode', color: 'success' },
  dontAsk: { text: 'denies unless allowed', color: 'warning' },
  bypassPermissions: { text: 'permissions bypassed !', color: 'error' },
}

/** The permission mode in plain words; red for bypass, since nothing then asks before a command runs. */
function modeRow(s: Snapshot): Row | undefined {
  if (!s.permissionMode) return undefined
  const m = MODE_LABEL[s.permissionMode] ?? { text: s.permissionMode, dim: true }
  return { id: 'mode', parts: [{ text: 'Mode ', dim: true }, { text: m.text, color: m.color, dim: m.dim }] }
}

export const BACKUP_WARN_MS = 2 * 60 * 60_000
export const BACKUP_ERROR_MS = 8 * 60 * 60_000

/** Time since the newest commit or checkpoint; amber once files are unsaved for 2 hours, red from 8 (rewind covers only Claude's own edits). */
function backupRow(s: Snapshot): Row | undefined {
  const g = s.git
  if (!g || s.backupAt === undefined) return undefined
  const unsaved = g.modified + g.added + g.deleted + g.untracked
  if (s.backupAt === null) return unsaved > 0 ? { id: 'backup', parts: [{ text: 'Backup ', dim: true }, { text: `none · ${unsaved} unsaved`, color: 'warning' }] } : undefined
  const age = Math.max(0, s.now - s.backupAt)
  const color = unsaved === 0 ? 'success' : age >= BACKUP_ERROR_MS ? 'error' : age >= BACKUP_WARN_MS ? 'warning' : 'success'
  const parts: Part[] = [{ text: 'Backup ', dim: true }, { text: age < 60_000 ? 'just now' : `${fmtDuration(age)} ago`, color }]
  if (unsaved > 0) parts.push({ text: ` · ${unsaved} unsaved`, color: color === 'success' ? undefined : color, dim: color === 'success' })
  return { id: 'backup', parts }
}

function contextRow(s: Snapshot, o: BoxSettings): Row | undefined {
  const c = s.context
  if (!c) return undefined
  const percent = isNum(c.percent) ? c.percent : isNum(c.tokens) && isNum(c.window) && c.window > 0 ? Math.round((c.tokens / c.window) * 100) : undefined
  if (percent === undefined) return undefined
  const color = levelColor(percent)
  const amount = isNum(c.tokens) && isNum(c.window) ? ` ${fmtTokens(c.tokens)}/${fmtTokens(c.window)}` : ''
  const label = 'Context '
  const tail = ` ${Math.round(percent)}%${amount}`
  const parts: Part[] = [{ text: label, dim: true }, { text: bar(percent, Math.max(4, Math.min(10, o.width - label.length - tail.length))), color }, { text: tail, color }]
  const row: Row = { id: 'context', parts }
  if (percent >= 85 && s.breakdown && s.breakdown.length > 0) {
    row.extra = [[{ text: s.breakdown.map(b => `${b.name} ${fmtTokens(b.tokens)}`).join(' · '), dim: true }]]
  }
  return row
}

const WINDOW_LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
const worse = (a: string, b: string): string => (a === 'error' || b === 'error' ? 'error' : a === 'warning' || b === 'warning' ? 'warning' : a)

function usageRow(s: Snapshot, o: BoxSettings): Row | undefined {
  const lines: Part[][] = []
  for (const w of s.rateLimits ?? []) {
    if (!isNum(w.percentUsed)) continue
    if (w.kind === 'seven_day' && w.percentUsed < o.sevenDayAt) continue
    const label = `${WINDOW_LABEL[w.kind] ?? w.kind} `
    const resetsAt = parseTime(w.resetsAt)
    const pace: Pace = paceOf(w.percentUsed, resetsAt, s.now, WINDOW_MS[w.kind])
    const base = w.percentUsed < PACE_MIN_PERCENT ? 'success' : levelColor(w.percentUsed)
    const color = pace === 'red' ? worse(base, 'error') : pace === 'amber' ? worse(base, 'warning') : base
    const marker = pace === 'neutral' ? '' : ' ▲'
    const reset = resetsAt !== undefined && resetsAt > s.now ? ` · resets in ${fmtDuration(Math.ceil((resetsAt - s.now) / 60_000) * 60_000)}` : ''
    const tail = ` ${Math.round(w.percentUsed)}%${marker}`
    const width = Math.max(4, Math.min(10, o.width - label.length - tail.length - reset.length))
    lines.push([{ text: label, dim: true }, { text: bar(w.percentUsed, width), color }, { text: tail, color }, ...(reset ? [{ text: reset, dim: true }] : [])])
  }
  if (lines.length === 0) return undefined
  return { id: 'usage', parts: lines[0]!, extra: lines.slice(1) }
}

function costRow(s: Snapshot): Row | undefined {
  const parts: Part[] = []
  if (isNum(s.cost)) parts.push({ text: dollars(s.cost), bold: true })
  if (isNum(s.ledger?.today)) parts.push(...(parts.length > 0 ? [sep()] : []), { text: `Today ${dollars(s.ledger.today)}`, dim: true })
  if (isNum(s.ledger?.week)) parts.push(...(parts.length > 0 ? [sep()] : []), { text: `Week ${dollars(s.ledger.week)}`, dim: true })
  return parts.length > 0 ? { id: 'cost', parts } : undefined
}

function cacheRow(s: Snapshot): Row | undefined {
  const c = s.cache
  if (!c) return undefined
  const parts: Part[] = []
  if (isNum(c.expiresAt)) parts.push(c.expiresAt <= s.now ? { text: 'Cache expired', color: 'warning' } : { text: `Cache until ${clock(c.expiresAt)}`, color: 'success' })
  if (isNum(c.hitRate)) {
    const pct = Math.round(c.hitRate <= 1 ? c.hitRate * 100 : c.hitRate)
    parts.push(...(parts.length > 0 ? [sep()] : []), { text: `hit ${pct}%`, color: pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'error' })
  }
  return parts.length > 0 ? { id: 'cache', parts } : undefined
}

function gitRow(s: Snapshot, o: BoxSettings): Row | undefined {
  const g = s.git
  if (!g) return undefined
  const dirty = isDirty(g)
  const parts: Part[] = [{ text: `${g.branch}${dirty ? '*' : ''}`, bold: true, color: dirty ? 'warning' : 'success' }]
  if (g.ahead > 0) parts.push({ text: ` ↑${g.ahead}`, color: g.ahead >= o.pushWarn ? 'warning' : undefined })
  if (g.behind > 0) parts.push({ text: ` ↓${g.behind}` })
  if (dirty) parts.push({ text: ` !${g.modified} +${g.added} ✘${g.deleted} ?${g.untracked}`, dim: true })
  if (g.worktree) parts.push({ text: ` ⎇ ${g.worktree}`, dim: true })
  return { id: 'git', parts }
}

function tokensRow(s: Snapshot): Row | undefined {
  const t = s.tokens
  if (!t) return undefined
  const fields = [`in ${fmtTokens(t.input)}`, `out ${fmtTokens(t.output)}`, `cache ${fmtTokens(t.cacheRead)}`]
  const parts: Part[] = [{ text: fields.join(' · '), dim: true }]
  if (isNum(t.tokensPerSecond) && t.tokensPerSecond > 0) parts.push(sep(), { text: `${Math.round(t.tokensPerSecond)} tok/s`, dim: true })
  return { id: 'tokens', parts }
}

function activityRow(s: Snapshot, o: BoxSettings): Row | undefined {
  const a = s.activity
  if (!a) return undefined
  const groups = groupRuns(a.runs, o.toolsMaxVisible)
  const parts: Part[] = []
  groups.forEach((g, i) => {
    const m = RUN_MARK[g.state]
    if (i > 0) parts.push(sep())
    const detail = g.state === 'running' ? (g.target ? ` ${g.target}` : '') : g.count > 1 ? ` ×${g.count}` : ''
    parts.push({ text: `${m.icon} ${g.name}${detail}`, color: m.color })
  })
  const extra: Part[][] = []
  if (a.skills.length > 0) extra.push([{ text: `Skills: ${a.skills.join(', ')}`, dim: true }])
  const servers = Object.entries(a.mcp)
  if (servers.length > 0) extra.push([{ text: `MCP: ${servers.map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(', ')}`, dim: true }])
  if (a.compactions > 0) extra.push([{ text: `Compactions: ${a.compactions}`, dim: true }])
  if (parts.length === 0 && extra.length === 0) return undefined
  if (parts.length === 0) return { id: 'activity', parts: extra[0]!, extra: extra.slice(1) }
  return { id: 'activity', parts, extra }
}

function environmentRow(s: Snapshot, o: BoxSettings): Row | undefined {
  const e = s.env
  if (!e) return undefined
  const items: [number | undefined, string][] = [[e.claudeMd, 'CLAUDE.md'], [e.rules, 'rules'], [e.mcp, 'MCP'], [e.hooks, 'hooks'], [e.plugins, 'plugins']]
  const known = items.filter((i): i is [number, string] => isNum(i[0]) && i[0] > 0)
  const total = known.reduce((n, [c]) => n + c, 0)
  if (known.length === 0 || total < o.envThreshold) return undefined
  return { id: 'environment', parts: [{ text: known.map(([c, name]) => `${c} ${name}`).join(' · '), dim: true }] }
}

/** Every row that has something to draw, keyed by id. */
export function buildRows(s: Snapshot, o: BoxSettings = DEFAULT_BOX): Record<RowId, Row | undefined> {
  return {
    model: modelRow(s),
    mode: modeRow(s),
    context: contextRow(s, o),
    usage: usageRow(s, o),
    cost: costRow(s),
    cache: cacheRow(s),
    git: gitRow(s, o),
    backup: backupRow(s),
    tokens: tokensRow(s),
    activity: activityRow(s, o),
    environment: environmentRow(s, o),
  }
}

/** `a, b, x` -> the known ids in that order, once each. */
export function parseRows(list: string | undefined | null): RowId[] {
  const out: RowId[] = []
  for (const w of (list ?? '').split(',')) {
    const id = w.trim().toLowerCase() as RowId
    if ((ROW_IDS as readonly string[]).includes(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** Putting a row back keeps the canonical order among the rows shown. */
export function showRow(current: readonly RowId[], id: RowId): RowId[] {
  if (current.includes(id)) return [...current]
  const rank = ROW_IDS.indexOf(id)
  const at = current.findIndex(c => ROW_IDS.indexOf(c) > rank)
  const next = [...current]
  next.splice(at === -1 ? next.length : at, 0, id)
  return next
}

export const hideRow = (current: readonly RowId[], id: RowId): RowId[] => current.filter(c => c !== id)

const plainLength = (parts: readonly Part[]): number => parts.reduce((n, p) => n + p.text.length, 0)

/** The lines to draw, in order: one per row (expanded), or rows joined with ` │ ` on as few lines as fit (compact). */
export function layoutLines(rows: readonly Row[], layout: Layout, width: number): { key: string; parts: Part[] }[] {
  const lines: { key: string; parts: Part[] }[] = []
  if (layout === 'compact') {
    let line: Part[] = []
    let ids: string[] = []
    const flush = () => {
      if (line.length > 0) lines.push({ key: ids.join('+'), parts: line })
      line = []
      ids = []
    }
    for (const r of rows) {
      if (line.length > 0 && plainLength(line) + 3 + plainLength(r.parts) > width) flush()
      if (line.length > 0) line.push({ text: ' │ ', dim: true })
      line.push(...r.parts)
      ids.push(r.id)
      if (r.extra && r.extra.length > 0) {
        flush()
        r.extra.forEach((x, i) => lines.push({ key: `${r.id}:extra:${i}`, parts: x }))
      }
    }
    flush()
    return lines
  }
  for (const r of rows) {
    lines.push({ key: r.id, parts: r.parts })
    r.extra?.forEach((x, i) => lines.push({ key: `${r.id}:extra:${i}`, parts: x }))
  }
  return lines
}

/** The file a tool call works on, or the short thing it looks for, for the running mark: `Edit auth.ts`. */
export function targetOf(e: Record<string, unknown>): string | undefined {
  for (const k of ['file_path', 'notebook_path', 'path']) {
    const v = e[k]
    if (typeof v === 'string' && v !== '') return v.split('/').filter(Boolean).pop()
  }
  for (const k of ['pattern', 'query', 'url']) {
    const v = e[k]
    if (typeof v === 'string' && v !== '') return v.length > 24 ? `${v.slice(0, 23)}…` : v
  }
  return undefined
}

/** The MCP server of a tool named `mcp__<server>__<tool>`, else undefined. */
export function mcpServerOf(tool: string): string | undefined {
  if (!tool.startsWith('mcp__')) return undefined
  const server = tool.slice(5).split('__')[0]
  return server ? server : undefined
}

export const RUN_CAP = 24
export const SKILL_CAP = 8
export const MCP_CAP = 8

/** A tool call starts: bounded, newest last. */
export function startRun(a: Activity, run: ToolRun): Activity {
  const skills = run.name === 'Skill' && run.target ? [...a.skills.filter(s => s !== run.target), run.target].slice(-SKILL_CAP) : a.skills
  const server = mcpServerOf(run.name)
  let mcp = a.mcp
  if (server) {
    mcp = { ...a.mcp, [server]: (a.mcp[server] ?? 0) + 1 }
    const names = Object.keys(mcp)
    if (names.length > MCP_CAP) delete mcp[names.find(n => n !== server)!]
  }
  return { ...a, runs: [...a.runs, run].slice(-RUN_CAP), skills, mcp }
}

/** The call ends: its run turns done (or error). */
export const finishRun = (a: Activity, id: string, state: 'done' | 'error'): Activity => ({ ...a, runs: a.runs.map(r => (r.id === id ? { ...r, state } : r)) })
