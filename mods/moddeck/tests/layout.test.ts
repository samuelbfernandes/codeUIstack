import { expect, test } from 'claude-code/testing'

import { CARD_GAP, barTarget, listAt, packCards, pillText, scrollBar } from '../hooks/layout'

test('packCards keeps a card on the line while every card still gets its minimum, and shares the spare cells out', () => {
  expect(packCards([30, 30, 50], 40)).toEqual([[{ index: 0, width: 40 }], [{ index: 1, width: 40 }], [{ index: 2, width: 40 }]])
  const wide = packCards([30, 30, 50], 70)
  expect(wide).toEqual([[{ index: 0, width: 34 }, { index: 1, width: 35 }], [{ index: 2, width: 70 }]])
  expect(wide[0]!.reduce((n, c) => n + c.width, 0) + CARD_GAP).toBe(70) // the line is filled exactly
  expect(packCards([80], 40)).toEqual([[{ index: 0, width: 40 }]]) // a card wider than the pane still gets the pane
  expect(packCards([], 40)).toEqual([])
})

test('scrollBar puts the thumb where the window is, sized to the share it shows', () => {
  expect(scrollBar(0, 4, 4)).toEqual(['thumb', 'thumb', 'thumb', 'thumb']) // everything shows
  expect(scrollBar(0, 4, 8)).toEqual(['thumb', 'thumb', 'track', 'track'])
  expect(scrollBar(4, 4, 8)).toEqual(['track', 'track', 'thumb', 'thumb'])
  expect(scrollBar(2, 4, 8)).toEqual(['track', 'thumb', 'thumb', 'track'])
  expect(scrollBar(0, 3, 30)).toEqual(['thumb', 'track', 'track']) // never smaller than one cell
})

test('barTarget moves a page toward the click, and never past either end', () => {
  expect(barTarget(0, 4, 8, 3)).toBe(4)
  expect(barTarget(4, 4, 8, 0)).toBe(0)
  expect(barTarget(4, 4, 9, 3)).toBe(5) // clamped to the last page
  expect(barTarget(0, 4, 8, 0)).toBe(0) // the thumb in the upper half at the top: stays
})

test('listAt tells which list (and which of its rows) a tree row is over, counting from the bottom', () => {
  // rows from the end: footer, gap, prompts' bottom border, 2 prompts, top border, title, gap, skills' bottom border, 3 skills
  const lists = [{ id: 'prompts', shown: 2 }, { id: 'skills', shown: 3 }]
  const total = 40
  expect(listAt(lists, total, total - 1)).toBeUndefined() // the footer
  expect(listAt(lists, total, total - 3)).toBeUndefined() // a border
  expect(listAt(lists, total, total - 4)).toEqual({ id: 'prompts', index: 1 })
  expect(listAt(lists, total, total - 5)).toEqual({ id: 'prompts', index: 0 })
  expect(listAt(lists, total, total - 6)).toBeUndefined() // the prompts' top border
  expect(listAt(lists, total, total - 10)).toEqual({ id: 'skills', index: 2 })
  expect(listAt(lists, total, total - 12)).toEqual({ id: 'skills', index: 0 })
  expect(listAt(lists, total, total - 13)).toBeUndefined()
})

test('pillText pads a name so the pills of one card line up', () => {
  expect(pillText('suggest', 9)).toBe(' suggest   ')
})
