// suggest-model: every prompt the person types is checked locally (keyword rules, no model call by
// default, zero tokens) for two risks: the current model is likely too WEAK for the task, or it is
// OVERKILL for it. Each check refreshes a one-line status ($.ui.status); only a mismatch at or above
// the confidence bar opens a dialog and BLOCKS the prompt until it is answered: switch the session,
// run just this task as a subagent, ask Codex for a read-only review, or keep going. There is no
// cooldown and no "already asked about this" memory: every mismatch above the bar asks, every time. The
// recommendation is the cheapest model predicted to be at least "ok" for the task, from rough, editable cost ratios. All of it is a prediction, never a
// measurement.
//
// HOW THE DIALOG HOLDS THE PROMPT: a hook has 10 s of its OWN time, but the clock stops while
// a `$` call is in flight, and `$.ui.ask` is one (the pattern command-guard uses). So the hook
// simply awaits the question; the person may take minutes at no cost.
//
// FAIL OPEN for everything except the question itself: an error in the predictor, state, switch,
// spawn or Codex sends the prompt exactly as typed. The deliberate drops are: a prompt sent to a subagent the person asked for, and a prompt
// HELD because the person dismissed the dialog (Esc) with `onDismiss` = hold, the default. A held
// prompt is echoed back in full so nothing typed is lost; `/suggest-model off` ends any trap.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Run } from './actions'
import { codexContext, manualSwitchHint, probeCodex, runCodex, spawnSubagent, switchModel } from './actions'
import { buildDialog, choiceOf, compactTable, isKeepOnly } from './dialog'
import { dropWith } from './reply'
import type { Choice } from './dialog'
import { cheaperBy, effortAdvice, effortNote, judge, nameOf, parseCosts, ratingTable, recommend, statusText } from './fit'
import type { Costs, Fit } from './fit'
import { canRunAlone, familyOf, pushHistory, snippet } from './gate'
import type { Alias, Family } from './gate'
import { isNotATask } from './input'
import { TIER_WORD, isStrong, predict, wordCount } from './predict'
import type { Prediction } from './predict'
import { MODEL_ID, cheaperFit } from './route'
import type { SuggestModelEntry } from '../types'

type Dollar = EngineInterface

const seen = atom({ plugin: 'suggest-model', key: 'seen' } as const, 0)
const isMuted = atom({ plugin: 'suggest-model', key: 'isMuted' } as const, false)
/** Mirror of the persisted on/off switch (`$.store` 'off'), read by the moddeck side bar so it redraws when ANY path flips it. */
const isOff = atom({ plugin: 'suggest-model', key: 'isOff' } as const, false)
const codexOk = atom({ plugin: 'suggest-model', key: 'codexOk' } as const, null)
const recent = atom({ plugin: 'suggest-model', key: 'recent' } as const, [])
/** The session's effort level as the last model request named it (empty: none seen, or a model without effort). */
/** What the side bar's model row shows beside the effort when it does not fit the last task (`medium would do`). */
/** The routed model's name for the moddeck Session box ('' when not routed). */
const routedTo = atom({ plugin: 'suggest-model', key: 'routedTo' } as const, '')
const effortHint = atom({ plugin: 'suggest-model', key: 'effortAdvice' } as const, '')
const effortNow = atom({ plugin: 'suggest-model', key: 'effort' } as const, '')

// Only the person typing is ever analysed. 'bridge' is the same person on a phone or the web.
const PERSON = new Set(['composer', 'bridge'])
const KEEP_RECENT = 5
const CLASSIFIER_MODEL = 'haiku'

type Cfg = {
  minConfidence: number
  minWords: number
  /** Ordinary (standard-tier) tasks also open the dialog when the model is borderline or has spare capacity. */
  askOnStandard: boolean
  /** What Esc does: 'hold' keeps the prompt from being sent, 'send' sends it as typed. */
  onDismiss: 'hold' | 'send'
  useClassifier: boolean
  isEnabled: boolean
  statusLine: boolean
  /** Add a short note to the status line when the effort level does not match the task. */
  effortWatch: boolean
  /** Draw the on/off button in the band above the prompt. */
  costs: Costs
  /** The first prompt of a conversation picks a cheaper model for the whole conversation when one will do. */
  autoRoute: boolean
  /** A subagent started without a model gets the cheapest one that fits its task (never above the session's). */
  routeSubagents: boolean
  /** Pieces of the cost setting that were ignored (shown by explain and status). */
  costProblems: string[]
}

function numberOf(v: unknown, fallback: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

export function readConfig(o: Readonly<Record<string, unknown>>): Cfg {
  const { costs, problems } = parseCosts(o.costRatios)
  return {
    minConfidence: numberOf(o.minConfidence, 0.6, 0.5, 0.95),
    minWords: Math.round(numberOf(o.minWords, 3, 1, 50)),
    askOnStandard: o.askOnStandard === true,
    onDismiss: o.onDismiss === 'send' ? 'send' : 'hold',
    useClassifier: o.useClassifier === true,
    isEnabled: o.enabled !== false,
    statusLine: o.statusLine !== false,
    effortWatch: o.effortWatch !== false,
    costs,
    autoRoute: o.autoRoute !== false,
    routeSubagents: o.routeSubagents !== false,
    costProblems: problems,
  }
}

async function quietly<T>(f: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}

// ------------------------------------------------------------------ persisted choices

type Counters = { accepted: number; dismissed: number; history: string[] }

async function readCounters($: Dollar): Promise<Counters> {
  const n = async (k: string) => {
    const v = await quietly(() => $.store.get(k))
    return typeof v === 'number' ? v : 0
  }
  const h = await quietly(() => $.store.get('history'))
  const history = Array.isArray(h) ? h.filter((x): x is string => x === 'a' || x === 'd') : []
  return { accepted: await n('accepted'), dismissed: await n('dismissed'), history }
}

/** Counts an answer: totals for the status report, a short history for the confidence nudge. */
async function tally($: Dollar, kind: 'a' | 'd'): Promise<void> {
  await quietly(async () => {
    const c = await readCounters($)
    await $.store.set(kind === 'a' ? 'accepted' : 'dismissed', (kind === 'a' ? c.accepted : c.dismissed) + 1)
    await $.store.set('history', pushHistory(c.history, kind))
  })
}

const OFF_STATUS = 'suggest-model: off · type /suggest-model on'

/** The one place the switch changes, for the moddeck side bar and /suggest-model alike. */
async function setSwitch($: Dollar, cfg: Cfg, off: boolean): Promise<void> {
  if (off) {
    await $.store.set('off', true)
    await showStatus($, cfg, OFF_STATUS) // visible even where the band is not drawn
  } else {
    await $.store.delete('off')
    await showStatus($, cfg, undefined)
    await update($, isMuted, () => false) // turning it back on also lifts a session mute
  }
  await quietly(() => update($, isOff, () => off))
}

async function isOn($: Dollar, cfg: Cfg): Promise<boolean> {
  if (!cfg.isEnabled) return false
  return (await quietly(() => $.store.get('off'))) !== true
}

// ------------------------------------------------------------------------ bookkeeping

async function note($: Dollar, text: string, p: Prediction, outcome: string): Promise<void> {
  const entry: SuggestModelEntry = { snippet: snippet(text), tier: p.tier, confidence: p.confidence, reasons: p.reasons.slice(0, 3), outcome }
  await quietly(() => update($, recent, list => [...list, entry].slice(-KEEP_RECENT)))
}

const setOutcome = ($: Dollar, outcome: string) =>
  quietly(() => update($, recent, list => list.map((x, i) => (i === list.length - 1 ? { ...x, outcome } : x))))

/** The always-on one-liner. Non-blocking: a failure here changes nothing. */
const showStatus = ($: Dollar, cfg: Cfg, text: string | undefined) =>
  cfg.statusLine ? quietly(() => $.ui.status(text)) : Promise.resolve()

// ------------------------------------------------------------------------ prediction

/** One haiku call for a prompt the rules could not place; it can only confirm or replace the tier. */
async function refine($: Dollar, text: string, p: Prediction, minConfidence: number): Promise<Prediction> {
  const label = await quietly(() => $.model.classify(text, ['light', 'standard', 'deep'], { model: CLASSIFIER_MODEL }))
  if (label !== 'light' && label !== 'standard' && label !== 'deep') return p
  const confidence = Math.max(p.confidence, minConfidence) // the classifier settles the doubt either way
  const reasons = [`small-model classifier says ${label}`, ...(label === p.tier ? p.reasons : [])]
  return { tier: label, score: p.score, confidence, reasons }
}

const isAmbiguous = (p: Prediction, minConfidence: number): boolean => p.tier !== 'review' && p.confidence < minConfidence

type Outcome = { kind: 'pass' } | { kind: 'drop'; reason: string } | { kind: 'context'; context: string[] }
const PASS: Outcome = { kind: 'pass' }

type Mismatch = Extract<Fit, { kind: 'mismatch' }>
type Ask = Mismatch | { kind: 'review' }

// ------------------------------------------------------------------------ the hook

async function review($: Dollar, e: { text: string; origin: { kind: string }; turnId?: string }, cfg: Cfg): Promise<Outcome> {
  if (!(await isOn($, cfg))) return PASS
  if (!PERSON.has(e.origin.kind) || e.turnId !== undefined) return PASS
  const text = e.text.trim()
  if (text === '' || isNotATask(text)) return PASS // slash commands, "yes", pasted output: nothing to judge

  await update($, seen, n => n + 1)
  let p = predict(text)
  if (wordCount(text) < cfg.minWords && !isStrong(p)) return PASS

  const chosen = familyOf((await quietly(() => $.session.model())) ?? '')
  // The first prompt of a conversation: nothing is cached yet, so running it on a cheaper model costs nothing extra.
  // The pick holds for the whole conversation (turn.step names it on every request), so the cache is never thrown away.
  if (cfg.autoRoute && routed === undefined && lastResponseAt === undefined && !routeOff) {
    const pick = cheaperFit(p, chosen, cfg.costs, cfg.minConfidence)
    if (pick !== undefined) {
      routed = pick
      routedFrom = chosen
      await quietly(() => update($, routedTo, () => nameOf(pick)))
      await note($, text, p, `routed to ${pick}`)
      await setOutcome($, `routed this conversation to ${pick}`)
      $.ui.toast(`suggest-model · this conversation runs on ${nameOf(pick)} (${p.tier} task) · /model to choose yourself`, { timeoutMs: 10_000 })
      await showStatus($, cfg, `suggest-model: on ${nameOf(pick)} for this conversation`)
      return PASS
    }
  }
  const current = routed ?? chosen
  const minConfidence = cfg.minConfidence // fixed: dismissing a dialog never raises the bar
  let fit = judge(p, current, minConfidence, cfg.costs, cfg.askOnStandard)

  if (fit.kind === 'none' && cfg.useClassifier && current !== undefined && isAmbiguous(p, minConfidence)) {
    p = await refine($, text, p, minConfidence)
    fit = judge(p, current, minConfidence, cfg.costs, cfg.askOnStandard)
  }
  // A review on a model that fits is only worth a word when Codex can really do it; the probe runs once.
  if (fit.kind === 'review' && !(await quietly(() => hasCodex($)))) fit = { kind: 'fits' }
  await note($, text, p, 'not suggested')
  const verdict = statusText(fit, current, cfg.costs)
  const effortLevel = await read($, effortNow)
  const effort = cfg.effortWatch && p.confidence >= minConfidence ? effortNote(p.tier, effortLevel) : undefined
  await quietly(() => update($, effortHint, () => (cfg.effortWatch && p.confidence >= minConfidence ? (effortAdvice(p.tier, effortLevel) ?? '') : '')))
  await showStatus($, cfg, verdict !== undefined && effort !== undefined ? `${verdict} · ${effort}` : (verdict ?? (effort !== undefined ? `suggest-model: ${effort}` : undefined))) // a prompt the rules cannot place clears the line
  if (fit.kind !== 'mismatch' && fit.kind !== 'review') {
    return await skip($, fit.kind === 'none' ? `no: ${fit.why}` : fit.kind === 'fits' ? 'fits: no dialog' : 'hint on the status line only')
  }
  if (current === undefined) return PASS
  if (await read($, isMuted)) return await skip($, 'no: muted this session')

  const surfaces = await quietly(() => $.session.surfaces())
  if (surfaces !== undefined && surfaces.length === 0) return await skip($, 'no: nobody to ask (headless run)')

  return await offer($, cfg, e.text, p, fit, current)
}

const skip = async ($: Dollar, outcome: string): Promise<Outcome> => {
  await setOutcome($, outcome)
  return PASS
}

const runner = ($: Dollar): Run => (argv, init) => $.process.run(argv, init)

async function hasCodex($: Dollar): Promise<boolean> {
  const known = await read($, codexOk)
  if (known !== null) return known
  const ok = await probeCodex(runner($))
  await update($, codexOk, () => ok)
  return ok
}

/** When the main conversation last got a response: its cache lives a TTL from there. undefined = none yet (nothing to lose). */
let lastResponseAt: number | undefined

/** The cache is probably warm: a response inside the TTL (60 min on a subscription, 5 otherwise, as Claude Code defaults). */
async function isCacheWarm($: Dollar, windows: readonly { kind: string }[]): Promise<boolean> {
  if (lastResponseAt === undefined) return false
  const ttlMs = (windows.some(w => w.kind === 'five_hour' || w.kind === 'seven_day') ? 60 : 5) * 60_000
  const now = await $.clock.now().catch(() => Date.now())
  return now - lastResponseAt < ttlMs
}

/** The model this conversation was routed to at its first prompt; undefined = the session's own. */
let routed: Alias | undefined
/** A model you picked yourself (/model) ends routing until the next conversation. */
let routeOff = false
/** The session model when routing began: a different one later means you switched with /model. */
let routedFrom: Family | undefined

async function offer($: Dollar, cfg: Cfg, text: string, p: Prediction, m: Ask, current: Family): Promise<Outcome> {
  const usage = await quietly(() => $.session.usage())
  const dialog = buildDialog({
    prediction: p,
    current,
    risk: m.kind === 'review' ? 'self' : m.risk,
    target: m.kind === 'review' ? undefined : m.recommended,
    table: ratingTable(p.tier, current, cfg.costs),
    cheaper: m.kind === 'review' ? '' : cheaperBy(cfg.costs, current, m.recommended),
    contextTokens: usage?.context.tokens ?? 0,
    isCacheWarm: await isCacheWarm($, usage?.rateLimits ?? []),
    canSubagent: canRunAlone(text),
    hasCodex: p.tier === 'review' && (await hasCodex($)),
  })

  if (isKeepOnly(dialog)) {
    // The only real move would be a switch, and mid-session it costs more than it saves: no question, the prompt goes as typed.
    await setOutcome($, 'kept the model: a switch would re-cache the conversation')
    return PASS
  }
  let answer: string
  try {
    answer = await $.ui.ask(dialog.question, { options: dialog.order.map(c => dialog.labels[c]), header: 'Model choice' })
  } catch {
    // Esc or an interrupt. By default the prompt is HELD (not sent), and echoed so nothing typed is lost.
    if (cfg.onDismiss === 'send') {
      await setOutcome($, 'dialog dismissed: sent as typed')
      return PASS
    }
    await setOutcome($, 'dialog dismissed: prompt held')
    return { kind: 'drop', reason: heldMessage(text) }
  }
  const choice: Choice = choiceOf(dialog, answer) ?? 'keep' // free text under "Other" is read as keep
  await setOutcome($, `chose: ${choice}`)
  return await act($, cfg, choice, text, m.kind === 'review' ? undefined : m.recommended)
}

/** After Esc: a one-line reason (the drop box); the prompt text goes to the transcript so nothing typed is lost. */
export function heldMessage(text: string): string {
  const shown = text.length > 2000 ? `${text.slice(0, 2000)}...` : text
  return ['suggest-model blocked your prompt · nothing was sent. Send it again to choose, or type /suggest-model off.', shown].join('\n')
}

async function act($: Dollar, cfg: Cfg, choice: Choice, text: string, alias: Alias | undefined): Promise<Outcome> {
  if (choice === 'mute') {
    await update($, isMuted, () => true)
    await tally($, 'd')
    $.ui.toast('suggest-model · muted for this session. The status line stays.')
    return PASS
  }
  if (choice === 'switch' && alias !== undefined) {
    await tally($, 'a')
    const r = await switchModel({ list: () => $.config.list(), set: (key, value) => $.config.set({ key, value }) }, alias)
    $.ui.toast(r.isSwitched ? `suggest-model · switched to ${nameOf(alias)}` : manualSwitchHint(alias))
    if (r.isSwitched) await showStatus($, cfg, `suggest-model: switched to ${nameOf(alias)}`)
    return PASS // the prompt itself continues; the new model reads it if the switch took
  }
  if (choice === 'subagent' && alias !== undefined) {
    await tally($, 'a')
    const started = await spawnSubagent(args => $.agent.spawn(args), text, alias)
    if (started.ok) return { kind: 'drop', reason: `Sent to a ${alias} subagent; its answer will appear when done` }
    $.ui.toast(`suggest-model · could not start the subagent (${started.why}), sending to the current model`, { timeoutMs: 10000 })
    $.ui.log(`suggest-model · subagent not started: ${started.why}`)
    return PASS
  }
  if (choice === 'codex') {
    await tally($, 'a')
    $.ui.toast('suggest-model · asking Codex, read-only (can take a few minutes)', { timeoutMs: 8000 })
    const r = await runCodex(runner($), await quietly(() => $.session.cwd()), text)
    if (!r.ok) {
      $.ui.toast(`suggest-model · Codex did not answer (${r.why}), sending as typed`, { timeoutMs: 8000 })
      return PASS
    }
    $.ui.log(`Codex review · read-only\n${r.text}`)
    return { kind: 'context', context: [codexContext(r.text)] }
  }
  await tally($, 'd') // keep (or free text)
  return PASS
}

// ----------------------------------------------------------------------- commands

function verdictText(fit: Fit, current: Family | undefined): string {
  if (fit.kind === 'none') return `no suggestion (${fit.why})`
  const me = current === undefined ? 'the current model' : nameOf(current)
  if (fit.kind === 'fits') return `${me} fits`
  if (fit.kind === 'review') return `offers a Codex review (if installed): ${me} should not approve its own work`
  const rec = nameOf(fit.recommended)
  if (fit.kind === 'hint') return `status line only (${fit.why === 'borderline' ? `${me} is borderline` : 'spare capacity'}, ${rec} is the alternative; askOnStandard makes it ask)`
  return fit.risk === 'under' ? `blocks with "Don't use ${me} for this task" and offers ${rec}` : `blocks with "${me} is overkill for this" and offers ${rec}`
}

async function explain($: Dollar, text: string, cfg: Cfg): Promise<string> {
  if (text.trim() === '') return 'Usage: /suggest-model explain <text to test>'
  const p = predict(text)
  const current = familyOf((await quietly(() => $.session.model())) ?? '')
  const fit = judge(p, current, cfg.minConfidence, cfg.costs, cfg.askOnStandard)
  const short = wordCount(text) < cfg.minWords && !isStrong(p) ? ' · too short, would be ignored' : ''
  const skipped = isNotATask(text.trim()) ? ' · not a task, would not be checked' : ''
  return [
    `${TIER_WORD[p.tier].charAt(0)}${TIER_WORD[p.tier].slice(1).toLowerCase()} task · confidence ${p.confidence.toFixed(2)}${short}${skipped}`,
    `Because ${p.reasons.join(', ')}`,
    compactTable(ratingTable(p.tier, current, cfg.costs)),
    `On ${current === undefined ? 'an unrecognised model' : nameOf(current)}: ${verdictText(fit, current)}.`,
    `Dry run, nothing sent. Rough predictions, not measurements. Cheapest good enough: ${nameOf(recommend(p.tier, cfg.costs))}.`,
    ...(cfg.costProblems.length > 0 ? [`Ignored in costRatios: ${cfg.costProblems.join(', ')}.`] : []),
  ].join('\n')
}

async function status($: Dollar, cfg: Cfg): Promise<string> {
  const on = await isOn($, cfg)
  const c = await readCounters($)
  const total = c.accepted + c.dismissed
  const model = familyOf((await quietly(() => $.session.model())) ?? '')
  const list = await read($, recent)
  const rows = list.map(r => `${TIER_WORD[r.tier].toLowerCase()} ${r.confidence.toFixed(2)} “${r.snippet}” · ${r.reasons.join(', ')} → ${r.outcome}`)
  const costs = (['haiku', 'sonnet', 'opus', 'fable'] as const).filter(f => cfg.costs[f] !== undefined).map(f => `${nameOf(f)} ${cfg.costs[f]}x`).join(' · ')
  return [
    `suggest-model · ${on ? 'on' : 'off'} · ${model === undefined ? 'unrecognised model' : nameOf(model)}`,
    on
      ? `Blocks and asks on a mismatch (confidence ≥ ${cfg.minConfidence.toFixed(2)})${cfg.askOnStandard ? ', ordinary tasks too' : ''}. Esc ${cfg.onDismiss === 'hold' ? 'holds the prompt' : 'sends it'}.`
      : 'Not checking prompts. Type /suggest-model on to resume.',
    `${costs} (rough, set in costRatios)`,
    total === 0 ? 'No answers yet' : `${c.accepted} accepted · ${c.dismissed} dismissed`,
    ...((await read($, isMuted)) ? ['Questions muted this session. Type /suggest-model on to lift it.'] : []),
    ...(cfg.costProblems.length > 0 ? [`Ignored in costRatios: ${cfg.costProblems.join(', ')}.`] : []),
    ...(rows.length > 0 ? ['Recent', ...rows.map(r => `  ${r}`)] : []),
  ].join('\n')
}

async function runCommand($: Dollar, args: string, cfg: Cfg): Promise<string> {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const arg = word.toLowerCase()
  if (arg === 'explain') return explain($, rest.join(' '), cfg)
  if (arg === 'off') {
    await setSwitch($, cfg, true)
    return 'suggest-model · off\nNo prompt is checked. Type /suggest-model on to resume.'
  }
  if (arg === 'on') {
    if (!cfg.isEnabled) return 'suggest-model · disabled\nThe enabled setting is false. Change it in /config.'
    await setSwitch($, cfg, false)
  }
  const text = await status($, cfg)
  return arg === '' || arg === 'on' || arg === 'status' ? text : `${text}\nTry: /suggest-model · /suggest-model on · /suggest-model off · /suggest-model explain <text>`
}

// --------------------------------------------------------------------- register

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  // The main conversation's last response: its cache is warm for a TTL from here (subagents keep caches of their own).
  // A subagent Claude starts without naming a model gets the cheapest one its task needs (never above the session's).
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const input = e as unknown as { prompt?: unknown; model?: unknown; subagent_type?: unknown }
    if (!cfg.routeSubagents || input.model !== undefined || input.subagent_type === 'fork' || typeof input.prompt !== 'string') return next(e)
    const parent = routed ?? familyOf((await quietly(() => $.session.model())) ?? '')
    const pick = cheaperFit(predict(input.prompt), parent, cfg.costs, cfg.minConfidence)
    return next(pick === undefined ? e : ({ ...e, model: pick } as typeof e))
  }).catch(($, e, next) => next(e))

  // /clear starts an empty conversation: nothing cached to lose, and routing may pick again.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      lastResponseAt = undefined
      routed = undefined
      routeOff = false
      await quietly(() => update($, routedTo, () => ''))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) lastResponseAt = await $.clock.now().catch(() => Date.now())
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await quietly(async () => {
      const stored = (await $.store.get('off')) === true // the switch outlives the session
      await update($, isOff, () => stored)
      if (stored && cfg.isEnabled) await showStatus($, cfg, OFF_STATUS)
    })
    await quietly(() =>
      $.command.register({
        name: 'suggest-model',
        description: 'Suggest model: status, on, off, or explain <text>',
        argumentHint: 'status|on|off|explain <text>',
      }),
    )
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'suggest-model' }, async ($, e) => ({ text: await runCommand($, e.args, cfg) })).catch(() => ({
    text: 'suggest-model · that did not work, nothing changed',
  }))

  // Effort-watch only reads: the level of each main-thread request is kept (off the request's path) for the next prompt's status line.
  // Each main-loop request: note its effort for the status line, and in a routed conversation name the routed model, so
  // the conversation stays on one model (and one cache) throughout. A model you pick yourself with /model wins: routing
  // stops until the next conversation.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const level = typeof e.effort === 'string' ? e.effort : '' // state holds JSON data: empty means none
    $.clock.after(1, () => void quietly(() => update($, effortNow, () => level)))
    if (routed === undefined) return yield* next(e)
    const now = familyOf((await quietly(() => $.session.model())) ?? '')
    if (now !== routedFrom) {
      routed = undefined
      routeOff = true
      await quietly(() => update($, routedTo, () => ''))
      return yield* next(e)
    }
    return yield* next({ ...e, model: MODEL_ID[routed] })
  })

  // Exactly one `next` per path. A drop is answered WITHOUT `next`: after a subagent really started
  // (the current model must not also answer).
  on('prompt.submit', async ($, e, next) => {
    const out = await review($, e, cfg).catch((): Outcome => PASS)
    if (out.kind === 'drop') return dropWith(note => $.ui.log(note), out.reason)
    return next(out.kind === 'context' ? { ...e, context: [...(e.context ?? []), ...out.context] } : e)
  }).catch(($, e, next) => next(e)) // fail open; if `next` already ran this replays its result
}
