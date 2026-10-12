// Usage pace and time formatting: pure helpers, no engine access.
//
// A rate-limit window resets at a known time. At the rate it has been used so far (percent used over the fraction of the
// window that has passed), it either reaches the limit before the reset or it does not; the side bar marks it with a ▲
// (amber at >= 90% projected, red at >= 100%). A window under 10% used is never marked: too little to tell a trend from noise.

export type Pace = 'neutral' | 'amber' | 'red'

const HOUR = 3_600_000
/** Window lengths the engine documents by kind; a kind not listed has no known length, so it gets no pace. */
export const WINDOW_MS: Readonly<Record<string, number>> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }

/** Below this share used a window stays neutral. */
export const PACE_MIN_PERCENT = 10
export const PACE_AMBER_AT = 90
export const PACE_RED_AT = 100

/** Where the current burn rate ends up at the reset, in percent of the limit; undefined when it cannot be told. */
export function projectedPercent(percentUsed: number, resetsAtMs: number | undefined, nowMs: number, windowMs: number | undefined): number | undefined {
  if (windowMs === undefined || windowMs <= 0 || resetsAtMs === undefined || !Number.isFinite(resetsAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(percentUsed)) return undefined
  const remaining = resetsAtMs - nowMs
  if (remaining <= 0) return undefined // already past its reset: nothing to project
  const elapsed = Math.min(windowMs, windowMs - remaining)
  if (elapsed <= 0) return undefined // the window has not started by this clock
  return percentUsed / (elapsed / windowMs)
}

export function paceOf(percentUsed: number, resetsAtMs: number | undefined, nowMs: number, windowMs: number | undefined): Pace {
  if (!Number.isFinite(percentUsed) || percentUsed < PACE_MIN_PERCENT) return 'neutral'
  if (percentUsed >= PACE_RED_AT) return 'red'
  const projected = projectedPercent(percentUsed, resetsAtMs, nowMs, windowMs)
  if (projected === undefined) return 'neutral'
  if (projected >= PACE_RED_AT) return 'red'
  if (projected >= PACE_AMBER_AT) return 'amber'
  return 'neutral'
}

/** An ISO 8601 timestamp as milliseconds, or undefined when absent or unreadable. */
export function parseTime(iso: string | undefined): number | undefined {
  if (typeof iso !== 'string') return undefined
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : undefined
}

/** `1h 12m`, `45m`, `2d 4h`, `30s`: the two largest units, rounded down; a negative length reads as 0. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${total}s`
}

/** `12k`, `1.4M`, `850`: a token count in as few characters as read well. */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  if (abs < 1000) return String(Math.round(n))
  if (abs < 1_000_000) return `${(n / 1000).toFixed(abs < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(abs < 10_000_000 ? 1 : 0).replace(/\.0$/, '')}M`
}
