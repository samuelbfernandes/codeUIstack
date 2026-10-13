// error-inbox: pure helpers (no engine access): what a failed call was, and secret scrubbing.
import type { ErrorInboxKind } from '../types'

// ---- secrets ------------------------------------------------------------------------------------------------------
// The same function is copied from test-ledger (mods cannot import each other); keep the two in step.

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}/g, '***'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/g, '***'],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, '***'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '***'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '***'],
  [/\bglpat-[A-Za-z0-9_-]{10,}/g, '***'],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, '***'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '***'],
  [/\b(Bearer|Basic|Token)(\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1$2***'],
  [/(--?(?:token|password|passwd|pass|secret|api[-_]?key|access[-_]?key|auth|private[-_]?key)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, '$1***'],
  [/((?:password|passwd|pwd|secret|token|api[-_]?key|apikey|access[-_]?key|auth[-_]?key|client[-_]?secret)["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;,'"]+)/gi, '$1***'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+@/gi, '$1***@'],
]

/** Replaces the obvious secrets (API tokens, keys, Bearer values, password=..., --token x, URL passwords) with ***. */
export function scrub(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, to]) => out.replace(pattern, to), text)
}

/** Drops control characters (keeps newline and tab) and cuts to `limit` characters with an ellipsis. */
export function cut(text: string, limit: number): string {
  const clean = text.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean
}

// ---- what the call was ---------------------------------------------------------------------------------------------

/** The command or the file path of a call: never its contents. '' when it has neither. */
export function inputSummary(input: Record<string, unknown>): string {
  for (const key of ['command', 'file_path', 'notebook_path', 'path']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim() !== '') return cut(scrub(value).replace(/\s+/g, ' ').trim(), 200)
  }

  return ''
}

/** Words that mark a call the person (or a permission rule) turned down, rather than one that ran and failed. */
const DENIED = /doesn't want to proceed|tool use was rejected|user (?:rejected|denied|declined)|permission to use .{0,300}? (?:was|has been) denied/i

/** Whether a finished call is worth keeping, and as what. */
export function failureOf(ran: { deny?: string; isError?: true; text?: string; result?: unknown }): { kind: ErrorInboxKind; text: string } | undefined {
  if (ran.deny !== undefined) return { kind: 'refused', text: ran.deny }
  if (ran.isError !== true) return undefined
  const text = ran.text ?? (typeof ran.result === 'string' ? ran.result : '')

  return { kind: DENIED.test(text) ? 'denied' : 'failed', text: text || 'The tool reported an error and no text.' }
}

/** The draft the "Ask Claude" button puts in the prompt box. */
export function draftFor(entry: { tool: string; input: string; error: string }): string {
  const lines = [`Please explain this error from a ${entry.tool} call and suggest a fix (do not change anything yet).`]
  if (entry.input !== '') lines.push(`Input: ${entry.input}`)
  lines.push('Error:', entry.error)

  return lines.join('\n')
}

export const clockTime = (ms: number): string => {
  const d = new Date(ms)

  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':')
}
