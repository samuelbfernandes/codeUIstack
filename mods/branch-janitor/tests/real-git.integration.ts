// REAL-GIT integration test. Builds throwaway repositories in a temp directory with the `git` on this machine
// (init, commits, merge, squash merge, rebase-style merge, worktree, stash, gone upstream behind a local bare
// "remote"), runs the mod's real scan and delete code through a `run` adapter that really spawns git, and
// checks that it deletes only what it should.
//
// Run:  bun tests/real-git.integration.ts        (from the mod folder; exits non-zero on any failure)
// It is not a `*.test.ts` file because `claude plugin test` runs in a sandbox with no process access.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { devNull, tmpdir } from 'node:os'
import { join } from 'node:path'

import { repoFingerprint } from '../hooks/fingerprint'
import { DEFAULT_PROTECTED, scan } from '../hooks/scan'
import { cleanNow, lookAndOffer, report, runCommand, watchPrompt } from '../hooks/janitor'
import type { Deps } from '../hooks/janitor'
import type { Run } from '../hooks/git'

// Not hooks code: the few Node/Bun globals this script uses, declared here so they stay out of the hooks' type-check.
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

// Isolate from the machine's git configuration.
process.env.GIT_CONFIG_GLOBAL = devNull
process.env.GIT_CONFIG_SYSTEM = devNull
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = 'Test Author'
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = 'test@example.com'
process.env.GIT_TERMINAL_PROMPT = '0'

/** The adapter under test: argv in, real process out. `gh` is scripted (no GitHub here). */
function makeRun(ghPrs: Record<string, unknown[]> = {}): Run {
  return async (argv, o) => {
    if (argv[0] === 'gh') {
      const head = argv[argv.indexOf('--head') + 1] ?? ''
      return { exitCode: 0, stdout: JSON.stringify(ghPrs[head] ?? []), stderr: '' }
    }
    const r = spawnSync(argv[0]!, argv.slice(1), { cwd: o?.cwd, encoding: 'utf8', input: o?.stdin, timeout: o?.timeoutMs })
    if (r.error) throw r.error
    return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr }
  }
}
const real = makeRun()
/** A runner that records every command it is asked to run, to prove what the cheap paths do NOT do. */
function counting(inner: Run): { run: Run; calls: string[][] } {
  const calls: string[][] = []
  return { calls, run: async (argv, o) => (calls.push([...argv]), inner(argv, o)) }
}

function sh(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`)
  return r.stdout.trim()
}
const commit = (cwd: string, file: string, text: string, msg: string) => {
  writeFileSync(join(cwd, file), text)
  sh(cwd, 'add', file)
  sh(cwd, 'commit', '-q', '-m', msg)
}
const branches = (cwd: string) => sh(cwd, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).sort()
const remoteBranches = (bare: string) => sh(bare, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').filter(Boolean).sort()

type World = { dir: string; work: string; bare: string; other: string; tips: Record<string, string> }

/** One repo with every kind of branch. `main` is where the work lands; `work` is the clone under test. */
function buildWorld(): World {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'branch-janitor-')))
  const bare = join(dir, 'origin.git')
  const work = join(dir, 'work')
  const other = join(dir, 'other')
  mkdirSync(bare)
  sh(bare, 'init', '-q', '--bare', '-b', 'main')
  sh(dir, 'clone', '-q', bare, work)
  sh(work, 'checkout', '-q', '-b', 'main')
  commit(work, 'base.txt', 'base\n', 'base')
  sh(work, 'push', '-q', '-u', 'origin', 'main')
  sh(work, 'remote', 'set-head', 'origin', 'main')
  sh(dir, 'clone', '-q', bare, other)

  const feature = (name: string, f: (n: string) => void) => {
    sh(work, 'checkout', '-q', '-b', name, 'main')
    f(name)
    sh(work, 'checkout', '-q', 'main')
  }
  const push = (n: string) => sh(work, 'push', '-q', '-u', 'origin', n)

  // 1. plain merge (ancestor), pushed
  feature('merged-ff', n => { commit(work, 'f1.txt', '1\n', 'f1'); push(n) })
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge merged-ff', 'merged-ff')
  // 2. squash merge of ONE commit
  feature('squash-one', n => { commit(work, 's1.txt', '1\n', 's1'); push(n) })
  sh(work, 'merge', '-q', '--squash', 'squash-one'); sh(work, 'commit', '-q', '-m', 'squash one (#1)')
  // 3. squash merge of TWO commits (git cherry shows '+': only the content check can see it)
  feature('squash-multi', n => { commit(work, 'm1.txt', '1\n', 'm1'); commit(work, 'm2.txt', '2\n', 'm2'); push(n) })
  sh(work, 'merge', '-q', '--squash', 'squash-multi'); sh(work, 'commit', '-q', '-m', 'squash multi (#2)')
  // 4. rebase-style merge: same patches, new commits
  feature('rebase-merged', () => { commit(work, 'r1.txt', '1\n', 'r1'); commit(work, 'r2.txt', '2\n', 'r2') })
  commit(work, 'between.txt', '1\n', 'main moves on') // so the picked commits get new parents (new shas)
  sh(work, 'cherry-pick', 'rebase-merged~1', 'rebase-merged')
  // 5. unmerged work
  feature('unmerged', () => commit(work, 'u1.txt', '1\n', 'wip'))
  // 6. merged but checked out in a worktree
  feature('in-worktree', () => commit(work, 'w1.txt', '1\n', 'w1'))
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge in-worktree', 'in-worktree')
  sh(work, 'worktree', 'add', '-q', join(dir, 'wt'), 'in-worktree')
  // 7. merged but with a stash made on it
  feature('stashed', () => commit(work, 'st1.txt', '1\n', 'st1'))
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge stashed', 'stashed')
  sh(work, 'checkout', '-q', 'stashed'); writeFileSync(join(work, 'st1.txt'), 'dirty\n'); sh(work, 'stash', 'push', '-q'); sh(work, 'checkout', '-q', 'main')
  // 8. upstream gone + merged (the PR branch deleted on the server)
  feature('gone-merged', n => { commit(work, 'g1.txt', '1\n', 'g1'); push(n) })
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge gone-merged', 'gone-merged')
  // 9. upstream gone + NOT merged
  feature('gone-unmerged', n => { commit(work, 'g2.txt', '1\n', 'g2'); push(n) })
  sh(work, 'push', '-q', 'origin', '--delete', 'gone-merged', 'gone-unmerged')
  sh(work, 'fetch', '-q', '--prune')
  // 10. merged, but a commit that was never pushed
  feature('unpushed', n => { commit(work, 'p1.txt', '1\n', 'p1'); push(n); commit(work, 'p2.txt', '2\n', 'p2 (not pushed)') })
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge unpushed', 'unpushed')
  // 11. merged, and the server copy has MORE commits than we deleted (pushed from elsewhere)
  feature('remote-moved', n => { commit(work, 'x1.txt', '1\n', 'x1'); push(n) })
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge remote-moved', 'remote-moved')
  sh(other, 'fetch', '-q'); sh(other, 'checkout', '-q', 'remote-moved'); commit(other, 'x2.txt', '2\n', 'x2 from elsewhere'); sh(other, 'push', '-q', 'origin', 'remote-moved')
  // 12. protected by name
  feature('release/1.0', () => commit(work, 'rel.txt', '1\n', 'rel'))
  sh(work, 'merge', '-q', '--no-ff', '-m', 'merge release', 'release/1.0')
  // 13. a name starting with a dash (made with update-ref; this tool must never touch it)
  sh(work, 'update-ref', 'refs/heads/-dash', sh(work, 'rev-parse', 'main'))
  // 14. PR merged on the server, local main not updated, head matches (scripted gh)
  feature('pr-only', n => { commit(work, 'pr1.txt', '1\n', 'pr1'); commit(work, 'pr2.txt', '2\n', 'pr2'); push(n) })

  sh(work, 'push', '-q', 'origin', 'main')
  sh(work, 'fetch', '-q')
  const tips: Record<string, string> = {}
  for (const b of branches(work)) tips[b] = sh(work, 'rev-parse', `refs/heads/${b}`)
  return { dir, work, bare, other, tips }
}

type Script = (question: string, options: string[], header: string) => string | Promise<string>
function depsFor(w: World, script: Script, o: { run?: Run; hasGh?: boolean } = {}) {
  const store = new Map<string, unknown>()
  const memory = new Map<string, unknown>()
  const log = { asks: [] as { question: string; options: string[]; header: string }[], toasts: [] as string[], announced: 0 }
  const deps: Deps = {
    run: o.run ?? real,
    ask: async (question, opts) => {
      log.asks.push({ question, options: opts.options, header: opts.header })
      return script(question, opts.options, opts.header)
    },
    toast: t => void log.toasts.push(t),
    now: async () => 1_800_000_000_000,
    store: { get: async k => store.get(k), set: async (k, v) => void store.set(k, v) },
    hasGh: async () => o.hasGh ?? false,
    tryLock: async () => async () => undefined,
    session: { get: async k => memory.get(k), set: async (k, v) => void memory.set(k, v) },
    announce: async () => void log.announced++,
    settings: { minMinutes: 30, staleDays: 60, protectedBranches: DEFAULT_PROTECTED },
  }
  return { deps, log, store }
}

const OFFERED = ['merged-ff', 'rebase-merged', 'remote-moved', 'squash-multi', 'squash-one', 'gone-merged'].sort()
const KEPT = ['unmerged', 'in-worktree', 'stashed', 'gone-unmerged', 'unpushed', '-dash', 'release/1.0', 'pr-only']

async function main() {
  // ---- scan: verdicts per branch
  {
    const w = buildWorld()
    console.log('scan verdicts')
    const res = (await scan(real, w.work, { protectedBranches: DEFAULT_PROTECTED, staleDays: 60 }, { ghScope: 'none', hasGh: async () => false, now: Date.now() }))!
    const status = Object.fromEntries(res.verdicts.map(v => [v.name, v.status]))
    for (const b of OFFERED) check(status[b] === 'offer', `${b} should be offered`, JSON.stringify(res.verdicts.find(v => v.name === b)?.reason))
    for (const b of KEPT) check(status[b] !== 'offer', `${b} must not be offered`, String(status[b]))
    check(status['gone-unmerged'] === 'maybe', 'gone-unmerged is only "maybe"', String(status['gone-unmerged']))
    check(status['-dash'] === 'excluded', 'dash branch excluded')
    check(status['in-worktree'] === 'excluded' && status['release/1.0'] === 'excluded' && status['main'] === 'excluded', 'worktree, protected, default excluded')
    const by = (n: string) => res.verdicts.find(v => v.name === n)!
    check(by('merged-ff').deleteFlag === '-d', 'ancestor merge uses -d')
    check(by('squash-multi').deleteFlag === '-D' && by('squash-multi').evidence.some(e => e.kind === 'content'), 'multi-commit squash found by content check, uses -D')
    check(by('squash-one').evidence.some(e => e.kind === 'patch'), 'single squash found by patch ids')
    check(by('rebase-merged').evidence.some(e => e.kind === 'patch'), 'rebase merge found by patch ids')
    check(by('stashed').checks.find(c => c.id === 'd')?.ok === false, 'stash check fails for stashed')
    check(by('unpushed').checks.find(c => c.id === 'c')?.ok === false, 'unpushed check fails for unpushed')
    check(by('gone-merged').evidence.some(e => e.kind === 'gone') && by('gone-merged').status === 'offer', 'gone + merged is offered')
    check(by('unmerged').status === 'keep', 'unmerged is keep')
    // gh, scripted: the PR for pr-only merged at exactly the tip
    const withGh = makeRun({ 'pr-only': [{ number: 7, mergedAt: '2026-01-01', baseRefName: 'main', headRefOid: w.tips['pr-only'] }], 'gone-unmerged': [{ number: 8, mergedAt: '2026-01-01', baseRefName: 'main', headRefOid: 'f'.repeat(40) }] })
    const g = (await scan(withGh, w.work, { protectedBranches: DEFAULT_PROTECTED, staleDays: 60 }, { ghScope: 'pushed', hasGh: async () => true, now: Date.now() }))!
    const gs = Object.fromEntries(g.verdicts.map(v => [v.name, v.status]))
    check(gs['pr-only'] === 'offer', 'PR merged at this exact tip is offered', String(gs['pr-only']))
    check(gs['gone-unmerged'] === 'keep', 'PR merged but branch has later commits: not offered', String(gs['gone-unmerged']))
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- report deletes nothing
  {
    const w = buildWorld()
    console.log('report')
    const before = branches(w.work)
    const { deps } = depsFor(w, () => { throw new Error('report must not ask') })
    const text = await report(deps, w.work)
    check(text.split('\n')[0]!.startsWith('Branches · ') && text.includes('✓ merged-ff · ') && text.includes('· unmerged · '), 'report lists verdicts')
    check(JSON.stringify(branches(w.work)) === JSON.stringify(before), 'report deleted nothing')
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- Not now: nothing deleted, snoozed
  {
    const w = buildWorld()
    console.log('Keep')
    const before = branches(w.work)
    const { deps, log, store } = depsFor(w, () => 'Keep')
    await lookAndOffer(deps, w.work, 'merge')
    check(log.asks.length === 1 && log.asks[0]!.question.startsWith('Delete 6 finished branches?'), 'one dialog, six branches', log.asks[0]?.question.split('\n')[0])
    check(log.asks[0]!.options[0] === 'Keep', 'Keep is the first (default) option')
    check(JSON.stringify(branches(w.work)) === JSON.stringify(before), 'nothing deleted')
    const key = [...store.keys()].find(k => k.startsWith('repo:'))!
    check((store.get(key) as { snoozeUntil: number }).snoozeUntil > 1_800_000_000_000, 'snoozed')
    await lookAndOffer(deps, w.work, 'other')
    check(log.asks.length === 1, 'snoozed: a quiet trigger does not ask again')
    await lookAndOffer(deps, w.work, 'merge')
    check(log.asks.length === 1, 'a merge looks again, but the six branches already turned down at these tips are not offered again')
    // a branch that finishes later is offered on its own
    sh(w.work, 'checkout', '-q', '-b', 'later', 'main'); commit(w.work, 'later.txt', '1\n', 'later'); sh(w.work, 'checkout', '-q', 'main')
    sh(w.work, 'merge', '-q', '--no-ff', '-m', 'merge later', 'later')
    await lookAndOffer(deps, w.work, 'merge')
    check(log.asks.length === 2 && log.asks[1]!.question.startsWith('Delete 1 finished branch?') && log.asks[1]!.question.includes('\nlater\n'), 'only the newly finished branch is offered', log.asks[1]?.question.split('\n').slice(0, 3).join(' | '))
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- merge done OUTSIDE Claude Code: the next prompt's cheap probe notices and offers
  {
    const w = buildWorld()
    console.log('merge outside Claude, next prompt')
    const counted = counting(real)
    const { deps, log } = depsFor(w, () => 'Keep', { run: counted.run })
    await watchPrompt(deps, w.work) // the session's first prompt: nothing looked at yet, so a full look
    check(log.asks.length === 1 && log.announced === 1, 'first prompt of the session: one look, announced once', String(log.asks.length))
    const before = counted.calls.length
    await watchPrompt(deps, w.work)
    await watchPrompt(deps, w.work)
    const extra = counted.calls.slice(before)
    check(log.asks.length === 1, 'nothing changed: no new question')
    check(extra.length === 2 && extra.every(c => c.includes('for-each-ref')), 'nothing changed: exactly one probe per prompt and no scan', extra.map(c => c.slice(6).join(' ')).join(' | '))
    check(extra.every(c => c.length > 0 && c.includes('refs/heads') && c.includes('refs/remotes')), 'the probe reads heads and remote-tracking refs in one call')
    // in a plain terminal: finish a feature and merge it, then fetch
    const answers: string[] = []
    deps.ask = async (question, opts) => {
      answers.push(question)
      return opts.options.find(o => o === 'Delete branch') ?? 'Keep'
    }
    sh(w.work, 'checkout', '-q', '-b', 'typed-in-terminal', 'main'); commit(w.work, 'tt.txt', '1\n', 'tt'); sh(w.work, 'push', '-q', '-u', 'origin', 'typed-in-terminal'); sh(w.work, 'checkout', '-q', 'main')
    sh(w.work, 'merge', '-q', '--no-ff', '-m', 'merge typed-in-terminal', 'typed-in-terminal')
    await watchPrompt(deps, w.work)
    const cleanup = answers.filter(q => q.startsWith('Delete 1 finished branch?'))
    check(cleanup.length === 1 && cleanup[0]!.includes('\ntyped-in-terminal\n') && !cleanup[0]!.includes('merged-ff'), 'changed after an outside merge: only the new branch is offered', cleanup[0]?.split('\n').slice(0, 3).join(' | '))
    check(!branches(w.work).includes('typed-in-terminal') && branches(w.work).includes('merged-ff'), 'the offered branch was deleted on Yes; the declined ones were left alone')
    // a server-side merge seen only after `git fetch` also changes the print
    const fp1 = await repoFingerprint(real, w.work)
    sh(w.other, 'fetch', '-q'); sh(w.other, 'checkout', '-q', 'main'); sh(w.other, 'pull', '-q'); commit(w.other, 'srv.txt', '1\n', 'server side'); sh(w.other, 'push', '-q', 'origin', 'main')
    sh(w.work, 'fetch', '-q')
    check((await repoFingerprint(real, w.work)) !== fp1, 'a fetch that moves origin/main changes the fingerprint')
    check((await repoFingerprint(real, w.work)) === (await repoFingerprint(real, w.work)), 'the fingerprint is stable when nothing moved')
    check((await repoFingerprint(real, w.dir)) === undefined, 'outside a repository there is no fingerprint')
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- a branch nobody has committed on yet is not finished work, however "merged" it looks
  {
    const w = buildWorld()
    console.log('just created')
    sh(w.work, 'branch', 'fresh', 'main')
    const res = (await scan(real, w.work, { protectedBranches: DEFAULT_PROTECTED, staleDays: 60 }, { ghScope: 'none', hasGh: async () => false, now: Date.now() }))!
    const fresh = res.verdicts.find(v => v.name === 'fresh')!
    check(fresh.status === 'keep' && fresh.reason.includes('just created'), 'a branch created from main with no commit is kept', fresh.reason)
    sh(w.work, 'checkout', '-q', 'fresh'); commit(w.work, 'fresh.txt', '1\n', 'first work'); sh(w.work, 'checkout', '-q', 'main'); sh(w.work, 'merge', '-q', '--no-ff', '-m', 'merge fresh', 'fresh')
    const done = (await scan(real, w.work, { protectedBranches: DEFAULT_PROTECTED, staleDays: 60 }, { ghScope: 'none', hasGh: async () => false, now: Date.now() }))!
    check(done.verdicts.find(v => v.name === 'fresh')!.status === 'offer', 'after real work and a merge it is offered')
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- plain words and the slash command are one function
  {
    const w = buildWorld()
    console.log('plain words')
    const { deps } = depsFor(w, () => { throw new Error('listing must not ask') })
    const listed = await runCommand(deps, w.work, '')
    check(listed.includes('✓ merged-ff · '), 'listing')
    check((await runCommand(deps, w.work, 'sideways')).includes('branch-janitor clean'), 'usage text names the plain words')
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- Delete all, remote: yes for merged-ff, no for the rest; lease race on squash-one
  {
    const w = buildWorld()
    console.log('delete all + remote questions')
    const remoteAsks: string[] = []
    const { deps, log } = depsFor(w, async (q, options, header) => {
      if (header === 'Branches') return options.find(o => o.startsWith('Delete all'))!
      remoteAsks.push(q)
      if (q.includes('origin/merged-ff?')) return 'Delete origin/merged-ff'
      if (q.includes('origin/squash-one?')) { // the server copy moves after the scan: the lease must refuse
        sh(w.other, 'fetch', '-q'); sh(w.other, 'checkout', '-q', 'squash-one'); commit(w.other, 'late.txt', '1\n', 'late'); sh(w.other, 'push', '-q', 'origin', 'squash-one')
        return 'Delete origin/squash-one'
      }
      return 'Keep'
    })
    await lookAndOffer(deps, w.work, 'merge')
    const left = branches(w.work)
    for (const b of OFFERED) check(!left.includes(b), `${b} deleted locally`)
    for (const b of KEPT) check(left.includes(b), `${b} survived`)
    check(left.includes('main'), 'main survived')
    check(!remoteBranches(w.bare).includes('merged-ff'), 'remote merged-ff deleted after its own Yes')
    check(remoteBranches(w.bare).includes('squash-one'), 'remote squash-one kept: it moved after our check (lease refused)')
    check(remoteBranches(w.bare).includes('squash-multi') && remoteBranches(w.bare).includes('rebase-merged') === false, 'remote squash-multi kept (answered Keep)')
    check(!remoteAsks.some(q => q.includes('remote-moved')), 'no remote question where the server tip differs from what was deleted')
    check(!remoteAsks.some(q => q.includes('gone-merged')), 'no remote question for a [gone] upstream')
    check(log.toasts.length === 1 && log.toasts[0]!.includes('Deleted 6 branches') && OFFERED.every(b => log.toasts[0]!.includes(`git branch ${b} ${w.tips[b]}`)), 'one toast with every restore command', log.toasts[0])
    check(log.toasts[0]!.includes('✗ origin/squash-one'), 'toast reports the refused remote delete')
    // the restore command really restores the tip
    sh(w.work, 'branch', 'squash-multi', w.tips['squash-multi']!)
    check(sh(w.work, 'rev-parse', 'squash-multi') === w.tips['squash-multi'], 'restore command brings the branch back at the same tip')
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- Choose one by one: delete only the picked one
  {
    const w = buildWorld()
    console.log('one by one')
    const { deps } = depsFor(w, (q, options, header) => {
      if (header === 'Branches' && options.includes('Review one by one')) return 'Review one by one'
      if (header === 'Branches') return q.startsWith('Delete squash-multi?') ? 'Delete squash-multi' : 'Keep'
      return 'Keep'
    })
    await lookAndOffer(deps, w.work, 'merge')
    const left = branches(w.work)
    check(!left.includes('squash-multi'), 'picked branch deleted (-D)')
    for (const b of OFFERED.filter(b => b !== 'squash-multi')) check(left.includes(b), `${b} skipped, still there`)
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- Never ask again, then off/on
  {
    const w = buildWorld()
    console.log('never ask again')
    const { deps, log } = depsFor(w, () => 'Never ask here')
    await lookAndOffer(deps, w.work, 'merge')
    check(sh(w.work, 'config', '--local', '--get', 'toolkit.branchJanitor') === 'false', 'git config written')
    check(log.asks.length === 1, 'asked once')
    await lookAndOffer(deps, w.work, 'merge')
    check(log.asks.length === 1, 'never asks again in this repo')
    check(OFFERED.every(b => branches(w.work).includes(b)), 'nothing deleted')
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- a branch that moves between the dialog and the click is left alone; stale local main uses origin/main
  {
    const w = buildWorld()
    console.log('moved branch / stale main')
    const { deps } = depsFor(w, (_q, options, header) => {
      if (header !== 'Branches') return 'Keep'
      sh(w.work, 'checkout', '-q', 'merged-ff'); commit(w.work, 'late.txt', '1\n', 'late work'); sh(w.work, 'checkout', '-q', 'main')
      return options.find(o => o.startsWith('Delete all'))!
    })
    await lookAndOffer(deps, w.work, 'merge')
    check(branches(w.work).includes('merged-ff'), 'branch that got a commit after the scan is not deleted')
    rmSync(w.dir, { recursive: true, force: true })

    const s = buildWorld()
    // the server merged "pr-only" (fast-forward) but local main has not been pulled: origin/main contains it
    sh(s.other, 'fetch', '-q'); sh(s.other, 'checkout', '-q', 'main'); sh(s.other, 'pull', '-q'); sh(s.other, 'merge', '-q', '--ff-only', 'origin/pr-only'); sh(s.other, 'push', '-q', 'origin', 'main')
    sh(s.work, 'fetch', '-q')
    const r = (await scan(real, s.work, { protectedBranches: DEFAULT_PROTECTED, staleDays: 60 }, { ghScope: 'none', hasGh: async () => false, now: Date.now() }))!
    const v = r.verdicts.find(x => x.name === 'pr-only')!
    check(v.status === 'offer' && v.evidence[0]!.text === 'merged into origin/main', 'stale local main: merged into origin/main counts', v.reason)
    rmSync(s.dir, { recursive: true, force: true })
  }

  // ---- standing on another branch: git's own -d would refuse (it judges "merged" against HEAD); the -D retry is safe
  {
    const w = buildWorld()
    console.log('delete while on another branch')
    sh(w.work, 'checkout', '-q', 'unmerged')
    const { deps } = depsFor(w, (_q, options, header) => (header === 'Branches' ? options.find(o => o.startsWith('Delete all'))! : 'Keep'))
    await lookAndOffer(deps, w.work, 'merge')
    const left = branches(w.work)
    check(!left.includes('gone-merged') && !left.includes('merged-ff'), 'merged branches deleted although HEAD is elsewhere')
    check(left.includes('unmerged'), 'the branch we stand on is untouched')
    rmSync(w.dir, { recursive: true, force: true })
  }

  // ---- clean command with a fake gh available
  {
    const w = buildWorld()
    console.log('clean')
    const gh = makeRun({ 'pr-only': [{ number: 7, mergedAt: 'x', baseRefName: 'main', headRefOid: w.tips['pr-only'] }] })
    const { deps, log } = depsFor(w, (_q, options, header) => (header === 'Branches' ? options.find(o => o.startsWith('Delete all'))! : 'Keep'), { run: gh, hasGh: true })
    const text = await cleanNow(deps, w.work)
    check(!branches(w.work).includes('pr-only') && text.includes('Deleted 7 branches'), 'clean deletes the PR-merged branch too', text.split('\n')[0])
    check(log.asks[0]!.question.includes('✓ PR #7 merged into main'), 'dialog shows PR evidence')
    rmSync(w.dir, { recursive: true, force: true })
  }

  console.log(`${checks - failures}/${checks} checks passed`)
  if (failures > 0) process.exit(1)
}

main().catch(e => {
  console.log('CRASH', e)
  process.exit(1)
})
