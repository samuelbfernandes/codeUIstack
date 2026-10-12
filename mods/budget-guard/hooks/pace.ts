// Usage pace: will a plan window run out before it resets, at the burn rate so far? Pure, never throws.
import type { BudgetWindow } from '../types'

export type Pace = 'ok' | 'amber' | 'red' | 'none'

const HOUR = 3_600_000
/** Window lengths by kind; any other kind has no pace. */
const LENGTH_MS: Readonly<Record<string, number>> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }

/** Too early in a window (under 2%) or too little used (under 10 points) to say anything. */
const MIN_FRACTION = 0.02
const MIN_PCT = 10
const RED_AT = 100
const AMBER_AT = 90

export type Projection = { projected: number; elapsedMs: number; lengthMs: number }

/** The projected % used at reset, or undefined when the window has no pace or the timestamp is unreadable / outside the window. */
export function project(w: BudgetWindow, now: number): Projection | undefined {
  const lengthMs = LENGTH_MS[w.kind]
  const at = w.resetsAt === undefined ? NaN : Date.parse(w.resetsAt)
  if (lengthMs === undefined || !Number.isFinite(at) || !Number.isFinite(now) || !Number.isFinite(w.pct)) return undefined
  const elapsedMs = lengthMs - (at - now)
  if (elapsedMs <= 0 || elapsedMs > lengthMs) return undefined // not inside the window
  const fraction = elapsedMs / lengthMs
  if (fraction < MIN_FRACTION || w.pct < MIN_PCT) return { projected: 0, elapsedMs, lengthMs } // neutral, never an alarm
  return { projected: w.pct / fraction, elapsedMs, lengthMs }
}

/** 'red' at 100%+ projected, 'amber' at 90%+, else 'ok'; 'none' where no pace can be computed. */
export function paceOf(w: BudgetWindow, now: number): Pace {
  try {
    const p = project(w, now)
    if (p === undefined) return 'none'
    return p.projected >= RED_AT ? 'red' : p.projected >= AMBER_AT ? 'amber' : 'ok'
  } catch {
    return 'none'
  }
}

/** Milliseconds until the window is used up at the current rate (only meaningful for amber/red); undefined otherwise. */
export function runOutMs(w: BudgetWindow, now: number): number | undefined {
  const p = project(w, now)
  if (p === undefined || p.projected <= 0 || w.pct <= 0) return undefined
  return Math.max(0, ((100 - w.pct) / w.pct) * p.elapsedMs)
}
