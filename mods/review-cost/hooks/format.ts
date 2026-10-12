// Everything the person reads. Pure functions: easy to test, no `$`.
//
// SHAPE (kept short, Apple-style): a one-line headline, a level line, then a few plain lines.
// COLOR: `$.ui.ask` takes plain strings (no styling), so the level line carries the level
// WORD ("Amber") and a small bar and works without color. A separate `ui.render` hook
// (register.tsx) adds a colored copy of that line above the dialog where the surface draws it.
import { changedLines } from './git'
import type { Plan } from './git'
import type { Estimate, Level, Reviewer } from './estimate'

export const ASK_HEADER = 'Review cost' // the dialog's chip (12 characters at most); also how the render hook finds our dialog
export const TOP_FILES = 3
const BAR_WIDTH = 10

export type Prices = { inputUsdPerMTok: number; outputUsdPerMTok: number }

export const reviewerName = (r: Reviewer) => (r === 'claude' ? 'Claude' : 'Codex')

export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(n / 1000)}k`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  return n < 10 * 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** `▰▰▰▰▰▱▱▱▱▱`: how far the expected cost is toward the red threshold (always at least one block). */
export function bar(expected: number, redMin: number): string {
  const filled = Math.max(1, Math.min(BAR_WIDTH, Math.ceil((BAR_WIDTH * expected) / Math.max(1, redMin))))
  return `${'\u25B0'.repeat(filled)}${'\u25B1'.repeat(BAR_WIDTH - filled)}`
}

export const levelWord = (l: Level) => l[0]!.toUpperCase() + l.slice(1)

/** Dollars only when BOTH prices are set: the person's plan pricing is unknown, so nothing is ever guessed. */
export function dollars(est: Estimate, prices: Prices): string | undefined {
  const { inputUsdPerMTok: i, outputUsdPerMTok: o } = prices
  if (!(i > 0) || !(o > 0)) return undefined
  const usd = (est.input * i + est.output * o) / 1_000_000
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`
}

export const headline = (reviewer: Reviewer, est: Estimate) =>
  `${reviewerName(reviewer)} review \u00B7 about ${fmtTokens(est.expected)} tokens`

/** The second line: `● Amber  ▰▰▰▰▱▱▱▱▱▱  21k to 88k`. The colored copy above the dialog is this line. */
export const levelLine = (est: Estimate, redMin: number) =>
  `\u25CF ${levelWord(est.level)}  ${bar(est.expected, redMin)}  ${fmtTokens(est.low)} to ${fmtTokens(est.high)}`

export const toastText = (reviewer: Reviewer, est: Estimate) =>
  `${reviewerName(reviewer)} review \u00B7 about ${fmtTokens(est.expected)} tokens \u00B7 ${levelWord(est.level)}`

const shorten = (path: string, max = 36) => (path.length <= max ? path : `...${path.slice(path.length - max + 3)}`)

function largest(plan: Plan): string {
  const sorted = [...plan.files].sort((a, b) => changedLines(b) - changedLines(a) || a.path.localeCompare(b.path))
  const named = sorted.slice(0, TOP_FILES).map(f => `${shorten(f.path)} +${f.added} -${f.removed}`)
  const more = plan.files.length - TOP_FILES
  return `Largest: ${named.join(', ')}${more > 0 ? `, and ${more} more` : ''}`
}

export function askOptions(level: Level): { options: [string, string]; review: string; skip: string } {
  // The FIRST option is the one the dialog highlights, so Enter takes it. Review for green and
  // amber (the safe default: the push gets its check); Skip for red (many tokens: the person
  // has to choose to spend them).
  return level === 'red'
    ? { options: ['Skip', 'Review anyway'], review: 'Review anyway', skip: 'Skip' }
    : { options: ['Review', 'Skip'], review: 'Review', skip: 'Skip' }
}

export function question(plan: Plan, est: Estimate, redMin: number, prices: Prices): string {
  const files = plan.files.length
  const lines = plan.files.reduce((n, f) => n + changedLines(f), 0)
  const usd = dollars(est, prices)
  const cost = [usd ? `About ${usd} at API prices` : '', plan.reviewer === 'claude' ? 'Counts against your Claude plan' : '']
    .filter(Boolean)
    .join(' \u00B7 ')
  return [
    headline(plan.reviewer, est),
    levelLine(est, redMin),
    '',
    `${files} file${files === 1 ? '' : 's'} \u00B7 ${lines} changed lines \u00B7 about ${fmtBytes(plan.diffBytes)}` +
      (plan.capped ? ` (capped at ${fmtBytes(plan.maxBytes)})` : ''),
    largest(plan),
    ...(cost ? [cost] : []),
    est.calibratedFrom > 0
      ? `Estimate from your last ${est.calibratedFrom} reviews, not a measurement.`
      : 'Estimate, not a measurement.',
    '',
    'Skip still pushes, marked UNREVIEWED.',
    `Review with ${reviewerName(plan.reviewer)} before pushing?`,
  ].join('\n')
}

export const CANCEL_TEXT = 'Push cancelled. Run it again to choose Review or Skip.'
