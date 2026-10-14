import { expect, test } from 'claude-code/testing'

import { barTarget, listAt, pillText, scrollBar, stepTop, trackCells } from '../hooks/layout'

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

test('listAt skips the rows drawn under a list inside its box (the more/fewer row and its rule)', () => {
  // from the end: footer, gap, bottom border, more/fewer row, rule, 5 skills
  const lists = [{ id: 'skills', shown: 5, under: 2 }]
  expect(listAt(lists, 40, 40 - 4)).toBeUndefined() // the more/fewer row
  expect(listAt(lists, 40, 40 - 5)).toBeUndefined() // the rule
  expect(listAt(lists, 40, 40 - 6)).toEqual({ id: 'skills', index: 4 })
  expect(listAt(lists, 40, 40 - 10)).toEqual({ id: 'skills', index: 0 })
  expect(listAt(lists, 40, 40 - 11)).toBeUndefined() // the top border
})

test('the arrows take a cell each from the bar; stepTop moves one line and stays inside the list', () => {
  expect(trackCells(5)).toBe(3)
  expect(trackCells(2)).toBe(2)
  expect(scrollBar(0, 5, 10, 3)).toHaveLength(3)
  expect(stepTop(0, -1, 5, 10)).toBe(0)
  expect(stepTop(0, 1, 5, 10)).toBe(1)
  expect(stepTop(5, 1, 5, 10)).toBe(5)
})

test('pillText pads a name so the pills of one card line up', () => {
  expect(pillText('suggest', 9)).toBe(' suggest   ')
})
