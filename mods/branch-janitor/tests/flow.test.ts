import { test, expect } from 'claude-code/testing'

import { SHA, world } from './world'
import type { FakeBranch, Model } from './world'

const SURFACES = [['terminal'], ['desktop'], ['terminal', 'desktop']] as const
const DONE = SHA('d')
const MAIN = SHA('1')

/** main (current) plus the given feature branches. */
const repo = (branches: Record<string, FakeBranch>, extra: Partial<Model> = {}): Model => ({
  current: 'main',
  branches: { main: { sha: MAIN, upstream: 'refs/remotes/origin/main' }, ...branches },
  ...extra,
})
const merged = (sha = DONE): FakeBranch => ({ sha, merged: true })
const squashed = (sha: string): FakeBranch => ({ sha, cherry: `- ${sha}\n` })
const merge = ($: any, command = 'git merge done') => $.tool.call({ tool: 'Bash', command })
const slash = ($: any, args: string) => $.command.run({ command: 'branch-janitor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const repoState = (w: { store: Map<string, unknown> }) => w.store.get('repo:/work') as { lastLook: number; snoozeUntil: number }

test('a command that is not a trigger costs nothing: no git call at all', async ($, on) => {
  const w = world(on, repo({ done: merged() }))
  const r = await merge($, 'git status && ls')
  expect(w.cmds).toHaveLength(0)
  expect(w.asks).toHaveLength(0)
  expect((r.result as { stdout: string }).stdout).toBe('ran git status && ls')
})

for (const surfaces of SURFACES)
  test(`finished branch after git merge on ${surfaces.join('+')}: the dialog lists evidence, checks, tip and the undo command; the Bash result is untouched`, async ($, on) => {
    const w = world(on, repo({ done: merged() }), { surfaces })
    const r = await merge($)
    expect((r.result as { stdout: string }).stdout).toBe('ran git merge done')
    expect(r.deny).toBeUndefined()
    expect(w.asks).toHaveLength(1)
    const ask = w.asks[0]!
    expect(ask.header).toBe('Branches')
    expect(ask.options).toEqual(['Keep', 'Delete branch', 'Never ask here'])
    expect(ask.question.split('\n')[0]).toBe('Delete 1 finished branch?')
    expect(ask.question).toBe(
      ['Delete 1 finished branch?', '', 'done', '✓ Merged into main', '✓ Nothing unpushed · no stash', `→ Restore: git branch done ${DONE}`, '', 'Local branches only. Remote copies are asked separately.'].join('\n'),
    )
    expect(ask.question.split('\n').length).toBeLessThanOrEqual(8)
    expect(ask.question).not.toMatch(/\[ok\]|\[FAIL\]|Tip:|Undo:/)
    expect(w.deleted).toEqual([]) // "Keep" is the default answer
  })

test('every probe is read-only until the confirmed delete', async ($, on) => {
  const w = world(on, repo({ done: merged(), sq: squashed(SHA('2')) }))
  await merge($)
  const verbs = new Set(w.cmds.map(c => c[6]))
  expect([...verbs].sort()).toEqual(['cherry', 'config', 'for-each-ref', 'merge-base', 'reflog', 'rev-list', 'rev-parse', 'stash', 'symbolic-ref', 'worktree'].filter(v => verbs.has(v)))
  expect(w.cmds.some(c => ['branch', 'push'].includes(c[6]!))).toBe(false)
  expect(w.cmds.every(c => c.slice(0, 6).join(' ') === 'git -c core.quotepath=off --no-optional-locks --no-pager --literal-pathspecs')).toBe(true)
  expect(w.cmds.every(c => c[0] === 'git')).toBe(true)
})

test('Keep: nothing deleted, snoozed; a merge looks again but never re-asks about the branch that was turned down', async ($, on) => {
  const model = repo({ done: merged() })
  const w = world(on, model, { answer: 'Keep' })
  await merge($)
  expect(w.asks).toHaveLength(1)
  expect(repoState(w).snoozeUntil).toBeGreaterThan(0)
  await w.clock.advance(2 * 3_600_000)
  await merge($, 'git push')
  expect(w.asks).toHaveLength(1) // snoozed (24 h), minMinutes long passed
  await merge($, 'gh pr merge 3')
  expect(w.asks).toHaveLength(1) // a merge looks again, but `done` at this tip was already turned down
  model.branches.next = merged(SHA('c')) // a branch that finishes later is a new question
  await merge($, 'gh pr merge 4')
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]!.question).toContain('\nnext\n')
  expect(w.asks[1]!.question).not.toContain('done')
  expect(w.deleted).toEqual([])
  expect(w.toasts).toEqual([])
})

test('a turned-down branch is offered again only once it has a new tip', async ($, on) => {
  const model = repo({ done: merged() })
  const w = world(on, model, { answer: 'Keep' })
  await merge($)
  await merge($, 'git merge x')
  expect(w.asks).toHaveLength(1)
  model.branches.done!.sha = SHA('e') // new commits, merged again
  await merge($, 'git merge x')
  expect(w.asks).toHaveLength(2)
})

test('Keep in the one-by-one questions counts as turned down; the branch that was deleted does not', async ($, on) => {
  const model = repo({ a: merged(SHA('a')), b: merged(SHA('b')) })
  const w = world(on, model, {
    answer: (_q, o, h) => {
      if (h !== 'Branches') return 'Keep'
      if (o.includes('Review one by one')) return 'Review one by one'
      return o.includes('Delete b') ? 'Delete b' : 'Keep'
    },
  })
  await merge($)
  expect(w.deleted).toEqual([{ flag: '-d', name: 'b' }])
  const asked = w.asks.length
  await merge($, 'git merge x')
  expect(w.asks).toHaveLength(asked) // `a` was skipped at this tip
})

test('"Never ask again" and /branch-janitor on: on forgets what was turned down', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: 'Keep' })
  await merge($)
  expect(w.store.get('declined:/work')).toEqual({ done: DONE })
  await slash($, 'on')
  expect(w.store.get('declined:/work')).toEqual({})
  await merge($)
  expect(w.asks).toHaveLength(2)
})

test('rate limit: one scan per repo per minMinutes unless the command was a merge', async ($, on) => {
  const w = world(on, repo({ wip: { sha: SHA('3'), cherry: `+ ${SHA('3')}\n` } }))
  const scans = () => w.cmds.filter(c => c[6] === 'for-each-ref' && c[7]!.startsWith('--format=%(HEAD)%09')).length
  await merge($, 'git pull')
  expect(scans()).toBe(1)
  await merge($, 'git pull')
  expect(scans()).toBe(1)
  await merge($, 'git merge x')
  expect(scans()).toBe(2) // a merge bypasses the limit
  await w.clock.advance(31 * 60_000)
  await merge($, 'git fetch --prune')
  expect(scans()).toBe(3)
})

test('delete (merged): git branch -d, one toast and transcript lines with the restore command', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: 'Delete branch' })
  const r = await merge($)
  expect(w.deleted).toEqual([{ flag: '-d', name: 'done' }])
  expect(w.cmds.find(c => c[6] === 'branch')).toEqual(expect.arrayContaining(['branch', '-d', '--', 'done']))
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toBe(`Deleted 1 branch · restore with:\ngit branch done ${DONE}`)
  expect(w.logs).toEqual(['Deleted 1 branch · restore with:', `git branch done ${DONE}`])
  expect(w.logs.every(l => !l.includes('\n'))).toBe(true) // a newline in $.ui.log draws as a stray glyph
  expect((r.result as { stdout: string }).stdout).toBe('ran git merge done')
})

test('squash merge: git branch -D, and the dialog explains why that is still safe', async ($, on) => {
  const w = world(on, repo({ sq: squashed(SHA('5')) }), { answer: 'Delete branch' })
  await merge($, 'git merge sq')
  expect(w.asks[0]!.question).toContain('✓ All 1 commit already in main (squash/rebase merge)')
  expect(w.asks[0]!.question).toContain("· Uses git branch -D, because git can't see squash merges")
  expect(w.asks[0]!.question).toContain(`→ Restore: git branch sq ${SHA('5')}`)
  expect(w.deleted).toEqual([{ flag: '-D', name: 'sq' }])
})

test('git -d refusing a verified merge (it checks HEAD, not main) falls back to -D', async ($, on) => {
  const w = world(on, repo({ done: { ...merged(), deleteFails: "error: the branch 'done' is not fully merged" } }), { answer: 'Delete branch' })
  await merge($)
  expect(w.deleted).toEqual([{ flag: '-D', name: 'done' }])
})

test('another git refusal is reported, never retried with force', async ($, on) => {
  const w = world(on, repo({ done: { ...merged(), deleteFails: 'error: something else broke' } }), { answer: 'Delete branch' })
  await merge($)
  expect(w.deleted).toEqual([])
  expect(w.toasts[0]).toContain('✗ done: error: something else broke')
})

test('the branch moved after the scan: left alone', async ($, on) => {
  const model = repo({ done: merged() })
  const w = world(on, model, { answer: () => ((model.branches.done!.sha = SHA('9')), 'Delete branch') })
  await merge($)
  expect(w.deleted).toEqual([])
  expect(w.toasts[0]).toContain('✗ done: new commits since the check, left alone')
})

test('remote copy: a SEPARATE second question, default No, and No pushes nothing', async ($, on) => {
  const model = repo({ done: { ...merged(), upstream: 'refs/remotes/origin/done', remoteTip: DONE } })
  const w = world(on, model, { answer: (_q, _o, h) => (h === 'Branches' ? 'Delete branch' : 'Keep') })
  await merge($)
  expect(w.asks).toHaveLength(2)
  expect(w.asks[0]!.question).not.toContain('Also delete origin/done?')
  expect(w.asks[1]).toMatchObject({ header: 'Remote', options: ['Keep', 'Delete origin/done'] })
  expect(w.asks[1]!.question.split('\n')[0]).toBe('Also delete origin/done?')
  expect(w.pushed).toEqual([])
  expect(w.deleted).toHaveLength(1)
})

test('remote copy: Yes pushes --delete guarded by a lease on the verified tip', async ($, on) => {
  const model = repo({ done: { ...merged(), upstream: 'refs/remotes/origin/done', remoteTip: DONE } })
  const w = world(on, model, { answer: (_q, _o, h) => (h === 'Branches' ? 'Delete branch' : 'Delete origin/done') })
  await merge($)
  expect(w.pushed).toEqual([['push', 'origin', `--force-with-lease=refs/heads/done:${DONE}`, '--delete', 'done']])
  expect(w.toasts[0]).toContain('✓ Deleted origin/done on the server')
})

test('remote copy: a failed push is reported', async ($, on) => {
  const model = repo({ done: { ...merged(), upstream: 'refs/remotes/origin/done', remoteTip: DONE } }, { pushFails: 'stale info' })
  const w = world(on, model, { answer: (_q, _o, h) => (h === 'Branches' ? 'Delete branch' : 'Delete origin/done') })
  await merge($)
  expect(w.toasts[0]).toContain('✗ origin/done: stale info')
})

test('remote copy: never asked when the server tip differs from what was deleted', async ($, on) => {
  const moved = world(on, repo({ done: { ...merged(), upstream: 'refs/remotes/origin/done', remoteTip: SHA('e'), remoteAncestorOfBase: false } }), { answer: 'Delete branch' })
  await merge($)
  expect(moved.asks).toHaveLength(1)
  expect(moved.pushed).toEqual([])
})

test('remote copy: a remote tip that is already inside main is offered', async ($, on) => {
  const w = world(on, repo({ done: { ...merged(), upstream: 'refs/remotes/origin/done', remoteTip: SHA('e'), remoteAncestorOfBase: true } }), { answer: (_q, _o, h) => (h === 'Branches' ? 'Delete branch' : 'Keep') })
  await merge($)
  expect(w.asks).toHaveLength(2)
})

test('remote copy: [gone] upstream means no remote question at all', async ($, on) => {
  const w = world(on, repo({ done: { ...merged(), upstream: 'refs/remotes/origin/done', track: '[gone]', remoteTip: DONE } }), { answer: 'Delete branch' })
  await merge($)
  expect(w.asks).toHaveLength(1)
  expect(w.deleted).toHaveLength(1)
})

test('remote copy dismissed (Esc) counts as No', async ($, on) => {
  let n = 0
  const w = world(on, repo({ done: { ...merged(), upstream: 'refs/remotes/origin/done', remoteTip: DONE } }), {
    answer: () => {
      if (n++ === 0) return 'Delete branch'
      throw new Error('dismissed')
    },
  })
  await merge($)
  expect(w.pushed).toEqual([])
  expect(w.deleted).toHaveLength(1)
})

test('several branches: Delete all N, then a remote question per branch with a way out', async ($, on) => {
  const up = (n: string): FakeBranch => ({ ...merged(SHA(n)), upstream: `refs/remotes/origin/b${n}`, remoteTip: SHA(n) })
  const w = world(on, repo({ b1: up('1'), b2: up('2'), b3: up('3') }), { answer: (_q, o, h) => (h === 'Branches' ? o[1]! : 'Keep the rest') })
  await merge($)
  expect(w.asks[0]!.options).toEqual(['Keep', 'Delete all 3', 'Review one by one', 'Never ask here'])
  expect(w.asks[0]!.question.split('\n')[0]).toBe('Delete 3 finished branches?')
  expect(w.deleted.map(d => d.name).sort()).toEqual(['b1', 'b2', 'b3'])
  expect(w.asks).toHaveLength(2) // first remote question offered "Keep the rest"; answering it stops the rest
  expect(w.asks[1]!.options).toEqual(['Keep', expect.stringContaining('Delete origin/b'), 'Keep the rest'])
})

test('Review one by one: each branch asked alone, only the picked ones go', async ($, on) => {
  const w = world(on, repo({ a: merged(SHA('a')), b: merged(SHA('b')) }), {
    answer: (q, o, h) => {
      if (h !== 'Branches') return 'Keep'
      if (o.includes('Review one by one')) return 'Review one by one'
      return o.includes('Delete b') ? 'Delete b' : 'Keep'
    },
  })
  await merge($)
  expect(w.asks).toHaveLength(3)
  expect(w.asks[1]!.options).toEqual(['Keep', 'Delete a'])
  expect(w.asks[1]!.question.split('\n')[0]).toBe('Delete a?')
  expect(w.asks[1]!.question).toContain(`→ Restore: git branch a ${SHA('a')}`)
  expect(w.deleted).toEqual([{ flag: '-d', name: 'b' }])
})

test('Never ask again: writes the per-repo git config, says how to undo it, and then stays silent', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: 'Never ask here' })
  await merge($)
  expect(w.config).toEqual([['config', '--local', 'toolkit.branchJanitor', 'false']])
  expect(w.asks).toHaveLength(1)
  expect(w.deleted).toEqual([])
  await merge($)
  expect(w.asks).toHaveLength(1)
  expect(w.cmds.some(c => c[6] === 'for-each-ref')).toBe(true) // the first scan
  const afterFirst = w.cmds.filter(c => c[6] === 'for-each-ref').length
  await merge($)
  expect(w.cmds.filter(c => c[6] === 'for-each-ref').length).toBe(afterFirst) // later merges never scan
})

test('a repo switched off with git config is skipped without scanning', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { disabled: true }))
  await merge($)
  expect(w.asks).toHaveLength(0)
  expect(w.cmds.map(c => c.slice(6).join(' '))).toEqual(['rev-parse --show-toplevel', 'config --local --get toolkit.branchJanitor'])
})

test('a dismissed dialog changes nothing and the command still succeeds', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: 'REJECT' })
  const r = await merge($)
  expect(w.deleted).toEqual([])
  expect((r.result as { stdout: string }).stdout).toBe('ran git merge done')
})

test('free text under Other is never a yes', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: 'delete them all please' })
  await merge($)
  expect(w.deleted).toEqual([])
})

test('never while another dialog is open: a second trigger waits its turn silently', async ($, on) => {
  let release!: (answer: string) => void
  const gate = new Promise<string>(resolve => (release = resolve))
  const w = world(on, repo({ done: merged() }), { answer: () => gate })
  const first = merge($)
  await w.clock.settle()
  expect(w.asks).toHaveLength(1)
  const second = await merge($, 'gh pr merge 4')
  expect(w.asks).toHaveLength(1)
  expect((second.result as { stdout: string }).stdout).toBe('ran gh pr merge 4')
  release('Keep')
  await first
  w.model.branches.next = merged(SHA('c'))
  await merge($, 'gh pr merge 4')
  expect(w.asks).toHaveLength(2) // the lock was released
})

test('headless (no surface): no question and no git call', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { surfaces: [] })
  const r = await merge($)
  expect(w.cmds).toHaveLength(0)
  expect((r.result as { stdout: string }).stdout).toBe('ran git merge done')
})

test('a failed Bash command (non-zero exit) is never a trigger', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { bashFails: true }))
  const r = await merge($)
  expect(w.cmds).toHaveLength(0)
  expect(r.isError).toBe(true)
})

test('fail-open: git missing or throwing leaves the Bash result exactly as it was', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { broken: true }))
  const r = await merge($)
  expect(w.asks).toHaveLength(0)
  expect(r.deny).toBeUndefined()
  expect((r.result as { stdout: string }).stdout).toBe('ran git merge done')
})

test('not inside a repository: silence', async ($, on) => {
  const w = world(on, { root: null as never, branches: {} } as Model)
  await merge($)
  expect(w.asks).toHaveLength(0)
})

test('protected names, the branch you are on, worktrees and unsafe names are never offered', async ($, on) => {
  const w = world(
    on,
    repo({ 'release/2.0': merged(SHA('2')), dev: merged(SHA('3')), 'in-wt': merged(SHA('4')), '-dash': merged(SHA('5')), cur: merged(SHA('6')), custom: merged(SHA('7')), ok: merged(SHA('8')) }, { current: 'cur', worktrees: { 'in-wt': '/other/wt' } }),
  )
  const report = await $.command.run({ command: 'branch-janitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(report.text).toContain('✓ ok · merged into main')
  const skipped = report.text!.split('\n').find(l => l.startsWith('Skipped:'))!
  for (const n of ['release/2.0', 'dev', 'in-wt', '-dash', 'cur', 'main']) expect(skipped).toContain(`${n} (`)
  expect(skipped).toContain('in-wt (open in worktree /other/wt)')
  expect(skipped).toContain('release/2.0 (protected by release/*)')
  expect(skipped).toContain('cur (current branch)')
  expect(w.cmds.some(c => c.includes('--'))).toBe(false)
})

test('userConfig protectedBranches replaces the built-in list', { options: { protectedBranches: ['custom'] } }, async ($, on) => {
  world(on, repo({ custom: merged(SHA('7')), dev: merged(SHA('3')) }))
  const report = await $.command.run({ command: 'branch-janitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(report.text!.split('\n').find(l => l.startsWith('Skipped:'))).toContain('custom (protected by custom)')
  expect(report.text).toContain('✓ dev · merged into main')
})

test('upstream gone alone is a VERIFY note in the report, never offered', async ($, on) => {
  const w = world(on, repo({ g: { sha: SHA('4'), upstream: 'refs/remotes/origin/g', track: '[gone]' } }), { answer: 'REJECT' })
  await merge($)
  expect(w.asks).toHaveLength(0)
  const report = await $.command.run({ command: 'branch-janitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(report.text).toContain('· g · remote branch is gone, but no merge found: check before deleting')
})

test('a stash or an unpushed commit removes an otherwise finished branch from the offer, with the reason', async ($, on) => {
  const w = world(on, repo({ stashy: { ...merged(SHA('5')), stash: true }, ahead: { ...merged(SHA('6')), upstream: 'refs/remotes/origin/ahead', track: '[ahead 2]' } }))
  await merge($)
  expect(w.asks).toHaveLength(0)
  const report = await $.command.run({ command: 'branch-janitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(report.text).toContain('· stashy · merged into main, but a stash was saved on it')
  expect(report.text).toContain('· ahead · merged into main, but 2 commits not pushed to origin/ahead')
})

test('multi-commit squash is found by the content check (cherry still shows +)', async ($, on) => {
  const w = world(on, repo({ big: { sha: SHA('7'), cherry: `+ ${SHA('a')}\n+ ${SHA('b')}\n`, sameContent: true } }), { answer: 'Delete branch' })
  await merge($, 'git merge big')
  expect(w.asks[0]!.question).toContain('✓ Its files already match main (squash merge)')
  expect(w.deleted).toEqual([{ flag: '-D', name: 'big' }])
})

test('more than 8 finished branches: the first 8 are offered, the rest next time', async ($, on) => {
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`b${String(i).padStart(2, '0')}`, merged(SHA(i.toString(16)))]))
  const w = world(on, repo(many))
  await merge($)
  expect(w.asks[0]!.question.split('\n')[0]).toBe('Delete 8 finished branches?')
  expect(w.asks[0]!.question).toContain('4 more next time.')
  expect(w.asks[0]!.options).toContain('Delete all 8')
})

test('more than 60 branches: only 60 are examined and the report says so', async ($, on) => {
  const many = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`f${String(i).padStart(2, '0')}`, { sha: SHA((i % 10).toString()), ts: 1000 + i }]))
  world(on, repo(many))
  const report = await $.command.run({ command: 'branch-janitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(report.text).toContain('Checked the 60 oldest; 10 more not checked.')
  expect(report.text!.split('\n').filter(l => /^· f\d\d · not merged yet$/.test(l)).length).toBe(60)
})

test('/branch-janitor lists every branch with its verdict, shows stale unmerged work, and deletes nothing', async ($, on) => {
  const old = 1_800_000_000 - 90 * 86_400
  const w = world(on, repo({ done: merged(), stale: { sha: SHA('8'), ts: old, cherry: `+ ${SHA('8')}\n` }, fresh: { sha: SHA('9'), cherry: `+ ${SHA('9')}\n` } }), { answer: 'REJECT' })
  const r = await $.command.run({ command: 'branch-janitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(r.text!.split('\n')[0]).toBe('Branches · 1 ready to delete, 2 to keep')
  expect(r.text).toContain('Compared with main')
  expect(r.text).toContain('✓ done · merged into main')
  expect(r.text).toContain('· fresh · not merged yet')
  expect(r.text).toContain('Quiet for over 60 days, never offered:')
  expect(r.text).toContain('· stale · last commit 90 days ago')
  expect(r.text).not.toContain('fresh · last commit')
  expect(w.asks).toHaveLength(0)
  expect(w.deleted).toEqual([])
})

test('/branch-janitor clean scans and offers even when snoozed, then deletes on confirmation', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: (_q, _o, h) => (h === 'Branches' ? 'Delete branch' : 'Keep') })
  w.store.set('repo:/work', { lastLook: 1_800_000_000_000, snoozeUntil: 1_800_000_000_000 + 99 * 3_600_000 })
  const r = await $.command.run({ command: 'branch-janitor', args: 'clean', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(w.deleted).toEqual([{ flag: '-d', name: 'done' }])
  expect(r.text).toContain('Deleted 1 branch · restore with:')
})

test('/branch-janitor clean with nothing finished says so', async ($, on) => {
  world(on, repo({ wip: { sha: SHA('3'), cherry: `+ ${SHA('3')}\n` } }))
  const r = await $.command.run({ command: 'branch-janitor', args: 'clean', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(r.text!.split('\n')[0]).toBe('Branches · nothing to delete right now')
})

test('/branch-janitor off and on switch the repository, with undo instructions', async ($, on) => {
  const w = world(on, repo({ done: merged() }))
  const run = (args: string) => $.command.run({ command: 'branch-janitor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const off = await run('off')
  expect(off.text).toContain('/branch-janitor on')
  expect(off.text!.split('\n')[0]).toBe('Branches · off for this repository')
  expect(w.config).toEqual([['config', '--local', 'toolkit.branchJanitor', 'false']])
  const report = await run('')
  expect(report.text).toContain('Off for this repository.')
  const back = await run('on')
  expect(back.text).toBe('Branches · on for this repository')
  expect(w.config[1]).toEqual(['config', '--local', '--unset', 'toolkit.branchJanitor'])
  expect((await run('nonsense')).text).toContain('/branch-janitor clean')
})

test('/branch-janitor outside a repository', async ($, on) => {
  world(on, { root: null as never, branches: {} } as Model)
  const r = await $.command.run({ command: 'branch-janitor', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(r.text).toBe('Branches · not in a git repository')
})

test('session start: registers the command and looks once, a moment later', async ($, on) => {
  const w = world(on, repo({ done: merged() }))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(w.asks).toHaveLength(0)
  await w.clock.advance(3_100)
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('Delete 1 finished branch?')
})

test('session start in a non-interactive run does not look', async ($, on) => {
  const w = world(on, repo({ done: merged() }))
  await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
  await w.clock.advance(10_000)
  expect(w.cmds).toHaveLength(0)
})

test('gh: a merged PR at the exact tip lets a [gone] branch be offered; gh is probed once per session', async ($, on) => {
  const model = repo(
    {
      gone1: { sha: SHA('4'), upstream: 'refs/remotes/origin/gone1', track: '[gone]', cherry: `+ ${SHA('4')}\n` },
      gone2: { sha: SHA('5'), upstream: 'refs/remotes/origin/gone2', track: '[gone]', cherry: `+ ${SHA('5')}\n` },
    },
    {
      gh: {
        installed: true,
        prs: {
          gone1: [{ number: 11, mergedAt: '2026-01-01', baseRefName: 'main', headRefOid: SHA('4') }],
          gone2: [{ number: 12, mergedAt: '2026-01-01', baseRefName: 'main', headRefOid: SHA('f') }], // commits added after the merge
        },
      },
    },
  )
  const w = world(on, model, { answer: 'Keep' })
  await merge($, 'git fetch --prune')
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]!.question).toContain('\ngone1\n')
  expect(w.asks[0]!.question).toContain('✓ PR #11 merged into main')
  expect(w.asks[0]!.question).not.toContain('gone2')
  await merge($, 'git merge x')
  expect(w.cmds.filter(c => c[0] === 'gh' && c[1] === '--version')).toHaveLength(1)
  const pr = w.cmds.find(c => c[0] === 'gh' && c[1] === 'pr')!
  expect(pr).toEqual(['gh', 'pr', 'list', '--head', 'gone1', '--state', 'merged', '--json', 'number,mergedAt,baseRefName,headRefOid', '--limit', '1'])
})

test('gh missing or failing is silent and just means no PR evidence', async ($, on) => {
  const w = world(on, repo({ gone1: { sha: SHA('4'), upstream: 'refs/remotes/origin/gone1', track: '[gone]' } }, { gh: { installed: false } }))
  await merge($, 'git fetch --prune')
  expect(w.asks).toHaveLength(0)
  expect(w.toasts).toHaveLength(0)
})

test('the hook gives the git commands the session directory and never a shell', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { cwd: '/some/where' })
  await merge($)
  expect(w.cmds.length).toBeGreaterThan(3)
  for (const c of w.cmds) expect(['git', 'gh']).toContain(c[0])
})
