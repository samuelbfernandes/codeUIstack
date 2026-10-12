import { test, expect } from 'claude-code/testing'

import type { AgentRow } from '../types'
import {
  addStep,
  applyTaskTool,
  countTool,
  isStalled,
  stallMsOf,
  indentOf,
  progressBar,
  taskText,
  treeLines,
  treeOrder,
  bandText,
  busyBar,
  contextWindow,
  endTurn,
  fillBar,
  fmtCost,
  fmtDuration,
  fmtTokens,
  newRow,
  parseOverrides,
  priceFor,
  rowCost,
  rowFill,
  summarize,
  touch,
} from '../hooks/lib'

const u = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite })

test('price table: families, legacy opus, overrides win, unknown is null', () => {
  expect(priceFor('claude-sonnet-4-5-20250929')?.in).toBe(3)
  expect(priceFor('claude-opus-4-5')?.out).toBe(25)
  expect(priceFor('claude-opus-4-1-20250805')?.out).toBe(75)
  expect(priceFor('claude-haiku-4-5')?.in).toBe(1)
  expect(priceFor('claude-3-5-haiku-20241022')?.in).toBe(0.8)
  expect(priceFor('some-other-model')).toBeNull()
  expect(priceFor('')).toBeNull()
  expect(priceFor('claude-sonnet-4-5', parseOverrides('sonnet=6/30'))?.in).toBe(6)
})

test('overrides parse and skip malformed entries', () => {
  const rows = parseOverrides('opus=5/25/0.5/6.25, junk, sonnet=x/y, haiku=1/5')
  expect(rows.map(r => r.match[0])).toEqual(['opus', 'haiku'])
  expect(rows[1]?.cacheRead).toBe(0.1)
  expect(parseOverrides(undefined)).toEqual([])
})

test('formatting', () => {
  expect(fmtTokens(950)).toBe('950')
  expect(fmtTokens(18_000)).toBe('18k')
  expect(fmtTokens(41_234)).toBe('41.2k')
  expect(fmtTokens(2_500_000)).toBe('2.5M')
  expect(fmtCost(0.0042)).toBe('est. $0.004')
  expect(fmtCost(0.384, true)).toBe('est. $0.38+')
  expect(fmtDuration(72_000)).toBe('1m12s')
  expect(fmtDuration(4_000)).toBe('4s')
  expect(fmtDuration(3_900_000)).toBe('1h05m')
})

test('bars keep their width', () => {
  expect(fillBar(0.5, 10)).toBe('█████░░░░░')
  expect(fillBar(2, 4)).toBe('████')
  for (const s of [0, 1, 5, 6, 7, 40]) expect(busyBar(10, s)).toHaveLength(10)
})

test('a turn total replaces the steps sum (no double count) and cost follows', () => {
  let r: AgentRow = { ...newRow('a', { model: 'claude-sonnet-4-5' }, 0) }
  r = addStep(r, 't1', u(1000, 100), 'claude-sonnet-4-5')
  r = addStep(r, 't1', u(2000, 200), 'claude-sonnet-4-5')
  expect(r.cur).toEqual(u(3000, 300))
  expect(r.fill).toBe(2000)
  r = endTurn(r, true, 5000, u(3000, 300), 6000)
  expect(r.done).toEqual(u(3000, 300))
  expect(r.cur).toEqual(u(0, 0))
  expect(r.status).toBe('finished')
  expect(Math.abs((rowCost(r, []) ?? 0) - (3000 * 3 + 300 * 15) / 1e6)).toBeLessThan(1e-9)
  expect(rowFill(r)).toBe(2000 / contextWindow(r.model))
})

test('a helper with no usage has no cost; unpriced models make the total a lower bound', () => {
  const quiet = newRow('q', { model: 'claude-sonnet-4-5' }, 0)
  expect(rowCost(quiet, [])).toBeNull()
  const odd = addStep(newRow('o', { model: 'mystery-1' }, 0), 't', u(1000, 1000), 'mystery-1')
  const s = summarize([quiet, odd], 1000, [])
  expect(s.unpriced).toBe(1)
  expect(bandText(s)).toContain('est. n/a')
})

test('touch creates unknown rows and caps the list by dropping the oldest ended one', () => {
  let rows: AgentRow[] = []
  for (let i = 0; i < 65; i++) rows = touch(rows, `a${i}`, {}, i, r => ({ ...r, status: i === 64 ? 'running' : 'finished' }))
  expect(rows).toHaveLength(60)
  expect(rows.some(r => r.id === 'a64')).toBe(true)
  expect(rows.some(r => r.id === 'a0')).toBe(false)
})

// ---- v0.4.0: progress bars, task list, tree -----------------------------------------------------

const row = (id: string, extra: Partial<AgentRow> = {}): AgentRow => ({ ...newRow(id, { label: id }, 1000), ...extra })

test('progress bar: one cell per item up to 10, full and empty ends, no task list is no text', () => {
  expect(progressBar(3, 5)).toBe('▰▰▰▱▱')
  expect(progressBar(0, 5)).toBe('▱▱▱▱▱')
  expect(progressBar(1, 2)).toBe('▰▱')
  expect(progressBar(40, 40)).toBe('▰'.repeat(10))
  expect(taskText([])).toBe('')
  expect(taskText([{ id: '1', subject: 'a', status: 'completed' }, { id: '2', subject: 'b', status: 'pending' }])).toContain('1/2 tasks')
})

test('TodoWrite replaces the list from newTodos (or the input when no result); bad shapes change nothing', () => {
  const todos = [
    { content: 'a', status: 'completed', activeForm: 'A' },
    { content: 'b', status: 'in_progress', activeForm: 'B' },
    { content: 'c', status: 'pending', activeForm: 'C' },
  ]
  const fromResult = applyTaskTool([], 'TodoWrite', { todos: [] }, { oldTodos: [], newTodos: todos })
  expect(fromResult.map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect(applyTaskTool([], 'TodoWrite', { todos }, undefined)).toHaveLength(3)
  const keep = [{ id: 'x', subject: 's', status: 'pending' as const }]
  expect(applyTaskTool(keep, 'TodoWrite', {}, 'weird')).toEqual(keep)
  expect(applyTaskTool(keep, 'TodoWrite', { todos: [{ content: 'q', status: 'bogus' }] }, undefined)).toEqual([])
})

test('TaskCreate / TaskUpdate / TaskList keep the list by id', () => {
  let items = applyTaskTool([], 'TaskCreate', { subject: 's' }, { task: { id: '1', subject: 'first' } })
  items = applyTaskTool(items, 'TaskCreate', { subject: 'second' }, { task: { id: '2', subject: 'second' } })
  expect(applyTaskTool(items, 'TaskCreate', {}, { task: { id: '2', subject: 'dup' } })).toHaveLength(2)
  items = applyTaskTool(items, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })
  expect(items.map(t => t.status)).toEqual(['completed', 'pending'])
  expect(applyTaskTool(items, 'TaskUpdate', { taskId: '2', status: 'completed' }, { success: false })).toEqual(items)
  expect(applyTaskTool(items, 'TaskUpdate', { taskId: '2', status: 'deleted' }, { success: true }).map(t => t.id)).toEqual(['1'])
  // A task this mod never saw created still counts once it is updated.
  expect(applyTaskTool(items, 'TaskUpdate', { taskId: '9', status: 'in_progress' }, { success: true })).toHaveLength(3)
  expect(applyTaskTool(items, 'TaskList', {}, { tasks: [{ id: '5', subject: 'z', status: 'pending', blockedBy: [] }] })).toEqual([
    { id: '5', subject: 'z', status: 'pending' },
  ])
})

test('tree: children sit under their parent, orphans and parent loops are still listed once', () => {
  const rows = [
    row('root', { startedAt: 1 }),
    row('kid2', { startedAt: 3, parentId: 'root' }),
    row('kid1', { startedAt: 2, parentId: 'root' }),
    row('grand', { startedAt: 4, parentId: 'kid1' }),
    row('orphan', { startedAt: 5, parentId: 'gone' }),
    row('loopA', { startedAt: 6, parentId: 'loopB' }),
    row('loopB', { startedAt: 7, parentId: 'loopA' }),
  ]
  const order = treeOrder(rows).map(t => `${t.depth}:${t.row.id}`)
  // Roots newest first; each root's subtree in start order; a parent loop is listed last, flat from its first member.
  expect(order).toEqual(['0:orphan', '0:root', '1:kid1', '2:grand', '1:kid2', '0:loopA', '1:loopB'])
  expect(new Set(order.map(o => o.split(':')[1])).size).toBe(rows.length)
  expect(indentOf(0)).toBe('')
  expect(indentOf(2)).toBe('  └ ')
})

test('tree lines carry elapsed time and tool count; countTool never invents a row', () => {
  const rows = countTool(countTool([row('a', { since: null, busyMs: 65_000, status: 'finished' })], 'a', 0), 'a', 0)
  expect(countTool(rows, 'nobody')).toHaveLength(1)
  expect(treeLines(rows, 99_999)).toEqual(['✓ a · finished · 1m05s · 2 tools'])
})

test('stall detection: only a running helper that has been silent for the setting counts; 0 turns it off', () => {
  const min = 60_000
  const quiet = row('a', { status: 'running', startedAt: 0, lastAt: 0 })
  expect(stallMsOf(undefined)).toBe(5 * min)
  expect(stallMsOf(0)).toBe(0)
  expect(stallMsOf(2)).toBe(2 * min)
  expect(isStalled(quiet, 4 * min, 5 * min)).toBe(false)
  expect(isStalled(quiet, 5 * min, 5 * min)).toBe(true)
  expect(isStalled(quiet, 99 * min, 0)).toBe(false)
  expect(isStalled({ ...quiet, status: 'finished' }, 99 * min, 5 * min)).toBe(false)
  expect(isStalled({ ...quiet, lastAt: 4 * min }, 6 * min, 5 * min)).toBe(false) // a request or tool call resets the clock
})
