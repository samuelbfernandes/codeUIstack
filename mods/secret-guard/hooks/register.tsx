// secret-guard: keeps secrets out of the model's context.
//
//  1. Tool output. `tool.call` rewrites the result of Read, Bash, Grep, WebFetch and MCP tools before the model
//     reads it; a `session.append` hook on the `tool-result` door is the net under it: it redacts the row the model
//     actually reads, for EVERY tool and for errored results (which a `tool.call` answer cannot rewrite).
//  2. Typed prompts. A prompt the person types that holds a secret-looking string is held for one question.
//  3. `/secret-guard` reports counts by kind; `/secret-guard off|on` switches it.
//
// A secret is NEVER logged, stored or counted by value: tallies are kinds and numbers, the question names kinds,
// and the echo of a held prompt is the redacted text.
//
// FAIL OPEN: this is a convenience, not a gate. A hook that throws leaves the tool result, the row or the prompt
// exactly as it was (`.catch` calls `next(e)`; where `next` had already run it replays the same answer). The only
// refusal is deliberate: the person answering "Hold it", pressing Esc or typing something else at the question.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { readConfig } from './config'
import type { Config } from './config'
import { countOf, redact } from './detect'
import type { Hits } from './detect'
import { dropWith } from './reply'
import { ASK_HEADER, EMPTY_TALLY, HOLD, HOLD_REASON, SEND_AS_TYPED, SEND_REDACTED, announce, askText, report } from './report'
import { scrubBlocks, scrubValue } from './scrub'
import { isPeople } from './words'

const COMMAND = 'secret-guard'
const STORE_KEY = 'enabled'
const ECHO_LIMIT = 2000
/** Built-in tools whose result is text the model reads; MCP tools (`mcp__*`) are added by prefix. */
const WATCHED = new Set(['Read', 'Bash', 'Grep', 'WebFetch', 'ReadMcpResourceTool', 'GetTask'])

const tally = atom({ plugin: 'secret-guard', key: 'tally' } as const, EMPTY_TALLY)
const isOnAtom = atom({ plugin: 'secret-guard', key: 'isOn' } as const, null)

const isWatched = (tool: string): boolean => WATCHED.has(tool) || tool.startsWith('mcp__')

/** Whether the guard is on: the settings switch AND the person's own word (kept in $.store, read once). */
async function isOn($: EngineInterface, cfg: Config): Promise<boolean> {
  if (!cfg.enabled) return false
  const live = await read($, isOnAtom)
  if (live !== null) return live
  const saved = (await safe(() => $.store.get(STORE_KEY))) !== false
  await safe(() => update($, isOnAtom, () => saved))
  return saved
}

/** Counts what was hidden. Never throws: bookkeeping must not undo a redaction already made. */
async function note($: EngineInterface, source: 'tool' | 'typed', hits: Hits): Promise<void> {
  let isFirst = false
  try {
    await update($, tally, t => {
      isFirst = source === 'tool' && !t.hasAnnounced
      const bucket: Hits = { ...t[source] }
      for (const [kind, n] of Object.entries(hits)) bucket[kind] = (bucket[kind] ?? 0) + n
      return { ...t, [source]: bucket, hasAnnounced: t.hasAnnounced || source === 'tool' }
    })
    if (isFirst) $.ui.log(announce(hits))
  } catch {
    // the redaction already happened; losing a count is the lesser harm
  }
}

/** What `/secret-guard [on|off]` does; the reply is plain text. */
async function run($: EngineInterface, cfg: Config, arg: string): Promise<string> {
  const wanted = arg.trim().toLowerCase()
  if (wanted !== '' && wanted !== 'on' && wanted !== 'off') return `Secret guard · unknown option “${wanted.slice(0, 30)}”\nUse /secret-guard, /secret-guard on or /secret-guard off.`
  if (wanted !== '') {
    await $.store.set(STORE_KEY, wanted === 'on')
    await update($, isOnAtom, () => wanted === 'on')
  }
  return report({ tally: await read($, tally), isOn: await isOn($, cfg), offBySetting: !cfg.enabled, problems: cfg.problems })
}

export const register: Register = (on, options) => {
  const cfg = readConfig(options)

  on('session.start', async ($, e, next) => {
    // Fail-open: a store that cannot be read leaves the guard on.
    await isOn($, cfg)
    await $.command.register({ name: COMMAND, description: 'Show what secret-guard hid this session; on / off switches it', argumentHint: '[on|off]' })
    for (const problem of cfg.problems) safeLog($, `Secret guard · ${problem}`)
    return next(e)
  })

  // Answers its own command and reads no `next`: a failure only says so.
  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, cfg, e.args) })).catch(() => ({ text: 'Secret guard · could not read its own state' }))

  // 1a. Tool results, as a record. Only an answered result is rewritten; an `{ result }` of our own carries no `ref` or
  // `text`, so core maps it for the model again with the tool's own mapper. The errored ones are the net's job below.
  // The `context` that rides beside a result is passed on as it came: the engine refuses a hook that leaves an entry out.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true || !isWatched(e.tool)) return ran
    if (!(await isOn($, cfg))) return ran

    const hits: Hits = {}
    const result = scrubValue(ran.result, cfg.rules, hits)
    if (countOf(hits) === 0) return ran
    await note($, 'tool', hits)

    return (ran.context === undefined ? { result } : { result, context: ran.context }) as typeof ran
  }).catch(($, e, next) => next(e))

  // 1b. The net: the row the model reads, for every tool and for errors. Idempotent with 1a (placeholders match nothing).
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (!(await isOn($, cfg))) return next(e)
    const hits: Hits = {}
    const content = scrubBlocks(e.message.content, cfg.rules, hits)
    if (countOf(hits) === 0) return next(e)
    await note($, 'tool', hits)

    return next({ ...e, message: { ...e.message, content: [...content] } })
  }).catch(($, e, next) => next(e))

  // 2. The check of what a person typed.
  on('prompt.submit', async ($, e, next) => {
    await safe(() => update($, tally, t => (t.hasAnnounced ? { ...t, hasAnnounced: false } : t))) // a new turn may speak once
    if (!cfg.askOnPrompt || !isPeople(e.origin) || !(await isOn($, cfg))) return next(e)

    const { text: redacted, hits } = redact(e.text, cfg.rules)
    if (countOf(hits) === 0) return next(e)

    const choice = await choose($, hits)
    if (choice === 'redacted') {
      await note($, 'typed', hits)
      return next({ ...e, text: redacted })
    }
    if (choice === 'typed') {
      await safe(() => update($, tally, t => ({ ...t, sentAsTyped: t.sentAsTyped + 1 })))
      return next(e)
    }
    await safe(() => update($, tally, t => ({ ...t, held: t.held + 1 })))
    // The held text is echoed with its secrets hidden: the person gets their words back, the transcript gets no secret.
    safeLog($, `Held text, secrets hidden:\n${redacted.length > ECHO_LIMIT ? `${redacted.slice(0, ECHO_LIMIT)}…` : redacted}`)
    return dropWith({ log: line => $.ui.log(line) }, HOLD_REASON)
  }).catch(($, e, next) => next(e))
}

/** The person's answer. Esc, a dismissed dialog and free text under "Other" all hold: nothing was said yes to. */
async function choose($: EngineInterface, hits: Hits): Promise<'redacted' | 'typed' | 'hold'> {
  try {
    const answer = await $.ui.ask(askText(hits), { options: [SEND_REDACTED, SEND_AS_TYPED, HOLD], header: ASK_HEADER })
    if (answer === SEND_REDACTED) return 'redacted'
    if (answer === SEND_AS_TYPED) return 'typed'
  } catch {
    // dismissed
  }
  return 'hold'
}

function safeLog($: EngineInterface, text: string): void {
  try {
    $.ui.log(text)
  } catch {
    // a note is a courtesy
  }
}

async function safe<T>(f: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await f()
  } catch {
    return undefined
  }
}
