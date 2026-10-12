// REAL-GIT integration test. Builds throwaway repositories in a temp directory with the `git` on this machine
// and runs the mod's real command code through a `run` adapter that really spawns git (and rm). It checks that a
// snapshot never changes the branch, HEAD, the real index file or the stash list, that restore brings back
// exactly the snapshot (tracked, deleted and untracked files, odd names) and deletes only what the dialog listed.
//
// Run:  node tests/run-integration.mjs        (from the mod folder; Node 22.15+; exits non-zero on any failure)
//   or: bun tests/real-git.integration.ts
// It is not a `*.test.ts` file because `claude plugin test` runs in a sandbox with no process access.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'

import { autoSnapshot, runCommand } from '../hooks/checkpoint'
import type { Deps } from '../hooks/checkpoint'
import type { Run } from '../hooks/git'

declare const process: { env: Record<string, string | undefined>; exit(code: number): never }
declare const console: { log(...args: unknown[]): void }

let failures = 0
let checks = 0
function check(ok: boolean, what: string, extra = '') {
  checks++
  if (!ok) {
    failures++
    console.log(`  FAIL: ${what} ${extra}`)
  }
}

process.env.GIT_CONFIG_GLOBAL = devNull
process.env.GIT_CONFIG_SYSTEM = devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Test Author'
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'test@example.com'
process.env.GIT_TERMINAL_PROMPT = '0'

const run: Run = async (argv, o) => {
  const r = spawnSync(argv[0]!, argv.slice(1), { cwd: o?.cwd, encoding: 'utf8', input: o?.stdin, timeout: o?.timeoutMs, env: { ...process.env, ...(o?.env ?? {}) } })
  if (r.error) throw r.error
  return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
}

const sh = (cwd: string, ...argv: string[]) => {
  const r = spawnSync(argv[0]!, argv.slice(1), { cwd, encoding: 'utf8', env: process.env })
  if (r.status !== 0) throw new Error(`${argv.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}
const put = (root: string, rel: string, text: string) => {
  const parts = rel.split('/')
  if (parts.length > 1) mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const read = (root: string, rel: string) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : undefined)

let answer = 'Cancel'
const asked: string[] = []
const deps = (cwd: string): Deps => ({
  run,
  cwd,
  now: () => Date.now(),
  ask: async text => {
    asked.push(text)
    if (answer === 'REJECT') throw new Error('dismissed')
    return answer
  },
  canAsk: async () => true,
})

/** What the person owns: branch, HEAD, stash list, the real index file's bytes. */
const owned = (root: string) => ({
  branch: sh(root, 'git', 'branch', '--show-current').trim(),
  head: sh(root, 'git', 'rev-parse', 'HEAD').trim(),
  stash: sh(root, 'git', 'stash', 'list'),
  index: createHash('sha256').update(readFileSync(join(root, '.git', 'index'))).digest('hex'),
})
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const base = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-it-')))

async function main() {
  // ------------------------------------------------------------ a normal repository
  const root = join(base, 'repo')
  mkdirSync(root)
  sh(root, 'git', 'init', '-q', '-b', 'main')
  put(root, '.gitignore', '*.log\n')
  put(root, 'a.txt', 'one\n')
  put(root, 'b.txt', 'two\n')
  put(root, 'dir/deep.txt', 'deep\n')
  put(root, 'my file é.txt', 'odd name\n')
  sh(root, 'git', 'add', '.')
  sh(root, 'git', 'commit', '-q', '-m', 'init')
  sh(root, 'git', 'checkout', '-q', '-b', 'feature')
  put(root, 'a.txt', 'one, stashed\n')
  sh(root, 'git', 'stash', 'push', '-q', '-m', 'pre-existing')
  put(root, 'a.txt', 'one edited\n')
  put(root, 'c.txt', 'staged new\n')
  sh(root, 'git', 'add', 'c.txt') // a real staged change the person owns
  put(root, 'untracked.txt', 'u1\n')
  put(root, 'dir/untracked2.txt', 'u2\n')
  put(root, 'noise.log', 'ignored\n')

  const before = owned(root)
  const statusBefore = sh(root, 'git', '--no-optional-locks', 'status', '--porcelain=v1')
  let out = await runCommand(deps(root), 'good')
  check(out.text.includes('saved good'), 'create says saved', out.text)
  check(same(owned(root), before), 'create: branch, HEAD, stash and the real index file are byte-identical')
  check(sh(root, 'git', '--no-optional-locks', 'status', '--porcelain=v1') === statusBefore, 'create: git status unchanged')
  const files = sh(root, 'git', 'ls-tree', '-r', '--name-only', 'refs/moddeck/checkpoints/good').split('\n').filter(Boolean)
  check(files.includes('untracked.txt') && files.includes('dir/untracked2.txt') && files.includes('c.txt'), 'snapshot has untracked and staged files', files.join(','))
  check(!files.includes('noise.log'), 'snapshot leaves ignored files out')
  check(sh(root, 'git', 'show', 'refs/moddeck/checkpoints/good:a.txt') === 'one edited\n', 'snapshot holds the working-tree content, not the index')
  check(sh(root, 'git', 'log', '-1', '--format=%P', 'refs/moddeck/checkpoints/good').trim() === before.head, 'snapshot is parented on HEAD')

  out = await runCommand(deps(root), 'list')
  check(/1 saved/.test(out.text) && /good · just now · 0 files changed/.test(out.text), 'list: name, age, 0 files changed', out.text)

  // mess the tree up
  put(root, 'a.txt', 'one DAMAGED\n')
  put(root, 'dir/deep.txt', 'deep DAMAGED\n')
  rmSync(join(root, 'b.txt'))
  rmSync(join(root, 'my file é.txt'))
  put(root, 'new-untracked.txt', 'x\n')
  put(root, 'dir/new2.txt', 'y\n')
  put(root, 'noise.log', 'ignored, changed\n')
  put(root, 'untracked.txt', 'u1 changed\n')
  const mid = owned(root)

  out = await runCommand(deps(root), 'list')
  check(/good · .* · 7 files changed/.test(out.text), 'list counts changed files vs now', out.text)
  out = await runCommand(deps(root), 'diff good')
  check(out.text.includes('a.txt') && out.text.includes('new-untracked.txt'), 'diff --stat names the changed files', out.text)
  check(same(owned(root), mid), 'diff/list leave everything untouched')

  // restore: Cancel / Esc change nothing
  const messy = ['a.txt', 'dir/deep.txt', 'b.txt', 'new-untracked.txt', 'dir/new2.txt', 'untracked.txt'].map(p => read(root, p))
  for (const a of ['Cancel', 'REJECT', 'yes please']) {
    answer = a
    out = await runCommand(deps(root), 'restore good')
    check(out.text.includes('cancelled'), `restore ${a}: cancelled`, out.text)
    check(same(['a.txt', 'dir/deep.txt', 'b.txt', 'new-untracked.txt', 'dir/new2.txt', 'untracked.txt'].map(p => read(root, p)), messy), `restore ${a}: working tree unchanged`)
  }
  const q = asked[asked.length - 1]!
  check(q.includes('would be lost') && q.includes('a.txt') && q.includes('new-untracked.txt'), 'dialog lists what would be lost', q)
  check(!q.includes('noise.log'), 'dialog never lists ignored files')

  answer = 'Snapshot first, then restore'
  out = await runCommand(deps(root), 'restore good')
  check(out.text.includes('restored good'), 'restore reports', out.text)
  check(read(root, 'a.txt') === 'one edited\n' && read(root, 'dir/deep.txt') === 'deep\n', 'tracked files back to the snapshot')
  check(read(root, 'b.txt') === 'two\n' && read(root, 'my file é.txt') === 'odd name\n', 'deleted files (odd name too) come back')
  check(read(root, 'untracked.txt') === 'u1\n' && read(root, 'dir/untracked2.txt') === 'u2\n', 'untracked files in the snapshot are back')
  check(read(root, 'new-untracked.txt') === undefined && read(root, 'dir/new2.txt') === undefined, 'untracked files absent in the snapshot are removed')
  check(read(root, 'noise.log') === 'ignored, changed\n', 'ignored file never touched')
  const after = owned(root)
  check(after.branch === before.branch && after.head === before.head && after.stash === before.stash, 'restore: branch, HEAD, stash unchanged')
  check(after.index === before.index, 'restore: real index file byte-identical')
  const safety = sh(root, 'git', 'for-each-ref', '--format=%(refname:strip=3)', 'refs/moddeck/checkpoints/').split('\n').find(n => n.startsWith('before-restore-'))
  check(safety !== undefined && sh(root, 'git', 'show', `refs/moddeck/checkpoints/${safety}:a.txt`) === 'one DAMAGED\n', 'before-restore copy holds the pre-restore state', String(safety))
  check(sh(root, 'git', 'show', `refs/moddeck/checkpoints/${safety}:new-untracked.txt`) === 'x\n', 'before-restore copy holds the untracked file that was deleted')
  out = await runCommand(deps(root), 'restore good')
  check(out.text.includes('already matches'), 'restoring again: nothing to do', out.text)

  // restore back to the damaged state through the safety copy (round trip)
  answer = 'Restore'
  out = await runCommand(deps(root), `restore ${safety}`)
  check(read(root, 'a.txt') === 'one DAMAGED\n' && read(root, 'new-untracked.txt') === 'x\n' && read(root, 'b.txt') === undefined, 'round trip through the safety copy')

  // drop
  answer = 'Cancel'
  await runCommand(deps(root), 'drop good')
  check(sh(root, 'git', 'rev-parse', '-q', '--verify', 'refs/moddeck/checkpoints/good').trim() !== '', 'drop Cancel keeps it')
  answer = 'Drop'
  out = await runCommand(deps(root), 'drop good')
  check(out.text.includes('dropped good') && spawnSync('git', ['rev-parse', '-q', '--verify', 'refs/moddeck/checkpoints/good'], { cwd: root }).status !== 0, 'drop removes the ref', out.text)
  check(read(root, 'a.txt') === 'one DAMAGED\n', 'drop touches no files')
  check(owned(root).stash === before.stash, 'stash list still intact at the end')

  // automatic snapshots, capped
  for (let i = 0; i < 5; i++) {
    put(root, 'a.txt', `auto ${i}\n`)
    await new Promise(r => setTimeout(r, 1100)) // names carry seconds
    await autoSnapshot(deps(root), 3)
  }
  const refs = sh(root, 'git', 'for-each-ref', '--format=%(refname:strip=3)', 'refs/moddeck/checkpoints/').split('\n').filter(Boolean)
  const autos = refs.filter(n => n.startsWith('auto-'))
  check(autos.length === 3, 'auto: capped at 3', autos.join(','))
  check(refs.some(n => n.startsWith('before-restore-')), 'auto pruning never deletes other snapshots')
  const kept = autos.map(n => sh(root, 'git', 'show', `refs/moddeck/checkpoints/${n}:a.txt`).trim()).sort()
  check(same(kept, ['auto 2', 'auto 3', 'auto 4']), 'auto: the newest three kept', kept.join('|'))
  await autoSnapshot(deps(root), 3)
  check(sh(root, 'git', 'for-each-ref', 'refs/moddeck/checkpoints/auto-*').split('\n').filter(Boolean).length === 3, 'auto: unchanged tree makes no new snapshot')
  check(owned(root).stash === before.stash && owned(root).branch === 'feature', 'auto: stash and branch untouched')

  // ------------------------------------------------------------ a repository with no commit yet
  const empty = join(base, 'empty')
  mkdirSync(empty)
  sh(empty, 'git', 'init', '-q', '-b', 'main')
  put(empty, 'first.txt', 'hello\n')
  out = await runCommand(deps(empty), 'start')
  check(out.text.includes('saved start'), 'works before the first commit', out.text)
  check(sh(empty, 'git', 'show', 'refs/moddeck/checkpoints/start:first.txt') === 'hello\n', 'content kept without a HEAD')
  put(empty, 'first.txt', 'changed\n')
  answer = 'Restore'
  await runCommand(deps(empty), 'restore start')
  check(read(empty, 'first.txt') === 'hello\n', 'restore without a HEAD')

  // ------------------------------------------------------------ not a repository
  const plain = join(base, 'plain')
  mkdirSync(plain)
  put(plain, 'x.txt', 'x')
  for (const args of ['', 'list', 'restore x', 'drop x']) {
    out = await runCommand(deps(plain), args)
    check(out.text.includes('not a git repository'), `not a repo: "${args}"`, out.text)
  }
  check(!existsSync(join(plain, '.git')) && read(plain, 'x.txt') === 'x', 'not a repo: nothing created')
}

try {
  await main()
} catch (error) {
  failures++
  console.log(`  FAIL: threw ${error instanceof Error ? error.stack : String(error)}`)
} finally {
  rmSync(base, { recursive: true, force: true })
}
console.log(failures === 0 ? `integration: ${checks} checks passed` : `integration: ${failures} of ${checks} checks FAILED`)
process.exit(failures === 0 ? 0 : 1)
