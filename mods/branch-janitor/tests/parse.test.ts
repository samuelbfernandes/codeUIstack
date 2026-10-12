import { test, expect } from 'claude-code/testing'

import { readSettings } from '../hooks/config'
import {
  BRANCH_FORMAT, isSafeName, matchesPattern, parseBranchRefs, parseCherry, parseMergedPr, parseRemoteTips,
  parseStashBranches, parseTrack, parseWorktrees,
} from '../hooks/git'
import { DEFAULT_PROTECTED } from '../hooks/scan'
import { segments, triggerOf } from '../hooks/trigger'

const S1 = 'a'.repeat(40)
const S2 = 'b'.repeat(40)

test('BRANCH_FORMAT carries the fields parseBranchRefs reads', () => {
  expect(BRANCH_FORMAT.split('%09')).toHaveLength(7)
})

test('parseBranchRefs: current marker, upstream, track, date; CRLF tolerated', () => {
  const out = [
    `*\trefs/heads/main\t${S1}\trefs/remotes/origin/main\torigin\t\t1700000000`,
    ` \trefs/heads/feature/x\t${S2}\trefs/remotes/origin/feature/x\torigin\t[ahead 2, behind 1]\t1690000000`,
    ` \trefs/heads/old\t${S2}\trefs/remotes/origin/old\torigin\t[gone]\t1600000000`,
    ` \trefs/heads/local-only\t${S1}\t\t\t\t1650000000`,
  ].join('\r\n')
  const refs = parseBranchRefs(out)
  expect(refs.map(r => r.name)).toEqual(['main', 'feature/x', 'old', 'local-only'])
  expect(refs[0]).toMatchObject({ isCurrent: true, ahead: 0, behind: 0, isGone: false, lastCommit: 1700000000 })
  expect(refs[1]).toMatchObject({ isCurrent: false, ahead: 2, behind: 1, upstream: 'refs/remotes/origin/feature/x', remote: 'origin' })
  expect(refs[2]!.isGone).toBe(true)
  expect(refs[3]).toMatchObject({ upstream: '', ahead: 0, isGone: false })
})

test('parseBranchRefs ignores lines that are not local branches', () => {
  expect(parseBranchRefs(` \trefs/tags/v1\t${S1}\t\t\t\t0\n\n`)).toEqual([])
})

test('parseTrack', () => {
  expect(parseTrack('')).toEqual({ isGone: false, ahead: 0, behind: 0 })
  expect(parseTrack('[gone]').isGone).toBe(true)
  expect(parseTrack('[behind 3]')).toEqual({ isGone: false, ahead: 0, behind: 3 })
  expect(parseTrack('[ahead 1, behind 2]')).toEqual({ isGone: false, ahead: 1, behind: 2 })
})

test('parseRemoteTips keys by remote/branch', () => {
  const tips = parseRemoteTips(`refs/remotes/origin/main\t${S1}\r\nrefs/remotes/origin/HEAD\t${S1}\nrefs/heads/x\t${S2}\n`)
  expect(tips.get('origin/main')).toBe(S1)
  expect(tips.has('x')).toBe(false)
})

test('parseCherry counts + and - lines; empty output is nothing ahead', () => {
  expect(parseCherry('')).toEqual({ plus: 0, minus: 0 })
  expect(parseCherry(`- ${S1}\r\n- ${S2}\n`)).toEqual({ plus: 0, minus: 2 })
  expect(parseCherry(`- ${S1}\n+ ${S2}\n`)).toEqual({ plus: 1, minus: 1 })
})

test('parseWorktrees: branch, detached, bare, paths with spaces, CRLF', () => {
  const out = [
    'worktree C:/Users/some one/repo', `HEAD ${S1}`, 'branch refs/heads/main', '',
    'worktree C:/Users/some one/wt', `HEAD ${S2}`, 'branch refs/heads/feature/wt', '',
    'worktree /tmp/detached', `HEAD ${S2}`, 'detached', '',
    'worktree /srv/bare.git', 'bare', '',
  ].join('\r\n')
  const trees = parseWorktrees(out)
  expect(trees.map(t => t.branch)).toEqual(['main', 'feature/wt', undefined, undefined])
  expect(trees[0]!.path).toBe('C:/Users/some one/repo')
  expect(trees[3]!.isBare).toBe(true)
})

test('parseStashBranches: WIP on / On, with or without the stash@{n}: prefix', () => {
  const out = ['stash@{0}: WIP on feature/a: 1234567 msg', 'stash@{1}: On fix-b: my note: with colon', 'WIP on c: abc d', 'stash@{2}: WIP on (no branch): abc x'].join('\r\n')
  expect([...parseStashBranches(out)].sort()).toEqual(['(no branch)', 'c', 'feature/a', 'fix-b'])
  expect(parseStashBranches('').size).toBe(0)
})

test('parseMergedPr: needs a number and mergedAt; junk is no PR', () => {
  expect(parseMergedPr(JSON.stringify([{ number: 7, mergedAt: '2026-01-01', baseRefName: 'main', headRefOid: S1 }]))).toEqual({ number: 7, baseRefName: 'main', headRefOid: S1 })
  expect(parseMergedPr('[]')).toBeUndefined()
  expect(parseMergedPr('not json')).toBeUndefined()
  expect(parseMergedPr(JSON.stringify([{ number: 7, mergedAt: null }]))).toBeUndefined()
})

test('isSafeName rejects dashes, control characters, spaces and odd ref syntax', () => {
  for (const ok of ['feature/x', 'fix-123', 'a.b', 'ünï'] ) expect(isSafeName(ok)).toBe(true)
  for (const bad of ['', '-rf', '--delete', 'a b', 'a\nb', 'a\u0000b', 'a\tb', 'a..b', 'a@{1}', 'x.lock', 'x/', 'a\u007fb', 'a'.repeat(300)]) expect(isSafeName(bad)).toBe(false)
})

test('matchesPattern: * spans slashes, dots are literal, whole-name match', () => {
  expect(matchesPattern('release/1.0', 'release/*')).toBe(true)
  expect(matchesPattern('release/1/x', 'release/*')).toBe(true)
  expect(matchesPattern('releases/1', 'release/*')).toBe(false)
  expect(matchesPattern('main', 'main')).toBe(true)
  expect(matchesPattern('main2', 'main')).toBe(false)
  expect(matchesPattern('a.b', 'a.b')).toBe(true)
  expect(matchesPattern('axb', 'a.b')).toBe(false)
  expect(DEFAULT_PROTECTED.some(p => matchesPattern('gh-pages', p))).toBe(true)
})

test('segments: splits on && || ; | newline outside quotes, drops quotes', () => {
  expect(segments('cd x && git merge "my branch"; echo hi | cat\nls')).toEqual([['cd', 'x'], ['git', 'merge', 'my branch'], ['echo', 'hi'], ['cat'], ['ls']])
  expect(segments("echo 'git merge x && y'")).toEqual([['echo', 'git merge x && y']])
})

test('triggerOf: merges and merged PRs are "merge"', () => {
  for (const c of ['git merge feature', 'git merge --no-ff feature -m "msg"', 'gh pr merge 12 --squash --delete-branch', 'gh pr merge', 'gh -R o/r pr merge 3', 'cd repo && git merge x', 'GIT_EDITOR=true git merge x', 'git -C ../other merge x', '/usr/bin/git.exe merge x'])
    expect(triggerOf(c)).toBe('merge')
})

test('triggerOf: the quieter triggers are "other"', () => {
  for (const c of ['git pull', 'git pull --rebase origin main', 'git push', 'git push -u origin feature', 'git checkout main', 'git switch main', 'git switch -', 'git fetch --prune', 'git fetch -p origin', 'git fetch --all --prune', 'git remote prune origin', 'git remote update --prune', 'git add . && git commit -m x && git push'])
    expect(triggerOf(c)).toBe('other')
})

test('triggerOf: everything else is nothing', () => {
  for (const c of ['git status', 'git log --oneline', 'git commit -m "git merge"', 'echo "git merge x"', 'git merge --abort', 'git checkout -b newbranch', 'git switch -c newbranch', 'git checkout -- file.txt', 'git checkout .', 'git checkout', 'git fetch', 'git fetch origin', 'git remote -v', 'gh pr list', 'gh pr view 3', 'ls -la', ''])
    expect(triggerOf(c)).toBeUndefined()
})

test('triggerOf: a merge anywhere in a compound command wins over a quieter trigger', () => {
  expect(triggerOf('git pull && git merge dev')).toBe('merge')
  expect(triggerOf('git push && gh pr merge 3')).toBe('merge')
})

test('readSettings: defaults, clamping, empty protected list falls back to the built-in one', () => {
  expect(readSettings({})).toEqual({ minMinutes: 30, staleDays: 60, protectedBranches: DEFAULT_PROTECTED })
  expect(readSettings({ minMinutes: 0, staleDays: 'x', protectedBranches: ['', '  '] })).toEqual({ minMinutes: 1, staleDays: 60, protectedBranches: DEFAULT_PROTECTED })
  expect(readSettings({ minMinutes: 5000, protectedBranches: [' keep ', 'wip/*'] })).toMatchObject({ minMinutes: 1440, protectedBranches: ['keep', 'wip/*'] })
})
