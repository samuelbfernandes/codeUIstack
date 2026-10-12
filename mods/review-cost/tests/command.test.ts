import { test, expect } from 'claude-code/testing'

import { findPush, joinPath, segments } from '../hooks/command'

const dir = (c: string) => findPush(c)?.dir
const isPush = (c: string) => findPush(c) !== undefined

const POSITIVE = [
  'git push',
  'git push origin main',
  'git push -u origin feature/x',
  'git push --force-with-lease origin main',
  'git push --tags',
  'git -C sub push',
  'git -C "C:/x y" push',
  'git -C "C:\\x y" push origin main',
  "git -C 'D:/my repo' push",
  'git -c core.editor=true push',
  'git --no-pager push',
  'cd x && git push',
  'cd "C:/my repo" && git push -u origin main',
  'npm test; git push',
  'make && git add . && git commit -m "git push later" && git push',
  '(cd x && git push)',
  'SKIP_THEORY_REVIEW=0 git push',
  'FOO=1 BAR=2 git push',
  'env GIT_TRACE=1 git push',
  'time git push',
  '/usr/bin/git push',
  'C:/Program Files/Git/cmd/git.exe push'.replace('Program Files', '"Program Files"'),
  'git push origin HEAD:refs/heads/main',
  'git push && echo done',
]

const NEGATIVE = [
  'git status',
  'git push --dry-run',
  'git push -n origin main',
  'git push -nu origin main',
  'git push --delete origin old',
  'git push -d origin old',
  'git push origin :old-branch',
  'echo "git push"',
  "echo 'git push origin main'",
  'xgit push',
  'git pushall',
  'git stash push',
  'git commit -m "git push"',
  'gh pr push',
  'git -C "C:/x y" status',
  'ls git push',
  'cd x && git status',
  '',
  'git',
]

for (const c of POSITIVE) test(`push detected: ${c}`, () => expect(isPush(c)).toBe(true))
for (const c of NEGATIVE) test(`not a push: ${JSON.stringify(c)}`, () => expect(isPush(c)).toBe(false))

test('directory: git -C, cd, and both together; Windows paths keep their spelling (slashes forward)', () => {
  expect(dir('git push')).toBeUndefined()
  expect(dir('git -C sub push')).toBe('sub')
  expect(dir('git -C "C:/x y" push')).toBe('C:/x y')
  expect(dir('git -C "C:\\x y" push')).toBe('C:/x y')
  expect(dir('cd /a/b && git push')).toBe('/a/b')
  expect(dir('cd /a && cd b && git push')).toBe('/a/b')
  expect(dir('cd /a && git -C b push')).toBe('/a/b')
  expect(dir('cd /a && git -C /other push')).toBe('/other')
  expect(dir('cd "C:/my repo" && git push')).toBe('C:/my repo')
})

test('a directory that cannot be resolved without a shell is not guessed: the push is left alone', () => {
  expect(isPush('cd ~/proj && git push')).toBe(false)
  expect(isPush('cd $PROJ && git push')).toBe(false)
  expect(isPush('git -C "$DIR" push')).toBe(false)
  expect(isPush('cd - && git push')).toBe(false)
})

test('SKIP_THEORY_REVIEW=1 in the command is reported', () => {
  expect(findPush('SKIP_THEORY_REVIEW=1 git push')?.skipEnv).toBe(true)
  expect(findPush('env SKIP_THEORY_REVIEW=1 git push origin main')?.skipEnv).toBe(true)
  expect(findPush('cd x && SKIP_THEORY_REVIEW=1 git push')?.skipEnv).toBe(true)
  expect(findPush('git push')?.skipEnv).toBe(false)
  expect(findPush('SKIP_THEORY_REVIEW=0 git push')?.skipEnv).toBe(false)
})

test('the first real push wins; a dry run before it does not hide it', () => {
  expect(findPush('git push --dry-run && git push')).toEqual({ dir: undefined, skipEnv: false })
})

test('segments and joinPath', () => {
  expect(segments('a b && c "d e"; f')).toEqual([['a', 'b'], ['c', 'd e'], ['f']])
  expect(segments('echo "a && b"')).toEqual([['echo', 'a && b']])
  expect(joinPath('C:/a', 'b')).toBe('C:/a/b')
  expect(joinPath('/a/', 'b')).toBe('/a/b')
  expect(joinPath('/a', 'C:\\z')).toBe('C:/z')
  expect(joinPath(undefined, 'rel')).toBe('rel')
})
