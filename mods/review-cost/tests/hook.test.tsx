import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { CANCEL_TEXT } from '../hooks/format'
import { repo, world } from './world'
import type { Surface } from './world'

const SURFACES = ['terminal', 'desktop'] as const
const PUSH = 'git push origin main'

// Diff sizes by number of added lines in the one changed file (60 bytes a line + 200 per file):
//   20 lines -> GREEN, 580 lines -> AMBER (~36k tokens), 5000 lines with theoryMaxBytes=250000 -> RED.
//   The default cap (120000 bytes) tops out near 84k tokens: AMBER, so RED needs a larger cap,
//   lower thresholds, or calibration from real runs.
const RED = repo(5000, { config: ['toolkit.theorymaxbytes 250000'] })

const decision = (w: { decisions: string[] }) => w.decisions.map(d => d.replace(/:\d+$/, ':<t>'))

// ----------------------------------------------------------------- untouched paths

test('not a push: nothing is probed, asked or recorded', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash', command: 'git status && ls' })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual(['git status && ls'])
  expect(w.runs).toHaveLength(0)
  expect(w.asks).toHaveLength(0)
})

const UNTOUCHED: [string, Parameters<typeof repo>[1], string?, string?][] = [
  ['no theory file and no theoryPaths', { tracked: [] }],
  ['toolkit.theoryReview is false', { config: ['toolkit.theoryreview false'] }],
  ['SKIP_THEORY_REVIEW=1 in the environment', {}, '1'],
  ['SKIP_THEORY_REVIEW=1 in the command text', {}, undefined, 'SKIP_THEORY_REVIEW=1 git push origin main'],
  ['no commits yet', { head: false }],
  ['nothing changed in the theory paths', { numstat: '' }],
  ['the diff cannot be computed', { failDiff: true }],
  ['--dry-run', {}, undefined, 'git push --dry-run'],
]
for (const [name, extra, skipEnv, command] of UNTOUCHED)
  test(`untouched: ${name}`, async ($, on) => {
    const w = world(on, { repo: repo(580, extra), skipEnv, answer: 'REJECT' })
    const r = await $.tool.call({ tool: 'Bash', command: command ?? PUSH })
    expect(r.deny).toBeUndefined()
    expect(w.ran).toEqual([command ?? PUSH])
    expect(w.asks).toHaveLength(0)
    expect(w.decisions).toHaveLength(0)
    expect(w.toasts).toHaveLength(0)
  })

test('theoryPaths alone is enough (no docs/THEORY_REVIEW.md), and its paths reach git diff', async ($, on) => {
  const w = world(on, { repo: repo(580, { tracked: [], config: ['toolkit.theorypaths analysis/ lib'] }) })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  const diff = w.runs.find(x => x.argv[1] === 'diff')!
  expect(diff.argv.slice(-3)).toEqual(['--', 'analysis/', 'lib'])
  expect(w.asks).toHaveLength(1)
})

test('default theory paths are "R src"; the base is the merge-base with the upstream', async ($, on) => {
  const w = world(on)
  await $.tool.call({ tool: 'Bash', command: PUSH })
  const diff = w.runs.find(x => x.argv[1] === 'diff')!
  expect(diff.argv).toEqual(['git', 'diff', '--numstat', '--no-renames', 'base123', 'HEAD', '--', 'R', 'src'])
})

test('a new branch with no upstream falls back to the default branch', async ($, on) => {
  const w = world(on, { repo: repo(580, { upstream: undefined }) })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(w.runs.some(x => x.argv.join(' ') === 'git merge-base HEAD origin/main')).toBe(true)
  expect(w.runs.find(x => x.argv[1] === 'diff')!.argv).toContain('base123')
})

test('the empty tree is the base when nothing else resolves', async ($, on) => {
  const w = world(on, { repo: repo(580, { upstream: 'origin/gone', mergeBases: [] }) })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  const diff = w.runs.find(x => x.argv[1] === 'diff')!
  expect(diff.argv).toContain('4b825dc642cb6eb9a060e54bf8d69288fbd2d4f')
})

test('git -C chooses where git runs (Windows-style path with a space included)', async ($, on) => {
  const w = world(on, { repo: repo(20) })
  await $.tool.call({ tool: 'Bash', command: 'git -C "C:/x y" push' })
  expect(w.runs[0]!.cwd).toBe('C:/x y')
})

test('cd sub && git push runs git in the session directory plus sub', async ($, on) => {
  const w = world(on, { repo: repo(20), cwd: '/work' })
  await $.tool.call({ tool: 'Bash', command: 'cd sub && git push' })
  expect(w.runs[0]!.cwd).toBe('/work/sub')
})

// ----------------------------------------------------------------- green: silent

for (const surfaces of [['terminal'], ['desktop']] as const)
  test(`green on ${surfaces[0]}: one-line toast, no dialog, review recorded`, async ($, on) => {
    const w = world(on, { repo: repo(20), surfaces, answer: 'REJECT' })
    await w.clock.now()
    const r = await $.tool.call({ tool: 'Bash', command: PUSH })
    expect(r.deny).toBeUndefined()
    expect(w.ran).toEqual([PUSH])
    expect(w.asks).toHaveLength(0)
    expect(w.toasts).toEqual([expect.stringMatching(/^Codex review \u00B7 about \d+(\.\d)?k tokens \u00B7 Green$/)])
    expect(decision(w)).toEqual(['review:<t>'])
  })

test('the decision carries epoch SECONDS from the clock', async ($, on) => {
  const w = world(on, { repo: repo(20) })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  const stamp = Number(w.decisions[0]!.split(':')[1])
  expect(stamp).toBe(Math.floor(w.clock.now() / 1000))
})

test('askWhen=always asks even when green', { options: { askWhen: 'always' } }, async ($, on) => {
  const w = world(on, { repo: repo(20) })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('\u25CF Green')
  expect(w.toasts).toHaveLength(0)
})

// ----------------------------------------------------------------- amber: dialog

for (const surface of SURFACES)
  test(`amber on ${surface}: dialog with the level word, Review runs the push and records review`, async ($, on) => {
    const w = world(on, { surfaces: [surface], answer: 'Review' })
    const r = await $.tool.call({ tool: 'Bash', command: PUSH })
    expect(r.deny).toBeUndefined()
    expect(w.ran).toEqual([PUSH])
    expect(decision(w)).toEqual(['review:<t>'])
    expect(w.asks).toHaveLength(1)
    const ask = w.asks[0]!
    expect(ask.options).toEqual(['Review', 'Skip'])
    expect(ask.header).toBe('Review cost')
    const [head, level] = ask.question.split('\n')
    expect(head).toMatch(/^Codex review \u00B7 about \d+k tokens$/)
    expect(level).toMatch(/^\u25CF Amber {2}\u25B0+\u25B1+ {2}\d+k to \d+k$/)
    expect(ask.question).toContain('1 file \u00B7 580 changed lines \u00B7 about')
    expect(ask.question).toContain('Largest: R/model.R +580 -0')
    expect(ask.question).toContain('Estimate, not a measurement.')
    expect(ask.question).toContain('Skip still pushes, marked UNREVIEWED.')
    expect(ask.question).not.toContain('$') // no dollars unless both prices are set
    expect(ask.question.trimEnd().endsWith('?')).toBe(true)
    expect(ask.question.split('\n').length).toBeLessThanOrEqual(10) // concise: headline, level, a few plain lines
  })

test('Skip on amber records skip and the push still runs', async ($, on) => {
  const w = world(on, { answer: 'Skip' })
  const r = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual([PUSH])
  expect(decision(w)).toEqual(['skip:<t>'])
})

test('top 3 files by changed lines, capped note, calibration note, dollars when both prices set', {
  options: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
}, async ($, on) => {
  const numstat = ['10\t0\ta.R', '900\t100\tbig.R', '300\t0\tc.R', '5\t5\td.R', '70\t0\te.R', '1\t1\tf.R', '-\t-\timg.png', '40\t2\tg.R'].join('\n')
  const usage = ['50000:50000', '50000:50000', '50000:50000', 'junk'].map(h => `toolkit.theoryusage ${h}`)
  const w = world(on, { repo: repo(0, { numstat, config: ['toolkit.theorymaxbytes 50000', ...usage] }) })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  const q = w.asks[0]!.question
  expect(q).toContain('Largest: big.R +900 -100, c.R +300 -0, e.R +70 -0, and 5 more')
  expect(q).toContain('(capped at 49 KB)')
  expect(q).toContain('Estimate from your last 3 reviews, not a measurement.')
  expect(q).toMatch(/About \$\d\.\d\d at API prices/)
})

test('a Claude reviewer is labelled as counting against the plan', async ($, on) => {
  const w = world(on, { repo: repo(580, { config: ['toolkit.theoryreviewer claude'] }) })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  const q = w.asks[0]!.question
  expect(q.split('\n')[0]).toMatch(/^Claude review \u00B7 about/)
  expect(q).toContain('\u25CF Amber')
  expect(q).toContain('Counts against your Claude plan')
  expect(q.trimEnd().endsWith('Review with Claude before pushing?')).toBe(true)
})

// ----------------------------------------------------------------- red

for (const surface of SURFACES)
  test(`red on ${surface}: Skip is the first (default) option; choosing it records skip`, async ($, on) => {
    const w = world(on, { repo: RED, surfaces: [surface], answer: 'Skip' })
    const r = await $.tool.call({ tool: 'Bash', command: PUSH })
    expect(r.deny).toBeUndefined()
    expect(w.ran).toEqual([PUSH])
    expect(w.asks[0]!.options).toEqual(['Skip', 'Review anyway'])
    expect(w.asks[0]!.question).toContain('\u25CF Red')
    expect(w.asks[0]!.question).toContain('capped at')
    expect(decision(w)).toEqual(['skip:<t>'])
  })

test('red: "Review anyway" records review', async ($, on) => {
  const w = world(on, { repo: RED, answer: 'Review anyway' })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(decision(w)).toEqual(['review:<t>'])
})

test('red also comes from calibration, and from lowered thresholds', { options: { greenMaxTokens: 1000, redMinTokens: 2000 } }, async ($, on) => {
  const w = world(on, { answer: 'Skip' })
  await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(w.asks[0]!.question).toContain('\u25CF Red')
})

// ----------------------------------------------------------------- cancel and failures

for (const surface of SURFACES)
  test(`cancel on ${surface}: push denied, nothing recorded, push never runs`, async ($, on) => {
    const w = world(on, { surfaces: [surface], answer: 'REJECT' })
    const r = await $.tool.call({ tool: 'Bash', command: PUSH })
    expect(r.deny).toBe(CANCEL_TEXT)
    expect(r.deny).toContain('Push cancelled')
    expect(r.deny).not.toMatch(/[\r\n]/) // one line
    expect(w.ran).toEqual([])
    expect(w.decisions).toHaveLength(0)
  })

test('free text under Other is a cancel, never a Review or Skip', async ($, on) => {
  const w = world(on, { answer: 'skip please' })
  const r = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(r.deny).toContain('Push cancelled')
  expect(w.ran).toEqual([])
})

test('headless (no surface): not asked, push goes through, nothing recorded', async ($, on) => {
  const w = world(on, { surfaces: [], answer: 'REJECT' })
  const r = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual([PUSH])
  expect(w.asks).toHaveLength(0)
  expect(w.decisions).toHaveLength(0)
})

for (const throwOn of ['rev-parse --show-toplevel', 'config --get-regexp', 'diff', 'config --local'])
  test(`fail-open: git throwing at "${throwOn}" never blocks the push (it runs exactly once)`, async ($, on) => {
    const w = world(on, { throwOn, answer: 'Skip' })
    const r = await $.tool.call({ tool: 'Bash', command: PUSH })
    expect(r.deny).toBeUndefined()
    expect(w.ran).toEqual([PUSH])
  })

test('a Skip that cannot be recorded says so (the review will run); the push still goes', async ($, on) => {
  const w = world(on, { repo: repo(580, { failConfigWrite: true }), answer: 'Skip' })
  const r = await $.tool.call({ tool: 'Bash', command: PUSH })
  expect(r.deny).toBeUndefined()
  expect(w.ran).toEqual([PUSH])
  expect(w.toasts).toEqual(['Could not record Skip. The review will run.'])
})

test('a push command with no text at all does not break the hook', async ($, on) => {
  const w = world(on)
  const r = await $.tool.call({ tool: 'Bash' } as never)
  expect(r.deny).toBeUndefined()
  expect(w.asks).toHaveLength(0)
})

// ----------------------------------------------------------------- the colored banner

const dialogProps = (question: string, header = 'Review cost') => ({
  tool: 'AskUserQuestion',
  questions: [{ question, header, multiSelect: false, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] }],
})

/** Beneath the plugin stands the engine's own dialog, as core answers next(e). Call once per test, before the first $ use. */
const engineDialog = (on: On) => on('ui.render', () => ({ type: 'engine', ref: 0 }) as never)

const drawn = ($: Engine, surface: Surface, question: string, header?: string) =>
  $.ui.mount({ plugin: 'review-cost', surface, component: 'AskUserQuestion', props: dialogProps(question, header) as never })

for (const surface of SURFACES) {
  const COLORS = [['Green', 'success'], ['Amber', 'warning'], ['Red', 'error']] as const
  for (const [level, color] of COLORS)
    test(`banner on ${surface}: ${level} headline drawn in ${color}, wrapped around the engine's dialog`, async ($, on) => {
      engineDialog(on)
      const text = `\u25CF ${level}  \u25B0\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1  21k to 88k`
      const ui = await drawn($, surface, `Codex review \u00B7 about 42k tokens\n${text}\n\nmore`)
      expect((await ui.find({ type: 'Text', text }))?.props.color).toBe(color)
    })

  test(`banner on ${surface}: another plugin's dialog is left alone`, async ($, on) => {
    engineDialog(on)
    const other = await drawn($, surface, 'Codex review \u00B7 about 1k tokens\n\u25CF Amber', 'Approach')
    expect(await other.find({ type: 'Text', text: /Amber/ })).toBeUndefined()
    const odd = await drawn($, surface, 'Which file?')
    expect(await odd.find({ type: 'Text' })).toBeUndefined()
  })

  test(`banner on ${surface}: coloredBanner=false draws nothing extra`, { options: { coloredBanner: false } }, async ($, on) => {
    engineDialog(on)
    const ui = await drawn($, surface, 'Codex review \u00B7 about 1k tokens\n\u25CF Red')
    expect(await ui.find({ type: 'Text', text: /Red/ })).toBeUndefined()
  })
}
