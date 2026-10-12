// Pure helpers: prices, duration parsing, formatting. No engine access.

const MIN = 60_000
const HOUR = 60 * MIN

export const MAX_KEEPWARM_MS = 24 * HOUR
export const DEFAULT_KEEPWARM_MS = 6 * HOUR
/** Margin kept between a ping and the cache's expiry. */
export const SAFETY_MS = 5 * MIN

/** USD per million tokens. */
export type Rate = { in: number; out: number; write5m: number; write1h: number; read: number }

const rate = (input: number, output: number): Rate => ({
  in: input,
  out: output,
  write5m: input * 1.25,
  write1h: input * 2,
  read: input * 0.1,
})

// Built-in list prices (est.): they drift, so every figure shown is labelled "est.".
// First match wins; an unknown model falls back to Sonnet rates and says so.
const PRICES: ReadonlyArray<readonly [RegExp, string, Rate]> = [
  [/opus-4(-1)?(-\d{8})?$/, 'Opus 4/4.1', rate(15, 75)],
  [/opus/, 'Opus', rate(5, 25)],
  [/haiku-3/, 'Haiku 3.x', rate(0.8, 4)],
  [/haiku/, 'Haiku', rate(1, 5)],
  [/sonnet/, 'Sonnet', rate(3, 15)],
]
const FALLBACK = { label: 'Sonnet rates (model unknown)', rate: rate(3, 15) }

export function priceFor(model: string): { label: string; rate: Rate } {
  const id = model.toLowerCase()
  const hit = PRICES.find(([re]) => re.test(id))
  return hit ? { label: hit[1], rate: hit[2] } : FALLBACK
}

/** Rate of a cache write: the 5-minute tier for a 5-minute TTL, else the 1-hour tier. */
export const writeRate = (r: Rate, ttlMinutes: number): number =>
  ttlMinutes <= 5 ? r.write5m : r.write1h

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function usageUsd(r: Rate, ttlMinutes: number, u: Usage): number {
  return (
    (u.input_tokens * r.in +
      u.output_tokens * r.out +
      u.cache_read_input_tokens * r.read +
      u.cache_creation_input_tokens * writeRate(r, ttlMinutes)) /
    1e6
  )
}

export const coldUsd = (r: Rate, ttlMinutes: number, tokens: number): number =>
  (tokens * writeRate(r, ttlMinutes)) / 1e6

export const warmUsd = (r: Rate, tokens: number): number => (tokens * r.read) / 1e6

/** Ping period: the TTL less the safety margin, never under one minute. */
export const pingIntervalMs = (ttlMinutes: number): number =>
  Math.max(ttlMinutes * MIN - SAFETY_MS, MIN)

/** A ping that comes sooner than this after the last touch is skipped: the next one still lands in time. */
export const skipBelowMs = (ttlMinutes: number): number =>
  Math.max(ttlMinutes * MIN - pingIntervalMs(ttlMinutes) - MIN, 0)

const UNITS: Record<string, number> = {
  m: MIN, min: MIN, mins: MIN, minute: MIN, minutes: MIN,
  h: HOUR, hr: HOUR, hrs: HOUR, hour: HOUR, hours: HOUR,
  d: 24 * HOUR, day: 24 * HOUR, days: 24 * HOUR,
}

/** "90m", "2h", "1h30m", "1.5h", "45" (minutes) to milliseconds; null when unreadable or zero. */
export function parseDuration(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, '')
  const parts = text.match(/\d+(?:\.\d+)?[a-z]*/g)
  if (!parts || parts.join('') !== text) return null
  let total = 0
  for (const part of parts) {
    const m = /^(\d+(?:\.\d+)?)([a-z]*)$/.exec(part)
    const unit = m?.[2] === '' ? (parts.length === 1 ? 'm' : '') : (m?.[2] ?? '')
    const ms = UNITS[unit]
    if (!m || ms === undefined) return null
    total += Number(m[1]) * ms
  }
  return total > 0 ? Math.round(total) : null
}

export function fmtDuration(ms: number): string {
  const s = Math.max(Math.round(ms / 1000), 0)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  return n < 10_000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`
}

/** Time left on a clock, in the words of a headline: "58 min", "1h 5m". */
export function fmtLeft(ms: number): string {
  const m = Math.max(Math.round(ms / MIN), 0)
  if (m < 1) return '<1 min'
  return m < 60 ? `${m} min` : fmtDuration(m * MIN)
}

/** "~$0.02", or "<$0.01" when it rounds to nothing. */
export function fmtApprox(n: number): string {
  return n > 0 && n < 0.01 ? '<$0.01' : `~${fmtUsd(n)}`
}

export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

export function fmtUsd(n: number): string {
  if (n > 0 && n < 0.01) return '<$0.01'
  return `$${n.toFixed(n < 10 ? 2 : 1)}`
}

/** Share of cached tokens that were read rather than written, in whole percent; null when none were counted. */
export function hitPercent(read: number, write: number): number | null {
  const total = read + write
  return total > 0 ? Math.round((read / total) * 100) : null
}

/** Share of all input tokens read from cache, 0-100 with one decimal; null when no input was counted. */
export function hitRate(read: number, write: number, uncached: number): number | null {
  const total = read + write + uncached
  if (!(total > 0) || !Number.isFinite(total)) return null
  return Math.round((read / total) * 1000) / 10
}

/** When the cache goes cold: the last response plus the TTL; null before any response (at = 0) or on bad input. */
export function expiryAt(lastResponseAt: number, ttlMs: number): number | null {
  return lastResponseAt > 0 && Number.isFinite(lastResponseAt) && ttlMs > 0 ? lastResponseAt + ttlMs : null
}

const two = (n: number): string => String(n).padStart(2, '0')

/**
 * Local wall-clock time of an epoch in ms ("14:30", or "2:30 pm"). Uses the JS Date local getters, so it is
 * the machine's own zone; the plugin API has no timezone call, and a sandbox without a zone shows UTC.
 */
export function fmtClock(ms: number, hour24 = true): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const h = d.getHours()
  if (hour24) return `${two(h)}:${two(d.getMinutes())}`
  return `${h % 12 === 0 ? 12 : h % 12}:${two(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`
}

/** "14:30", "expired" once past, "unknown" when null. */
export function fmtExpiry(expiresAt: number | null, now: number, hour24 = true): string {
  if (expiresAt === null) return 'unknown'
  return expiresAt <= now ? 'expired' : fmtClock(expiresAt, hour24)
}

/** "Cache until 14:30 · hit 87%"; "Cache expired", "Cache until unknown"; hit omitted when null. */
export function cacheClockLine(expiresAt: number | null, hit: number | null, now: number, hour24 = true): string {
  const when = fmtExpiry(expiresAt, now, hour24)
  const head = when === 'expired' ? 'Cache expired' : `Cache until ${when}`
  return hit === null ? head : `${head} · hit ${hit % 1 === 0 ? hit : hit.toFixed(1)}%`
}
