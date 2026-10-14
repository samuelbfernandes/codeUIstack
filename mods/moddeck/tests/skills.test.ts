import { expect, test } from 'claude-code/testing'

import { SKILLS, allSkills, listRowsOf, listSize, starFirst, toggleStar } from '../hooks/catalog'

test('allSkills keeps the toolkit skills first, then every other installed skill by name, once', () => {
  const list = allSkills([{ name: 'zeta', desc: 'Z  line' }, { name: 'burst' }, { name: 'plug:align' }, { name: 'alpha' }, { name: 'zeta' }, { name: ' ' }])
  expect(list.slice(0, SKILLS.length)).toEqual(SKILLS)
  expect(list.slice(SKILLS.length).map(k => k.id)).toEqual(['alpha', 'zeta'])
  expect(list.find(k => k.id === 'zeta')?.desc).toBe('Z line')
  expect(list.find(k => k.id === 'alpha')?.text).toBe('Use the alpha skill ')
})

test('allSkills with nothing read yet is the toolkit list', () => {
  expect(allSkills([])).toEqual(SKILLS)
})

test('starFirst moves starred skills up in list order; toggleStar adds and removes', () => {
  expect(starFirst(SKILLS, ['burst', 'align', 'gone'], k => k.id).map(k => k.id).slice(0, 3)).toEqual(['align', 'burst', 'dual-model-review'])
  expect(toggleStar(['a'], 'b')).toEqual(['a', 'b'])
  expect(toggleStar(['a', 'b'], 'a')).toEqual(['b'])
})

test('listRowsOf uses the pick, else the default, kept between 5 and 30', () => {
  expect(listRowsOf({}, 'skills', 5)).toBe(5)
  expect(listRowsOf({ skills: 9 }, 'skills', 5)).toBe(9)
  expect(listRowsOf({ skills: 1 }, 'skills', 5)).toBe(5)
  expect(listRowsOf({ skills: 99 }, 'skills', 5)).toBe(30)
})

test('listSize fits every star, shows at least five, and never more than the list has', () => {
  expect(listSize(1, 5, 10)).toBe(5) // one star: still five lines
  expect(listSize(7, 5, 10)).toBe(7) // seven stars: all of them
  expect(listSize(0, 8, 10)).toBe(8)
  expect(listSize(0, 5, 3)).toBe(3)
  expect(listSize(9, 5, 6)).toBe(6)
})
