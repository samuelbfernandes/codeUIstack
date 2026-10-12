import type { PromptItem } from '../types'

export const MAX_TEXT = 4000
export const MAX_NAME = 24
export const DEFAULT_MAX = 50

export const STARTERS: PromptItem[] = [
  { name: 'explain', text: 'Explain this code step by step, then list anything risky or unclear' },
  { name: 'tests', text: 'Write tests for the code I just changed; run them and fix failures' },
  { name: 'review', text: 'Review my last change for bugs, edge cases and missing tests; do not edit anything' },
  { name: 'eda', text: 'Profile this dataset: shape, dtypes, missing values, duplicates, outliers; summarise in a table and suggest next steps' },
]

export const HELP = [
  'Prompts · /prompts list',
  '/prompts add <name> | <prompt text>',
  '/prompts use <name> (puts it in the prompt box, nothing is sent)',
  '/prompts rename <old> <new>',
  '/prompts remove <name>',
].join('\n')

export const maxOf = (v: unknown): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : DEFAULT_MAX
  return n < 1 ? DEFAULT_MAX : Math.min(n, 200)
}

export const storeKey = (cwd: string) => `items:${cwd}`

/** Keeps only well-formed items from whatever the store held. */
export function clean(raw: unknown): PromptItem[] {
  if (!Array.isArray(raw)) return []
  const out: PromptItem[] = []
  for (const r of raw) {
    const o = r as { name?: unknown; text?: unknown } | null
    if (o && typeof o.name === 'string' && typeof o.text === 'string' && !out.some(i => i.name === o.name)) {
      out.push({ name: o.name, text: o.text })
    }
  }
  return out
}

/** A name as typed -> a valid name, or a plain reason. */
export function checkName(raw: string): { name: string } | { error: string } {
  const name = raw.trim().toLowerCase()
  if (name === '') return { error: 'Prompts · give it a name' }
  if (!/^[a-z0-9-]+$/.test(name)) return { error: 'Prompts · names use lowercase letters, digits and hyphens only' }
  if (name.length > MAX_NAME) return { error: `Prompts · name is too long (most ${MAX_NAME} characters)` }
  return { name }
}

export function listText(items: PromptItem[]): string {
  if (items.length === 0) return 'Prompts · none saved · /prompts add <name> | <prompt text>'
  const rows = items.map((it, i) => {
    const one = it.text.replace(/\s+/g, ' ').trim()
    return `${i + 1}. ${it.name} · ${one.length > 60 ? one.slice(0, 60) + '…' : one}`
  })
  return `Prompts · ${items.length} saved\n${rows.join('\n')}`
}
