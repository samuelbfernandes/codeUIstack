// Text for the dialog, the refusal the model reads and the toast. Plain text only: the dialog is the
// engine's own question dialog, which draws the same on every surface. Layout, top to bottom:
//   a one-line headline ("High risk · deletes data/"), the command, a few "Label   value" rows
//   (one honesty note at most), then the question. Nothing here contains ALL-CAPS words.
import type { Finding } from './classify'
import type { Row } from './folder'
import type { Report } from './measure'
import { PUSHED_NOTE } from './recover'
import type { RiskLevel } from './recover'

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
// first letter up, unless the text starts with a command name ("git diff failed")
const cap1 = (s: string) => (/^(git|rm|cp|mv|chmod|chown|find|du|dd|cargo|psql|mysql|sqlite3)\b/.test(s) ? s : s.charAt(0).toUpperCase() + s.slice(1))

const LABEL_WIDTH = 13
const DEFAULT_ROWS = 5 // rows shown under a list heading; the rest is "+N more"
const MAX_NOTES = 2
const FOOTNOTE = 'Estimated from file names and your last fetch.'
// The dialog takes plain text only, so the level is coloured with a dot. Unknown counts as red: it was not checked.
const WORD: Record<RiskLevel, string> = { high: '🔴 High', medium: '🟠 Medium', low: '🟢 Low', unknown: '🔴 Unknown' }
const WORST_FIRST: RiskLevel[] = ['high', 'unknown', 'medium', 'low']

const row = (label: string, value: string) => `${label.padEnd(LABEL_WIDTH)}${value}`
const levelOf = (r: Report): RiskLevel => r.risk?.level ?? 'unknown'
const worst = (reports: Report[]): RiskLevel => WORST_FIRST.find(l => reports.some(r => levelOf(r) === l)) ?? 'unknown'

// What the command does, when the measurer could not say.
function fallbackAction(f: Finding): string {
  const names = f.targets.map(t => t.raw)
  const what = (none: string) => (names.length === 1 ? clip(names[0]!, 50) : names.length > 1 ? `${names.length} paths` : none)
  switch (f.kind) {
    case 'rm': return `deletes ${f.viaXargs ? 'the files it is given' : what('files')}`
    case 'r': return 'deletes files from R code'
    case 'truncate': return `empties ${what('files')}`
    case 'shred': return `shreds ${what('files')}`
    case 'chmod': return `changes permissions of ${what('a tree')}`
    case 'cargo-clean': return 'deletes target/'
    case 'redirect': case 'overwrite': return `overwrites ${what('files')}`
    case 'dd': return 'overwrites data'
    case 'mkfs': return 'erases a disk'
    case 'find': return 'deletes every match'
    case 'git-clean': return 'deletes untracked files'
    case 'git-reset': case 'git-discard': return 'discards uncommitted changes'
    case 'git-push': return 'overwrites remote history'
    case 'git-branch': return 'deletes a branch'
    case 'git-stash': return 'deletes stashed work'
    case 'sql': return 'runs destructive SQL'
    case 'custom': return 'matches your extra pattern'
    case 'opaque': return clip(f.reason, 70)
  }
}
const actionOf = (r: Report) => r.action ?? fallbackAction(r.finding)

function list(title: string, rows: string[], more: number, max: number): string[] {
  if (rows.length === 0) return []
  const shown = rows.slice(0, max)
  const left = more + rows.length - shown.length
  return [title, ...shown.map(x => `  ${clip(x, 110)}`), ...(left > 0 ? [`  +${left} more`] : [])]
}

function folderRows(rows: Row[], indent = ''): string[] {
  return rows.map(([k, v]) => indent + row(k, clip(v, 200)))
}

function details(r: Report, sessionCwd: string | undefined, max: number): string[] {
  const f = r.finding
  const folders = r.folders ?? []
  const out: string[] = []
  if (f.cwd && f.cwd !== sessionCwd) out.push(row('Runs in', f.cwd))
  if (folders.length === 1) out.push(...folderRows(folders[0]!.rows))
  else
    for (const fr of folders) out.push(fr.title, ...folderRows(fr.rows, '  '))
  if (folders.length === 0 && r.risk?.headline) out.push(row('Impact', clip(cap1(r.risk.headline), 160)))
  for (const g of r.riskGroups ?? []) if (!g.subset && !(g.extra && folders.length > 0)) out.push(...list(g.title, g.rows, g.more, max))
  // a scanned folder already has its name in the headline and its size in the rows above
  const scanned = folders.length === 1 && folders[0]!.rows.some(([k]) => k === 'Size')
  r.groups.forEach((g, k) => {
    if (k === 0 && scanned && g.rows.length <= 1 && g.more === 0) return
    if (g.extra && scanned) return
    out.push(...list(g.title, g.rows, g.more, max))
  })
  if (folders.length === 0 && r.summary.length && r.items !== 1) out.push(row('Total', r.summary.join('; ')))
  const notes = r.notes.filter(n => !(folders.length > 0 && n === PUSHED_NOTE)).slice(0, MAX_NOTES)
  for (const n of notes) out.push(row('Note', clip(cap1(n), 120)))
  if (r.unmeasured && r.unmeasured !== 'native Windows') out.push(row('Not checked', clip(cap1(r.unmeasured), 120)))
  return out
}

/** The question shown in the dialog. Ends in a question mark, as the dialog wants. */
export function dialogText(command: string, reports: Report[], unlisted: number, sessionCwd?: string, maxRows = DEFAULT_ROWS): string {
  const many = reports.length > 1
  const lines: string[] = []
  if (many) lines.push(`${WORD[worst(reports)]} risk · ${reports.length + unlisted} risky commands`, '')
  else lines.push(`${WORD[worst(reports)]} risk · ${reports[0] ? clip(actionOf(reports[0]), 90) : 'risky command'}`, clip(oneLine(command), 200), '')
  reports.forEach(r => {
    if (many) lines.push(`${WORD[levelOf(r)]} · ${clip(actionOf(r), 80)}`, `  ${clip(oneLine(r.finding.command || r.finding.kind), 120)}`)
    const d = details(r, sessionCwd, maxRows)
    lines.push(...(many ? d.map(x => `  ${x}`) : d), '')
  })
  if (unlisted > 0) lines.push(`+${unlisted} more risky ${unlisted === 1 ? 'command' : 'commands'}, not checked`, '')
  // the closing question is never clipped away: the dialog wants the text to end in a question mark
  const footer = [...(reports.some(r => (r.folders ?? []).length > 0) ? [FOOTNOTE, ''] : []), 'Run this command?']
  const body = lines.join('\n')
  return clip(body, 6000 - footer.join('\n').length - 1) + '\n' + footer.join('\n')
}

/** One line per fact, short: what the model reads after a refusal. */
export function summaryLines(reports: Report[], maxRows = 6): string[] {
  const out: string[] = []
  for (const r of reports) {
    out.push(`${WORD[levelOf(r)]} risk · ${actionOf(r)}${r.finding.cwd ? ` (in ${r.finding.cwd})` : ''}`)
    const folders = r.folders ?? []
    if (folders.length === 0 && r.risk?.headline) out.push(`  Impact: ${clip(r.risk.headline, 220)}`)
    for (const fr of folders) out.push(`  ${clip(fr.title, 120)} · Recoverable: ${clip(fr.rows.at(-1)?.[1] ?? '', 200)}`)
    let left = maxRows
    for (const g of r.groups)
      for (const x of g.rows.slice(0, left)) (out.push(`  ${clip(x, 120)}`), left--)
    if (r.items !== 1) out.push(...r.summary.map(s => `  Total: ${s}`))
    if (r.unmeasured) out.push(`  Not checked: ${clip(r.unmeasured, 120)}`)
  }
  return out
}

export function denyText(why: string, command: string, reports: Report[]): string {
  return clip(
    [
      `Blocked by command-guard (${why}). Not run: ${clip(oneLine(command), 200)}`,
      ...summaryLines(reports),
      'Ask the user before retrying, or use a narrower, reversible command.',
    ].join('\n'), 2500,
  )
}

/** One line (no line breaks): shown as a toast and in the status line. */
export function toastText(reports: Report[]): string {
  const total = reports.flatMap(r => r.summary)[0]?.replace(/^1 item, /, '')
  return oneLine(`Blocked ${clip(oneLine(reports[0]?.finding.command ?? 'command'), 60)}${total ? ` · ${total}` : ''}`)
}
