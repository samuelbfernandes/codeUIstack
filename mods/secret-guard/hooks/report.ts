// What the mod says. Kinds and counts only: nothing here ever holds a secret.

import { countOf } from './detect'
import type { Hits } from './detect'
import type { Tally } from '../types'

export const EMPTY_TALLY: Tally = { tool: {}, typed: {}, held: 0, sentAsTyped: 0, hasAnnounced: false }

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** `github-token 2 · password 1`, most frequent first. */
export function kindsText(hits: Hits): string {
  return Object.entries(hits)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([kind, n]) => `${kind} ${n}`)
    .join(' · ')
}

/** The one dim line shown the first time something is hidden in a turn. */
export const announce = (hits: Hits): string => {
  const n = countOf(hits)
  return `Secret guard · hid ${plural(n, 'secret', 'secrets')} from tool output`
}

export type ReportInput = { tally: Tally; isOn: boolean; offBySetting: boolean; problems: readonly string[] }

/** The reply to `secret-guard`: a headline, then dim detail lines (dropWith logs everything after the first). */
export function report(r: ReportInput): string {
  const hidden = countOf(r.tally.tool) + countOf(r.tally.typed)
  const state = r.isOn ? 'on' : r.offBySetting ? 'off in settings' : 'off'
  const head = `Secret guard · ${state} · ${hidden === 0 ? 'nothing hidden yet' : `hid ${plural(hidden, 'secret', 'secrets')} this session`}`
  const lines = [head]
  if (countOf(r.tally.tool) > 0) lines.push(`Tool output: ${kindsText(r.tally.tool)}`)
  const asked = [kindsText(r.tally.typed), r.tally.held > 0 ? `held ${r.tally.held}` : '', r.tally.sentAsTyped > 0 ? `sent as typed ${r.tally.sentAsTyped}` : '']
  if (asked.some(x => x !== '')) lines.push(`Typed prompts: ${asked.filter(x => x !== '').join(' · ')}`)
  for (const problem of r.problems) lines.push(`Problem: ${problem}`)
  lines.push(r.isOn ? 'Type secret-guard off to pause it.' : r.offBySetting ? 'Turn it on in the plugin settings.' : 'Type secret-guard on to resume.')
  return lines.join('\n')
}

/** The question for a typed prompt: what kinds were found, never the text. */
export function askText(hits: Hits): string {
  const n = countOf(hits)
  return `This prompt seems to contain ${plural(n, 'secret', 'secrets')} (${Object.keys(hits).sort().join(', ')}). How should it be sent?`
}

export const ASK_HEADER = 'Secret guard'
export const SEND_REDACTED = 'Send redacted'
export const SEND_AS_TYPED = 'Send as typed'
export const HOLD = 'Hold it'
export const HOLD_REASON = 'secret-guard blocked your prompt · nothing was sent'
