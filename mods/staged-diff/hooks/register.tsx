// staged-diff: `/staged-diff [path]` shows what would go into the next commit (git diff --cached, the stat and the
// diff) in a pane, with a Refresh button. Read-only: it starts `git` (and nothing else) only when asked.
// FAIL OPEN: it hooks no tool call and refuses nothing; a git error is shown in the pane, never thrown.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { StagedReviewReport } from '../types'
import { LIMIT, STAT_LIMIT, bound, checkPath, clean, gitArgs, summaryOf } from './lib'

type Dollar = EngineInterface

const COMMAND = 'staged-diff'
const PANE = 'staged-diff'
const TITLE = 'Staged'
const TIMEOUT_MS = 15000

const report = atom({ plugin: 'staged-diff', key: 'report' } as const, null)

/** Runs one git command; any failure comes back as text, never as a throw. */
async function git($: Dollar, argv: string[]): Promise<{ out: string; err: string; isTruncated: boolean }> {
  try {
    const ran = await $.process.run(argv, { timeoutMs: TIMEOUT_MS })
    if (ran.exitCode !== 0) return { out: '', err: clean(ran.stderr || `git exited with ${ran.exitCode}`).trim(), isTruncated: false }

    return { out: clean(ran.stdout), err: '', isTruncated: ran.isStdoutTruncated === true }
  } catch (error) {
    return { out: '', err: `could not start git (${error instanceof Error ? error.message : 'unknown error'})`, isTruncated: false }
  }
}

/** Reads the index through git and keeps a bounded copy in `$.state`. */
async function load($: Dollar, path: string): Promise<StagedReviewReport> {
  const argv = gitArgs(path)
  const at = await $.clock.now()
  const stat = await git($, argv.stat)
  let next: StagedReviewReport
  if (stat.err !== '') {
    next = { path, stat: '', diff: '', isEmpty: false, isCut: false, error: bound(stat.err, 600).text, at }
  } else if (stat.out.trim() === '') {
    next = { path, stat: '', diff: '', isEmpty: true, isCut: false, error: '', at }
  } else {
    const diff = await git($, argv.diff)
    const shownStat = bound(stat.out.trimEnd(), STAT_LIMIT)
    const shownDiff = bound(diff.err !== '' ? `git diff failed: ${diff.err}` : diff.out.trimEnd(), LIMIT - shownStat.text.length)
    const isCut = shownStat.isCut || shownDiff.isCut || stat.isTruncated || diff.isTruncated
    next = { path, stat: shownStat.text, diff: shownDiff.text, isEmpty: false, isCut, error: '', at }
  }
  await update($, report, () => next)

  return next
}

function headline(r: StagedReviewReport): string {
  const where = r.path === '' ? '' : ` (${r.path})`
  if (r.error !== '') return `staged-diff · git could not be read${where}\n${r.error.split('\n')[0]}`
  if (r.isEmpty) return `staged-diff · Nothing is staged${where}.`

  return `staged-diff${where} · ${summaryOf(r.stat)}`
}

async function run($: Dollar, args: string): Promise<string> {
  const checked = checkPath(args)
  if ('error' in checked) return `staged-diff · ${checked.error}\nUse /staged-diff or /staged-diff <path>.`
  const r = await load($, checked.path)
  const opened = await $.ui.open({ id: PANE, title: TITLE, columns: 90 })
  const surfaces = await $.session.surfaces().catch(() => ['terminal'])
  if (!opened.isPlaced || surfaces.length === 0) {
    // Nothing will draw the pane now: say the short version here.
    return [headline(r), r.stat].filter(Boolean).join('\n')
  }

  return headline(r)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: COMMAND, description: 'Show the staged diff (what the next commit would hold) in a pane', argumentHint: '[path]' })
    } catch {
      // fail-open: the session goes on without the command
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await run($, e.args) })).catch(() => ({
    text: 'staged-diff · something went wrong, nothing was changed',
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code, Text } = $.ui.resolve(e)
    const r = await read($, report)
    const refresh = (
      <Button key="refresh" label="Refresh" hotkey="r" onPress={async () => void (await load($, r?.path ?? ''))} />
    )
    if (r === null) {
      return (
        <Box flexDirection="column">
          <Text dimColor>Nothing read yet.</Text>
          {refresh}
        </Box>
      )
    }
    const where = r.path === '' ? 'the whole index' : r.path

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>Staged · {where} </Text>
          {refresh}
        </Box>
        {r.error !== '' && <Text color="yellow">git could not be read: {r.error}</Text>}
        {r.isEmpty && <Text>Nothing is staged.</Text>}
        {r.stat !== '' && <Text>{r.stat}</Text>}
        {r.diff !== '' && <Code source={r.diff} language="diff" />}
        {r.isCut && <Text dimColor>Cut to {LIMIT} characters. Run git diff --cached yourself for the rest.</Text>}
      </Box>
    )
  })
}
