import { test, expect } from 'claude-code/testing'

import { decide } from '../hooks/decide'
import type { Facts } from '../hooks/decide'
import type { BranchRef } from '../hooks/git'

const SHA = 'c'.repeat(40)
const ref = (o: Partial<BranchRef> = {}): BranchRef => ({ name: 'feat', sha: SHA, isCurrent: false, upstream: '', remote: '', ahead: 0, behind: 0, isGone: false, lastCommit: 1, ...o })
const facts = (o: Partial<Facts> = {}, r: Partial<BranchRef> = {}): Facts => ({ ref: ref(r), hasStash: false, ...o })
const ctx = { defaultName: 'main' }
const failing = (f: Facts) => decide(f, ctx).checks.filter(c => !c.ok).map(c => c.id)

test('merged ancestor: offered with git -d and every check passing', () => {
  const v = decide(facts({ mergedInto: 'main' }), ctx)
  expect(v.status).toBe('offer')
  expect(v.deleteFlag).toBe('-d')
  expect(v.evidence[0]).toEqual({ kind: 'merged', text: 'merged into main' })
  expect(v.checks.map(c => c.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  expect(v.checks.every(c => c.ok)).toBe(true)
  expect(v.checks.find(c => c.id === 'e')!.detail).toBe(`git branch feat ${SHA}`)
})

test('squash/rebase (cherry all minus): offered with -D and the count in the evidence', () => {
  const v = decide(facts({ cherry: { base: 'main', plus: 0, minus: 3 } }), ctx)
  expect(v.status).toBe('offer')
  expect(v.deleteFlag).toBe('-D')
  expect(v.evidence[0]!.text).toBe('all 3 commits already in main (squash/rebase merge)')
  expect(decide(facts({ cherry: { base: 'main', plus: 0, minus: 1 } }), ctx).evidence[0]!.text).toContain('all 1 commit already')
})

test('multi-commit squash: cherry has + lines but every changed file matches the base', () => {
  const v = decide(facts({ cherry: { base: 'main', plus: 2, minus: 0 }, contentBase: 'main' }), ctx)
  expect(v.status).toBe('offer')
  expect(v.deleteFlag).toBe('-D')
  expect(v.evidence.map(e => e.kind)).toEqual(['content'])
})

test('cherry with + lines and nothing else: no evidence, never offered', () => {
  const v = decide(facts({ cherry: { base: 'main', plus: 2, minus: 0 } }), ctx)
  expect(v.status).toBe('keep')
  expect(v.evidence).toEqual([])
})

test('no evidence at all: keep', () => {
  expect(decide(facts(), ctx)).toMatchObject({ status: 'keep' })
})

test('upstream gone alone is only "maybe", never an offer', () => {
  const v = decide(facts({}, { upstream: 'refs/remotes/origin/feat', isGone: true }), ctx)
  expect(v.status).toBe('maybe')
  expect(v.reason).toContain('check before deleting')
})

test('upstream gone + merged: offered; the gone line is shown as extra evidence', () => {
  const v = decide(facts({ mergedInto: 'main' }, { upstream: 'refs/remotes/origin/feat', isGone: true }), ctx)
  expect(v.status).toBe('offer')
  expect(v.evidence.map(e => e.kind)).toEqual(['merged', 'gone'])
  expect(v.checks.find(c => c.id === 'c')!.ok).toBe(true)
})

test('upstream gone + patch evidence: offered', () => {
  expect(decide(facts({ cherry: { base: 'main', plus: 0, minus: 1 } }, { isGone: true, upstream: 'refs/remotes/origin/feat' }), ctx).status).toBe('offer')
})

test('PR merged into the default branch at exactly the tip: offered (check b by head sha)', () => {
  const v = decide(facts({ pr: { number: 9, baseRefName: 'main', headRefOid: SHA }, cherry: { base: 'main', plus: 3, minus: 0 } }), ctx)
  expect(v.status).toBe('offer')
  expect(v.evidence[0]!.text).toBe('PR #9 merged into main')
  expect(v.deleteFlag).toBe('-D')
})

test('PR merged but the branch has commits after it: evidence yes, check b fails, not offered', () => {
  const v = decide(facts({ pr: { number: 9, baseRefName: 'main', headRefOid: 'd'.repeat(40) }, cherry: { base: 'main', plus: 1, minus: 0 } }), ctx)
  expect(v.status).toBe('keep')
  expect(failing(facts({ pr: { number: 9, baseRefName: 'main', headRefOid: 'd'.repeat(40) }, cherry: { base: 'main', plus: 1, minus: 0 } }))).toEqual(['b'])
  expect(v.reason).toContain('PR #9 merged into main')
})

test('a PR merged into some other base is no evidence', () => {
  expect(decide(facts({ pr: { number: 9, baseRefName: 'release', headRefOid: SHA } }), ctx).status).toBe('keep')
})

// every safety check failing individually, on an otherwise finished branch
test('check c: unpushed commits on a live upstream remove the offer', () => {
  const f = facts({ mergedInto: 'main' }, { upstream: 'refs/remotes/origin/feat', ahead: 2 })
  expect(failing(f)).toEqual(['c'])
  const v = decide(f, ctx)
  expect(v.status).toBe('keep')
  expect(v.reason).toContain('2 commits not pushed to origin/feat')
})

test('check c: ahead 0 on a live upstream is fine; behind does not matter', () => {
  expect(decide(facts({ mergedInto: 'main' }, { upstream: 'refs/remotes/origin/feat', ahead: 0, behind: 4 }), ctx).status).toBe('offer')
})

test('check c: gone upstream is fine only when check b holds', () => {
  const f = facts({ pr: { number: 1, baseRefName: 'main', headRefOid: 'd'.repeat(40) }, cherry: { base: 'main', plus: 2, minus: 0 } }, { isGone: true, upstream: 'refs/remotes/origin/feat' })
  expect(failing(f)).toEqual(['b', 'c'])
})

test('check d: a stash made on the branch removes the offer', () => {
  const f = facts({ mergedInto: 'main', hasStash: true })
  expect(failing(f)).toEqual(['d'])
  expect(decide(f, ctx).status).toBe('keep')
})

test('check e: an unreadable tip removes the offer', () => {
  const f = facts({ mergedInto: 'main' }, { sha: '' })
  expect(failing(f)).toEqual(['e'])
  expect(decide(f, ctx).status).toBe('keep')
})

test('check b: the comparison itself failed', () => {
  const f = facts({ pr: { number: 3, baseRefName: 'main', headRefOid: '' } })
  expect(failing(f)).toEqual(['b'])
})

test('exclusions are never considered, whatever the evidence', () => {
  for (const exclusion of ['the branch you are on', 'the default branch', 'protected by the pattern "release/*"', 'checked out in another worktree (/x)', 'unusual branch name'])
    expect(decide(facts({ exclusion, mergedInto: 'main' }), ctx)).toMatchObject({ status: 'excluded', reason: exclusion, checks: [] })
})

test('delete flag: -d only when git itself can see the merge', () => {
  expect(decide(facts({ mergedInto: 'origin/main' }), ctx).deleteFlag).toBe('-d')
  expect(decide(facts({ cherry: { base: 'main', plus: 0, minus: 1 } }), ctx).deleteFlag).toBe('-D')
  expect(decide(facts({ contentBase: 'main' }), ctx).deleteFlag).toBe('-D')
})

test('a failing check is named in the reason together with the evidence', () => {
  const v = decide(facts({ mergedInto: 'main', hasStash: true }, { upstream: 'refs/remotes/origin/feat', ahead: 1 }), ctx)
  expect(v.status).toBe('keep')
  expect(v.reason).toContain('merged into main')
  expect(v.reason).toContain('1 commit not pushed')
  expect(v.reason).toContain('stash')
})
