import { expect, test } from 'claude-code/testing'

import { MAX_SOURCE, lastMermaid } from '../hooks/extract'

const F = '```'

test('no mermaid block gives undefined', () => {
  expect(lastMermaid('')).toBeUndefined()
  expect(lastMermaid('just text')).toBeUndefined()
  expect(lastMermaid(`${F}js\nconst a = 1\n${F}`)).toBeUndefined()
  expect(lastMermaid('the word mermaid in a sentence')).toBeUndefined()
})

test('the text of the block, without its fences', () => {
  expect(lastMermaid(`Here:\n${F}mermaid\ngraph TD\n  A --> B\n${F}\nDone.`)).toBe('graph TD\n  A --> B')
})

test('the last block wins', () => {
  const answer = `${F}mermaid\ngraph TD\n  A --> B\n${F}\nand\n${F}mermaid\npie\n  "a" : 1\n${F}`
  expect(lastMermaid(answer)).toBe('pie\n  "a" : 1')
})

test('other languages between two diagrams are skipped, and a later non-mermaid block does not replace it', () => {
  const answer = `${F}mermaid\ngraph TD\n  A --> B\n${F}\n${F}python\nprint(1)\n${F}`
  expect(lastMermaid(answer)).toBe('graph TD\n  A --> B')
})

test('the fence word is case-insensitive; tildes, longer fences and up to three spaces of indent are fences', () => {
  expect(lastMermaid(`${F}Mermaid\nA\n${F}`)).toBe('A')
  expect(lastMermaid('~~~mermaid\nB\n~~~')).toBe('B')
  expect(lastMermaid(`  ${F}mermaid\nC\n  ${F}`)).toBe('C')
  expect(lastMermaid(`${F}${F}mermaid\nD\n${F}\nstill D\n${F}${F}`)).toBe('D\n```\nstill D')
  expect(lastMermaid(`    ${F}mermaid\nE\n${F}`)).toBeUndefined() // four spaces is an indented code block, not a fence
  expect(lastMermaid(`${F}mermaidx\nF\n${F}`)).toBeUndefined()
})

test('a mermaid example shown inside another code block is not a diagram', () => {
  expect(lastMermaid(`${F}${F}markdown\n${F}mermaid\ngraph TD\n${F}\n${F}${F}`)).toBeUndefined()
  expect(lastMermaid(`${F}text\n${F}mermaid\nA\n${F}\n${F}mermaid\nreal\n${F}`)).toBe('real')
})

test('a block the answer never closed runs to the end', () => {
  expect(lastMermaid(`text\n${F}mermaid\ngraph TD\n  A --> B`)).toBe('graph TD\n  A --> B')
})

test('a tilde fence is not closed by backticks and a shorter fence does not close a longer one', () => {
  expect(lastMermaid(`~~~mermaid\nA\n${F}\nB\n~~~`)).toBe(`A\n${F}\nB`)
  expect(lastMermaid(`${F}${F}mermaid\nA\n${F}\nB\n${F}${F}`)).toBe(`A\n${F}\nB`)
})

test('Windows line endings are understood', () => {
  expect(lastMermaid(`${F}mermaid\r\ngraph TD\r\n  A --> B\r\n${F}\r\n`)).toBe('graph TD\n  A --> B')
})

test('the text is cut at the size cap', () => {
  const long = `${F}mermaid\n${'A --> B\n'.repeat(5000)}${F}`
  expect(lastMermaid(long)?.length).toBe(MAX_SOURCE)
})

test('an empty block is an empty string, which still counts as the last block', () => {
  expect(lastMermaid(`${F}mermaid\n${F}`)).toBe('')
})
