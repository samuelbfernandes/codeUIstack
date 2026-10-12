import { test, expect } from 'claude-code/testing'

import { looksLikeCorrection, proseOf } from '../hooks/prefilter'

const fence = '```'
const longLog = Array.from({ length: 40 }, (_, i) => `2026-10-09 12:00:${i} ERROR never retry worker ${i}`).join('\n')

// [prompt, expected, why]
const TABLE: ReadonlyArray<readonly [string, boolean, string]> = [
  // corrections and standing preferences
  ['No, use pnpm instead of npm', true, 'starts with no,'],
  ['no. that is the wrong file', true, 'starts with no.'],
  ['Nope, we do it differently here', true, 'nope,'],
  ["Don't add comments to every line", true, "don't"],
  ['dont touch the lockfile please', true, 'dont without apostrophe'],
  ['Please do not run the full test suite', true, 'do not'],
  ['Never commit directly to main', true, 'never'],
  ['Always run cargo fmt before finishing', true, 'always'],
  ['Stop adding docstrings to private helpers', true, 'stop'],
  ['Use ruff instead of flake8', true, 'instead'],
  ['Use a tibble rather than a data.frame here', true, 'rather than'],
  ['I told you to keep the R code in tidyverse style', true, 'I told you'],
  ['I already told you the genotype file is plink bed', true, 'I already told you'],
  ['We use pnpm workspaces for everything', true, 'we use'],
  ['we prefer small commits with imperative messages', true, 'we prefer'],
  ['In this repo tests live next to the code', true, 'in this repo'],
  ['In this codebase we avoid unwrap()', true, 'in this codebase'],
  ['From now on answer in British English', true, 'from now on'],
  ['Going forward, name the branches feat/<topic>', true, 'going forward'],
  ['Next time check the Makefile first', true, 'next time'],
  ['I prefer snake_case for R functions', true, 'prefer'],
  ['Use pnpm, not npm', true, 'X, not Y'],
  ['not npm, pnpm', true, 'not X, Y'],
  ['That is wrong, the config is in .config/tool.toml', true, "that is wrong"],
  // not corrections
  ['Add a unit test for the parser', false, 'plain task'],
  ['What does git stash pop do?', false, 'question'],
  ['Can you explain the BLUP formula?', false, 'question'],
  ['ok', false, 'too short'],
  ['yes please', false, 'too short'],
  ['thanks, looks good', false, 'no signal'],
  ['/compact', false, 'slash command'],
  ['/reflect off', false, 'slash command'],
  ["/model haiku don't ask", false, 'slash command with a signal word'],
  ['', false, 'empty'],
  ['   \n  ', false, 'whitespace'],
  ['Refactor the loader into two functions', false, 'plain task'],
  [`Why does this fail?\n${fence}\nif (!ok) { /* never reached, don't ask */ }\n${fence}`, false, 'signals only inside a code block'],
  [`${fence}\nnever always stop\n${fence}`, false, 'only a code block'],
  [`Please never skip tests\n${fence}\ncode\n${fence}`, true, 'signal in prose next to a code block'],
  [longLog, false, 'pasted log, many lines'],
  [`always ${'x'.repeat(2100)}`, false, 'over the length limit'],
  [`Summarise this paper in three bullets ${fence}never closed fence never`, false, 'unclosed fence swallows the rest'],
]

for (const [prompt, expected, why] of TABLE) {
  test(`prefilter ${expected ? 'passes' : 'ignores'}: ${why} (${JSON.stringify(prompt.slice(0, 30))})`, () => {
    expect(looksLikeCorrection(prompt)).toBe(expected)
  })
}

test('prefilter table has at least 30 cases', () => {
  expect(TABLE.length >= 30).toBe(true)
})

test('prefilter honours a custom length limit', () => {
  expect(looksLikeCorrection('Never use tabs in this repo', 10)).toBe(false)
  expect(looksLikeCorrection('Never use tabs in this repo', 100)).toBe(true)
})

test('prefilter never throws on odd input', () => {
  expect(looksLikeCorrection(undefined as unknown as string)).toBe(false)
  expect(proseOf(`a ${fence} b`)).toBe('a')
})
