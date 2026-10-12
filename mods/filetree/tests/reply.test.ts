import { expect, test } from 'claude-code/testing'

import { dropWith } from '../hooks/reply'

const ui = () => {
  const lines: string[] = []

  return { lines, log: (text: string) => void lines.push(text) }
}

test('dropWith: the first line is the reason, the rest is one dim note', () => {
  const sink = ui()
  expect(dropWith(sink, '  Filetree · open \n\n The side panel needs /tui fullscreen.\r\nSecond detail\n')).toEqual({ drop: 'Filetree · open' })
  expect(sink.lines).toEqual(['The side panel needs /tui fullscreen.\nSecond detail'])
})

test('dropWith: a single line logs nothing and control characters never reach the reason', () => {
  const sink = ui()
  const out = dropWith(sink, 'Filetree\u0000 · \u001bclosed\u007f')
  expect(out.drop).toBe('Filetree · closed')
  expect(/[\u0000-\u001f\u007f-\u009f]/.test(out.drop)).toBe(false)
  expect(sink.lines).toEqual([])
})

test('dropWith: a failing log still answers', () => {
  const out = dropWith({ log: () => { throw new Error('no log') } }, 'a\nb')
  expect(out).toEqual({ drop: 'a' })
})
