import { test, expect } from 'claude-code/testing'

import { failClosedReason, readConfig } from '../hooks/config'
import { buildDir, world } from './world'


test('a benign command goes straight through: no question, no probe', async ($, on) => {
  const w = world(on, { answer: 'REJECT' })
  const r = await $.tool.call({ tool: 'Bash', command: 'ls -la && git status' })
  expect(w.ran).toEqual(['ls -la && git status'])
  expect(w.asks).toHaveLength(0)
  expect(w.probes).toHaveLength(0)
  expect(r.deny).toBeUndefined()
})

// The dialog is the engine's own, drawn by each surface; the mod's part (hold, ask, obey) is the
// same on every surface, so the Proceed / Cancel / Esc paths run once per surface the session has.
const SURFACES = [['terminal'], ['desktop'], ['terminal', 'desktop']] as const

for (const surfaces of SURFACES)
test(`Proceed on ${surfaces.join('+')}: the question lists the blast radius, then the command runs`, async ($, on) => {
  const w = world(on, { answer: 'Proceed', probe: buildDir, surfaces })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.ran).toEqual(['rm -rf build'])
  expect(r.deny).toBeUndefined()
  expect(w.asks).toHaveLength(1)
  const ask = w.asks[0]!
  expect(ask.options).toEqual(['Cancel', 'Proceed']) // Cancel first: it is the one the dialog opens on
  expect(ask.header).toBe('Blast radius')
  const lines = ask.question.split('\n')
  expect(lines[0]).toBe('Unknown risk · deletes build/') // the probes here cannot scan the folder, so the level is not guessed
  expect(lines[1]).toBe('rm -rf build')
  expect(ask.question).toContain('build/ · 3 files, 38 MB')
  expect(ask.question).not.toMatch(/[A-Z]{4,}/) // no shouting
  expect(ask.question.trimEnd().endsWith('Run this command?')).toBe(true)
  expect(w.toasts).toHaveLength(0)
})

for (const surfaces of SURFACES)
test(`Cancel on ${surfaces.join('+')}: denied with the listing, toast and status set, command never runs`, async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: buildDir, surfaces })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.ran).toEqual([])
  expect(r.deny).toBeDefined()
  expect(r.deny).toContain('cancelled in the dialog')
  expect(r.deny).toContain('build/ · 3 files, 38 MB')
  expect(r.deny).toContain('Not run: rm -rf build')
  expect(w.toasts[0]).toBe('Blocked rm -rf build · 3 files, 38 MB')
  expect(w.status[0]).toBe('Blocked rm -rf build · 3 files, 38 MB')
})

test('the status line clears itself after a while', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: buildDir })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.status).toHaveLength(1)
  await w.clock.advance(31_000)
  expect(w.status).toEqual([expect.stringContaining('Blocked'), undefined])
})

for (const surfaces of SURFACES)
test(`Esc / dismissed dialog on ${surfaces.join('+')}: denied, not run`, async ($, on) => {
  const w = world(on, { answer: 'REJECT', probe: buildDir, surfaces })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.ran).toEqual([])
  expect(r.deny).toBeDefined()
  expect(r.deny).toContain('no answer: dialog dismissed')
  expect(r.deny).toContain('build/ · 3 files')
})

test('a session with no surface (headless): refused without asking, listing what was at stake', async ($, on) => {
  const w = world(on, { answer: 'Proceed', probe: buildDir, surfaces: [] })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks).toHaveLength(0)
  expect(w.ran).toEqual([])
  expect(r.deny).toContain('no screen to ask on')
  expect(r.deny).toContain('build/ · 3 files, 38 MB')
})

test('anything but exactly "Proceed" is a no (free text under Other)', async ($, on) => {
  const w = world(on, { probe: buildDir })
  for (const answer of ['no', 'proceed anyway', '']) {
    w.answer = answer
    const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
    expect(r.deny).toBeDefined()
  }
  expect(w.ran).toEqual([])
})

test('measuring fails: still held, says "could not measure"', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: () => ({ exitCode: 2, stderr: 'boom' }) })
  w.probes.length = 0
  const r = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('Not checked  git diff failed: boom')
  expect(w.asks[0]!.question.split('\n')[0]).toBe('Unknown risk · discards uncommitted changes')
  expect(r.deny).toBeDefined()
  expect(w.ran).toEqual([])
})

test('a probe that throws outright still holds', async ($, on) => {
  const w = world(on, { answer: 'Proceed', probe: () => undefined }) // every probe is unscripted -> throws
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.asks[0]!.question).toContain('Not checked')
  expect(w.ran).toEqual(['rm -rf build']) // the user said Proceed, having been told nothing was checked
  expect(r.deny).toBeUndefined()
})

test('cd /abs/path && rm -rf build measures /abs/path/build', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: argv => ({ stdout: argv.join(' ').includes('-type d') || argv[0] === 'du' ? '' : '' }) })
  await $.tool.call({ tool: 'Bash', command: 'cd /abs/path && rm -rf build' })
  expect(w.probes.some(p => p.argv.includes('/abs/path/build'))).toBe(true)
  expect(w.probes.some(p => p.argv.includes('/work/build'))).toBe(false)
  expect(w.asks[0]!.question).toContain('Runs in      /abs/path')
})

test('> file is held only when the file exists and has content', async ($, on) => {
  const missing = world(on, { answer: 'REJECT', probe: () => ({ stdout: '' }) })
  await $.tool.call({ tool: 'Bash', command: 'echo hi > new.txt' })
  expect(missing.asks).toHaveLength(0)
  expect(missing.ran).toEqual(['echo hi > new.txt'])
})

test('> file on a non-empty file asks', async ($, on) => {
  const w = world(on, {
    answer: 'Cancel',
    probe: argv => {
      const line = argv.join(' ')
      if (/-size \+0c -print$/.test(line) || /-maxdepth 0 -print$/.test(line)) return { stdout: '/work/notes.txt\n' }
      if (/^du -sk/.test(line)) return { stdout: '12\t/work/notes.txt\n' }
      return { stdout: '' }
    },
  })
  const r = await $.tool.call({ tool: 'Bash', command: 'echo hi > notes.txt' })
  expect(w.asks[0]!.question).toContain('notes.txt · 12 KB')
  expect(w.asks[0]!.question.split('\n')[0]).toBe('High risk · overwrites notes.txt')
  expect(r.deny).toBeDefined()
})

test('a line with several risky commands lists each one', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: () => ({ stdout: '' }) })
  await $.tool.call({ tool: 'Bash', command: 'git stash clear; psql -c "DROP TABLE t"' })
  const q = w.asks[0]!.question
  expect(q.split('\n')[0]).toBe('High risk · 2 risky commands')
  expect(q).toContain('● High · deletes all stashes')
  expect(q).toContain('● Unknown · runs destructive SQL')
  expect(q).toContain('DROP TABLE t')
})

test('userConfig: maxListed caps the rows, extraPatterns adds commands', { options: { maxListed: 5, extraPatterns: ['deploy\\.sh\\s+--prod'] } }, async ($, on) => {
  const names = Array.from({ length: 9 }, (_, k) => `/work/f${k}`)
  const w = world(on, {
    answer: 'Cancel',
    probe: argv => {
      const line = argv.join(' ')
      if (/-maxdepth 0 -type d -print$/.test(line)) return { stdout: '' }
      if (/-maxdepth 0 -print$/.test(line)) return { stdout: names.join('\n') }
      if (argv[0] === 'du') return { stdout: names.map(n => `1\t${n}`).join('\n') }
      return undefined
    },
  })
  await $.tool.call({ tool: 'Bash', command: `rm -f ${names.join(' ')}` })
  expect(w.asks[0]!.question).toContain('+4 more')
  await $.tool.call({ tool: 'Bash', command: './deploy.sh --prod' })
  expect(w.asks[1]!.question).toContain('matches your extra pattern')
  expect(w.asks[1]!.question).toContain('Not checked')
  await $.tool.call({ tool: 'Bash', command: './deploy.sh --dry' })
  expect(w.asks).toHaveLength(2)
})

test('a hook failure never wedges ordinary commands (fail-open for benign text)', async ($, on) => {
  const w = world(on, { answer: 'REJECT' })
  // no `command` at all: the classifier throws; there is nothing destructive to refuse on
  const r = await $.tool.call({ tool: 'Bash' } as never)
  expect(w.asks).toHaveLength(0)
  expect(r.deny).toBeUndefined()
})

test('failClosedReason: refuse destructive-looking text, pass the rest', () => {
  const cfg = readConfig({})
  expect(failClosedReason('rm -rf /tmp/x', cfg)).toContain('Not run')
  expect(failClosedReason('rm -rf\n/tmp/x', cfg)).not.toContain('\n') // one line
  expect(failClosedReason('git push --force', cfg)).toBeDefined()
  expect(failClosedReason('ls -la', cfg)).toBeUndefined()
  expect(failClosedReason(undefined, cfg)).toBeUndefined()
  const mine = readConfig({ extraPatterns: ['^terraform destroy'] })
  expect(failClosedReason('terraform destroy', mine)).toBeDefined()
})

test('readConfig: defaults, clamping, invalid regexes reported', () => {
  expect(readConfig({}).maxListed).toBe(5)
  expect(readConfig({ maxListed: 1 }).maxListed).toBe(5)
  expect(readConfig({ maxListed: 12 }).maxListed).toBe(12)
  expect(readConfig({ maxListed: 9999 }).maxListed).toBe(200)
  const c = readConfig({ extraPatterns: ['ok', '('] })
  expect(c.extraPatterns).toHaveLength(1)
  expect(c.badPatterns).toEqual(['('])
})

// ---- native Windows: Unix find/du do not exist there, so nothing is measured and nothing may slip through silently ----
import { looksWindows } from '../hooks/windows'

test('looksWindows recognises drive-letter and UNC paths only', () => {
  expect(looksWindows('C:\\Users\\sam\\proj')).toBe(true)
  expect(looksWindows('d:/data')).toBe(true)
  expect(looksWindows('\\\\server\\share')).toBe(true)
  expect(looksWindows('/home/sam')).toBe(false)
  expect(looksWindows(undefined)).toBe(false)
})

test('Windows: a destructive command is still held, says nothing was measured, and runs no probe', async ($, on) => {
  const w = world(on, { answer: 'Cancel', cwd: 'C:/Users/sam/proj' })
  const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(w.probes).toHaveLength(0) // never the Unix find/du
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question.split('\n')[0]).toBe('Unknown risk · deletes build')
  expect(w.asks[0]!.question).toContain('Nothing can be listed on Windows')
  expect(w.asks[0]!.question).toContain('rm -rf build')
  expect(r.deny).toBeDefined()
  expect(w.ran).toEqual([])
})

test('Windows: Proceed lets the command run', async ($, on) => {
  const w = world(on, { answer: 'Proceed', cwd: 'C:/Users/sam/proj' })
  const r = await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git reset --hard'])
})

test('Windows: a plain redirect is not interrupted (it would need a file check)', async ($, on) => {
  const w = world(on, { answer: 'Cancel', cwd: 'C:/Users/sam/proj' })
  await $.tool.call({ tool: 'Bash', command: 'echo hi > out.txt' })
  expect(w.asks).toHaveLength(0)
  expect(w.ran).toEqual(['echo hi > out.txt'])
})

// ---- every text shown to the person is calm and fits on its own lines ----------------------------------------------------
// This mod never drops a prompt (no prompt.submit hook), so there is no `{ drop }` reason to check. The one-line rule
// that applies here is for the toast and the status line: a line break would draw as a garbled character on desktop.

test('the toast and the status line are one line even when the command spans several lines', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: buildDir })
  const r = await $.tool.call({ tool: 'Bash', command: 'echo start\nrm -rf build\necho done' })
  expect(r.deny).toBeDefined()
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).not.toMatch(/[\r\n]/)
  expect(w.status[0]).not.toMatch(/[\r\n]/)
  expect(w.toasts[0]).toBe('Blocked rm -rf build · 3 files, 38 MB')
})

test('a command with line breaks is shown on one line in the dialog headline block', async ($, on) => {
  const w = world(on, { answer: 'Cancel', probe: buildDir })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf \\\n  build' })
  const lines = w.asks[0]!.question.split('\n')
  expect(lines[1]).toBe('rm -rf \\ build')
})

test('the dialog stays short: a headline, the command, a few aligned rows, then the question', async ($, on) => {
  const names = Array.from({ length: 30 }, (_, k) => `/work/f${k}`)
  const w = world(on, {
    answer: 'Cancel',
    probe: argv => {
      const line = argv.join(' ')
      if (/-maxdepth 0 -type d -print$/.test(line)) return { stdout: '' }
      if (/-maxdepth 0 -print$/.test(line)) return { stdout: names.join('\n') }
      if (argv[0] === 'du') return { stdout: names.map(n => `1\t${n}`).join('\n') }
      return undefined
    },
  })
  await $.tool.call({ tool: 'Bash', command: `rm -f ${names.join(' ')}` })
  const q = w.asks[0]!.question
  expect(q.split('\n').length).toBeLessThanOrEqual(16)
  expect(q).toContain('+25 more') // the default shows 5 rows
  expect(q.split('\n')[0]).toBe('Unknown risk · deletes 30 files')
})
