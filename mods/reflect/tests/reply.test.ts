import { expect, test } from 'claude-code/testing'

import { dropWith } from '../hooks/reply'

const ui = () => {
  const lines: string[] = []

  return { lines, log: (text: string) => void lines.push(text) }
}

test('dropWith: the first line is the reason, the rest is one dim note', () => {
  const sink = ui()
  expect(dropWith(sink, '  Reflect · on \n\n No rule waiting.\r\nSecond detail\n')).toEqual({ drop: 'Reflect · on' })
  expect(sink.lines).toEqual(['No rule waiting.\nSecond detail'])
})

test('dropWith: a single line logs nothing and control characters never reach the reason', () => {
  const sink = ui()
  const out = dropWith(sink, 'Reflect\u0000 · \u001bon\u007f')
  expect(out.drop).toBe('Reflect · on')
  expect(/[\u0000-\u001f\u007f-\u009f]/.test(out.drop)).toBe(false)
  expect(sink.lines).toEqual([])
})

test('dropWith: a failing log still answers', () => {
  expect(dropWith({ log: () => { throw new Error('no log') } }, 'a\nb')).toEqual({ drop: 'a' })
})
