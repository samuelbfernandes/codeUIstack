import { test, expect } from 'claude-code/testing'

import { isConfirmation, isNotATask, looksLikeToolOutput, plainWord } from '../hooks/input'

test('plain words: exactly suggest-model / suggest model with an optional on or off', () => {
  expect(plainWord('suggest-model')).toBe('status')
  expect(plainWord('suggest-model')).toBe('status')
  expect(plainWord('  Suggest-Model  ')).toBe('status')
  expect(plainWord('suggest-model.')).toBe('status')
  expect(plainWord('suggest-model off')).toBe('off')
  expect(plainWord('Suggest Model ON.')).toBe('on')
  expect(plainWord('suggest-model   on')).toBe('on')
})

test('plain words: a prompt that merely contains the keyword is never one', () => {
  for (const t of [
    'suggest-model please',
    'what does suggest-model do',
    'turn suggest-model off for this session',
    'suggest-model explain derive the BLUP',
    'the model fit is poor, refit with REML',
    'suggest-models',
    'suggest-model off now',
    'suggest-model on..',
    '/suggest-model',
    'suggest-model\nmore text',
    '',
  ]) {
    expect(plainWord(t)).toBeUndefined()
  }
})

test('confirmations are bare replies, not tasks', () => {
  for (const t of ['yes', 'Yes.', 'ok', 'OK!', 'okay', 'y', 'thanks', 'go ahead', 'sounds good', 'lgtm', 'do it']) expect(isConfirmation(t)).toBe(true)
  for (const t of ['yes, and also derive the BLUP variance', 'ok now rename the variable x to n', 'fix typo', 'continue with the derivation of the REML score']) {
    expect(isConfirmation(t)).toBe(false)
  }
})

test('pasted tool output is recognised; a bulleted or numbered request is not', () => {
  const stack = ['Error: boom', '    at run (/a/b.js:10:5)', '    at main (/a/c.js:3:1)', '    at node:internal/x:1:1', '    at y (/a/d.js:9:9)', 'Caused by: z'].join('\n')
  const rust = ['   Compiling foo v0.1.0 (/w/foo)', 'error[E0382]: borrow of moved value', ' --> src/main.rs:4:5', '  |', '4 | x', 'error: could not compile `foo`'].join('\n')
  const tagged = '<bash-stdout>total 4\nfile</bash-stdout>'
  expect(looksLikeToolOutput(stack)).toBe(true)
  expect(looksLikeToolOutput(rust)).toBe(true)
  expect(looksLikeToolOutput(tagged)).toBe(true)
  const bullets = ['please do all of this:', '- rename x to n_obs', '- add a test for the loader', '- update the README', '1. then run the tests', '2. report what failed'].join('\n')
  expect(looksLikeToolOutput(bullets)).toBe(false)
  expect(looksLikeToolOutput('one line of prose')).toBe(false)
})

test('isNotATask covers slash commands, confirmations and pasted output', () => {
  expect(isNotATask('/suggest model')).toBe(true)
  expect(isNotATask('yes')).toBe(true)
  expect(isNotATask('<bash-stdout>x</bash-stdout>')).toBe(true)
  expect(isNotATask('derive the BLUP variance')).toBe(false)
})
