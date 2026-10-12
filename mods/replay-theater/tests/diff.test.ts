import { test, expect } from 'claude-code/testing'

import { lineDiff, splitLines, unifiedDiff } from '../hooks/diff'
import { capChanges, editFromCall, looksLikeShellWrite, stepIndex } from '../hooks/edits'

const render = (a: string, b: string) => lineDiff(splitLines(a), splitLines(b)).map(o => o.t + o.s)

test('lineDiff table', () => {
  const cases: [string, string, string, string[]][] = [
    ['identical', 'a\nb\n', 'a\nb\n', [' a', ' b']],
    ['empty to text', '', 'x\ny', ['+x', '+y']],
    ['text to empty', 'x\ny\n', '', ['-x', '-y']],
    ['replace middle', 'a\nb\nc', 'a\nB\nc', [' a', '-b', '+B', ' c']],
    ['insert', 'a\nc', 'a\nb\nc', [' a', '+b', ' c']],
    ['delete', 'a\nb\nc', 'a\nc', [' a', '-b', ' c']],
    ['lcs not greedy', 'a\nb\nc\nd', 'b\nd\ne', ['-a', ' b', '-c', ' d', '+e']],
    ['crlf is normalised', 'a\r\nb\r\n', 'a\nb\n', [' a', ' b']],
  ]
  for (const [name, a, b, want] of cases) expect(render(a, b), name).toEqual(want)
})

test('unifiedDiff hunks, headers and counts', () => {
  const one = unifiedDiff([{ old: 'a\nb\nc', new: 'a\nB\nc' }])
  expect(one.text).toBe('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c')
  expect([one.added, one.removed]).toEqual([1, 1])

  const create = unifiedDiff([{ old: '', new: 'x\ny\n' }])
  expect(create.text).toBe('@@ -0,0 +1,2 @@\n+x\n+y')

  const same = unifiedDiff([{ old: 'a\n', new: 'a\n' }])
  expect(same.text).toBe('')
})

test('unifiedDiff keeps 3 lines of context and splits distant changes', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `l${i}`)
  const changed = lines.slice()
  changed[1] = 'X'
  changed[18] = 'Y'
  const d = unifiedDiff([{ old: lines.join('\n'), new: changed.join('\n') }])
  const headers = d.text.split('\n').filter(l => l.startsWith('@@'))
  expect(headers).toEqual(['@@ -1,5 +1,5 @@', '@@ -16,5 +16,5 @@'])
})

test('unifiedDiff continues numbering across several changes', () => {
  const d = unifiedDiff([
    { old: 'a', new: 'b' },
    { old: 'c', new: 'd' },
  ])
  expect(d.text).toBe('@@ -1,1 +1,1 @@\n-a\n+b\n@@ -2,1 +2,1 @@\n-c\n+d')
})

test('lineDiff falls back to remove-all/add-all past the size limit', () => {
  const a = Array.from({ length: 600 }, (_, i) => `a${i}`)
  const b = Array.from({ length: 600 }, (_, i) => `b${i}`)
  const ops = lineDiff(a, b)
  expect(ops).toHaveLength(1200)
  expect(ops.slice(0, 600).every(o => o.t === '-')).toBe(true)
})

test('editFromCall table', () => {
  expect(editFromCall('Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' })).toEqual({
    path: '/p/a.ts',
    tool: 'Edit',
    changes: [{ old: 'x', new: 'y' }],
  })
  expect(editFromCall('MultiEdit', { file_path: '/p/a.ts', edits: [{ old_string: '1', new_string: '2' }, { old_string: '3', new_string: '4' }] })?.changes).toHaveLength(2)
  expect(editFromCall('Write', { file_path: '/p/n.ts', content: 'hi' }, { created: true, text: '' })).toMatchObject({ created: true, changes: [{ old: '', new: 'hi' }] })
  expect(editFromCall('Write', { file_path: '/p/o.ts', content: 'new' }, { created: false, text: 'old' })).toEqual({
    path: '/p/o.ts',
    tool: 'Write',
    changes: [{ old: 'old', new: 'new' }],
  })
  expect(editFromCall('Write', { file_path: '/p/big', content: 'z' }, { created: false })?.note).toContain('not captured')
  expect(editFromCall('NotebookEdit', { notebook_path: '/p/n.ipynb', new_source: 'print(1)' })?.changes).toEqual([{ old: '', new: 'print(1)' }])
  expect(editFromCall('Read', { file_path: '/p/a.ts' })).toBeNull()
  expect(editFromCall('Edit', { old_string: 'x', new_string: 'y' })).toBeNull()
})

test('capChanges cuts to the budget and says so', () => {
  const capped = capChanges([{ old: 'a'.repeat(30), new: 'b'.repeat(30) }, { old: 'c', new: 'd' }], 40)
  expect(capped.truncated).toBe(true)
  expect(capped.changes).toHaveLength(1)
  expect(capped.changes[0]!.old.length + capped.changes[0]!.new.length).toBe(40)
  expect(capChanges([{ old: 'a', new: 'b' }]).truncated).toBe(false)
})

test('stepIndex stays in bounds', () => {
  expect(stepIndex(0, -1, 3)).toBe(0)
  expect(stepIndex(0, 1, 3)).toBe(1)
  expect(stepIndex(2, 1, 3)).toBe(2)
  expect(stepIndex(5, 0, 3)).toBe(2)
  expect(stepIndex(0, 1, 0)).toBe(0)
})

test('looksLikeShellWrite heuristic', () => {
  for (const yes of ['sed -i s/a/b/ f', 'mv a b', 'git checkout -- f', 'echo hi > out.txt', 'cat a >> b', 'rm -rf build']) {
    expect(looksLikeShellWrite(yes), yes).toBe(true)
  }
  for (const no of ['ls -la', 'git status', 'grep -r foo .', 'make test 2>&1', 'echo hi >/dev/null', 'cargo build']) {
    expect(looksLikeShellWrite(no), no).toBe(false)
  }
})
