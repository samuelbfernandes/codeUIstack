// The automatic look on every prompt, and the plain-word commands. Same scripted world as flow.test.ts.
import { test, expect } from 'claude-code/testing'

import { dropWith, linesOf } from '../hooks/reply'
import { plainWord } from '../hooks/words'
import { SHA, world } from './world'
import type { FakeBranch, Model } from './world'

const SURFACES = [['terminal'], ['desktop'], ['terminal', 'desktop']] as const
const MAIN = SHA('1')
const DONE = SHA('d')
const WATCHING = 'Watching branches · type branch-janitor to list them'

const repo = (branches: Record<string, FakeBranch>, extra: Partial<Model> = {}): Model => ({
  current: 'main',
  branches: { main: { sha: MAIN, upstream: 'refs/remotes/origin/main' }, ...branches },
  ...extra,
})
const merged = (sha = DONE): FakeBranch => ({ sha, merged: true })
const unmerged = (sha: string): FakeBranch => ({ sha, cherry: `+ ${sha}\n` })

/** Wraps the model a person's terminal would have changed under Claude's feet: `feat` got merged into main. */
const mergeOutside = (m: Model, name = 'feat') => {
  m.branches.main!.sha = SHA((Number.parseInt(m.branches.main!.sha[0]!, 16) + 1).toString(16))
  m.branches[name] = { sha: m.branches[name]!.sha, merged: true }
}

const MS = 400 // past the short delay between the prompt and the probe
type Origin = { kind: string; name?: string }
function typed($: any, w: { clock: { advance: (ms: number) => Promise<void> } }, text: string, origin: Origin = { kind: 'composer' }) {
  return (async () => {
    const r = await $.prompt.submit({ text, wait: false, origin })
    await w.clock.advance(MS) // the probe and any look run from a timer, after the prompt went in
    return r as { text?: string; drop?: string }
  })()
}
const slash = ($: any, args = '') =>
  $.command.run({ command: 'branch-janitor', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
const probes = (w: { cmds: string[][] }) => w.cmds.filter(c => c[6] === 'for-each-ref' && c[7]!.startsWith('--format=%(HEAD)%(refname)'))
const scans = (w: { cmds: string[][] }) => w.cmds.filter(c => c[6] === 'for-each-ref' && c[7]!.startsWith('--format=%(HEAD)%09'))
const passthrough = (on: any) => on('prompt.submit', (_$: any, e: { text: string }) => ({ text: e.text }))

// ---------------------------------------------------------------- the automatic look

for (const surfaces of SURFACES)
  test(`first prompt on ${surfaces.join('+')}: one look, announced once, the prompt itself untouched`, async ($, on) => {
    const w = world(on, repo({ done: merged() }), { surfaces })
    passthrough(on)
    const r = await $.prompt.submit({ text: 'fix the bug', wait: false, origin: { kind: 'composer' } })
    expect(r).toMatchObject({ text: 'fix the bug' })
    expect(w.cmds).toHaveLength(0) // the hook itself runs no git: the look is scheduled
    await w.clock.advance(MS)
    expect(w.asks).toHaveLength(1)
    expect(w.asks[0]!.question).toContain('\ndone\n')
    expect(w.notices.toasts).toEqual([WATCHING])
    expect(w.notices.logs).not.toContain(WATCHING)
  })

test('unchanged repository: every later prompt costs exactly one probe, no scan, no question, no new notice', async ($, on) => {
  const w = world(on, repo({ wip: unmerged(SHA('3')) }))
  passthrough(on)
  await typed($, w, 'one')
  expect(scans(w)).toHaveLength(1)
  const before = w.cmds.length
  for (const text of ['two', 'three', 'four']) await typed($, w, text)
  const extra = w.cmds.slice(before)
  expect(extra).toHaveLength(3)
  expect(extra.every(c => probes({ cmds: [c] }).length === 1)).toBe(true)
  expect(extra[0]!.slice(6)).toEqual(['for-each-ref', '--format=%(HEAD)%(refname) %(objectname) %(upstream:track)', 'refs/heads', 'refs/remotes'])
  expect(w.notices.toasts).toHaveLength(1)
  expect(w.asks).toHaveLength(0)
})

for (const surfaces of SURFACES)
  test(`a merge done outside Claude is offered at the next prompt on ${surfaces.join('+')}, even right after the last look`, async ($, on) => {
    const model = repo({ feat: unmerged(SHA('f')) })
    const w = world(on, model, { surfaces, answer: 'Delete branch' })
    passthrough(on)
    await typed($, w, 'start working')
    expect(w.asks).toHaveLength(0)
    mergeOutside(model) // `git merge feat` in a plain terminal; the minMinutes rate limit (30) has NOT passed
    await typed($, w, 'what next?')
    expect(w.asks).toHaveLength(1)
    expect(w.asks[0]!.question).toContain('\nfeat\n')
    expect(w.asks[0]!.question).toContain('✓ Merged into main')
    expect(w.deleted).toEqual([{ flag: '-d', name: 'feat' }])
    expect(w.toasts[0]).toContain('git branch feat')
  })

test('a branch turned down is not offered again when something else changes; a new finished branch is', async ($, on) => {
  const model = repo({ feat: unmerged(SHA('f')), other: unmerged(SHA('9')) })
  const w = world(on, model, { answer: 'Keep' })
  passthrough(on)
  await typed($, w, 'a')
  mergeOutside(model)
  await typed($, w, 'b')
  expect(w.asks).toHaveLength(1)
  model.branches.main!.sha = SHA('7') // any other change (a commit, a fetch)
  await typed($, w, 'c')
  expect(w.asks).toHaveLength(1) // `feat` was turned down at this tip
  mergeOutside(model, 'other')
  await typed($, w, 'd')
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]!.question).toContain('\nother\n')
  expect(w.asks[1]!.question).not.toContain('feat')
})

test('the first prompt after a session start look does not ask twice (a dismissed question is not a no)', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: 'REJECT' })
  passthrough(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await w.clock.advance(3_100)
  expect(w.asks).toHaveLength(1)
  await typed($, w, 'hello')
  expect(w.asks).toHaveLength(1)
})

test('a change while a question is open is not lost: the next prompt after it closes looks again', async ($, on) => {
  const model = repo({ feat: unmerged(SHA('f')) })
  let release!: (answer: string) => void
  const gate = new Promise<string>(resolve => (release = resolve))
  let first = true
  const w = world(on, model, { answer: () => (first ? ((first = false), gate) : 'Keep') })
  passthrough(on)
  model.branches.done = merged()
  await typed($, w, 'a') // opens the question about `done`
  expect(w.asks).toHaveLength(1)
  mergeOutside(model)
  await typed($, w, 'b') // changed, but the dialog is still open: nothing stacks
  expect(w.asks).toHaveLength(1)
  release('Keep')
  await w.clock.settle()
  await typed($, w, 'c') // `b`'s look was refused by the lock, so this prompt still sees the change
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]!.question).toContain('\nfeat\n')
})

test('minMinutes still limits the quiet triggers after a prompt look; a change always looks', async ($, on) => {
  const model = repo({ wip: unmerged(SHA('3')) })
  const w = world(on, model)
  passthrough(on)
  await typed($, w, 'a')
  expect(scans(w)).toHaveLength(1)
  await $.tool.call({ tool: 'Bash', command: 'git pull' })
  expect(scans(w)).toHaveLength(1) // quiet trigger, 30 minutes not passed
  model.branches.main!.sha = SHA('8')
  await typed($, w, 'b')
  expect(scans(w)).toHaveLength(2) // changed
})

// ---------------------------------------------------------------- gh

test('gh is asked once per branch tip until the fingerprint changes, and never for branches the cheap checks settled', async ($, on) => {
  const model = repo(
    {
      gone1: { sha: SHA('4'), upstream: 'refs/remotes/origin/gone1', track: '[gone]', cherry: `+ ${SHA('4')}\n` },
      done: merged(),
      pushed: { sha: SHA('5'), upstream: 'refs/remotes/origin/pushed', cherry: `+ ${SHA('5')}\n` },
    },
    { gh: { installed: true, prs: { gone1: [{ number: 11, mergedAt: '2026-01-01', baseRefName: 'main', headRefOid: SHA('f') }] } } },
  )
  const w = world(on, model, { answer: 'Keep' })
  passthrough(on)
  const ghCalls = () => w.cmds.filter(c => c[0] === 'gh' && c[1] === 'pr')
  await typed($, w, 'a')
  expect(ghCalls().map(c => c[4])).toEqual(['gone1']) // not `done` (merged), not `pushed` (only a manual command asks about those)
  await typed($, w, 'b')
  await $.tool.call({ tool: 'Bash', command: 'git merge x' }) // same fingerprint
  expect(ghCalls()).toHaveLength(1)
  model.branches.main!.sha = SHA('9')
  await typed($, w, 'c') // fingerprint changed: allowed to ask again
  expect(ghCalls()).toHaveLength(2)
})

// ---------------------------------------------------------------- headless, other senders, fail-open

test('headless (no surface): no probe, no question, no notice, and a plain word goes through to the model', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { surfaces: [] })
  passthrough(on)
  const r = await typed($, w, 'branch-janitor')
  expect(r).toEqual({ text: 'branch-janitor' })
  expect(w.cmds).toHaveLength(0)
  expect(w.asks).toHaveLength(0)
  expect(w.notices.toasts).toHaveLength(0)
})

test('prompts that are not the person\'s own words are never watched or intercepted', async ($, on) => {
  const w = world(on, repo({ done: merged() }))
  passthrough(on)
  for (const origin of [{ kind: 'scheduled-trigger' }, { kind: 'task-notification' }, { kind: 'peer' }, { kind: 'plugin', name: 'x' }, { kind: 'sdk' }]) {
    const r = await typed($, w, 'janitor', origin)
    expect(r).toEqual({ text: 'janitor' })
  }
  expect(w.cmds).toHaveLength(0)
})

test('fail-open: git missing or throwing leaves the prompt exactly as typed and asks nothing', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { broken: true }))
  passthrough(on)
  const r = await typed($, w, 'hello')
  expect(r).toEqual({ text: 'hello' })
  expect(w.asks).toHaveLength(0)
  expect(w.notices.toasts).toHaveLength(0)
})

test('fail-open: a failing probe (corrupt repository, timeout) means no look and no complaint', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { probeFails: true }))
  passthrough(on)
  const r = await typed($, w, 'hello')
  expect(r).toEqual({ text: 'hello' })
  expect(w.cmds).toHaveLength(1) // the probe, nothing after it
  expect(w.asks).toHaveLength(0)
})

test('fail-open: a dismissed dialog and a throwing ask change nothing', async ($, on) => {
  const w = world(on, repo({ done: merged() }), { answer: 'REJECT' })
  passthrough(on)
  const r = await typed($, w, 'hello')
  expect(r).toEqual({ text: 'hello' })
  expect(w.deleted).toEqual([])
})

test('outside a repository: silence, one failed probe per prompt', async ($, on) => {
  const w = world(on, { root: null as never, branches: {} } as Model)
  passthrough(on)
  await typed($, w, 'a')
  await typed($, w, 'b')
  expect(w.cmds).toHaveLength(2)
  expect(w.asks).toHaveLength(0)
  expect(w.notices.toasts).toHaveLength(0)
})

test('a repository switched off: no scan, no notice, and later prompts cost only the probe', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { disabled: true }))
  passthrough(on)
  await typed($, w, 'a')
  expect(w.cmds.map(c => c.slice(6, 7).join())).toEqual(['for-each-ref', 'rev-parse', 'config'])
  await typed($, w, 'b')
  expect(w.cmds).toHaveLength(4)
  expect(w.notices.toasts).toHaveLength(0)
})

// ---------------------------------------------------------------- plain words

const LISTING_WORDS = ['branch-janitor', 'janitor', 'clean branches', 'clean up branches', 'cleanup branches', 'delete merged branches']

test('plainWord: exact words only, any case, optional trailing full stop', () => {
  for (const w of LISTING_WORDS) {
    expect(plainWord(w)).toBe('')
    expect(plainWord(`  ${w.toUpperCase()}.  `)).toBe('')
  }
  expect(plainWord('branch-janitor clean')).toBe('clean')
  expect(plainWord('Janitor  Clean.')).toBe('clean')
  expect(plainWord('branch-janitor on')).toBe('on')
  expect(plainWord('branch-janitor off')).toBe('off')
  for (const not of ['', 'janitor on', 'janitor off', 'please janitor', 'branch-janitor clean now', 'clean the branches', 'janitor?', 'janitor!', 'branches', 'what is branch-janitor', '/branch-janitor', 'cleanup branch', 'janitor clean branches', 'delete merged branches please'])
    expect(plainWord(not)).toBeUndefined()
})

for (const surfaces of SURFACES)
  for (const word of LISTING_WORDS)
    test(`"${word}" on ${surfaces.join('+')}: same output as /branch-janitor, dropped before the model, nothing deleted or asked`, async ($, on) => {
      const model = repo({ done: merged(), wip: unmerged(SHA('3')) })
      const w = world(on, model, { surfaces })
      let reachedModel = 0
      on('prompt.submit', (_$: any, e: { text: string }) => (reachedModel++, { text: e.text }))
      const expected = (await slash($)).text!.split('\n')
      const r = await $.prompt.submit({ text: word, wait: false, origin: { kind: 'composer' } })
      expect(r.drop).toBe('Branches · 1 ready to delete, 1 to keep') // one line: the headline
      expect(r.drop).toBe(expected[0])
      expect(w.logs).toEqual([expected.slice(1).join('\n')]) // the rest, once, in the transcript
      expect(w.logs[0]).toContain('✓ done · merged into main')
      expect(reachedModel).toBe(0)
      await w.clock.advance(MS)
      expect(w.asks).toHaveLength(0)
      expect(w.deleted).toEqual([])
      expect(probes(w)).toHaveLength(0) // a command is not also a watch
    })

for (const surfaces of SURFACES)
  for (const word of ['branch-janitor clean', 'Janitor Clean.'])
    test(`"${word}" on ${surfaces.join('+')} runs the clean flow like /branch-janitor clean`, async ($, on) => {
      const w = world(on, repo({ done: merged() }), { surfaces, answer: (_q, _o, h) => (h === 'Branches' ? 'Delete branch' : 'Keep') })
      let reachedModel = 0
      on('prompt.submit', (_$: any, e: { text: string }) => (reachedModel++, { text: e.text }))
      const r = await $.prompt.submit({ text: word, wait: false, origin: { kind: 'composer' } })
      expect(r.drop).toBe('Deleted 1 branch · restore with:')
      expect(w.logs).toEqual([`git branch done ${DONE}`]) // once: the toast's own log is skipped, the reply logs it
      expect(w.deleted).toEqual([{ flag: '-d', name: 'done' }])
      expect(reachedModel).toBe(0)
    })

test('"branch-janitor off" and "on" toggle the repository exactly like the slash command', async ($, on) => {
  const w = world(on, repo({ done: merged() }))
  passthrough(on)
  const off = await $.prompt.submit({ text: 'branch-janitor off', wait: false, origin: { kind: 'composer' } })
  expect(off.drop).toBe('Branches · off for this repository')
  expect(w.logs).toEqual(['Turn it on again: branch-janitor on'])
  expect(w.config).toEqual([['config', '--local', 'toolkit.branchJanitor', 'false']])
  const back = await $.prompt.submit({ text: 'branch-janitor on', wait: false, origin: { kind: 'composer' } })
  expect(back.drop).toBe('Branches · on for this repository')
  expect(w.config[1]).toEqual(['config', '--local', '--unset', 'toolkit.branchJanitor'])
})

test('a prompt that merely contains the words is left alone: it reaches the model and is not answered here', async ($, on) => {
  const w = world(on, repo({ wip: unmerged(SHA('3')) }))
  passthrough(on)
  for (const text of ['please run branch-janitor for me', 'what does the janitor do?', 'branch-janitor clean now', 'janitor on', 'clean branches and then commit', 'fix the janitor bug in cleanup branches code']) {
    const r = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
    expect(r).toEqual({ text })
    expect(r.drop).toBeUndefined()
  }
  expect(w.cmds).toHaveLength(0) // nothing ran before the timers
})

test('a plain-word command that fails half way is dropped with an apology, never sent to the model', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { broken: true }))
  let reachedModel = 0
  on('prompt.submit', (_$: any, e: { text: string }) => (reachedModel++, { text: e.text }))
  const r = await $.prompt.submit({ text: 'branch-janitor', wait: false, origin: { kind: 'composer' } })
  expect(r.drop).toBeDefined()
  expect(reachedModel).toBe(0)
  expect(w.deleted).toEqual([])
})

test('plain words outside a repository say so', async ($, on) => {
  world(on, { root: null as never, branches: {} } as Model)
  passthrough(on)
  const r = await $.prompt.submit({ text: 'janitor', wait: false, origin: { kind: 'composer' } })
  expect(r.drop).toBe('Branches · not in a git repository')
})

// ---------------------------------------------------------------- the slash command's description

test('the slash command is described as a helper the user runs, with the plain words', async ($, on) => {
  const w = world(on, repo({}))
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const reg = w.registered.find(r => r.name === 'branch-janitor')!
  expect(reg.description).toBe('Tidies finished git branches. Runs by itself, or type: branch-janitor. You run this, not Claude.')
})

// ---------------------------------------------------------------- a drop reason is ONE line

test('dropWith: the first line is the reason, the rest is one ui.log note, control characters are gone', () => {
  const logged: string[] = []
  const ui = { log: (t: string) => void logged.push(t) }
  expect(dropWith(ui, 'Headline\n  second\r\n\n third \u2028 fourth\u0007')).toEqual({ drop: 'Headline' })
  expect(logged).toEqual(['second\nthird\nfourth'])
  logged.length = 0
  expect(dropWith(ui, '  only one line  ')).toEqual({ drop: 'only one line' })
  expect(dropWith(ui, '\n\n')).toEqual({ drop: 'Branches' })
  expect(dropWith(ui, 'a\u0000b\tc\u0085d')).toEqual({ drop: 'a b c' }) // U+0085 is a line break too
  expect(logged).toEqual(['d'])
  expect(linesOf('x\ny')).toEqual(['x', 'y'])
  expect(dropWith({ log: () => { throw new Error('no log') } }, 'a\nb')).toEqual({ drop: 'a' }) // a failing log never breaks the reply
})

const NO_BREAK = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

test('every plain-word reply is a single-line drop and the rest goes to ui.log', async ($, on) => {
  const model = repo({ done: merged(), sq: { sha: SHA('2'), cherry: `- ${SHA('2')}\n` }, wip: unmerged(SHA('3')) })
  const w = world(on, model, { answer: 'Keep' })
  passthrough(on)
  const say = async (text: string) => {
    const before = w.logs.length
    const r = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
    expect(r.drop).toBeDefined()
    expect(r.drop!).not.toMatch(NO_BREAK)
    expect(r.drop!.length).toBeGreaterThan(0)
    return { drop: r.drop!, logged: w.logs.slice(before) }
  }
  const list = await say('branch-janitor')
  expect(list.drop).toBe('Branches · 2 ready to delete, 1 to keep')
  expect(list.logged).toHaveLength(1)
  expect(list.logged[0]).toContain('✓ done · merged into main')
  expect(list.logged[0]!.split('\n').length).toBeGreaterThan(3)
  const clean = await say('branch-janitor clean') // answered Keep
  expect(clean.drop).toBe('Branches · kept everything')
  expect(clean.logged).toEqual([])
  const off = await say('branch-janitor off')
  expect(off.drop).toBe('Branches · off for this repository')
  expect(off.logged).toEqual(['Turn it on again: branch-janitor on'])
  const on2 = await say('branch-janitor on')
  expect(on2.drop).toBe('Branches · on for this repository')
  expect(on2.logged).toEqual([])
  for (const text of [...w.logs, ...w.toasts]) expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/)
})

test('a failing plain-word command is a single-line drop', async ($, on) => {
  const w = world(on, repo({ done: merged() }, { broken: true }))
  passthrough(on)
  const r = await $.prompt.submit({ text: 'janitor', wait: false, origin: { kind: 'composer' } })
  expect(r.drop).toMatch(/^Branches · /) // git cannot run at all
  expect(r.drop).not.toMatch(NO_BREAK)
  expect(w.logs).toEqual([])
})
