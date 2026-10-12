import type { AsideEntry } from '../types'

export const MAX_KEPT = 5
export const DEFAULT_MAX_CHARS = 4000
/** What the fork is told, ahead of the question. It runs with every tool denied by the engine; this is the polite half. */
export const INSTRUCTION = 'Answer the side question briefly. Do not use tools. Do not change anything.'
/** The question is clipped to this before it is sent, and to a shorter length before it is shown. */
export const MAX_QUESTION_CHARS = 4000
export const SHOWN_QUESTION_CHARS = 300
/** A question still "thinking" this long after it started is assumed lost (a reload dropped it) and no longer blocks a new one. */
export const STALE_MS = 3 * 60_000

export const NO_ANSWER = 'Aside · no answer, nothing changed'

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

/** The maxAnswerChars setting: a number of at least 200, else the default. */
export function maxCharsOf(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : DEFAULT_MAX_CHARS
  return n >= 200 ? n : DEFAULT_MAX_CHARS
}

export const buildPrompt = (question: string): string =>
  `${INSTRUCTION}\n\nSide question: ${question.slice(0, MAX_QUESTION_CHARS)}`

/** The question as one headline: whitespace folded, clipped. */
export const headline = (question: string): string => clip(question.replace(/\s+/g, ' ').trim(), SHOWN_QUESTION_CHARS)

/** The answer cut to `max` characters; `isCut` says whether anything was lost. */
export function cutAnswer(text: string, max: number): { text: string; isCut: boolean } {
  const body = text.trim()
  return body.length > max ? { text: `${body.slice(0, max).trimEnd()}…`, isCut: true } : { text: body, isCut: false }
}

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

/** Every token the fork was billed or served, cached ones included: the figure is labelled est. where it is shown. */
export const tokensOf = (u: Usage): number =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

/** 950 -> "950", 12_400 -> "12k". */
export const fmtTokens = (n: number): string => (n < 1000 ? String(Math.round(n)) : `${Math.round(n / 1000)}k`)

/** The dim line under an answer. */
export const footer = (tokens: number | null): string =>
  `Side question · not added to the conversation${tokens === null || tokens <= 0 ? '' : ` · ~${fmtTokens(tokens)} tokens est.`}`

/** Newest first, at most MAX_KEPT. */
export const addEntry = (list: readonly AsideEntry[], entry: AsideEntry): AsideEntry[] => [entry, ...list].slice(0, MAX_KEPT)

export const patchEntry = (list: readonly AsideEntry[], id: number, patch: Partial<AsideEntry>): AsideEntry[] =>
  list.map(a => (a.id === id ? { ...a, ...patch } : a))

export const nextId = (list: readonly AsideEntry[]): number => list.reduce((m, a) => Math.max(m, a.id), 0) + 1

export const isRunning = (list: readonly AsideEntry[], now: number): boolean =>
  list.some(a => a.status === 'thinking' && now - a.at < STALE_MS)

type Miss =
  | { reason: 'nothing-to-fork' }
  | { reason: 'api-error'; status: number | null; error: string }
  | { reason: 'empty-reply' }
  | { reason: 'aborted' }

/** A short plain reason for the dim line under "no answer". */
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
