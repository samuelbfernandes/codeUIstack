// Token estimate for one automatic review. PURE: no `$`, no git, easy to test.
//
// EVERY NUMBER BELOW IS A HEURISTIC, chosen by reasoning about what a review run sends and
// reads. None was measured against a live Codex (or Claude) review. The calibration step
// replaces guesswork with the person's own past runs once three or more are recorded.

export type Level = 'green' | 'amber' | 'red'
export type Reviewer = 'codex' | 'claude'
export type Usage = { bytes: number; tokens: number } // one past review: diff bytes sent, tokens used

export const PROMPT_TOKENS = 1800 // review instructions + JSON schema, sent on every run
export const BYTES_PER_TOKEN = 3.5 // code and diff text, a common rule of thumb
export const LOW_OVERHEAD = 6000 // session overhead even when nothing else is opened
export const HIGH_FACTOR = 3 // the reviewer runs read-only and may open files: the input can triple...
export const HIGH_OVERHEAD = 12000 // ...plus a larger session overhead
export const OUTPUT_LOW = 1500 // tokens written, short verdict
export const OUTPUT_HIGH = 5000 // tokens written, long findings list
export const MIN_HISTORY = 3 // past reviews needed before calibrating
export const HISTORY_WINDOW = 10 // only the most recent are used
export const FACTOR_MIN = 0.3 // calibration never scales by less than this...
export const FACTOR_MAX = 4 // ...or more than this
export const GREEN_MAX_DEFAULT = 25_000
export const RED_MIN_DEFAULT = 60_000

export type Thresholds = { greenMax: number; redMin: number }
export type Estimate = {
  low: number // total tokens, optimistic
  expected: number // total tokens, midpoint of low and high (scaled when calibrated)
  high: number // total tokens, pessimistic
  input: number // of `expected`: tokens read (prompt, diff, files the reviewer opens)
  output: number // of `expected`: tokens written
  level: Level
  calibratedFrom: number // how many past reviews calibrated it; 0 = pure heuristic
  factor: number // the calibration factor applied (1 when not calibrated)
}

type Raw = { low: number; expected: number; high: number; output: number }

/** The uncalibrated numbers for a diff of `diffBytes` bytes. */
function raw(diffBytes: number): Raw {
  const input = PROMPT_TOKENS + Math.ceil(Math.max(0, diffBytes) / BYTES_PER_TOKEN)
  const low = input + LOW_OVERHEAD + OUTPUT_LOW
  const high = HIGH_FACTOR * input + HIGH_OVERHEAD + OUTPUT_HIGH
  return { low, high, expected: (low + high) / 2, output: (OUTPUT_LOW + OUTPUT_HIGH) / 2 }
}

export function levelOf(expected: number, t: Thresholds): Level {
  if (expected <= t.greenMax) return 'green'
  return expected >= t.redMin ? 'red' : 'amber'
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

/** Median of actual / predicted over the last HISTORY_WINDOW usable entries; undefined with too few. */
function calibration(history: readonly Usage[]): { factor: number; n: number } | undefined {
  const usable = history.filter(h => Number.isFinite(h.bytes) && h.bytes >= 0 && Number.isFinite(h.tokens) && h.tokens > 0)
  if (usable.length < MIN_HISTORY) return undefined
  const recent = usable.slice(-HISTORY_WINDOW)
  const ratio = median(recent.map(h => h.tokens / raw(h.bytes).expected))
  return { factor: Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, ratio)), n: recent.length }
}

/**
 * `files` is accepted for the caller's convenience but does not enter the formula: how many
 * files the reviewer opens is not knowable from a diff, and the fixed allowances cover it.
 * `reviewer` does not change the numbers either (Claude and Codex use the same formula);
 * it only changes how the caller labels them. `history` is the past actuals, oldest first.
 */
export function estimate(args: {
  diffBytes: number
  files: number
  reviewer: Reviewer
  history: readonly Usage[]
  thresholds?: Thresholds
}): Estimate {
  const r = raw(args.diffBytes)
  const cal = calibration(args.history)
  const factor = cal?.factor ?? 1
  const expected = Math.round(r.expected * factor)
  const output = Math.min(expected, Math.round(r.output * factor))
  const thresholds = args.thresholds ?? { greenMax: GREEN_MAX_DEFAULT, redMin: RED_MIN_DEFAULT }
  return {
    low: Math.round(r.low * factor),
    expected,
    high: Math.round(r.high * factor),
    input: expected - output,
    output,
    level: levelOf(expected, thresholds),
    calibratedFrom: cal?.n ?? 0,
    factor,
  }
}

/** Parse `<diffBytes>:<tokens>` lines (git config toolkit.theoryUsage); junk is ignored. */
export function parseUsage(lines: readonly string[]): Usage[] {
  const out: Usage[] = []
  for (const line of lines) {
    const m = /^\s*(\d+):(\d+)\s*$/.exec(line)
    if (m) out.push({ bytes: Number(m[1]), tokens: Number(m[2]) })
  }
  return out
}
