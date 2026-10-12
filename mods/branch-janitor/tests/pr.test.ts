// Open pull requests: the report lines, the protection of a branch whose PR is still open, and every way the
// gh call can be absent or fail (silently). Same scripted world as flow.test.ts.
import { test, expect } from 'claude-code/testing'

import { checksOf, parseOpenPrs, prSection, reviewOf } from '../hooks/prs'
import { SHA, world } from './world'
import type { FakeBranch, Model } from './world'

const SURFACES = [['terminal'], ['desktop']] as const
const DONE = SHA('d')
const MAIN = SHA('1')

const repo = (branches: Record<string, FakeBranch>, extra: Partial<Model> = {}): Model => ({
  current: 'main',
  branches: { main: { sha: MAIN, upstream: 'refs/remotes/origin/main' }, ...branches },
  ...extra,
})
const merged = (sha = DONE): FakeBranch => ({ sha, merged: true })
const unmerged = (sha: string): FakeBranch => ({ sha, cherry: `+ ${sha}\n` })
const pr = (number: number, head: string, over: object = {}) => ({
  number, headRefName: head, state: 'OPEN', reviewDecision: '', statusCheckRollup: [], ...over,
})
const ok = { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }
const GH_USED = 'ghUsed:/work'

const slash = ($: any, args = '') =>
  $.command.run({ command: 'branch-janitor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const merge = ($: any, command = 'git merge done') => $.tool.call({ tool: 'Bash', command })
const openCalls = (w: { cmds: string[][] }) => w.cmds.filter(c => c[0] === 'gh' && c[1] === 'pr' && c.includes('open'))

// ---------------------------------------------------------------- pure parsing

test('checksOf: failure beats pending beats passing; no checks is none', () => {
  expect(checksOf([ok, { __typename: 'StatusContext', state: 'SUCCESS' }, { conclusion: 'SKIPPED' }])).toBe('passing')
  expect(checksOf([ok, { status: 'IN_PROGRESS', conclusion: '' }])).toBe('pending')
  expect(checksOf([ok, { status: 'QUEUED', conclusion: '' }, { conclusion: 'FAILURE' }])).toBe('failing')
  expect(checksOf([{ __typename: 'StatusContext', state: 'PENDING' }])).toBe('pending')
  expect(checksOf([{ __typename: 'StatusContext', state: 'ERROR' }])).toBe('failing')
  expect(checksOf([{ conclusion: 'TIMED_OUT' }])).toBe('failing')
  expect(checksOf([])).toBe('none')
  expect(checksOf(null)).toBe('none')
  expect(checksOf([{ conclusion: 'SOMETHING_NEW' }])).toBe('pending') // unknown is never reported as passing
})

test('reviewOf: only approved and changes requested are named', () => {
  expect(reviewOf('APPROVED')).toBe('approved')
  expect(reviewOf('CHANGES_REQUESTED')).toBe('changes requested')
  expect(reviewOf('REVIEW_REQUIRED')).toBe('none')
  expect(reviewOf('')).toBe('none')
  expect(reviewOf(null)).toBe('none')
})

test('parseOpenPrs: open rows only, the newest PR per branch, junk ignored', () => {
  const out = JSON.stringify([pr(3, 'a'), pr(9, 'a'), pr(4, 'b', { state: 'MERGED' }), { number: 'x' }, null, pr(5, '')])
  expect(parseOpenPrs(out).map(p => [p.number, p.branch])).toEqual([[9, 'a']])
  expect(parseOpenPrs('not json')).toEqual([])
  expect(parseOpenPrs('{}')).toEqual([])
})

test('prSection: only branches that exist locally, capped at eight lines', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ number: i + 1, branch: `b${i}`, checks: 'none' as const, review: 'none' as const }))
  const lines = prSection([...many, { number: 99, branch: 'elsewhere', checks: 'none', review: 'none' }], many.map(p => p.branch))
  expect(lines[0]).toBe('Open pull requests')
  expect(lines).toHaveLength(1 + 8 + 1)
  expect(lines.at(-1)).toBe('and 2 more')
  expect(lines.join('\n')).not.toContain('elsewhere')
})

// ---------------------------------------------------------------- the report

for (const surfaces of SURFACES)
  test(`the plain-word report lists one line per local branch with an open PR on ${surfaces.join('+')}`, async ($, on) => {
    const w = world(
      on,
      repo(
        { feat: unmerged(SHA('2')), wip: unmerged(SHA('3')), other: unmerged(SHA('4')) },
        {
          gh: {
            installed: true,
            open: [
              pr(42, 'feat', { reviewDecision: 'APPROVED', statusCheckRollup: [ok, ok] }),
              pr(43, 'wip', { reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [ok, { conclusion: 'FAILURE' }] }),
              pr(7, 'main', { statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: '' }] }),
              pr(50, 'not-local'),
            ],
          },
        },
      ),
      { surfaces },
    )
    w.store.set(GH_USED, true)
    const r = await $.prompt.submit({ text: 'branch-janitor', wait: false, origin: { kind: 'composer' } })
    expect(r.drop).toContain('Branches')
    expect(w.logs).toHaveLength(1)
    const lines = w.logs[0]!.split('\n')
    expect(lines).toContain('Open pull requests')
    expect(lines).toContain('#7 open · checks pending · review none · main')
    expect(lines).toContain('#42 open · checks passing · review approved · feat')
    expect(lines).toContain('#43 open · checks failing · review changes requested · wip')
    expect(lines.join('\n')).not.toContain('not-local')
    expect(lines.join('\n')).not.toContain('#50')

    const calls = openCalls(w)
    expect(calls).toEqual([['gh', 'pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,headRefName,statusCheckRollup,reviewDecision,state']])
  })

test('gh not used in this repository: the report never calls gh pr list and shows no pull request lines', async ($, on) => {
  const w = world(on, repo({ feat: unmerged(SHA('2')) }, { gh: { installed: true, open: [pr(42, 'feat')] } }))
  const r = await slash($)
  expect(r.text).not.toContain('#42')
  expect(r.text).not.toContain('Open pull requests')
  expect(openCalls(w)).toHaveLength(0)
})

test('gh missing: silent, no lines, and no call beyond the version probe', async ($, on) => {
  const w = world(on, repo({ feat: unmerged(SHA('2')) }, { gh: { installed: false } }))
  w.store.set(GH_USED, true)
  const r = await slash($)
  expect(r.text).not.toContain('Open pull requests')
  expect(r.text).toContain('feat · not merged yet')
  expect(openCalls(w)).toHaveLength(0)
})

for (const how of ['exit', 'throw'] as const)
  test(`gh ${how === 'exit' ? 'not signed in' : 'timing out'}: the report is the same, minus the pull request lines`, async ($, on) => {
    const w = world(on, repo({ feat: unmerged(SHA('2')) }, { gh: { installed: true, open: [pr(42, 'feat')], openFails: how } }))
    w.store.set(GH_USED, true)
    const r = await slash($)
    expect(r.text).not.toContain('Open pull requests')
    expect(r.text).toContain('feat · not merged yet')
    expect(r.text).not.toMatch(/auth|timed out/i)
  })

test('a gh command run by Claude is remembered, and unlocks the lines in the next report', async ($, on) => {
  const w = world(on, repo({ feat: unmerged(SHA('2')) }, { gh: { installed: true, open: [pr(42, 'feat')] } }))
  expect((await slash($)).text).not.toContain('#42')
  await merge($, 'gh pr view 42')
  expect(w.store.get(GH_USED)).toBe(true)
  expect((await slash($)).text).toContain('#42 open · checks none · review none · feat')
})

test('a command that does not run gh leaves no mark', async ($, on) => {
  const w = world(on, repo({ feat: unmerged(SHA('2')) }, { gh: { installed: true } }))
  await merge($, 'git status && echo gh')
  expect(w.store.has(GH_USED)).toBe(false)
})

// ---------------------------------------------------------------- protection

test('a finished branch whose pull request is still open is never offered: the keep list says #42 still open', async ($, on) => {
  const w = world(on, repo({ done: merged(), feat: unmerged(SHA('2')) }, { gh: { installed: true, open: [pr(42, 'done'), pr(8, 'feat')] } }))
  w.store.set(GH_USED, true)
  const r = await slash($, 'clean')
  expect(r.text).toBe('Branches · nothing to delete right now\nType branch-janitor to see why each branch stays.')
  expect(w.asks).toHaveLength(0)
  const list = (await slash($)).text as string
  expect(list.split('\n')[0]).toBe('Branches · nothing to delete, 2 to keep')
  expect(list).toContain('· done · #42 still open')
  expect(list).toContain('#42 open · checks none · review none · done')
  expect(w.deleted).toEqual([])
})

test('after a merge Claude ran: an open PR keeps the branch out of the dialog, gh is asked once', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { gh: { installed: true, open: [pr(42, 'done')] } }))
  w.store.set(GH_USED, true)
  await merge($)
  expect(w.asks).toHaveLength(0)
  expect(openCalls(w)).toHaveLength(1)
})

test('other finished branches are still offered; only the one with an open PR is held back', async ($, on) => {
  const w = world(on, repo({ done: merged(), also: merged(SHA('e')) }, { gh: { installed: true, open: [pr(42, 'done')] } }))
  w.store.set(GH_USED, true)
  await merge($)
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('Delete 1 finished branch?')
  expect(w.asks[0]!.question).toContain('also')
  expect(w.asks[0]!.question).not.toContain('done\n')
})

test('gh failing at offer time never hides an offer: the branch is offered as before', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { gh: { installed: true, openFails: 'throw' } }))
  w.store.set(GH_USED, true)
  await merge($)
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('Delete 1 finished branch?')
})

test('never per prompt: with nothing to offer there is no gh pr list call, however often branches change', async ($, on) => {
  const w = world(on, repo({ feat: unmerged(SHA('2')) }, { gh: { installed: true, open: [pr(42, 'feat')] } }))
  w.store.set(GH_USED, true)
  await merge($, 'git pull')
  await merge($, 'git merge feat')
  expect(openCalls(w)).toHaveLength(0)
})

test('only git and gh are ever spawned, and the gh calls are read-only list calls', async ($, on) => {
  const w = world(on, repo({ done: merged(), feat: unmerged(SHA('2')) }, { gh: { installed: true, open: [pr(42, 'feat')] } }))
  w.store.set(GH_USED, true)
  await slash($)
  await slash($, 'clean')
  await merge($)
  for (const c of w.cmds) expect(['git', 'gh']).toContain(c[0])
  for (const c of w.cmds.filter(c => c[0] === 'gh' && c[1] !== '--version')) {
    expect(c.slice(1, 3)).toEqual(['pr', 'list'])
    expect(c.filter(a => !a.includes(',')).join(' ')).not.toMatch(/merge|close|edit|create|comment|review|ready|reopen/) // the json field list is not a verb
  }
})
