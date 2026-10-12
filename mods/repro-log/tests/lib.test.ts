import { expect, test } from 'claude-code/testing'

import { cleanCommand, isAnalysis, looksSecret, maskArgs, programsOf, seedsOf, stamp } from '../hooks/lib'

const P = programsOf(undefined)

test('analysis commands are told from other shell commands', () => {
  for (const c of ['python3 run.py', 'Rscript a.R', 'R CMD BATCH x.R', 'cd d && make all', 'FOO=1 pytest -q', 'cargo run --release', '/usr/bin/python3 x.py', 'quarto render'])
    expect(isAnalysis(c, P), c).toBe(true)
  for (const c of ['ls -la', 'git status', 'cargo build', 'R --version | head', 'echo python'])
    expect(isAnalysis(c, P), c).toBe(false)
})

test('programs setting: custom list and fallback to the default', () => {
  expect(isAnalysis('julia x.jl', programsOf('julia'))).toBe(true)
  expect(isAnalysis('python x.py', programsOf('julia'))).toBe(false)
  expect(isAnalysis('python x.py', programsOf('  '))).toBe(true)
})

test('secrets', () => {
  for (const c of ['python x.py --api-key abc', 'TOKEN=1 python x.py', 'curl -H "Authorization: Bearer abc"', 'PASSWORD=x make', 'python x.py --secret s', 'python x.py postgres://u:pw@h/db'])
    expect(looksSecret(c), c).toBe(true)
  expect(cleanCommand('python x.py --token 1')).toBeUndefined()
  expect(maskArgs('python x.py --password hunter2 --n 3')).toBe('python x.py --password *** --n 3')
  expect(maskArgs('x --pwd="a b" y')).toBe('x --pwd *** y')
})

test('seeds are literal numbers only', () => {
  expect(seedsOf(['python x.py --seed 42', 'Rscript -e "set.seed(7)"', 'python x.py --seed $S', 'x random_state=3', 'python x.py --seed=42'])).toEqual(['42', '7', '3'])
})

test('stamp is YYYY-MM-DD-HHMM', () => {
  expect(stamp(Date.UTC(2026, 9, 12, 12, 0))).toMatch(/^2026-10-1[123]-\d{4}$/)
})
