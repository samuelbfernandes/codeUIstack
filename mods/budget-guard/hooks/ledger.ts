// The per-day cost ledger: pure helpers. Keys are local dates YYYY-MM-DD, values USD. No engine access.
import type { BudgetWindow } from '../types'

export type Ledger = Record<string, number>
/** The last cost reading of the running session, so only the growth since is counted. */
export type LedgerLast = { startedAt: number; usd: number }
export type LedgerAtom = { today: number; week: number | null }

export const KEEP_DAYS = 60
const DAY = 86_400_000

const p2 = (n: number): string => String(n).padStart(2, '0')

/** The local calendar date of a time, as YYYY-MM-DD. */
export function dateKey(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** The date `n` local days before `ms` (calendar arithmetic, so a DST day is still one day). */
export function daysAgoKey(ms: number, n: number): string {
  const d = new Date(ms)
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

const KEY = /^\d{4}-\d{2}-\d{2}$/

/** Whatever the store held, as a clean ledger (bad keys or values dropped). */
export function cleanLedger(v: unknown): Ledger {
  const out: Ledger = {}
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, n] of Object.entries(v)) if (KEY.test(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = n
  return out
}

/** Keeps the last 60 days, today included. */
export function pruneLedger(l: Ledger, now: number): Ledger {
  const oldest = daysAgoKey(now, KEEP_DAYS - 1)
  return Object.fromEntries(Object.entries(l).filter(([k]) => k >= oldest))
}

/** What one new reading adds: the growth of this session's cost since the last reading, and the new last. */
export function deltaOf(prev: LedgerLast | null, startedAt: number, usd: number, now: number): { delta: number; last: LedgerLast } {
  const last = { startedAt, usd }
  if (prev === null || prev.startedAt !== startedAt) {
    // The first reading of this session here: its earlier spend counts only if the session began today.
    return { delta: dateKey(startedAt) === dateKey(now) ? usd : 0, last }
  }
  return { delta: usd >= prev.usd ? usd - prev.usd : 0, last } // a falling total is a restarted ledger: counted from here
}

export function addSpend(l: Ledger, now: number, delta: number): Ledger {
  const k = dateKey(now)
  return pruneLedger(delta > 0 ? { ...l, [k]: (l[k] ?? 0) + delta } : l, now)
}

/** The sum of days from `fromKey` on. */
const sumFrom = (l: Ledger, fromKey: string): number => Object.entries(l).reduce((s, [k, n]) => (k >= fromKey ? s + n : s), 0)

/** Today, and the week since the weekly window opened (resetsAt minus 7 days, by whole days); null with no readable seven_day window. */
export function atomOf(l: Ledger, now: number, windows: readonly BudgetWindow[]): LedgerAtom {
  const w = windows.find(x => x.kind === 'seven_day')
  const at = w?.resetsAt === undefined ? NaN : Date.parse(w.resetsAt)
  const week = Number.isFinite(at) ? sumFrom(l, dateKey(at - 7 * DAY)) : null
  return { today: l[dateKey(now)] ?? 0, week }
}

/** The last `n` days, newest first, zero days included. */
export function lastDays(l: Ledger, now: number, n: number): { date: string; usd: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const date = daysAgoKey(now, i)
    return { date, usd: l[date] ?? 0 }
  })
}
