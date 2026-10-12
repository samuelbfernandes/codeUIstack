import { expect, test } from 'claude-code/testing'

import { isDirty, linkedWorktree, parseStatusV2 } from '../hooks/gitinfo'

const SAMPLE = [
  '# branch.oid 4fc5e35a1b2c3d4e5f60718293a4b5c6d7e8f901',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 aaaa bbbb src/a.ts',
  '1 M. N... 100644 100644 100644 aaaa bbbb src/b.ts',
  '1 MM N... 100644 100644 100644 aaaa bbbb src/c.ts',
  '1 A. N... 000000 100644 100644 0000 bbbb src/new.ts',
  '1 .D N... 100644 100644 000000 aaaa bbbb src/gone.ts',
  '2 R. N... 100644 100644 100644 aaaa bbbb R100 src/renamed.ts\tsrc/old.ts',
  'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc src/conflict.ts',
  '? notes.txt',
  '? scratch/',
  '! build/',
].join('\n')

test('the porcelain v2 sample parses: branch, ahead/behind and each file counted once', async () => {
  const g = parseStatusV2(SAMPLE)!
  expect(g.branch).toBe('main')
  expect(g.isDetached).toBe(false)
  expect(g.hasUpstream).toBe(true)
  expect([g.ahead, g.behind]).toEqual([2, 1])
  expect(g.added).toBe(1)
  expect(g.deleted).toBe(1)
  expect(g.modified).toBe(5) // .M, M., MM, the rename, and the conflicted file
  expect(g.untracked).toBe(2)
  expect(g.conflicts).toBe(1)
  expect(isDirty(g)).toBe(true)
})

test('a clean branch without an upstream has no ahead or behind and is not dirty', async () => {
  const g = parseStatusV2('# branch.oid abc\n# branch.head feature\n')!
  expect(g).toMatchObject({ branch: 'feature', ahead: 0, behind: 0, hasUpstream: false, modified: 0, untracked: 0 })
  expect(isDirty(g)).toBe(false)
})

test('a detached head reads as the short commit; a new repository has a branch but no commit', async () => {
  expect(parseStatusV2('# branch.oid 1234567890abcdef\n# branch.head (detached)\n')).toMatchObject({ branch: '1234567', isDetached: true })
  expect(parseStatusV2('# branch.oid (initial)\n# branch.head main\n? a\n')).toMatchObject({ branch: 'main', untracked: 1 })
})

test('text with no branch header is not a status (git said something else)', async () => {
  expect(parseStatusV2('')).toBeUndefined()
  expect(parseStatusV2('fatal: not a git repository')).toBeUndefined()
})

test('a linked worktree is named from its git dir; the main checkout and unreadable output have none', async () => {
  expect(linkedWorktree('/repo/.git/worktrees/reload-plugins-fbc15d\n/repo/.git\n')).toBe('reload-plugins-fbc15d')
  expect(linkedWorktree('.git\n.git\n')).toBeUndefined()
  expect(linkedWorktree('/repo/.git/\n/repo/.git\n')).toBeUndefined()
  expect(linkedWorktree('')).toBeUndefined()
  expect(linkedWorktree('/elsewhere\n/repo/.git')).toBeUndefined()
})
