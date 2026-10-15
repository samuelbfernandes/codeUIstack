// The behaviour, written against a small `Deps` record instead of `$` so the same code runs under the
// engine (register.tsx builds Deps from `$`), under the unit tests (fake `$`) and under the real-git
// integration script (real git, scripted answers).
import type { Verdict } from './decide'
import { repoFingerprint } from './fingerprint'
import { gitIn, lines, matchesPattern } from './git'
import type { Run } from './git'
import { dialogText, neverAskText, remoteDialogText, reportText, singleDialogText, toastText } from './format'
import { deleteLocal, deleteRemote, remoteOffer } from './remove'
import type { RemoteOffer } from './remove'
import { fetchOpenPrs, protectOpen } from './prs'
import { isDisabled, repoRoot, scan } from './scan'
import type { GhGate, ScanConfig, ScanResult } from './scan'

export type Settings = ScanConfig & { minMinutes: number }
export type AskOptions = { options: string[]; header: string }

export type Deps = {
  run: Run
  /** Resolves the chosen label (or free text); rejects when dismissed or when no one can be asked. */
  ask: (question: string, options: AskOptions) => Promise<string>
  toast: (text: string) => void
  now: () => Promise<number>
  store: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
  /** Is `gh` installed? Probed lazily, once per session by the caller. */
  hasGh: () => Promise<boolean>
  /** Take the "a dialog is open" lock; resolves a release function, or undefined when one is already open. */
  tryLock: () => Promise<(() => Promise<void>) | undefined>
  /** Memory that lasts one session (what was last looked at, which branches `gh` was asked about); `store` outlives it. */
  session: { get: (key: string) => Promise<unknown>; set: (key: string, value: unknown) => Promise<void> }
  /** Tells the person, once per session and only where one can see it, that branches are being watched. */
  announce: () => Promise<void>
  settings: Settings
}

/**
 * Why a look happens. merge: Claude ran a merge or a merged PR. changed: the per-prompt probe saw the branches
 * change (or this is the first prompt of the session). other: Claude pulled, pushed, switched or pruned.
 * start: the session just began.
 */
export type Look = 'merge' | 'changed' | 'other' | 'start'

export const SNOOZE_MS = 24 * 3_600_000
const MAX_OFFERED = 8

/** The first answer is always the safe one. */
export const LABEL = {
  keep: 'Keep',
  never: 'Never ask here',
  oneByOne: 'Review one by one',
  keepRest: 'Keep the rest',
} as const

type RepoState = { lastLook: number; snoozeUntil: number }
const stateKey = (root: string) => `repo:${root}`
/** Branches the person was shown and did not delete, by name -> tip: never offered again at that tip. */
type Declined = Record<string, string>
const declinedKey = (root: string) => `declined:${root}`
const seenKey = (cwd: string) => `fingerprint:${cwd}`
const ghKey = (cwd: string) => `gh:${cwd}`
const ghUsedKey = (root: string) => `ghUsed:${root}`

/** Claude ran `gh` in this repository: remembered (store), so the pull-request lines are shown only where gh is in use. */
export async function noteGhUse(d: Deps, cwd: string): Promise<void> {
  const root = await repoRoot(d.run, cwd)
  if (root !== undefined && (await d.store.get(ghUsedKey(root))) !== true) await d.store.set(ghUsedKey(root), true)
}

/**
 * Add open pull requests to a scan: only when gh is installed AND has been used in this repository, one read-only
 * `gh pr list`, silent on any failure. A branch with an open PR is never "finished": its offer becomes a keep.
 * Called for the explicit report, `clean`, and just before a dialog would open: never for an unchanged repository.
 */
async function withOpenPrs(d: Deps, root: string, res: ScanResult): Promise<ScanResult> {
  try {
    if ((await d.store.get(ghUsedKey(root))) !== true || !(await d.hasGh())) return res
    const prs = await fetchOpenPrs(d.run, root)
    return prs === undefined ? res : { ...res, verdicts: protectOpen(res.verdicts, prs), openPrs: prs }
  } catch {
    return res
  }
}

async function readDeclined(d: Deps, root: string): Promise<Declined> {
  const v = await d.store.get(declinedKey(root))
  return v !== null && typeof v === 'object' ? (v as Declined) : {}
}

async function readState(d: Deps, root: string): Promise<RepoState> {
  const v = (await d.store.get(stateKey(root))) as Partial<RepoState> | undefined
  return { lastLook: Number(v?.lastLook) || 0, snoozeUntil: Number(v?.snoozeUntil) || 0 }
}
const writeState = (d: Deps, root: string, s: RepoState) => d.store.set(stateKey(root), s)

/**
 * The rate limit: once per repo per `minMinutes`, and not while snoozed, unless the branches just changed.
 * A merge (Claude's, or one the probe saw as a changed set of refs) is the clearest sign a branch is finished, so
 * it never waits. What still protects work in progress is not time but the checks: the branch you stand on, other
 * worktrees, unpushed commits, stashes and branches nobody has committed on yet are never offered; and a branch
 * the person already turned down at its current tip is not offered again (see `declined`).
 */
export function mayLook(look: Look, s: RepoState, now: number, minMinutes: number): boolean {
  if (look === 'merge' || look === 'changed') return true
  return now - s.lastLook >= minMinutes * 60_000 && now >= s.snoozeUntil
}

export type Outcome = { deleted: Verdict[]; failed: { name: string; why: string }[]; remote: string[]; text: string }

export type LookResult = 'done' | 'busy'

/**
 * The per-prompt watch (runs from a timer, never inside the prompt): one probe; if the fingerprint is the one
 * already looked at in this session, that is all. Otherwise (a first prompt counts: nothing was looked at yet) a
 * full look. 'busy' means a dialog is open, so the change is still unlooked.
 */
export async function watchPrompt(d: Deps, cwd: string): Promise<LookResult> {
  const fingerprint = await repoFingerprint(d.run, cwd)
  if (fingerprint === undefined) return 'done' // not a repository, or git failed: fail open, say nothing
  if ((await d.session.get(seenKey(cwd))) === fingerprint) return 'done'
  return lookAndOffer(d, cwd, 'changed', { fingerprint })
}

/** Hook path: look, and offer if something is finished. Everything here is silent when there is nothing to say. */
export async function lookAndOffer(d: Deps, cwd: string, look: Look, o: { fingerprint?: string } = {}): Promise<LookResult> {
  const root = await repoRoot(d.run, cwd)
  if (root === undefined) return 'done'
  if (await isDisabled(d.run, root)) {
    if (o.fingerprint !== undefined) await d.session.set(seenKey(cwd), o.fingerprint) // stay quiet until something changes
    return 'done'
  }
  const fingerprint = o.fingerprint ?? (await repoFingerprint(d.run, cwd))
  await d.announce()
  const now = await d.now()
  const state = await readState(d, root)
  if (!mayLook(look, state, now, d.settings.minMinutes)) return 'done'
  const release = await d.tryLock()
  if (release === undefined) return 'busy' // another dialog is open: never stack questions
  try {
    await writeState(d, root, { ...state, lastLook: now })
    if (fingerprint !== undefined) await d.session.set(seenKey(cwd), fingerprint)
    const ledger = await ghLedger(d, cwd, fingerprint ?? '')
    let res = await scan(d.run, root, d.settings, { ghScope: 'gone', hasGh: d.hasGh, now, ghGate: ledger.gate })
    await ledger.save()
    const declined = await readDeclined(d, root)
    const wanted = (r: ScanResult | undefined) => r?.verdicts.filter(v => v.status === 'offer' && declined[v.name] !== v.sha) ?? []
    if (res && wanted(res).length > 0) res = await withOpenPrs(d, root, res) // only now that a question would open
    const offers = wanted(res)
    if (res && offers.length > 0) await offer(d, res, offers, { auto: true })
  } finally {
    await release()
  }
  return 'done'
}

/**
 * `gh` is asked about a branch tip at most once per fingerprint: a look the fingerprint did not change repeats
 * nothing, and entries of an older fingerprint are dropped, so a changed repository may ask again.
 */
async function ghLedger(d: Deps, cwd: string, fingerprint: string): Promise<{ gate: GhGate; save: () => Promise<void> }> {
  const old = (await d.session.get(ghKey(cwd))) as Record<string, string> | undefined
  const fresh: Record<string, string> = Object.fromEntries(Object.entries(old ?? {}).filter(([, fp]) => fp === fingerprint))
  const id = (branch: string, sha: string) => `${branch}@${sha}`
  return {
    gate: { shouldAsk: (b, sha) => fresh[id(b, sha)] === undefined, asked: (b, sha) => void (fresh[id(b, sha)] = fingerprint) },
    save: () => d.session.set(ghKey(cwd), fresh),
  }
}

/** `/branch-janitor clean`: scan with gh help and offer, whatever the rate limit says. */
export async function cleanNow(d: Deps, cwd: string): Promise<string> {
  const root = await repoRoot(d.run, cwd)
  if (root === undefined) return NOT_A_REPO
  const release = await d.tryLock()
  if (release === undefined) return 'Branches · answer the open question first'
  try {
    const scanned = await scan(d.run, root, d.settings, { ghScope: 'pushed', hasGh: d.hasGh, now: await d.now() })
    if (!scanned) return UNREADABLE
    const res = await withOpenPrs(d, root, scanned)
    const offers = res.verdicts.filter(v => v.status === 'offer')
    if (offers.length === 0) return ['Branches · nothing to delete right now', 'Run /branch-janitor to see why each branch stays.'].join('\n')
    const out = await offer(d, res, offers, { auto: false })
    return out.text || 'Branches · nothing deleted'
  } finally {
    await release()
  }
}

/** The slash command: `arg` is '' (list), `clean`, `on`, `off`; anything else is the usage text. */
export async function runCommand(d: Deps, cwd: string, arg: string): Promise<string> {
  if (arg === '') return report(d, cwd)
  if (arg === 'clean') return cleanNow(d, cwd)
  if (arg === 'on' || arg === 'off') return setEnabled(d, cwd, arg === 'on')
  return USAGE
}

const NOT_A_REPO = 'Branches · not in a git repository'
const UNREADABLE = "Branches · couldn't read this repository (is git installed?)"

const USAGE = [
  'Branches · commands',
  '/branch-janitor · list branches, delete nothing',
  '/branch-janitor clean · review and delete finished ones',
  '/branch-janitor off · stop looking here',
  '/branch-janitor on · look again',
].join('\n')

/** `/branch-janitor`: the full table, no questions, no deletion. */
export async function report(d: Deps, cwd: string): Promise<string> {
  const root = await repoRoot(d.run, cwd)
  if (root === undefined) return NOT_A_REPO
  const scanned = await scan(d.run, root, d.settings, { ghScope: 'pushed', hasGh: d.hasGh, now: await d.now() })
  if (!scanned) return UNREADABLE
  const res = await withOpenPrs(d, root, scanned)
  return reportText(res, { isOff: await isDisabled(d.run, root), staleDays: d.settings.staleDays })
}

/** `/branch-janitor on|off` for the current repository. */
export async function setEnabled(d: Deps, cwd: string, isOn: boolean): Promise<string> {
  const root = await repoRoot(d.run, cwd)
  if (root === undefined) return NOT_A_REPO
  const git = gitIn(d.run, root)
  if (isOn) {
    await git('config', '--local', '--unset', 'toolkit.branchJanitor') // exit 5 when it was never set: fine
    await writeState(d, root, { lastLook: 0, snoozeUntil: 0 })
    await d.store.set(declinedKey(root), {}) // a fresh start: everything finished may be offered again
    return 'Branches · on for this repository'
  }
  const r = await git('config', '--local', 'toolkit.branchJanitor', 'false')
  return r.exitCode === 0 ? neverAskText() : `Branches · couldn't save the setting: ${lines(r.stderr)[0] ?? 'git refused'}`
}

// ---------------------------------------------------------------- the questions

async function safeAsk(d: Deps, question: string, o: AskOptions): Promise<string | undefined> {
  try {
    return await d.ask(question, o)
  } catch {
    return undefined // dismissed, interrupted, or nobody to ask: treated as "no", nothing is changed
  }
}

/** `auto`: an automatic look, so a "no" is remembered (snooze, and each shown branch at its tip); a command never is. */
async function offer(d: Deps, res: ScanResult, all: Verdict[], o: { auto: boolean }): Promise<Outcome> {
  const offers = all.slice(0, MAX_OFFERED)
  const n = offers.length
  const deleteAll = n === 1 ? 'Delete branch' : `Delete all ${n}`
  const options = [LABEL.keep, deleteAll, ...(n > 1 ? [LABEL.oneByOne] : []), LABEL.never]
  const answer = await safeAsk(d, dialogText(offers, all.length - n), { options, header: 'Branches' })

  if (answer === LABEL.never) return finish(d, res, [], { text: await setEnabled(d, res.root, false) })
  if (answer === LABEL.keep) {
    if (o.auto) {
      await snooze(d, res.root)
      await decline(d, res, offers)
    }
    return finish(d, res, [], { text: 'Branches · kept everything' })
  }
  if (answer === deleteAll) return finish(d, res, offers, {})
  if (answer === LABEL.oneByOne) {
    const chosen: Verdict[] = []
    const skipped: Verdict[] = []
    for (const v of offers) {
      const a = await safeAsk(d, singleDialogText(v), { options: [LABEL.keep, `Delete ${v.name}`], header: 'Branches' })
      if (a === `Delete ${v.name}`) chosen.push(v)
      else if (a === LABEL.keep) skipped.push(v)
    }
    if (o.auto) await decline(d, res, skipped)
    return finish(d, res, chosen, {})
  }
  return finish(d, res, [], { text: 'Branches · no answer, kept everything' })
}

/** Remember branches the person saw and kept, so an automatic look does not ask about the same tip twice. */
async function decline(d: Deps, res: ScanResult, shown: Verdict[]): Promise<void> {
  if (shown.length === 0) return
  const exists = new Set(res.verdicts.map(v => v.name))
  const kept = Object.entries(await readDeclined(d, res.root)).filter(([name]) => exists.has(name)) // forget deleted branches
  await d.store.set(declinedKey(res.root), { ...Object.fromEntries(kept), ...Object.fromEntries(shown.map(v => [v.name, v.sha])) })
}

async function snooze(d: Deps, root: string): Promise<void> {
  const now = await d.now()
  await writeState(d, root, { ...(await readState(d, root)), snoozeUntil: now + SNOOZE_MS })
}

/** Delete the chosen branches (locally), then ask about each remote copy separately; one toast at the end. */
async function finish(d: Deps, res: ScanResult, chosen: Verdict[], base: { text?: string }): Promise<Outcome> {
  if (chosen.length === 0) return { deleted: [], failed: [], remote: [], text: base.text ?? '' }
  const deleted: { v: Verdict; flag: string }[] = []
  const failed: { name: string; why: string }[] = []
  for (const v of chosen) {
    const r = await deleteLocal(d.run, res.root, v)
    if (r.ok) deleted.push({ v, flag: r.flag })
    else failed.push({ name: v.name, why: r.why })
  }
  const remote = await askRemotes(d, res, deleted.map(x => x.v), failed)
  const text = toastText(deleted, failed, remote)
  d.toast(text)
  return { deleted: deleted.map(x => x.v), failed, remote, text }
}

async function askRemotes(d: Deps, res: ScanResult, deleted: Verdict[], failed: { name: string; why: string }[]): Promise<string[]> {
  const offers: { v: Verdict; offer: RemoteOffer }[] = []
  for (const v of deleted) {
    const ro = await remoteOffer(d.run, res.root, v, res.bases, b => b === res.defaultName || d.settings.protectedBranches.some(p => matchesPattern(b, p)))
    if (ro) offers.push({ v, offer: ro })
  }
  const done: string[] = []
  for (const [i, { offer: ro }] of offers.entries()) {
    const full = `${ro.remote}/${ro.branch}`
    const yes = `Delete ${full}`
    const rest = offers.length - i - 1
    const options = [LABEL.keep, yes, ...(rest > 0 ? [LABEL.keepRest] : [])]
    const a = await safeAsk(d, remoteDialogText(ro.remote, ro.branch, ro.tip), { options, header: 'Remote' })
    if (a === LABEL.keepRest) break
    if (a !== yes) continue
    const r = await deleteRemote(d.run, res.root, ro)
    if (r.ok) done.push(full)
    else failed.push({ name: full, why: r.why })
  }
  return done
}

