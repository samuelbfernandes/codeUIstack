// The "by the way" panel: pure helpers. A side question is answered over the main thread's cached context and shown in the
// side bar only; nothing is added to the conversation. No engine access here.

import type { BtwEntry } from '../types'

export const MAX_KEPT = 5
export const DEFAULT_MAX_CHARS = 1500
/** What the fork is told ahead of the question. The engine denies every tool for it; this is the polite half. */
export const INSTRUCTION = 'Answer the side question briefly. Do not use tools. Do not change anything.'
export const MAX_QUESTION_CHARS = 4000
/** A question still "thinking" this long after it started is taken as lost and no longer blocks a new one. */
export const STALE_MS = 3 * 60_000

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

export const buildPrompt = (question: string): string => `${INSTRUCTION}\n\nSide question: ${question.slice(0, MAX_QUESTION_CHARS)}`
export const headline = (question: string, max = 120): string => clip(question.replace(/\s+/g, ' ').trim(), max)

export function maxCharsOf(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_MAX_CHARS
  return n >= 200 ? n : DEFAULT_MAX_CHARS
}

export function cutAnswer(text: string, max: number): { text: string; isCut: boolean } {
  const body = text.trim()
  return body.length > max ? { text: `${body.slice(0, max).trimEnd()}…`, isCut: true } : { text: body, isCut: false }
}

/** Most of the transcript the fallback sends when there is nothing to fork (a resumed or reloaded session). */
export const DIGEST_CHARS = 60_000
const PER_MESSAGE = 4_000

/** The newest user and assistant text, oldest first, as plain "User:"/"Claude:" lines, up to `max` characters. */
export function digest(messages: readonly { role: 'user' | 'assistant'; text: string }[], max = DIGEST_CHARS): string {
  const out: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    const body = m.text.trim()
    if (body === '') continue
    const line = `${m.role === 'user' ? 'User' : 'Claude'}: ${clip(body, PER_MESSAGE)}`
    if (used + line.length > max) break
    out.push(line)
    used += line.length + 2
  }
  return out.reverse().join('\n\n')
}

export const fallbackPrompt = (transcript: string, question: string): string =>
  `The conversation so far (text only, newest last):\n\n${transcript}\n\n---\n\nSide question: ${question.slice(0, MAX_QUESTION_CHARS)}`

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export const tokensOf = (u: Usage): number => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
export const fmtTokens = (n: number): string => (n < 1000 ? String(Math.round(n)) : `${Math.round(n / 1000)}k`)

/** The dim line under an answer. */
export const footer = (e: BtwEntry): string =>
  e.status === 'thinking' ? 'Thinking…' : e.status === 'failed' ? e.note : `not added to the conversation${e.tokens === null || e.tokens <= 0 ? '' : ` · ~${fmtTokens(e.tokens)} tokens est.`}${e.isCut ? ' · cut' : ''}`

/** Newest first, at most MAX_KEPT. */
export const addEntry = (list: readonly BtwEntry[], entry: BtwEntry): BtwEntry[] => [entry, ...list].slice(0, MAX_KEPT)
export const patchEntry = (list: readonly BtwEntry[], id: number, patch: Partial<BtwEntry>): BtwEntry[] => list.map(a => (a.id === id ? { ...a, ...patch } : a))
export const nextId = (list: readonly BtwEntry[]): number => list.reduce((m, a) => Math.max(m, a.id), 0) + 1
export const isRunning = (list: readonly BtwEntry[], now: number): boolean => list.some(a => a.status === 'thinking' && now - a.at < STALE_MS)

type Miss =
  | { reason: 'nothing-to-fork' }
  | { reason: 'api-error'; status: number | null; error: string }
  | { reason: 'empty-reply' }
  | { reason: 'aborted' }

export function whyNot(miss: Miss): string {
  switch (miss.reason) {
    case 'nothing-to-fork':
      return 'Nothing to ask about yet · send a message first'
    case 'api-error':
      return `The request failed${miss.status === null ? '' : ` (${miss.status})`} · ${miss.error.replace(/_/g, ' ')}`
    case 'aborted':
      return 'Cut short'
    default:
      return 'The model sent no text'
  }
}
