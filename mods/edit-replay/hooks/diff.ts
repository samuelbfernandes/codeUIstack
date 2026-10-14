// Pure line diff, no engine calls: easy to test and safe to run in any hook.
import type { Change } from '../types'

export type Op = { t: ' ' | '-' | '+'; s: string }

// Largest middle section (old lines x new lines) we run the LCS table on.
// Past it the middle is shown as one block removed, one block added.
const MAX_CELLS = 250_000

/** Lines of a text, without the empty "line" after a final newline. The Code
 *  element refuses control characters other than tab and newline, so CRs and
 *  the like are dropped here. */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const clean = text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
  const lines = clean.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Line-level edit script from `a` to `b`: common prefix and suffix are
 *  peeled off, the middle is solved by LCS. On a tie removals come first. */
export function lineDiff(a: string[], b: string[]): Op[] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)
  const ops: Op[] = a.slice(0, head).map(s => ({ t: ' ', s }))
  ops.push(...diffMiddle(midA, midB))
  ops.push(...a.slice(a.length - tail).map(s => ({ t: ' ' as const, s })))
  return ops
}

function diffMiddle(a: string[], b: string[]): Op[] {
  const removed = (s: string): Op => ({ t: '-', s })
  const added = (s: string): Op => ({ t: '+', s })
  if (a.length === 0) return b.map(added)
  if (b.length === 0) return a.map(removed)
  if (a.length * b.length > MAX_CELLS) return [...a.map(removed), ...b.map(added)]

  // lcs[i][j] = length of the LCS of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ t: ' ', s: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push(removed(a[i]!))
      i++
    } else {
      ops.push(added(b[j]!))
      j++
    }
  }
  while (i < a.length) ops.push(removed(a[i++]!))
  while (j < b.length) ops.push(added(b[j++]!))
  return ops
}

type Range = [from: number, to: number]

/** Index ranges of `ops` to show: each change with `context` lines around it,
 *  neighbouring ranges merged when their context would touch. */
function hunkRanges(ops: Op[], context: number): Range[] {
  const changed = ops.flatMap((o, i) => (o.t === ' ' ? [] : [i]))
  const ranges: Range[] = []
  let start = changed[0]
  let end = changed[0]
  for (const idx of changed.slice(1)) {
    if (idx - end! - 1 <= 2 * context) {
      end = idx
    } else {
      ranges.push([start!, end!])
      start = end = idx
    }
  }
  if (start !== undefined) ranges.push([start, end!])
  return ranges.map(([s, e]) => [Math.max(0, s - context), Math.min(ops.length - 1, e + context)])
}

export type DiffResult = { text: string; added: number; removed: number }

/** Unified-diff hunks (no ---/+++ header) for a list of old->new changes.
 *  Line numbers are relative to the changed snippets, not to the file: the
 *  tool inputs do not say where in the file a snippet sat. Changes after the
 *  first continue counting from where the previous one ended, so the hunks
 *  stay in order. */
export function unifiedDiff(changes: readonly Change[], context = 3): DiffResult {
  const out: string[] = []
  let added = 0
  let removed = 0
  let oldBase = 0
  let newBase = 0
  for (const change of changes) {
    const ops = lineDiff(splitLines(change.old), splitLines(change.new))
    for (const [from, to] of hunkRanges(ops, context)) {
      const before = ops.slice(0, from)
      const body = ops.slice(from, to + 1)
      const oldCount = body.filter(o => o.t !== '+').length
      const newCount = body.filter(o => o.t !== '-').length
      const oldStart = oldBase + before.filter(o => o.t !== '+').length + (oldCount > 0 ? 1 : 0)
      const newStart = newBase + before.filter(o => o.t !== '-').length + (newCount > 0 ? 1 : 0)
      out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
      out.push(...body.map(o => o.t + o.s))
    }
    added += ops.filter(o => o.t === '+').length
    removed += ops.filter(o => o.t === '-').length
    oldBase += ops.filter(o => o.t !== '+').length
    newBase += ops.filter(o => o.t !== '-').length
  }
  return { text: out.join('\n'), added, removed }
}
